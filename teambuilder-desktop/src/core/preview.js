// Jersey number preview: draws a number from the per-font digit textures onto a
// jersey-mesh background. Same approach as the CFB TEAMBUILDER Offline Editor's
// "Number preview": a flat size study, not a 3D render of the game.
//
// Each digit texture is 120x120 RGBA. R/G/B are coverage masks for the number's
// colorR/colorG/colorB tints, A is the digit's opacity.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TBPreview = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DIGIT_SIZE = 120;
  const DIGIT_BYTES = DIGIT_SIZE * DIGIT_SIZE * 4;
  const WIDTH = 320;
  const HEIGHT = 250;
  const SPACING_MIN = -0.6;
  const SPACING_MAX = -0.3;
  const DEFAULT_COLORS = ['#ffffff', '#151515', '#000000'];

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // Stored number scale -> on-screen scale. A smaller stored value draws a bigger
  // number (same inverted mapping the size sliders use).
  function scaleFromStored(value) {
    return typeof value === 'number' && value > 0 ? clamp(1 / value, 0.25, 4) : 1;
  }

  // Mesh fabric in the jersey color: small dimples, a faint diagonal weave, and
  // stitch lines near the top and bottom edges.
  function jerseyBackground(hex, width = WIDTH, height = HEIGHT) {
    const base = hexToRgb(hex) || [40, 60, 90];
    const px = new Uint8ClampedArray(width * height * 4);
    const stitchRows = new Set([24, 25, height - 25, height - 24]);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dx = ((x + (Math.floor(y / 10) % 2 ? 5 : 0)) % 10) - 5;
        const dy = (y % 10) - 5;
        const hole = dx * dx + dy * dy <= 2;
        const stitch = stitchRows.has(y) && x % 9 < 5;
        const delta = hole ? -24 : stitch ? 22 : ((x + y) % 3 === 0 ? 2 : -2);
        const i = (y * width + x) * 4;
        px[i] = base[0] + delta;
        px[i + 1] = base[1] + delta;
        px[i + 2] = base[2] + delta;
        px[i + 3] = 255;
      }
    }
    return px;
  }

  // Blends one digit, centred on (cx, cy), scaled by (sx, sy), with bilinear sampling.
  function drawDigit(px, width, height, raw, offset, cx, cy, colors, sx, sy) {
    const w = Math.max(1, Math.round(DIGIT_SIZE * sx));
    const h = Math.max(1, Math.round(DIGIT_SIZE * sy));
    const left = Math.round(cx - w / 2);
    const top = Math.round(cy - h / 2);
    const max = DIGIT_SIZE - 1;
    const at = (x, y, c) => raw[offset + (y * DIGIT_SIZE + x) * 4 + c];
    for (let dy = 0; dy < h; dy++) {
      const y = top + dy;
      if (y < 0 || y >= height) continue;
      const fy = clamp(((dy + 0.5) * DIGIT_SIZE) / h - 0.5, 0, max);
      const y0 = Math.floor(fy);
      const y1 = Math.min(max, y0 + 1);
      const ty = fy - y0;
      for (let dx = 0; dx < w; dx++) {
        const x = left + dx;
        if (x < 0 || x >= width) continue;
        const fx = clamp(((dx + 0.5) * DIGIT_SIZE) / w - 0.5, 0, max);
        const x0 = Math.floor(fx);
        const x1 = Math.min(max, x0 + 1);
        const tx = fx - x0;
        const sample = (c) =>
          (at(x0, y0, c) * (1 - tx) + at(x1, y0, c) * tx) * (1 - ty) +
          (at(x0, y1, c) * (1 - tx) + at(x1, y1, c) * tx) * ty;
        const alpha = sample(3);
        if (alpha <= 0) continue;
        const m = [sample(0), sample(1), sample(2)];
        const total = Math.max(1, m[0] + m[1] + m[2]);
        const i = (y * width + x) * 4;
        for (let c = 0; c < 3; c++) {
          const tint = (colors[0][c] * m[0] + colors[1][c] * m[1] + colors[2][c] * m[2]) / total;
          px[i + c] = Math.round((tint * alpha + px[i + c] * (255 - alpha)) / 255);
        }
      }
    }
  }

  // opts: number ("27"), digits (Uint8Array of ten 120x120 RGBA digits back to back),
  // available (digit list), colors ([R, G, B] hex), background (hex),
  // spacing (stored numberSpacing.x), scaleZ / scaleW (stored offsetScale z / w).
  // Returns { pixels, width, height, missing }.
  function renderNumber(opts) {
    const width = opts.width || WIDTH;
    const height = opts.height || HEIGHT;
    const px = jerseyBackground(opts.background, width, height);
    const number = String(opts.number || '').replace(/\D/g, '').slice(0, 2);
    const missing = [];
    if (!number || !opts.digits) return { pixels: px, width, height, missing: number ? number.split('') : [] };

    const colors = [0, 1, 2].map((i) => hexToRgb(opts.colors && opts.colors[i]) || hexToRgb(DEFAULT_COLORS[i]));
    const sx = scaleFromStored(opts.scaleZ);
    const sy = scaleFromStored(opts.scaleW);
    const spacing = typeof opts.spacing === 'number' ? opts.spacing : -0.5;
    const separation = Math.abs(clamp(spacing, SPACING_MIN, SPACING_MAX)) * DIGIT_SIZE * sx;
    const cx = width / 2;
    const positions = number.length === 1 ? [cx] : [cx - separation / 2, cx + separation / 2];
    const cy = Math.round(height * 0.48);
    const available = opts.available || [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

    number.split('').forEach((ch, idx) => {
      const d = Number(ch);
      if (!available.includes(d) || opts.digits.length < (d + 1) * DIGIT_BYTES) { missing.push(ch); return; }
      drawDigit(px, width, height, opts.digits, d * DIGIT_BYTES, positions[idx], cy, colors, sx, sy);
    });
    return { pixels: px, width, height, missing };
  }

  return { DIGIT_SIZE, DIGIT_BYTES, WIDTH, HEIGHT, DEFAULT_COLORS, hexToRgb, scaleFromStored, jerseyBackground, renderNumber };
});
