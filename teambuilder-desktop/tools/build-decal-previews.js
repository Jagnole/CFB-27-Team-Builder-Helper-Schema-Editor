// Builds src/assets/decal-previews/ for the brand logo gallery.
//
//   node tools/build-decal-previews.js <extension editor.js> <offline editor preview_assets dir> <unzipped vendor_previews dir>
//
// Sources, best first:
//  1. Vector traces from Team Builder Helper extension v0.76 (PREVIEW_SVGS in
//     editor.js). Regions R/G/B are the logo's colorR/colorG/colorB tint areas.
//  2. Raster previews from the CFB TEAMBUILDER Offline Editor
//     (preview_assets/manifest.json + vendor_previews.zip). These are the full
//     512x512 decal squeezed to 110x70, so the app draws them back at square.
//     Most are R/G/B masks; a few (the metallic "Diamond" decals) are full-color
//     gold art. Those are stored as a grayscale shading map (brightness
//     normalised so the bright metal reaches white), which the app multiplies
//     by the logo's main color. The art keeps its shine and dark edge in
//     whatever color the logo is set to.
// The index maps each decal's color texture name (lower case) to its preview.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');

const [editorJs, previewAssets, vendorDir] = process.argv.slice(2);
if (!editorJs || !previewAssets || !vendorDir) {
  console.error('usage: node tools/build-decal-previews.js <editor.js> <preview_assets dir> <vendor_previews dir>');
  process.exit(1);
}
const root = path.join(__dirname, '..');
const outDir = path.join(root, 'src', 'assets', 'decal-previews');
const data = JSON.parse(fs.readFileSync(path.join(root, 'src', 'data', 'tb-data.json'), 'utf8'));
const W = 110;
const H = 70;

function extractPreviewSvgs(file) {
  const src = fs.readFileSync(file, 'utf8');
  const start = src.indexOf('const PREVIEW_SVGS = {');
  if (start < 0) throw new Error('PREVIEW_SVGS not found in ' + file);
  const open = src.indexOf('{', start);
  let depth = 0;
  let end = open;
  for (; end < src.length; end++) {
    if (src[end] === '{') depth++;
    else if (src[end] === '}' && --depth === 0) break;
  }
  return vm.runInNewContext('(' + src.slice(open, end + 1) + ')', {}); // plain object literal, no code
}

// Minimal RGBA PNG writer (no dependencies).
const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buf) => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, body) {
  const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
  const tb = Buffer.concat([Buffer.from(type), body]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(tb));
  return Buffer.concat([len, tb, crc]);
}
function png(rgba, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const rows = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(rows, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// Full-color art -> grayscale shading map with alpha kept.
function shadeMap(rgba) {
  const luma = [];
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] > 200) luma.push(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]);
  }
  luma.sort((a, b) => a - b);
  const bright = luma[Math.floor(luma.length * 0.95)] || 255; // 95th percentile becomes white
  const out = Buffer.from(rgba);
  for (let i = 0; i < out.length; i += 4) {
    const l = Math.min(255, Math.round(((0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) * 255) / bright));
    out[i] = out[i + 1] = out[i + 2] = l;
  }
  return out;
}

// A tint mask is made of pure R/G/B areas; full-color art is not.
function isMask(rgba) {
  let opaque = 0;
  let pure = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 200) continue;
    opaque++;
    if ([0, 1, 2].every((c) => rgba[i + c] < 40 || rgba[i + c] > 215)) pure++;
  }
  return opaque > 0 && pure / opaque > 0.8;
}

const svgs = extractPreviewSvgs(editorJs);
const manifest = JSON.parse(fs.readFileSync(path.join(previewAssets, 'manifest.json'), 'utf8'));
const rasters = new Map(Object.values(manifest.vendors).map((v) => [`${v.id}_col`.toLowerCase(), v]));

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const index = {};
for (const decal of data.catalog.decals) {
  const key = decal.col.split('/').pop().toLowerCase();
  const trace = svgs[decal.label];
  if (trace) {
    index[key] = { type: 'vector', viewBox: trace.viewBox, transform: trace.transform, regions: trace.regions };
    continue;
  }
  const raster = rasters.get(key);
  if (raster) {
    const rgba = fs.readFileSync(path.join(vendorDir, raster.entry));
    if (rgba.length !== W * H * 4) throw new Error(`${raster.entry}: unexpected size ${rgba.length}`);
    const file = `${raster.id}.png`;
    const mask = isMask(rgba);
    fs.writeFileSync(path.join(outDir, file), png(mask ? rgba : shadeMap(rgba), W, H));
    index[key] = mask ? { type: 'image', file, mask: true } : { type: 'image', file, shade: true };
    continue;
  }
  console.warn(`no preview for ${decal.label}`);
}
fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index));
const counts = Object.values(index).reduce((a, e) => { const k = e.type + (e.shade ? ' (shaded art)' : ''); a[k] = (a[k] || 0) + 1; return a; }, {});
console.log(`${Object.keys(index).length} of ${data.catalog.decals.length} decals:`, counts);
