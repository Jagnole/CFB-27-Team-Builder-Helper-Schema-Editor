const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const M = require('../src/core/model.js');
const P = require('../src/core/preview.js');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/data/tb-data.json'), 'utf8'));
const previewDir = path.join(__dirname, '../src/assets/number-previews');
const index = JSON.parse(fs.readFileSync(path.join(previewDir, 'index.json'), 'utf8'));
const fontKey = (p) => p.replace('/uniforms/comp/', '/uniforms/').toLowerCase();

// Ten synthetic digits: a solid square in the middle, R mask on the left half,
// G mask on the right half, fully opaque.
function syntheticDigits() {
  const buf = new Uint8Array(P.DIGIT_BYTES * 10);
  for (let d = 0; d < 10; d++) {
    for (let y = 30; y < 90; y++) {
      for (let x = 30; x < 90; x++) {
        const i = d * P.DIGIT_BYTES + (y * P.DIGIT_SIZE + x) * 4;
        buf[i] = x < 60 ? 255 : 0;
        buf[i + 1] = x < 60 ? 0 : 255;
        buf[i + 3] = 255;
      }
    }
  }
  return buf;
}
const pixel = (r, x, y) => Array.from(r.pixels.slice((y * r.width + x) * 4, (y * r.width + x) * 4 + 3));

test('every catalog font has a packed preview with all ten digits', () => {
  const fonts = M.listNumberFonts(data);
  const missing = fonts.filter((f) => !index[fontKey(f.path)]);
  assert.deepEqual(missing.map((f) => f.displayName), []);
  for (const entry of new Map(Object.values(index).map((e) => [e.file, e])).values()) {
    assert.match(entry.file, /^[A-Za-z0-9_-]+\.gz$/);
    assert.ok(fs.existsSync(path.join(previewDir, entry.file)), entry.file);
  }
  const sample = Object.values(index)[0];
  assert.equal(zlib.gunzipSync(fs.readFileSync(path.join(previewDir, sample.file))).length, P.DIGIT_BYTES * 10);
});

test('mask channels take the number colors and transparent pixels keep the background', () => {
  const r = P.renderNumber({ number: '7', digits: syntheticDigits(), colors: ['#ff0000', '#00ff00', '#0000ff'], background: '#000000', spacing: -0.5, scaleZ: 1, scaleW: 1 });
  assert.deepEqual(r.missing, []);
  const cx = r.width / 2;
  const cy = Math.round(r.height * 0.48);
  assert.deepEqual(pixel(r, cx - 15, cy), [255, 0, 0]);
  assert.deepEqual(pixel(r, cx + 15, cy), [0, 255, 0]);
  const bg = pixel(r, 5, 5);
  assert.ok(bg.every((c) => c <= 22), `background stays dark, got ${bg}`);
});

test('a smaller stored scale draws a bigger number', () => {
  const opts = { number: '1', digits: syntheticDigits(), colors: ['#ffffff'], background: '#000000', spacing: -0.5 };
  const width = (r) => {
    const y = Math.round(r.height * 0.48);
    let n = 0;
    for (let x = 0; x < r.width; x++) if (pixel(r, x, y)[0] > 200) n++;
    return n;
  };
  const normal = width(P.renderNumber({ ...opts, scaleZ: 1, scaleW: 1 }));
  const bigger = width(P.renderNumber({ ...opts, scaleZ: 0.5, scaleW: 0.5 }));
  assert.ok(bigger > normal * 1.8, `${bigger} vs ${normal}`);
});

test('wider spacing pushes two digits further apart', () => {
  const opts = { number: '11', digits: syntheticDigits(), colors: ['#ffffff', '#ffffff'], background: '#000000', scaleZ: 1, scaleW: 1 };
  const firstLit = (r) => {
    const y = Math.round(r.height * 0.48);
    for (let x = 0; x < r.width; x++) if (pixel(r, x, y)[0] > 200) return x;
    return -1;
  };
  assert.ok(firstLit(P.renderNumber({ ...opts, spacing: -0.6 })) < firstLit(P.renderNumber({ ...opts, spacing: -0.3 })));
});

test('digits without a texture are reported, not drawn', () => {
  const r = P.renderNumber({ number: '27', digits: syntheticDigits(), available: [2], colors: [], background: '#123456' });
  assert.deepEqual(r.missing, ['7']);
});

test('real font renders its fill in the main color', () => {
  const entry = index[fontKey(M.listNumberFonts(data)[0].path)];
  const digits = zlib.gunzipSync(fs.readFileSync(path.join(previewDir, entry.file)));
  const r = P.renderNumber({ number: '8', digits, available: entry.digits, colors: ['#ff0000', '#0000ff', '#00ff00'], background: '#000000', spacing: -0.4, scaleZ: 1, scaleW: 1 });
  let red = 0;
  for (let i = 0; i < r.pixels.length; i += 4) if (r.pixels[i] > 200 && r.pixels[i + 1] < 60 && r.pixels[i + 2] < 60) red++;
  assert.ok(red > 1500, `expected a visible red fill, got ${red} pixels`);
});
