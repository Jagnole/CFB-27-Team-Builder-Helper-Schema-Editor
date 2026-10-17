// Estimates a number font's spacing from its digit shapes, for fonts added
// without the jersey's partItem XML (which holds the game's real values).
//
//   node tools/tune-number-spacing.js <font texture path> [target gap px]
//
// Across 236 in-game jerseys the tightest row-by-row gap between the two digits
// of a number is a steady ~6 px (median 6.4, at the 120 px preview size), with
// EA's per-number overrides (mostly numbers with a thin "1") landing on the
// same gap. This finds the numberSpacing that gives that gap for most numbers,
// then a playerNumberAdjust entry for each number that would sit far off it.
// Prints a layout profile to paste into src/data/extra-fonts.json.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const P = require('../src/core/preview.js');

const [fontPath, targetArg] = process.argv.slice(2);
if (!fontPath) {
  console.error('usage: node tools/tune-number-spacing.js <font texture path> [target gap px]');
  process.exit(1);
}
const TARGET = Number(targetArg) || 6.4;
const TOLERANCE = 4; // px off the target before a number gets its own spacing
const D = P.DIGIT_SIZE;
const dir = path.join(__dirname, '..', 'src', 'assets', 'number-previews');
const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
const entry = index[fontPath.replace('/uniforms/comp/', '/uniforms/').toLowerCase()];
if (!entry) throw new Error('No preview for that font yet; add it with tools/add-number-preview.js first.');
const buf = zlib.gunzipSync(fs.readFileSync(path.join(dir, entry.file)));

// Left/right ink edge of every row of every digit layer (20 when the font has
// a separate left-digit set, see entry.leftSet).
const leftSet = entry.leftSet || 0;
const rows = Array.from({ length: leftSet ? leftSet + 10 : 10 }, (_, d) => Array.from({ length: D }, (_, y) => {
  let l = -1;
  let r = -1;
  for (let x = 0; x < D; x++) {
    if (buf[d * P.DIGIT_BYTES + (y * D + x) * 4 + 3] > 96) { if (l < 0) l = x; r = x; }
  }
  return l < 0 ? null : [l, r];
}));

// Tightest gap at spacing 0 (digit centres one cell apart); spacing s moves them s*D closer.
const gapAtZero = (n) => {
  const a = rows[Math.floor(n / 10) + leftSet];
  const b = rows[n % 10];
  let best = Infinity;
  for (let y = 0; y < D; y++) if (a[y] && b[y]) best = Math.min(best, P.digitSeparation(0) + b[y][0] - a[y][1] - 1);
  return best;
};
const spacingFor = (n) => (TARGET - gapAtZero(n)) / D; // gap(s) = gapAtZero + s*D
const round = (v) => Math.round(v * 100) / 100;

const numbers = Array.from({ length: 90 }, (_, i) => i + 10).filter((n) => Number.isFinite(gapAtZero(n)));
const wanted = numbers.map(spacingFor).sort((a, b) => a - b);
const base = round(wanted[Math.floor(wanted.length / 2)]);
const playerNumberAdjust = numbers
  .filter((n) => Math.abs(gapAtZero(n) + base * D - TARGET) > TOLERANCE)
  .map((n) => ({ number: n, width: round(spacingFor(n)) }));

console.log(JSON.stringify({ numberSpacing: base, playerNumberAdjust }, null, 2));
console.error(`base ${base}: ${numbers.length - playerNumberAdjust.length} numbers within ${TOLERANCE}px of a ${TARGET}px gap; ${playerNumberAdjust.length} get their own spacing`);
