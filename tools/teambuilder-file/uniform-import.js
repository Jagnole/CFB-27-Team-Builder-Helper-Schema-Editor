/*
 * uniform-import.js — page logic for uniform-import.html.
 * Reads a Team Builder save file and a uniform creator export in the browser,
 * writes the uniform in as an extra variant, and hands back a new save file.
 */
'use strict';

const el = (id) => document.getElementById(id);
const state = { save: null, kit: null, result: null };

/*
 * This page needs tbfile.js, uniform.js and kitzip.js loaded from the same
 * folder. Saving the page on its own, or moving it away from them, leaves
 * every control inert — so say that out loud instead of doing nothing.
 */
const REQUIRED = [['TBFile', 'tbfile.js'], ['TBUniform', 'uniform.js'], ['TBKitZip', 'kitzip.js']];
function bootCheck() {
  const missing = REQUIRED.filter(([global]) => typeof window[global] === 'undefined');
  const problems = [];
  if (missing.length) {
    problems.push('These files did not load: <code>' + missing.map(m => m[1]).join('</code>, <code>') +
      '</code>. They have to sit in the same folder as this page. Downloading the whole ' +
      '<code>tools/teambuilder-file/</code> folder fixes it — or use ' +
      '<code>uniform-import-standalone.html</code>, which has everything in one file.');
  }
  if (typeof CompressionStream === 'undefined') {
    problems.push('This browser has no <code>CompressionStream</code>, which the page needs to write ' +
      'the save file. Chrome, Edge or a current Firefox will work.');
  }
  const banner = el('banner');
  if (!problems.length) {
    /* The notice is in the static HTML so it shows even when these scripts
       never load; getting this far means it can go. */
    banner.hidden = true;
    return true;
  }
  banner.className = 'bad';
  banner.innerHTML = '<b>This page cannot run here</b>' + problems.join('<br><br>');
  for (const id of ['saveFile', 'kitFile', 'go']) el(id).disabled = true;
  return false;
}

const ready = bootCheck();
const zlibHost = ready ? TBFile.zlibWeb() : null;
const inflateRaw = ready ? TBKitZip.inflateRawWeb() : null;

/* Anything that escapes a handler should land somewhere the user can see. */
window.addEventListener('error', (e) => setStatus('Unexpected error: ' + e.message, true));
window.addEventListener('unhandledrejection', (e) => setStatus('Unexpected error: ' +
  ((e.reason && e.reason.message) || e.reason), true));

function setStatus(text, isError) {
  const s = el('status');
  s.textContent = text || '';
  s.className = isError ? 'err' : '';
}
const bytes = (n) => (n < 1024 ? n + ' B'
  : n < 1024 * 1024 ? (n / 1024).toFixed(0) + ' KB'
  : (n / 1048576).toFixed(2) + ' MB');

function readFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result));
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(file);
  });
}

// ------------------------------------------------------------------ save file
el('saveFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const raw = await readFile(file);
    const container = await TBFile.Container.open(raw, zlibHost);
    const recs = TBFile.parsePayload(container.payload);
    const loc = TBUniform.locate(recs);
    state.save = { name: file.name, raw, container, recs, loc };
    const variants = TBUniform.listVariants(loc);
    el('saveInfo').textContent = 'team ' + loc.teamCode + ' · uniforms: ' + variants.join(', ') +
      ' · ' + bytes(container.freeSpace) + ' spare space';
    const sel = el('sourceVariant');
    sel.innerHTML = '';
    for (const v of variants) {
      const opt = document.createElement('option');
      opt.value = opt.textContent = v;
      if (v === 'HOME') opt.selected = true;
      sel.appendChild(opt);
    }
    setStatus('');
  } catch (err) {
    state.save = null;
    el('saveInfo').textContent = '';
    setStatus('Could not read that save file: ' + err.message, true);
  }
  refresh();
});

// -------------------------------------------------------------------- kit zip
el('kitFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const kit = await TBKitZip.readKit(await readFile(file), inflateRaw);
    state.kit = kit;
    const pngs = [...kit.files.entries()].filter(([n]) => /\.png$/i.test(n));
    const total = pngs.reduce((a, [, b]) => a + b.length, 0);
    el('kitInfo').textContent = '"' + (kit.json.uniformName || 'unnamed') + '" · ' +
      (kit.json.layers || []).length + ' layers · ' + pngs.length + ' images (' + bytes(total) + ')';
    if (!el('variantName').value) {
      el('variantName').value = TBUniform.sanitizeVariant(kit.json.uniformName || 'Imported');
    }
    setStatus('');
  } catch (err) {
    state.kit = null;
    el('kitInfo').textContent = '';
    setStatus('Could not read that export: ' + err.message, true);
  }
  refresh();
});

function refresh() { el('go').disabled = !(state.save && state.kit); }

// ------------------------------------------------------------ png re-encoding
/** Re-encode a PNG so it is at most maxDim on its longest edge. */
async function shrinkPng(png, maxDim) {
  const bitmap = await createImageBitmap(new Blob([png], { type: 'image/png' }));
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  if (scale >= 1) { bitmap.close(); return png; }
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  const out = new Uint8Array(await blob.arrayBuffer());
  return out.length < png.length ? out : png;
}

/** Shrink every image in the kit until the set fits the space we have. */
async function fitTextures(kit, budget, startDim) {
  const files = new Map(kit.files);
  const names = [...files.keys()].filter((n) => /\.png$/i.test(n));
  const total = () => names.reduce((a, n) => a + files.get(n).length, 0);
  let dim = startDim;
  while (total() > budget && dim >= 128) {
    for (const n of names) files.set(n, await shrinkPng(files.get(n), dim));
    dim = Math.floor(dim / 2);
  }
  return { json: kit.json, files, fitted: total() <= budget, finalDim: dim * 2, totalBytes: total() };
}

// ------------------------------------------------------------------ the build
el('go').addEventListener('click', async () => {
  el('go').disabled = true;
  el('download').style.display = 'none';
  setStatus('Working…');
  try {
    const { container, recs, loc } = state.save;
    const mode = el('texMode').value;
    /* Compressed PNGs barely shrink again inside the save file's own zlib
       stream, so the free space is a fair budget for the images. */
    const budget = Math.max(0, container.freeSpace - 64 * 1024);
    let kit = state.kit;
    let fitNote = '';
    if (mode === 'fit') {
      const fitted = await fitTextures(kit, budget, Number(el('maxDim').value) || 1024);
      kit = { json: fitted.json, files: fitted.files };
      fitNote = fitted.fitted
        ? 'images shrunk to ' + bytes(fitted.totalBytes) + ' (max ' + fitted.finalDim + 'px)'
        : 'images still ' + bytes(fitted.totalBytes) + ' after shrinking';
    }
    const name = TBUniform.sanitizeVariant(el('variantName').value || kit.json.uniformName || 'Imported');
    if (TBUniform.listVariants(loc).includes(name)) {
      throw new Error('this save already has a uniform called ' + name);
    }
    const report = TBUniform.importKit(recs, kit, {
      name,
      source: el('sourceVariant').value || undefined,
      skipBakedTextures: mode === 'skip',
    });
    const payload = TBFile.buildPayload(recs);
    const file = await container.build(payload, zlibHost);
    const used = container.compressedLengthOf(file.subarray(container.streamOffset));
    state.result = { file, name };
    showReport(report, container, used, fitNote);
    setStatus('Added "' + report.variant + '" — save file rebuilt.');
    el('download').style.display = '';
  } catch (err) {
    setStatus(err.message, true);
    /* recs were mutated, so reload the save before another attempt */
    if (state.save) {
      const c = state.save.container;
      state.save.recs = TBFile.parsePayload(c.payload);
      state.save.loc = TBUniform.locate(state.save.recs);
    }
  }
  el('go').disabled = false;
});

function list(id, items) {
  const ul = el(id);
  ul.innerHTML = '';
  for (const item of items) {
    const li = document.createElement('li');
    li.textContent = item;
    ul.appendChild(li);
  }
  if (!items.length) {
    const li = document.createElement('li');
    li.textContent = '(none)';
    li.style.opacity = '.6';
    ul.appendChild(li);
  }
}

function showReport(report, container, used, fitNote) {
  const space = container.totalSize - container.streamOffset;
  const rows = [
    ['Uniform added', report.variant + ' (copied from ' + report.clonedFrom + ')'],
    ['Changes written', String(report.applied.length)],
    ['Images embedded', report.textures.length + (report.textures.length
      ? ' (' + bytes(report.textures.reduce((a, t) => a + t.bytes, 0)) + ')' : '')],
  ];
  if (fitNote) rows.push(['Image sizing', fitNote]);
  el('summary').innerHTML = rows
    .map(([k, v]) => '<tr><th>' + k + '</th><td class="n">' + v + '</td></tr>').join('');
  const pct = Math.min(100, (used / space) * 100);
  const bar = el('spaceBar');
  bar.className = 'bar' + (pct > 97 ? ' over' : pct > 85 ? ' tight' : '');
  bar.firstElementChild.style.width = pct.toFixed(1) + '%';
  el('spaceText').textContent = bytes(used) + ' of ' + bytes(space) + ' used · ' +
    bytes(space - used) + ' spare';
  list('applied', report.applied);
  list('skipped', report.skipped);
  list('unmapped', report.unmapped);
  el('report').style.display = '';
}

el('download').addEventListener('click', () => {
  if (!state.result) return;
  const base = state.save.name.replace(/(\.[^./]*)?$/, '');
  const url = URL.createObjectURL(new Blob([state.result.file], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = base + '-' + state.result.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
});
