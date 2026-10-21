// CFB 27 TEAMBUILDER save package ("FBCHUNKS") container, main process only.
// Layout, as handled by the CFB TEAMBUILDER Offline Editor (JCothron2):
//   0   "FBCHUNKS"
//   10  uint32 LE  header length -> data starts at 18 + header length
//   14  uint32 LE  capacity      -> size of the data area (to end of file)
//   data area: one zlib stream holding the TDF team data, zero-padded to capacity
// There is no checksum. Saving keeps the header and the file size unchanged:
// the new zlib stream goes in the same place, padded with zeros.
const zlib = require('zlib');

const MAGIC = Buffer.from('FBCHUNKS', 'latin1');
const KNOWN_LAYOUT = { offset: 17950, size: 7864338 }; // every package the Offline Editor accepts
const MAX_PLAIN = 64 * 1024 * 1024;

const isPackage = (buf) => buf.length >= 18 && buf.subarray(0, 8).equals(MAGIC);

function readPackage(buf) {
  if (!isPackage(buf)) throw new Error('This is not a TEAMBUILDER save package (no FBCHUNKS header).');
  const offset = 18 + buf.readUInt32LE(10);
  const capacity = buf.readUInt32LE(14);
  if (offset >= buf.length || capacity !== buf.length - offset) {
    throw new Error('This save package layout is not supported. Nothing was changed.');
  }
  let result;
  try {
    result = zlib.inflateSync(buf.subarray(offset), { info: true, maxOutputLength: MAX_PLAIN });
  } catch (err) {
    throw new Error(`The team data in this save could not be unpacked (${err.code || err.message}).`);
  }
  const used = result.engine.bytesWritten;
  const tail = buf.subarray(offset + used);
  if (tail.some((b) => b !== 0)) throw new Error('Unexpected data after the team data. Nothing was changed.');
  return {
    offset,
    capacity,
    plain: new Uint8Array(result.buffer),
    knownLayout: offset === KNOWN_LAYOUT.offset && buf.length === KNOWN_LAYOUT.size,
  };
}

// New package bytes: original header, recompressed data, zero padding to the
// same capacity. Verified by unpacking it again.
function writePackage(original, pkg, plain) {
  const packed = zlib.deflateSync(Buffer.from(plain), { level: 9 });
  if (packed.length > pkg.capacity) throw new Error('The edited team data no longer fits in this save file.');
  const out = Buffer.concat([original.subarray(0, pkg.offset), packed, Buffer.alloc(pkg.capacity - packed.length)]);
  const check = readPackage(out);
  if (!Buffer.from(check.plain).equals(Buffer.from(plain)) || out.length !== original.length) {
    throw new Error('Repacking verification failed. Nothing was saved.');
  }
  return out;
}

// Test helper: a package around TDF data, laid out like a real one.
function buildPackage(plain, { headerLength = KNOWN_LAYOUT.offset - 18, size = null } = {}) {
  const packed = zlib.deflateSync(Buffer.from(plain), { level: 6 });
  const offset = 18 + headerLength;
  const total = size || offset + packed.length + 4096;
  const head = Buffer.alloc(offset);
  MAGIC.copy(head, 0);
  head.writeUInt32LE(headerLength, 10);
  head.writeUInt32LE(total - offset, 14);
  return Buffer.concat([head, packed, Buffer.alloc(total - offset - packed.length)]);
}

module.exports = { isPackage, readPackage, writePackage, buildPackage, KNOWN_LAYOUT };
