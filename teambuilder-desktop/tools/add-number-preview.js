// Adds one number font's preview digits to src/assets/number-previews/.
//
//   node tools/add-number-preview.js <digits dir> <font texture path> [--left-set 10]
//
// <digits dir> is the output of tools/dds-digits.py (<layer>.rgba + meta.json).
// --left-set 10: the font has a second set of digits in layers 10-19 for the
// left (tens) digit of two-digit numbers (check which set tapers on which side).
// The digits are resampled to the 120x120 preview size (area average, alpha
// weighted so transparent edges don't bleed) and packed like the rest, and
// index.json gains an entry for the font path. Other fonts are left alone.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 120;
const args = process.argv.slice(2);
const flag = args.indexOf('--left-set');
const leftSet = flag >= 0 ? Number(args.splice(flag, 2)[1]) : 0;
const [digitsDir, fontPath] = args;
if (!digitsDir || !fontPath || !/\/numbers\/[^/]+_NUM_Array$/i.test(fontPath)) {
  console.error('usage: node tools/add-number-preview.js <digits dir> <content/.../numbers/<Name>_NUM_Array>');
  process.exit(1);
}
const meta = JSON.parse(fs.readFileSync(path.join(digitsDir, 'meta.json'), 'utf8'));

// Area-average resample of straight RGBA, computed on alpha-premultiplied values.
function resample(src, w, h) {
  const weights = (n) => {
    const scale = n / SIZE;
    return Array.from({ length: SIZE }, (_, o) => {
      const a = o * scale;
      const b = a + scale;
      const taps = [];
      for (let i = Math.floor(a); i < Math.ceil(b); i++) {
        const wgt = Math.min(b, i + 1) - Math.max(a, i);
        if (wgt > 0) taps.push([i, wgt / scale]);
      }
      return taps;
    });
  };
  const wx = weights(w);
  const wy = weights(h);
  const mid = new Float64Array(SIZE * h * 4);
  for (let y = 0; y < h; y++) {
    for (let ox = 0; ox < SIZE; ox++) {
      const acc = [0, 0, 0, 0];
      for (const [x, k] of wx[ox]) {
        const i = (y * w + x) * 4;
        const a = src[i + 3] / 255;
        acc[0] += src[i] * a * k; acc[1] += src[i + 1] * a * k; acc[2] += src[i + 2] * a * k; acc[3] += src[i + 3] * k;
      }
      mid.set(acc, (y * SIZE + ox) * 4);
    }
  }
  const out = Buffer.alloc(SIZE * SIZE * 4);
  for (let oy = 0; oy < SIZE; oy++) {
    for (let ox = 0; ox < SIZE; ox++) {
      const acc = [0, 0, 0, 0];
      for (const [y, k] of wy[oy]) {
        const i = (y * SIZE + ox) * 4;
        for (let c = 0; c < 4; c++) acc[c] += mid[i + c] * k;
      }
      const o = (oy * SIZE + ox) * 4;
      const a = acc[3] / 255;
      for (let c = 0; c < 3; c++) out[o + c] = a > 0 ? Math.round(Math.min(255, acc[c] / a)) : 0;
      out[o + 3] = Math.round(acc[3]);
    }
  }
  return out;
}

const layers = leftSet ? leftSet + 10 : 10;
const packed = Buffer.alloc(SIZE * SIZE * 4 * layers);
const digits = [];
for (let d = 0; d < layers; d++) {
  const file = path.join(digitsDir, `${d}.rgba`);
  if (!fs.existsSync(file)) continue;
  const src = fs.readFileSync(file);
  if (src.length !== meta.width * meta.height * 4) throw new Error(`${file}: expected ${meta.width}x${meta.height} RGBA`);
  resample(src, meta.width, meta.height).copy(packed, d * SIZE * SIZE * 4);
  digits.push(d);
}

const outDir = path.join(__dirname, '..', 'src', 'assets', 'number-previews');
const name = fontPath.split('/').pop();
const file = `${name}.gz`;
fs.writeFileSync(path.join(outDir, file), zlib.gzipSync(packed, { level: 9 }));
const indexPath = path.join(outDir, 'index.json');
const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
index[fontPath.replace('/uniforms/comp/', '/uniforms/').toLowerCase()] = leftSet ? { file, digits, leftSet } : { file, digits };
fs.writeFileSync(indexPath, JSON.stringify(index));
console.log(`${name}: layers ${digits.join(',')}${leftSet ? ` (left digit set starts at ${leftSet})` : ''} -> ${file}`);
