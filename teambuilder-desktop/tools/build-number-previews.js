// Packs the jersey-number preview digits into src/assets/number-previews/.
//
// Source: the preview assets shipped with the CFB TEAMBUILDER Offline Editor
// (assets/preview_assets/manifest.json + number_previews.zip). Unzip
// number_previews.zip into a folder first, then run:
//
//   node tools/build-number-previews.js <manifest.json> <unzipped number_previews dir>
//
// Each digit is 120x120 RGBA: R/G/B are coverage masks for the number's
// colorR/colorG/colorB tints and A is the digit's opacity. Every font becomes
// one gzip file holding digits 0-9 back to back (missing digits are zero-filled),
// plus an index.json that maps the font's texture path to that file.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DIGIT_BYTES = 120 * 120 * 4;
const [manifestPath, digitsDir] = process.argv.slice(2);
if (!manifestPath || !digitsDir) {
  console.error('usage: node tools/build-number-previews.js <manifest.json> <number_previews dir>');
  process.exit(1);
}

const outDir = path.join(__dirname, '..', 'src', 'assets', 'number-previews');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const normalize = (p) => p.replace('/uniforms/comp/', '/uniforms/').toLowerCase();
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const index = {};
const written = new Map();
let bytes = 0;

for (const [fontPath, info] of Object.entries(manifest.numberFonts)) {
  const file = `${info.set}.gz`;
  if (!written.has(info.set)) {
    const packed = Buffer.alloc(DIGIT_BYTES * 10);
    const digits = [];
    for (const d of info.digits) {
      const src = path.join(digitsDir, info.set, `${d}.rgba`);
      if (!fs.existsSync(src)) continue;
      const raw = fs.readFileSync(src);
      if (raw.length !== DIGIT_BYTES) throw new Error(`${src}: expected ${DIGIT_BYTES} bytes, got ${raw.length}`);
      raw.copy(packed, d * DIGIT_BYTES);
      digits.push(d);
    }
    const gz = zlib.gzipSync(packed, { level: 9 });
    fs.writeFileSync(path.join(outDir, file), gz);
    bytes += gz.length;
    written.set(info.set, digits);
  }
  index[normalize(fontPath)] = { file, digits: written.get(info.set) };
}

fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index));
console.log(`${Object.keys(index).length} fonts, ${written.size} files, ${(bytes / 1048576).toFixed(1)} MB`);
