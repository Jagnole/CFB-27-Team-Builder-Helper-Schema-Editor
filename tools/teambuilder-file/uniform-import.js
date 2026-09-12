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
const REQUIRED = [['TBFile', 'tbfile.js'], ['TBUniform', 'uniform.js'], ['TBKitZip', 'kitzip.js'],
                  ['TBImagingWeb', 'imaging-web.js'], ['TBTextures', 'textures.js']];
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
const imaging = ready ? TBImagingWeb.imaging() : null;

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
    const unused = TBTextures.unusedTextures(recs, loc).filter((u) => u.prunable);
    state.save.unused = unused;
    el('saveInfo').textContent = 'team ' + loc.teamCode + ' · uniforms: ' + variants.join(', ') +
      ' · ' + bytes(container.freeSpace) + ' spare space';
    el('pruneHint').textContent = unused.length
      ? unused.length + ' uploaded image(s) here, ' + bytes(unused.reduce((a, u) => a + u.bytes, 0)) +
        ', are not used by any layer — tick to reclaim that space'
      : 'Nothing to reclaim in this file — every uploaded image is in use.';
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

// --------------------------------------------------------------- the plan
/* Space accounting: PNGs are already compressed, so they pass through the
   save file's own zlib stream at roughly their own size. That makes the
   container's free space (plus anything reclaimed) a fair budget. */
const SAFETY_MARGIN = 64 * 1024;

async function planTextures(kit, budget) {
  return TBTextures.planKitTextures(kit, {
    budget,
    maxDim: Number(el('maxDim').value) || 2048,
    skipFlat: true,
    imaging,
  });
}

// ------------------------------------------------------------------ the build
el('go').addEventListener('click', async () => {
  el('go').disabled = true;
  el('download').style.display = 'none';
  setStatus('Working…');
  try {
    const { container, recs, loc } = state.save;
    const mode = el('texMode').value;
    const grow = el('grow').checked;

    let reclaimed = 0;
    if (el('prune').checked && state.save.unused.length) {
      const result = TBTextures.pruneTextures(loc, state.save.unused.map((u) => u.key));
      reclaimed = result.bytes;
    }

    let kit = state.kit;
    let plan = null;
    if (mode === 'fit') {
      setStatus('Fitting the images…');
      const budget = grow ? Infinity : Math.max(0, container.freeSpace + reclaimed - SAFETY_MARGIN);
      plan = await planTextures(kit, budget);
      kit = plan.kit;
    }

    const name = TBUniform.sanitizeVariant(el('variantName').value || kit.json.uniformName || 'Imported');
    if (TBUniform.listVariants(loc).includes(name)) {
      throw new Error('this save already has a uniform called ' + name);
    }
    setStatus('Writing the uniform…');
    const report = TBUniform.importKit(recs, kit, {
      name,
      source: el('sourceVariant').value || undefined,
      skipBakedTextures: mode === 'skip',
    });
    const payload = TBFile.buildPayload(recs);
    const file = await container.build(payload, zlibHost, { grow });
    const used = container.compressedLengthOf(file.subarray(container.streamOffset));
    state.result = { file, name };
    showReport(report, container, file, used, { plan, reclaimed });
    setStatus('Added "' + report.variant + '" — save file rebuilt.');
    el('download').style.display = '';
  } catch (err) {
    setStatus(err.message, true);
    /* recs and the texture table were mutated, so start from the file again */
    if (state.save) {
      const c = state.save.container;
      state.save.recs = TBFile.parsePayload(c.payload);
      state.save.loc = TBUniform.locate(state.save.recs);
      state.save.unused = TBTextures.unusedTextures(state.save.recs, state.save.loc)
        .filter((u) => u.prunable);
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

function showReport(report, container, file, used, extras) {
  const space = file.length - container.streamOffset;
  const rows = [
    ['Uniform added', report.variant + ' (copied from ' + report.clonedFrom + ')'],
    ['Changes written', String(report.applied.length)],
    ['Images embedded', report.textures.length + (report.textures.length
      ? ' (' + bytes(report.textures.reduce((a, t) => a + t.bytes, 0)) + ')' : '')],
  ];
  if (extras.reclaimed) rows.push(['Space reclaimed', bytes(extras.reclaimed) + ' of unused images']);
  if (extras.plan) {
    rows.push(['Images planned', bytes(extras.plan.totalBytes) +
      (extras.plan.fits ? '' : ' — over budget')]);
  }
  if (file.length !== container.totalSize) {
    rows.push(['File size', bytes(file.length) + ' — larger than the original ' +
      bytes(container.totalSize) + ', which may be rejected']);
  }
  el('summary').innerHTML = rows
    .map(([k, v]) => '<tr><th>' + k + '</th><td class="n">' + v + '</td></tr>').join('');
  const pct = Math.min(100, (used / space) * 100);
  const bar = el('spaceBar');
  bar.className = 'bar' + (pct > 97 ? ' over' : pct > 85 ? ' tight' : '');
  bar.firstElementChild.style.width = pct.toFixed(1) + '%';
  el('spaceText').textContent = bytes(used) + ' of ' + bytes(space) + ' used · ' +
    bytes(space - used) + ' spare';
  const applied = report.applied.slice();
  if (extras.plan) {
    for (const d of extras.plan.decisions) {
      applied.push('image ' + d.file + ' — ' + d.reason);
    }
  }
  list('applied', applied);
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
