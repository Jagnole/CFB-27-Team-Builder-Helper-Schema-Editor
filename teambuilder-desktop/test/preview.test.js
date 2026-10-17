const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const M = require('../src/core/model.js');
const P = require('../src/core/preview.js');

const data = M.mergeExtraFonts(
  JSON.parse(fs.readFileSync(path.join(__dirname, '../src/data/tb-data.json'), 'utf8')),
  JSON.parse(fs.readFileSync(path.join(__dirname, '../src/data/extra-fonts.json'), 'utf8')));
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

test('more negative spacing pulls two digits closer together', () => {
  const opts = { number: '11', digits: syntheticDigits(), colors: ['#ffffff', '#ffffff'], background: '#000000', scaleZ: 1, scaleW: 1 };
  const firstLit = (r) => {
    const y = Math.round(r.height * 0.48);
    for (let x = 0; x < r.width; x++) if (pixel(r, x, y)[0] > 200) return x;
    return -1;
  };
  assert.ok(firstLit(P.renderNumber({ ...opts, spacing: -0.3 })) < firstLit(P.renderNumber({ ...opts, spacing: -0.6 })));
});

test('numbers listed in playerNumberAdjust use their own spacing', () => {
  const adjust = [{ number: 11, width: -0.7 }];
  assert.equal(P.spacingForNumber('11', -0.45, adjust), -0.7);
  assert.equal(P.spacingForNumber('27', -0.45, adjust), -0.45);
  const r = P.renderNumber({ number: '11', digits: syntheticDigits(), spacing: -0.45, numberAdjust: adjust, background: '#000000' });
  assert.equal(r.spacing, -0.7);
});

// Real in-game jerseys (number settings from the game's jersey part files). With
// the right spacing model every number, including EA's per-number overrides,
// leaves a small positive gap between the two digits.
const GAME_JERSEYS = [
  { jersey: 'AUB_JERSEY_2024_ORANGE', font: 'content/characters/player/parts/uniforms/jerseys/numbers/AUB_Jersey_2023_NUM_Array', spacing: -0.45, adjust: [{ number: 11, width: -0.64 }, { number: 10, width: -0.56 }, { number: 21, width: -0.56 }] },
  { jersey: 'MIA_JERSEY_2024_ORANGE', font: 'content/characters/player/parts/uniforms/jerseys/numbers/MIA_Jersey_2025_NUM_Array', spacing: -0.445, adjust: [{ number: 11, width: -0.54 }, { number: 10, width: -0.48 }, { number: 21, width: -0.48 }] },
  { jersey: 'MICH_JERSEY_2023_BLUE', font: 'ContentShared/characters/player/parts/uniforms/jerseys/numbers/Standard_Jersey_2021_MICH_NUM_Array', spacing: -0.47, adjust: [{ number: 11, width: -0.67 }, { number: 10, width: -0.59 }, { number: 21, width: -0.57 }] },
  { jersey: 'NEB_JERSEY_2026_RED', font: 'content/characters/player/parts/uniforms/jerseys/numbers/NEB_Jersey_2026_NUM_Array', spacing: -0.37, adjust: [{ number: 11, width: -0.69 }, { number: 10, width: -0.53 }, { number: 21, width: -0.53 }] },
  { jersey: 'TCU_JERSEY_2024_PURPLE', font: 'content/characters/player/parts/uniforms/jerseys/numbers/TCU_Jersey_2021_NUM_Array', spacing: -0.38, adjust: [{ number: 11, width: -0.64 }, { number: 10, width: -0.55 }, { number: 21, width: -0.45 }] },
  { jersey: 'UTAH_JERSEY_2024_BLACKALT', font: 'content/characters/player/parts/uniforms/jerseys/numbers/UTAH_Jersey_2022_NUM_Array', spacing: -0.55, adjust: [{ number: 11, width: -0.72 }, { number: 10, width: -0.66 }, { number: 21, width: -0.62 }] },
  { jersey: 'WIS_JERSEY_2024_RED', font: 'content/characters/player/parts/uniforms/jerseys/numbers/WIS_Jersey_2021_NUM_Array', spacing: -0.51, adjust: [{ number: 11, width: -0.73 }, { number: 10, width: -0.63 }, { number: 21, width: -0.63 }] },
];

test('game-tuned spacing leaves a small gap between digits, never a big overlap', () => {
  const extents = (buf, d) => {
    let l = P.DIGIT_SIZE, r = -1;
    for (let y = 0; y < P.DIGIT_SIZE; y++) {
      for (let x = 0; x < P.DIGIT_SIZE; x++) {
        if (buf[d * P.DIGIT_BYTES + (y * P.DIGIT_SIZE + x) * 4 + 3] > 96) { l = Math.min(l, x); r = Math.max(r, x); }
      }
    }
    return { l, r };
  };
  for (const j of GAME_JERSEYS) {
    const entry = index[fontKey(j.font)];
    assert.ok(entry, `${j.jersey} font has a preview`);
    const buf = zlib.gunzipSync(fs.readFileSync(path.join(previewDir, entry.file)));
    for (const n of [10, 11, 21, 27, 45, 88]) {
      const a = extents(buf, Math.floor(n / 10));
      const b = extents(buf, n % 10);
      const sep = P.digitSeparation(P.spacingForNumber(String(n), j.spacing, j.adjust));
      const gap = sep + b.l - a.r - 1;
      assert.ok(gap > -4 && gap < 20, `${j.jersey} #${n}: gap ${gap.toFixed(1)}px`);
    }
  }
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

test('every brand logo in the catalog has a preview', () => {
  const dir = path.join(__dirname, '../src/assets/decal-previews');
  const decals = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  for (const decal of data.catalog.decals) {
    const e = decals[decal.col.split('/').pop().toLowerCase()];
    assert.ok(e, `${decal.label} has a preview`);
    assert.equal(e.channels[0], 'R', `${decal.label} lists its color areas, main first`);
    assert.ok(e.channels.every((c) => ['R', 'G', 'B'].includes(c)));
    if (e.type === 'vector') {
      assert.ok(Object.keys(e.regions).length && Object.keys(e.regions).every((k) => ['R', 'G', 'B'].includes(k)), decal.label);
    } else {
      assert.match(e.file, /^[A-Za-z0-9_-]+\.png$/);
      assert.ok(e.shade || e.mask, `${decal.label} can be recolored`);
      assert.ok(fs.existsSync(path.join(dir, e.file)), e.file);
    }
  }
});

test('added fonts are tuned to the same digit gap as in-game jerseys', () => {
  const extra = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/data/extra-fonts.json'), 'utf8'));
  for (const f of extra.fonts) {
    const prof = data.numberLayoutProfiles[f.displayName];
    const buf = zlib.gunzipSync(fs.readFileSync(path.join(previewDir, index[fontKey(f.path)].file)));
    const rowsOf = (d) => Array.from({ length: P.DIGIT_SIZE }, (_, y) => {
      let l = -1, r = -1;
      for (let x = 0; x < P.DIGIT_SIZE; x++) if (buf[d * P.DIGIT_BYTES + (y * P.DIGIT_SIZE + x) * 4 + 3] > 96) { if (l < 0) l = x; r = x; }
      return l < 0 ? null : [l, r];
    });
    const entry = index[fontKey(f.path)];
    const leftSet = entry.leftSet || 0;
    const digits = Array.from({ length: leftSet ? leftSet + 10 : 10 }, (_, d) => rowsOf(d));
    for (let n = 10; n <= 99; n++) {
      const a = digits[Math.floor(n / 10) + leftSet], b = digits[n % 10];
      const sep = P.digitSeparation(P.spacingForNumber(String(n), prof.numberSpacing, prof.playerNumberAdjust));
      let gap = Infinity;
      for (let y = 0; y < P.DIGIT_SIZE; y++) if (a[y] && b[y]) gap = Math.min(gap, sep + b[y][0] - a[y][1] - 1);
      assert.ok(gap > 0 && gap < 12, `${f.label} #${n}: tightest gap ${gap.toFixed(1)}px`);
    }
  }
});

test('two-digit numbers take the tens digit from the left set when a font has one', () => {
  const buf = new Uint8Array(P.DIGIT_BYTES * 20);
  // layer 2 (right set) fills red, layer 12 (left set) fills green
  for (const [layer, c] of [[2, 0], [12, 1]]) {
    for (let i = 0; i < P.DIGIT_SIZE * P.DIGIT_SIZE; i++) { buf[layer * P.DIGIT_BYTES + i * 4 + c] = 255; buf[layer * P.DIGIT_BYTES + i * 4 + 3] = 255; }
  }
  const avail = [...Array(20).keys()];
  const colors = ['#ff0000', '#00ff00', '#0000ff'];
  const two = P.renderNumber({ number: '22', digits: buf, available: avail, leftSet: 10, colors, background: '#000000', spacing: -0.45 });
  const y = Math.round(two.height * 0.48);
  assert.deepEqual(pixel(two, 100, y), [0, 255, 0], 'left digit from layer 12');
  assert.deepEqual(pixel(two, 220, y), [255, 0, 0], 'right digit from layer 2');
  const one = P.renderNumber({ number: '2', digits: buf, available: avail, leftSet: 10, colors, background: '#000000' });
  assert.deepEqual(pixel(one, 160, y), [255, 0, 0], 'single digits use the base set');
});
