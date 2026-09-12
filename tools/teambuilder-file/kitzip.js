/*
 * kitzip.js — minimal reader for the .zip a cfbuniformcreator.com export
 * comes in (kit.json plus a textures/ folder). Handles stored and deflated
 * entries, which is all the export uses. No dependencies.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TBKitZip = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const u16 = (b, o) => b[o] | (b[o + 1] << 8);
  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000;

  function findEOCD(b) {
    for (let i = b.length - 22; i >= 0 && i > b.length - 0x10000; i--) {
      if (b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 0x05 && b[i + 3] === 0x06) return i;
    }
    return -1;
  }

  /** @returns {Promise<Map<string, Uint8Array>>} path -> contents */
  async function read(bytes, inflateRaw) {
    const eocd = findEOCD(bytes);
    if (eocd < 0) throw new Error('not a zip archive');
    const count = u16(bytes, eocd + 10);
    let p = u32(bytes, eocd + 16);
    const out = new Map();
    for (let i = 0; i < count; i++) {
      if (u32(bytes, p) !== 0x02014b50) throw new Error('bad zip central directory at ' + p);
      const method = u16(bytes, p + 10);
      const compSize = u32(bytes, p + 20);
      const nameLen = u16(bytes, p + 28);
      const extraLen = u16(bytes, p + 30);
      const commentLen = u16(bytes, p + 32);
      const localOff = u32(bytes, p + 42);
      const name = decodeName(bytes.subarray(p + 46, p + 46 + nameLen));
      p += 46 + nameLen + extraLen + commentLen;
      if (name.endsWith('/')) continue;
      if (u32(bytes, localOff) !== 0x04034b50) throw new Error('bad zip local header for ' + name);
      const lNameLen = u16(bytes, localOff + 26);
      const lExtraLen = u16(bytes, localOff + 28);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const raw = bytes.subarray(dataStart, dataStart + compSize);
      if (method === 0) out.set(name, raw.slice());
      else if (method === 8) out.set(name, await inflateRaw(raw));
      else throw new Error('unsupported zip compression method ' + method + ' for ' + name);
    }
    return out;
  }

  function decodeName(b) {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(b);
    return Buffer.from(b).toString('utf8');
  }

  /** Read an export and return {json, files}. */
  async function readKit(bytes, inflateRaw) {
    const files = await read(bytes, inflateRaw);
    let jsonName = null;
    for (const name of files.keys()) {
      if (/(^|\/)kit\.json$/i.test(name)) { jsonName = name; break; }
    }
    if (!jsonName) throw new Error('no kit.json in this archive — is it a uniform creator export?');
    const text = typeof TextDecoder !== 'undefined'
      ? new TextDecoder('utf-8').decode(files.get(jsonName))
      : Buffer.from(files.get(jsonName)).toString('utf8');
    const prefix = jsonName.slice(0, jsonName.length - 'kit.json'.length);
    const rebased = new Map();
    for (const [name, data] of files) {
      rebased.set(prefix && name.startsWith(prefix) ? name.slice(prefix.length) : name, data);
    }
    return { json: JSON.parse(text), files: rebased };
  }

  function inflateRawNode(zlibModule) {
    return (b) => new Uint8Array(zlibModule.inflateRawSync(Buffer.from(b.buffer, b.byteOffset, b.byteLength)));
  }
  function inflateRawWeb() {
    return async (b) => {
      const rs = new Blob([b]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(rs).arrayBuffer());
    };
  }

  return { read, readKit, inflateRawNode, inflateRawWeb };
});
