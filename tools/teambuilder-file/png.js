/*
 * png.js — just enough PNG to make textures fit a save file: decode, spot an
 * image that carries no detail, box-downscale, re-encode. Pure JS, works in
 * the browser and in Node (zlib is passed in, same as tbfile.js).
 *
 * Handles the 8-bit colour types a texture export uses (grey, RGB, palette,
 * grey+alpha, RGBA), no interlacing.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TBPng = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

  function u32(b, o) { return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; }
  function put32(b, o, v) { b[o] = (v >>> 24) & 255; b[o + 1] = (v >>> 16) & 255; b[o + 2] = (v >>> 8) & 255; b[o + 3] = v & 255; }

  // ---------------------------------------------------------------- crc32
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  /** Chunk list, plus width/height/bitDepth/colorType from IHDR. */
  function chunks(bytes) {
    for (let i = 0; i < 8; i++) if (bytes[i] !== SIG[i]) throw new Error('not a PNG');
    const out = [];
    let p = 8;
    while (p + 8 <= bytes.length) {
      const len = u32(bytes, p);
      const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
      out.push({ type, data: bytes.subarray(p + 8, p + 8 + len) });
      p += 12 + len;
      if (type === 'IEND') break;
    }
    return out;
  }

  function info(bytes) {
    const ihdr = chunks(bytes).find(c => c.type === 'IHDR');
    if (!ihdr) throw new Error('PNG has no IHDR');
    return {
      width: u32(ihdr.data, 0), height: u32(ihdr.data, 4),
      bitDepth: ihdr.data[8], colorType: ihdr.data[9], interlace: ihdr.data[12],
      bytes: bytes.length,
    };
  }

  /** Decode to {width, height, rgba:Uint8Array}. */
  function decode(bytes, zlib) {
    const cs = chunks(bytes);
    const meta = info(bytes);
    if (meta.bitDepth !== 8) throw new Error('unsupported PNG bit depth ' + meta.bitDepth);
    if (meta.interlace) throw new Error('interlaced PNG not supported');
    const ch = CHANNELS[meta.colorType];
    if (!ch) throw new Error('unsupported PNG colour type ' + meta.colorType);

    let idatLen = 0;
    for (const c of cs) if (c.type === 'IDAT') idatLen += c.data.length;
    const idat = new Uint8Array(idatLen);
    let o = 0;
    for (const c of cs) if (c.type === 'IDAT') { idat.set(c.data, o); o += c.data.length; }
    const raw = zlib.inflateSync(idat);

    const { width: w, height: h } = meta;
    const stride = w * ch;
    const lines = new Uint8Array(h * stride);
    let rp = 0;
    for (let y = 0; y < h; y++) {
      const filter = raw[rp++];
      const row = lines.subarray(y * stride, (y + 1) * stride);
      const prev = y ? lines.subarray((y - 1) * stride, y * stride) : null;
      for (let x = 0; x < stride; x++) {
        const rawv = raw[rp + x];
        const a = x >= ch ? row[x - ch] : 0;
        const b = prev ? prev[x] : 0;
        const c = prev && x >= ch ? prev[x - ch] : 0;
        let v;
        switch (filter) {
          case 0: v = rawv; break;
          case 1: v = rawv + a; break;
          case 2: v = rawv + b; break;
          case 3: v = rawv + ((a + b) >> 1); break;
          case 4: {
            const p = a + b - c;
            const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
            v = rawv + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
            break;
          }
          default: throw new Error('bad PNG row filter ' + filter);
        }
        row[x] = v & 255;
      }
      rp += stride;
    }

    const rgba = new Uint8Array(w * h * 4);
    const plteChunk = cs.find(c => c.type === 'PLTE');
    const trnsChunk = cs.find(c => c.type === 'tRNS');
    for (let i = 0, n = w * h; i < n; i++) {
      const s = i * ch, d = i * 4;
      if (meta.colorType === 3) {
        const idx = lines[s];
        const plte = plteChunk.data;
        rgba[d] = plte[idx * 3]; rgba[d + 1] = plte[idx * 3 + 1]; rgba[d + 2] = plte[idx * 3 + 2];
        rgba[d + 3] = trnsChunk && idx < trnsChunk.data.length ? trnsChunk.data[idx] : 255;
      } else if (meta.colorType === 0 || meta.colorType === 4) {
        rgba[d] = rgba[d + 1] = rgba[d + 2] = lines[s];
        rgba[d + 3] = meta.colorType === 4 ? lines[s + 1] : 255;
      } else {
        rgba[d] = lines[s]; rgba[d + 1] = lines[s + 1]; rgba[d + 2] = lines[s + 2];
        rgba[d + 3] = meta.colorType === 6 ? lines[s + 3] : 255;
      }
    }
    return { width: w, height: h, rgba };
  }

  /** Encode RGBA (or RGB when every pixel is opaque) as a PNG. */
  function encode(img, zlib) {
    const { width: w, height: h, rgba } = img;
    let opaque = true;
    for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) { opaque = false; break; }
    const ch = opaque ? 3 : 4;
    const stride = w * ch;
    const raw = new Uint8Array(h * (stride + 1));
    for (let y = 0; y < h; y++) {
      raw[y * (stride + 1)] = 0;                     // filter: none
      const dst = y * (stride + 1) + 1;
      for (let x = 0; x < w; x++) {
        const s = (y * w + x) * 4, d = dst + x * ch;
        raw[d] = rgba[s]; raw[d + 1] = rgba[s + 1]; raw[d + 2] = rgba[s + 2];
        if (!opaque) raw[d + 3] = rgba[s + 3];
      }
    }
    const idat = zlib.deflateSync(raw, { level: 9 });
    const ihdr = new Uint8Array(13);
    put32(ihdr, 0, w); put32(ihdr, 4, h);
    ihdr[8] = 8; ihdr[9] = opaque ? 2 : 6;
    const parts = [];
    const chunk = (type, data) => {
      const out = new Uint8Array(12 + data.length);
      put32(out, 0, data.length);
      for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
      out.set(data, 8);
      put32(out, 8 + data.length, crc32(out.subarray(4, 8 + data.length)));
      parts.push(out);
    };
    chunk('IHDR', ihdr);
    chunk('IDAT', idat);
    chunk('IEND', new Uint8Array(0));
    const total = 8 + parts.reduce((a, p) => a + p.length, 0);
    const out = new Uint8Array(total);
    out.set(SIG, 0);
    let o = 8;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  /** Box-filter downscale so the longest edge is at most maxDim. */
  function downscale(img, maxDim) {
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    if (scale >= 1) return img;
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const out = new Uint8Array(w * h * 4);
    const xr = img.width / w, yr = img.height / h;
    for (let y = 0; y < h; y++) {
      const y0 = Math.floor(y * yr), y1 = Math.min(img.height, Math.max(y0 + 1, Math.floor((y + 1) * yr)));
      for (let x = 0; x < w; x++) {
        const x0 = Math.floor(x * xr), x1 = Math.min(img.width, Math.max(x0 + 1, Math.floor((x + 1) * xr)));
        let r = 0, g = 0, b = 0, a = 0, n = 0;
        for (let sy = y0; sy < y1; sy++) {
          for (let sx = x0; sx < x1; sx++) {
            const s = (sy * img.width + sx) * 4;
            r += img.rgba[s]; g += img.rgba[s + 1]; b += img.rgba[s + 2]; a += img.rgba[s + 3]; n++;
          }
        }
        const d = (y * w + x) * 4;
        out[d] = Math.round(r / n); out[d + 1] = Math.round(g / n);
        out[d + 2] = Math.round(b / n); out[d + 3] = Math.round(a / n);
      }
    }
    return { width: w, height: h, rgba: out };
  }

  /**
   * Is this image carrying detail worth storing? A baked normal or rsm map
   * that came out uniform tells the renderer nothing the in-game asset does
   * not already say, and those are the big files.
   *
   * @returns {{flat:boolean, spread:number, colour:number[]}}
   */
  function flatness(img, tolerance) {
    const tol = tolerance == null ? 2 : tolerance;
    const n = img.width * img.height;
    const step = Math.max(1, Math.floor(n / 20000));      // sample, do not scan 4M pixels
    const min = [255, 255, 255, 255], max = [0, 0, 0, 0];
    const sum = [0, 0, 0, 0];
    let count = 0;
    for (let i = 0; i < n; i += step) {
      const s = i * 4;
      for (let c = 0; c < 4; c++) {
        const v = img.rgba[s + c];
        if (v < min[c]) min[c] = v;
        if (v > max[c]) max[c] = v;
        sum[c] += v;
      }
      count++;
    }
    let spread = 0;
    for (let c = 0; c < 4; c++) spread = Math.max(spread, max[c] - min[c]);
    return { flat: spread <= tol, spread, colour: sum.map(v => Math.round(v / count)) };
  }

  function nodeZlib(zlibModule) {
    return {
      inflateSync: (b) => new Uint8Array(zlibModule.inflateSync(Buffer.from(b.buffer, b.byteOffset, b.byteLength))),
      deflateSync: (b, o) => new Uint8Array(zlibModule.deflateSync(Buffer.from(b.buffer, b.byteOffset, b.byteLength), o || { level: 9 })),
    };
  }

  /**
   * The imaging interface textures.js works against, backed by the pure-JS
   * codec above. The browser hands it a canvas-backed one instead, because
   * CompressionStream is async and this codec needs zlib synchronously.
   */
  function imaging(zlib) {
    return {
      decode: (bytes) => decode(bytes, zlib),
      encode: (img) => encode(img, zlib),
      downscale: (img, maxDim) => downscale(img, maxDim),
      flatness: (img, tol) => flatness(img, tol),
    };
  }

  return { info, decode, encode, downscale, flatness, chunks, crc32, nodeZlib, imaging };
});
