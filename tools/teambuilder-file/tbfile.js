/*
 * tbfile.js — codec for EA CFB 27 Team Builder save files (TEAMBUILDER-00N).
 *
 * A save file is an "FBCHUNKS" container: a fixed-size header block, one raw
 * zlib stream holding the whole team, then zero padding out to a fixed total
 * file size. Inside the zlib stream is a tagged tree (see FORMAT.md).
 *
 * No dependencies. Works in the browser and in Node; the only host-specific
 * part is zlib inflate/deflate, which is passed in (see zlibNode/zlibWeb).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TBFile = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- value types
  const T = {
    INT: 0x00,   // varint, sign in the first byte
    STR: 0x01,   // varint byte length (NUL included) + UTF-8 bytes
    BLOB: 0x02,  // varint byte length + raw bytes (PNG uploads live here)
    OBJ: 0x03,   // (hash24, type, value)* terminated by a 0x00 byte
    ARR: 0x04,   // elemType, varint count, values
    MAP: 0x05,   // keyType (always STR), valueType, varint count, (key, value)*
    F32: 0x0a,   // 4 bytes, big-endian IEEE-754
  };

  // ------------------------------------------------------------------- reader
  class Reader {
    constructor(bytes) { this.b = bytes; this.p = 0; }
    u8() { return this.b[this.p++]; }
    peek() { return this.b[this.p]; }
    raw(n) { const v = this.b.subarray(this.p, this.p + n); this.p += n; return v; }
    /* The first byte carries 6 value bits, a sign bit (0x40) and a continue
       bit (0x80); every further byte carries 7 more bits, low group first. */
    num() {
      let b = this.b[this.p++];
      const neg = (b & 0x40) !== 0;
      let v = b & 0x3f, sh = 6;
      while (b & 0x80) {
        b = this.b[this.p++];
        v += (b & 0x7f) * Math.pow(2, sh);
        sh += 7;
      }
      return neg ? -v : v;
    }
    str() {
      const n = this.num();
      if (n < 1) throw new Error('bad string length ' + n + ' at ' + this.p);
      const bytes = this.raw(n);
      if (bytes[n - 1] !== 0) throw new Error('unterminated string at ' + this.p);
      return utf8Decode(bytes.subarray(0, n - 1));
    }
    hash24() { const b = this.b, p = this.p; this.p += 3; return b[p] | (b[p + 1] << 8) | (b[p + 2] << 16); }
  }

  // ------------------------------------------------------------------- writer
  class Writer {
    constructor() { this.chunks = []; this.len = 0; }
    push(bytes) { this.chunks.push(bytes); this.len += bytes.length; }
    u8(v) { this.push(Uint8Array.of(v & 0xff)); }
    num(v) {
      const neg = v < 0; let n = neg ? -v : v;
      const out = [];
      let first = (n % 64) | (neg ? 0x40 : 0);
      let rest = Math.floor(n / 64);
      out.push(first | (rest ? 0x80 : 0));
      while (rest) {
        const g = rest % 128;
        rest = Math.floor(rest / 128);
        out.push(g | (rest ? 0x80 : 0));
      }
      this.push(Uint8Array.from(out));
    }
    str(s) {
      const body = utf8Encode(s);
      this.num(body.length + 1);
      this.push(body);
      this.u8(0);
    }
    hash24(h) { this.push(Uint8Array.of(h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff)); }
    bytes() {
      const out = new Uint8Array(this.len);
      let o = 0;
      for (const c of this.chunks) { out.set(c, o); o += c.length; }
      return out;
    }
  }

  // --------------------------------------------------------------- node model
  // int  -> {k:'i', v:Number}          f32  -> {k:'f', v:Number}
  // str  -> {k:'s', v:String}          blob -> {k:'b', v:Uint8Array}
  // obj  -> {k:'o', m:[{h,t,n}, ...]}  (h = field hash24, t = type, n = node)
  // arr  -> {k:'a', et:Number, items:[node, ...]}
  // map  -> {k:'m', vt:Number, entries:[[key, node], ...]}

  function readValue(r, t) {
    switch (t) {
      case T.INT: return { k: 'i', v: r.num() };
      case T.STR: return { k: 's', v: r.str() };
      case T.F32: return { k: 'f', v: readF32(r.raw(4)) };
      case T.BLOB: return { k: 'b', v: r.raw(r.num()).slice() };
      case T.OBJ: {
        const m = [];
        for (;;) {
          if (r.peek() === 0) { r.p++; return { k: 'o', m }; }
          const h = r.hash24(), tt = r.u8();
          m.push({ h, t: tt, n: readValue(r, tt) });
        }
      }
      case T.ARR: {
        const et = r.u8(), n = r.num(), items = [];
        for (let i = 0; i < n; i++) items.push(readValue(r, et));
        return { k: 'a', et, items };
      }
      case T.MAP: {
        const kt = r.u8(), vt = r.u8(), n = r.num();
        if (kt !== T.STR) throw new Error('unsupported map key type ' + kt);
        const entries = [];
        for (let i = 0; i < n; i++) entries.push([r.str(), readValue(r, vt)]);
        return { k: 'm', vt, entries };
      }
      default: throw new Error('unknown value type 0x' + t.toString(16) + ' at ' + r.p);
    }
  }

  function writeValue(w, node) {
    switch (node.k) {
      case 'i': w.num(node.v); break;
      case 's': w.str(node.v); break;
      case 'f': w.push(writeF32(node.v)); break;
      case 'b': w.num(node.v.length); w.push(node.v); break;
      case 'o':
        for (const f of node.m) { w.hash24(f.h); w.u8(f.t); writeValue(w, f.n); }
        w.u8(0);
        break;
      case 'a':
        w.u8(node.et); w.num(node.items.length);
        for (const it of node.items) writeValue(w, it);
        break;
      case 'm':
        w.u8(T.STR); w.u8(node.vt); w.num(node.entries.length);
        for (const [key, v] of node.entries) { w.str(key); writeValue(w, v); }
        break;
      default: throw new Error('bad node kind ' + node.k);
    }
  }

  const KIND_TO_TYPE = { i: T.INT, s: T.STR, f: T.F32, b: T.BLOB, o: T.OBJ, a: T.ARR, m: T.MAP };
  function typeOf(node) { return KIND_TO_TYPE[node.k]; }

  /** Parse the inflated payload: a flat sequence of top-level records. */
  function parsePayload(bytes) {
    const r = new Reader(bytes), recs = [];
    while (r.p < bytes.length) {
      const h = r.hash24(), t = r.u8();
      recs.push({ h, t, n: readValue(r, t) });
    }
    return recs;
  }

  /** Serialize records back to payload bytes. */
  function buildPayload(recs) {
    const w = new Writer();
    for (const rec of recs) { w.hash24(rec.h); w.u8(rec.t); writeValue(w, rec.n); }
    return w.bytes();
  }

  function cloneNode(node) {
    switch (node.k) {
      case 'i': case 's': case 'f': return { k: node.k, v: node.v };
      case 'b': return { k: 'b', v: node.v.slice() };
      case 'o': return { k: 'o', m: node.m.map(f => ({ h: f.h, t: f.t, n: cloneNode(f.n) })) };
      case 'a': return { k: 'a', et: node.et, items: node.items.map(cloneNode) };
      case 'm': return { k: 'm', vt: node.vt, entries: node.entries.map(([k2, v]) => [k2, cloneNode(v)]) };
      default: throw new Error('bad node kind ' + node.k);
    }
  }

  // ------------------------------------------------------------------ helpers
  function field(objNode, hash) {
    if (!objNode || objNode.k !== 'o') return null;
    const f = objNode.m.find(x => x.h === hash);
    return f ? f.n : null;
  }
  function setField(objNode, hash, node) {
    const f = objNode.m.find(x => x.h === hash);
    if (f) { f.n = node; f.t = typeOf(node); return; }
    objNode.m.push({ h: hash, t: typeOf(node), n: node });
  }
  function mapGet(mapNode, key) {
    const e = mapNode.entries.find(x => x[0] === key);
    return e ? e[1] : null;
  }
  function mapSet(mapNode, key, node) {
    const e = mapNode.entries.find(x => x[0] === key);
    if (e) { e[1] = node; return; }
    mapNode.entries.push([key, node]);
    mapNode.entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  }
  /** Depth-first walk. cb(node, path) for every node. */
  function walk(node, cb, path) {
    path = path || '';
    cb(node, path);
    if (node.k === 'o') for (const f of node.m) walk(f.n, cb, path + '/#' + f.h.toString(16).padStart(6, '0'));
    else if (node.k === 'a') node.items.forEach((it, i) => walk(it, cb, path + '[' + i + ']'));
    else if (node.k === 'm') for (const [key, v] of node.entries) walk(v, cb, path + '/' + key);
  }

  // ------------------------------------------------------------------ f32 i/o
  const _buf = new ArrayBuffer(4), _f32 = new Float32Array(_buf), _u8 = new Uint8Array(_buf);
  function readF32(b) { _u8[0] = b[3]; _u8[1] = b[2]; _u8[2] = b[1]; _u8[3] = b[0]; return _f32[0]; }
  function writeF32(v) { _f32[0] = v; return Uint8Array.of(_u8[3], _u8[2], _u8[1], _u8[0]); }

  // ------------------------------------------------------------------- utf8
  const _enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
  const _dec = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : null;
  function utf8Encode(s) {
    if (_enc) return _enc.encode(s);
    return Uint8Array.from(Buffer.from(s, 'utf8'));
  }
  function utf8Decode(b) {
    if (_dec) return _dec.decode(b);
    return Buffer.from(b).toString('utf8');
  }

  // --------------------------------------------------------------- container
  const MAGIC = 'FBCHUNKS';
  /* Offset 12 of the header block holds the size of the data region that
     follows it, so the payload starts at fileSize - that value. */
  const REGION_SIZE_OFFSET = 12;

  function isZlibHeader(bytes, i) {
    return i + 1 < bytes.length && bytes[i] === 0x78 &&
      ((bytes[i] << 8) | bytes[i + 1]) % 31 === 0;
  }

  function findStream(bytes) {
    const region = bytes[REGION_SIZE_OFFSET] | (bytes[REGION_SIZE_OFFSET + 1] << 8) |
      (bytes[REGION_SIZE_OFFSET + 2] << 16) | (bytes[REGION_SIZE_OFFSET + 3] * 0x1000000);
    const stated = bytes.length - region;
    if (region > 0 && stated > 8 && isZlibHeader(bytes, stated)) return stated;
    for (let i = 8; i < bytes.length - 1; i++) if (isZlibHeader(bytes, i)) return i;
    return -1;
  }

  /* The game writes its stream at best compression (0x78 0xDA). Only the
     informational level bits differ when another deflater writes it, so the
     header is normalized to match; every inflater ignores those bits. */
  function normalizeZlibHeader(bytes) {
    if (bytes.length > 1 && bytes[0] === 0x78) bytes[1] = 0xda;
    return bytes;
  }

  class Container {
    /** @param {Uint8Array} raw  @param {{inflate:Function}} zlib */
    static async open(raw, zlib) {
      for (let i = 0; i < MAGIC.length; i++) {
        if (raw[i] !== MAGIC.charCodeAt(i)) throw new Error('not a Team Builder save (no FBCHUNKS magic)');
      }
      const off = findStream(raw);
      if (off < 0) throw new Error('no zlib stream found in container');
      const c = new Container();
      c.raw = raw;
      c.streamOffset = off;
      c.header = raw.slice(0, off);
      c.totalSize = raw.length;
      const tail = raw.subarray(off);
      /* The browser's DecompressionStream refuses trailing bytes, so the zero
         padding has to be cut off exactly. Trailing zeros are counted back,
         then up to four are handed back in case the stream's own Adler-32
         checksum ends in zero bytes. */
      const trimmed = c.compressedLengthOf(tail);
      let lastError = null;
      for (let extra = 0; extra <= 4 && trimmed + extra <= tail.length; extra++) {
        try {
          c.payload = await zlib.inflate(tail.subarray(0, trimmed + extra));
          c.originalCompressedSize = trimmed + extra;
          return c;
        } catch (e) { lastError = e; }
      }
      throw new Error('could not decompress the save payload: ' + (lastError && lastError.message));
    }
    /* Padding after the stream is all zero, so the real stream length is the
       distance to the last non-zero byte. */
    compressedLengthOf(tail) {
      let end = tail.length;
      while (end > 0 && tail[end - 1] === 0) end--;
      return end;
    }
    /** Free space left in the container for a bigger compressed payload. */
    get freeSpace() { return this.totalSize - this.streamOffset - this.originalCompressedSize; }
    /**
     * Rebuild the whole file around a new payload, keeping the header and the
     * fixed total file size. Throws if the compressed payload no longer fits.
     */
    async build(payload, zlib) {
      const comp = normalizeZlibHeader(await zlib.deflate(payload));
      const used = this.streamOffset + comp.length;
      if (used > this.totalSize) {
        throw new Error('payload too large for this save file: needs ' + used +
          ' bytes, container holds ' + this.totalSize +
          ' (over by ' + (used - this.totalSize) + ' bytes)');
      }
      const out = new Uint8Array(this.totalSize);
      out.set(this.header, 0);
      out.set(comp, this.streamOffset);
      return out;
    }
  }

  // --------------------------------------------------------------- zlib hosts
  /** Node host: pass require('zlib'). */
  function zlibNode(zlibModule) {
    return {
      inflate: (b) => new Uint8Array(zlibModule.inflateSync(Buffer.from(b.buffer, b.byteOffset, b.byteLength))),
      deflate: (b) => new Uint8Array(zlibModule.deflateSync(Buffer.from(b.buffer, b.byteOffset, b.byteLength), { level: 9 })),
    };
  }
  /** Browser host: CompressionStream/DecompressionStream ('deflate' == zlib). */
  function zlibWeb() {
    const run = async (bytes, stream) => {
      const rs = new Blob([bytes]).stream().pipeThrough(stream);
      const buf = await new Response(rs).arrayBuffer();
      return new Uint8Array(buf);
    };
    return {
      inflate: (b) => run(b, new DecompressionStream('deflate')),
      deflate: (b) => run(b, new CompressionStream('deflate')),
    };
  }
  /** Pick whichever host we are running on. */
  function autoZlib() {
    if (typeof CompressionStream !== 'undefined') return zlibWeb();
    // eslint-disable-next-line no-undef
    return zlibNode(require('zlib'));
  }

  return {
    T, Reader, Writer, Container,
    parsePayload, buildPayload, readValue, writeValue, cloneNode, typeOf,
    findStream, normalizeZlibHeader,
    field, setField, mapGet, mapSet, walk,
    zlibNode, zlibWeb, autoZlib,
  };
});
