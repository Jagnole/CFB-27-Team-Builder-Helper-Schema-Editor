// EA "TDF" binary encoding, as used inside CFB 27 TEAMBUILDER save packages.
// Format notes come from the CFB TEAMBUILDER Offline Editor (by JCothron2),
// which edits these files directly.
//
// A struct is a run of fields ended by a 0x00 byte. Each field is:
//   3-byte tag  -> four 6-bit letters (+32), e.g. "TXID"
//   1-byte type -> 0 int, 1 string, 2 blob, 3 struct, 4 list, 5 map, 10 float
//   value
// Ints (and lengths/counts) are variable-length: the first byte holds 6 value
// bits, a sign bit (0x40) and a continue bit (0x80); following bytes hold 7
// value bits each. Strings are length-prefixed UTF-8 including a trailing NUL.
// Floats are 4-byte big-endian IEEE 754. Lists carry an element type and count;
// maps carry key type, value type and count.
//
// decode() keeps the byte range of every leaf value so edits can be spliced
// back in place without re-encoding anything else (the Offline Editor's approach).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TBTdf = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const T = { INT: 0, STRING: 1, BLOB: 2, STRUCT: 3, LIST: 4, MAP: 5, FLOAT: 10 };
  const MAX_COUNT = 1000000;

  const tagToString = (b0, b1, b2) => {
    const n = (b0 << 16) | (b1 << 8) | b2;
    return [18, 12, 6, 0].map((s) => String.fromCharCode(((n >> s) & 63) + 32)).join('').trimEnd();
  };

  function tagToBytes(tag) {
    const t = tag.padEnd(4, ' ');
    let n = 0;
    for (let i = 0; i < 4; i++) {
      const c = t.charCodeAt(i) - 32;
      if (c < 0 || c > 63) throw new Error(`Invalid TDF tag "${tag}".`);
      n = (n << 6) | c;
    }
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function encodeInt(value) {
    if (!Number.isSafeInteger(value)) throw new Error('TDF ints must be whole numbers.');
    let v = Math.abs(value);
    const out = [(v & 63) | (value < 0 ? 64 : 0)];
    v = Math.floor(v / 64);
    while (v > 0) {
      out[out.length - 1] |= 128;
      out.push(v & 127);
      v = Math.floor(v / 128);
    }
    return Uint8Array.from(out);
  }

  const utf8 = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
  const utf8d = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8', { fatal: true }) : null;

  function encodeString(s) {
    const body = utf8.encode(String(s));
    const len = encodeInt(body.length + 1);
    const out = new Uint8Array(len.length + body.length + 1);
    out.set(len, 0);
    out.set(body, len.length);
    return out;
  }

  function encodeFloat(f) {
    const out = new Uint8Array(4);
    new DataView(out.buffer).setFloat32(0, f, false);
    return out;
  }

  // ---------- decode ----------
  function decode(bytes) {
    let p = 0;
    const need = (n) => { if (n < 0 || p + n > bytes.length) throw new Error(`TDF data ends early at byte ${p}.`); };
    const take = (n) => { need(n); const v = bytes.subarray(p, p + n); p += n; return v; };
    const readInt = () => {
      let x = take(1)[0];
      let v = x & 63;
      const neg = x & 64;
      let mul = 64;
      while (x & 128) {
        x = take(1)[0];
        v += (x & 127) * mul;
        mul *= 128;
        if (mul > 2 ** 70) throw new Error('TDF int too long.');
      }
      return neg ? -v : v;
    };
    const count = () => {
      const n = readInt();
      if (n < 0 || n >= MAX_COUNT) throw new Error(`Unreasonable TDF count ${n} at byte ${p}.`);
      return n;
    };

    function value(t) {
      const start = p;
      switch (t) {
        case T.INT: return { t, v: readInt(), s: start, e: p };
        case T.STRING: {
          const n = count();
          const b = take(n);
          if (!n || b[n - 1] !== 0) throw new Error(`Unterminated TDF string at byte ${start}.`);
          return { t, v: utf8d.decode(b.subarray(0, n - 1)), s: start, e: p };
        }
        case T.BLOB: {
          const n = count();
          const b = take(n);
          return { t, size: n, bytes: b, s: start, e: p };
        }
        case T.STRUCT: return { t, fields: fields(false), s: start, e: p };
        case T.LIST: {
          const et = take(1)[0];
          const n = count();
          const items = [];
          for (let i = 0; i < n; i++) items.push(value(et));
          return { t, et, items, s: start, e: p };
        }
        case T.MAP: {
          const [kt, vt] = take(2);
          const n = count();
          const entries = [];
          for (let i = 0; i < n; i++) entries.push({ k: value(kt), v: value(vt) });
          return { t, kt, vt, entries, s: start, e: p };
        }
        case T.FLOAT: {
          const b = take(4);
          return { t, v: new DataView(b.buffer, b.byteOffset, 4).getFloat32(0, false), s: start, e: p };
        }
        default: throw new Error(`Unknown TDF type ${t} at byte ${start}.`);
      }
    }

    function fields(isRoot) {
      const out = [];
      while (p < bytes.length) {
        if (bytes[p] === 0) { p++; return out; }
        const tb = take(3);
        const tag = tagToString(tb[0], tb[1], tb[2]);
        const t = take(1)[0];
        out.push({ tag, node: value(t) });
      }
      if (!isRoot) throw new Error('TDF struct is not terminated.');
      return out;
    }

    const rootFields = fields(true);
    if (p !== bytes.length) throw new Error('Unexpected data after the TDF root.');
    return { t: T.STRUCT, fields: rootFields, s: 0, e: bytes.length };
  }

  // ---------- encode (used to build test packages; edits are spliced) ----------
  // Collects byte chunks (embedded images can be megabytes) and joins them once.
  function encode(rootNode) {
    const chunks = [];
    let size = 0;
    const put = (b) => { chunks.push(b); size += b.length; };
    const byte = (...b) => put(Uint8Array.from(b));
    function value(node) {
      switch (node.t) {
        case T.INT: put(encodeInt(node.v)); break;
        case T.STRING: put(encodeString(node.v)); break;
        case T.BLOB: put(encodeInt(node.bytes.length)); put(node.bytes); break;
        case T.STRUCT: fields(node.fields); byte(0); break;
        case T.LIST: byte(node.et); put(encodeInt(node.items.length)); node.items.forEach(value); break;
        case T.MAP: byte(node.kt, node.vt); put(encodeInt(node.entries.length)); node.entries.forEach(({ k, v }) => { value(k); value(v); }); break;
        case T.FLOAT: put(encodeFloat(node.v)); break;
        default: throw new Error(`Unknown TDF type ${node.t}.`);
      }
    }
    function fields(list) {
      list.forEach(({ tag, node }) => { byte(...tagToBytes(tag), node.t); value(node); });
    }
    fields(rootNode.fields);
    const out = new Uint8Array(size);
    let o = 0;
    chunks.forEach((c) => { out.set(c, o); o += c.length; });
    return out;
  }

  // Replaces byte ranges [s, e) with new bytes. Ranges must not overlap.
  function splice(bytes, edits) {
    const sorted = [...edits].sort((a, b) => a.s - b.s);
    const parts = [];
    let pos = 0;
    sorted.forEach(({ s, e, bytes: b }) => {
      if (s < pos || e < s) throw new Error('Overlapping TDF edits.');
      parts.push(bytes.subarray(pos, s), b);
      pos = e;
    });
    parts.push(bytes.subarray(pos));
    const out = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
    let o = 0;
    parts.forEach((x) => { out.set(x, o); o += x.length; });
    return out;
  }

  return { T, decode, encode, splice, encodeInt, encodeString, encodeFloat, tagToBytes, tagToString };
});
