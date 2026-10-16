(function () {
  'use strict';
  const M = window.TBModel;
  const P = window.TBPreview;
  const api = window.tbApi;

  const state = {
    data: null,
    original: null,
    payload: null,
    source: null,
    savedText: null,
    view: 'home',
    variantIdx: 0,
    captures: [],
    rawEditing: false,
    swapFrom: null,
    swapTo: null,
    // number preview (display only, never written to the team file)
    previewNumber: '27',
    previewPos: 'chest',
    previewBg: {},
    fontQuery: '',
    decalQuery: '',
    fontGridScroll: 0,
  };

  const $ = (id) => document.getElementById(id);
  const content = $('content');

  // ---------- tiny DOM helper (textContent only, never innerHTML) ----------
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    Object.entries(props || {}).forEach(([k, v]) => {
      if (v == null) return;
      if (v === false) { if (k in el) el[k] = false; return; }
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style') el.style.cssText = v; // CSSOM is allowed under the page's style-src 'self' CSP

      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    children.flat(Infinity).forEach((c) => {
      if (c == null || c === false) return;
      el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return el;
  }

  function toast(message, kind = 'ok', action) {
    const el = h('div', { class: `toast ${kind}` }, h('div', { text: message }));
    if (action) {
      el.appendChild(h('div', { class: 'row', style: 'margin-top:8px' },
        h('button', { class: 'btn small primary', text: action.label, onclick: () => { el.remove(); action.run(); } })));
    }
    const stack = $('toasts');
    stack.appendChild(el);
    while (stack.children.length > 3) stack.firstChild.remove();
    setTimeout(() => el.remove(), action ? 15000 : 4000);
  }

  const setStatus = (msg) => { $('statusText').textContent = msg; };

  // ---------- loading & chrome ----------
  function loadPayload(text, source) {
    let payload;
    try {
      payload = M.parseTeamJson(text);
    } catch (err) {
      toast(err.message, 'err');
      return false;
    }
    state.payload = payload;
    state.original = M.parseTeamJson(text);
    state.savedText = M.serialize(payload);
    state.source = source;
    state.variantIdx = 0;
    state.rawEditing = false;
    state.swapFrom = null;
    state.previewBg = {};
    state.fontGridScroll = 0;
    document.querySelectorAll('.sidenav button').forEach((b) => { b.disabled = false; });
    $('btnSave').disabled = false;
    refreshChrome();
    setStatus(`Loaded ${M.teamTitle(payload)}.`);
    show('team');
    return true;
  }

  function changes() {
    return state.payload ? M.changeReport(state.original, state.payload) : [];
  }

  function teamLogoUrl(payload) {
    try {
      const raw = M.getDeep(payload, ['teamData', 'teamInfos', 'TEAM_PRIMARY_LOGO']);
      const url = raw && JSON.parse(raw).pngUrl;
      return typeof url === 'string' && url.startsWith('https://cdn.mcr.ea.com/') ? url : null;
    } catch { return null; }
  }

  function refreshChrome() {
    const p = state.payload;
    $('teamBadge').hidden = !p;
    if (!p) return;
    $('teamBadgeName').textContent = M.teamTitle(p);
    $('teamBadgeSource').textContent = state.source.kind === 'capture'
      ? `From Team Builder · original kept at ${state.source.path}`
      : `From file · ${state.source.path}`;
    const logo = teamLogoUrl(p);
    $('teamLogo').hidden = !logo;
    if (logo) $('teamLogo').src = logo;
    const n = changes().length;
    $('changeCount').hidden = n === 0;
    $('changeCount').textContent = String(n);
    const dirty = M.serialize(p) !== state.savedText;
    $('dirtyText').textContent = dirty ? 'Unsaved changes' : (n ? 'All changes saved' : 'No changes yet');
    if (api) api.setDirty(dirty);
  }

  function edited(message) {
    refreshChrome();
    if (message) setStatus(message);
  }

  // Deferred so a focused input's blur/change can finish before its DOM is replaced.
  let renderQueued = false;
  function rerender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      const top = content.scrollTop;
      show(state.view);
      content.scrollTop = top;
    });
  }

  function show(view) {
    state.view = view;
    document.querySelectorAll('.sidenav button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    if (content.contains(document.activeElement)) document.activeElement.blur();
    content.replaceChildren();
    const views = { home: renderHome, team: renderTeam, uniforms: renderUniforms, changes: renderChanges, raw: renderRaw };
    content.appendChild((views[view] || renderHome)());
  }

  // ---------- shared widgets ----------
  function viewHead(title, subtitle, ...actions) {
    return h('div', { class: 'view-head' },
      h('div', null, h('h1', { text: title }), subtitle ? h('p', { text: subtitle }) : null),
      h('div', { class: 'row' }, actions));
  }

  function card(title, hint, ...body) {
    return h('section', { class: 'card' }, h('h2', { text: title }), hint ? h('p', { class: 'hint', text: hint }) : null, body);
  }

  function note(text, kind = '') {
    return h('div', { class: `note ${kind}`, text });
  }

  // One-click chips for the team's primary / secondary / tertiary colors.
  function teamColorChips(onPick) {
    if (!state.payload) return null;
    const seen = new Set();
    const chips = M.TEAM_COLOR_SLOTS.map((s) => ({ label: s.label, hex: M.getTeamColor(state.payload, s.key) }))
      .filter((c) => c.hex && !seen.has(c.hex) && seen.add(c.hex))
      .map((c) => h('button', {
        class: 'team-chip', title: `${c.label} team color ${c.hex.toUpperCase()}`, style: `background:${c.hex}`,
        onclick: (e) => { e.preventDefault(); onPick(c.hex); },
      }));
    return chips.length ? h('div', { class: 'team-chips' }, chips) : null;
  }

  // A color swatch + hex box. `onSet(hex)` mutates the payload and returns true on success.
  function colorRow(name, sub, hex, originalHex, onSet, { teamChips = true } = {}) {
    const picker = h('input', { type: 'color', value: hex || '#000000' });
    const text = h('input', { class: 'input hex', value: hex || '', maxLength: 7, spellcheck: false });
    const wrap = h('div', { class: 'swatch' + (originalHex && hex && originalHex !== hex ? ' changed' : '') }, picker);
    const commit = (value) => {
      if (!/^#[0-9a-f]{6}$/i.test(value)) { toast('Use a six-digit hex color like #FF850B.', 'err'); text.value = picker.value; return; }
      if (!onSet(value.toLowerCase())) { toast(`Could not set ${name}.`, 'err'); return; }
      text.value = value.toLowerCase();
      picker.value = value.toLowerCase();
      wrap.classList.toggle('changed', !!originalHex && originalHex !== value.toLowerCase());
      edited(`${name} → ${value}`);
    };
    picker.addEventListener('input', () => commit(picker.value));
    text.addEventListener('change', () => commit(text.value.trim().startsWith('#') ? text.value.trim() : '#' + text.value.trim()));
    return h('div', { class: 'color-row' },
      h('div', { class: 'name', title: name }, name, sub ? h('span', { class: 'chan', text: sub }) : null),
      teamChips ? teamColorChips(commit) : h('span'), wrap, text);
  }

  // Datalist values must be unique, so repeated labels get their asset name appended.
  function pickerOptions(list, labelOf, idOf) {
    const counts = {};
    list.forEach((e) => { const l = labelOf(e); counts[l] = (counts[l] || 0) + 1; });
    return list.map((e) => ({ value: counts[labelOf(e)] > 1 ? `${labelOf(e)} · ${idOf(e)}` : labelOf(e), entry: e }));
  }

  function searchPicker(id, options, currentLabel, placeholder, onPick) {
    const listId = `${id}-list`;
    const input = h('input', { class: 'input', list: listId, placeholder, value: '' });
    input.addEventListener('change', () => {
      const hit = options.find((o) => o.value === input.value);
      if (!hit) { if (input.value) toast(`"${input.value}" isn't in the list. Pick one of the suggestions.`, 'err'); return; }
      input.value = '';
      onPick(hit.entry);
    });
    return h('div', null,
      h('div', { class: 'small muted', style: 'margin-bottom:6px' }, 'Current: ', h('b', { text: currentLabel || '(none)' })),
      input,
      h('datalist', { id: listId }, options.map((o) => h('option', { value: o.value }))));
  }

  // ---------- Start ----------
  function renderHome() {
    const loaded = !!state.payload;
    const captureItems = state.captures.map((c) => h('div', { class: 'capture-item' },
      h('div', { class: 'grow' },
        h('div', { text: c.teamName }),
        h('div', { class: 'meta', text: `Captured ${new Date(c.time).toLocaleTimeString()} · original saved to ${c.savedTo}` })),
      h('button', { class: 'btn small primary', text: 'Edit this team', onclick: () => openCapture(c.id) })));

    return h('div', { class: 'hero' },
      h('h1', null, 'Build your next look, ', h('span', { text: 'mod-ready.' })),
      h('p', { text: 'Grab your team straight from the EA Team Builder website, change its name, colors, numbers, helmet and logos here, then save a .json you can import into the MMC editor to make a mod.' }),
      loaded ? note(`Currently editing ${M.teamTitle(state.payload)}. Loading another team replaces it, so save first.`, 'warn') : null,
      h('div', { class: 'start-grid', style: 'margin-top:16px' },
        h('section', { class: 'card start-card' },
          h('h2', { text: '1 · Get my team from Team Builder' }),
          h('ol', null,
            h('li', { text: 'Click the button below. Team Builder opens in its own window.' }),
            h('li', { text: 'Sign in with your EA account. You only need to do this once.' }),
            h('li', { text: 'Open your team and click Edit. The app grabs the team file automatically.' })),
          h('button', { class: 'btn primary', text: 'Open Team Builder', onclick: signIn })),
        h('section', { class: 'card start-card' },
          h('h2', { text: '2 · Or open a saved team .json' }),
          h('p', { class: 'hint', text: 'Any team JSON exported from Team Builder or saved from this app. Your original file is never overwritten.' }),
          h('button', { class: 'btn', text: 'Open .json file', onclick: openFile }))),
      h('div', { class: 'capture-list' },
        h('div', { class: 'row' },
          h('div', { class: 'section-label', text: 'Teams grabbed this session' }),
          h('div', { class: 'spacer' }),
          api ? h('button', { class: 'btn small ghost', text: 'Open captures folder', onclick: () => api.openCapturesFolder() }) : null),
        captureItems.length ? captureItems : h('p', { class: 'muted small', text: 'Nothing yet. Teams show up here as soon as you open them in the Team Builder window.' })),
      h('div', { class: 'flow' },
        h('b', { text: 'Team Builder' }), '→', h('b', { text: 'Edit here' }), '→', h('b', { text: 'Save .json' }), '→',
        h('b', { text: 'MMC editor import' }), '→', h('b', { text: 'Mod' })));
  }

  // ---------- Team ----------
  function renderTeam() {
    const p = state.payload;
    const o = state.original;

    const identity = card('Identity', 'School name and nickname also update the file\'s display metadata.',
      M.TEAM_FIELDS.map((f) => {
        const input = h('input', { class: 'input', value: M.getTeamField(p, f.key), maxLength: f.maxLength || 64 });
        const mark = () => input.classList.toggle('changed', input.value !== M.getTeamField(o, f.key));
        mark();
        input.addEventListener('change', () => {
          if (f.numeric && !/^\d{0,4}$/.test(input.value)) { toast(`${f.label} must be a number.`, 'err'); input.value = M.getTeamField(p, f.key); return; }
          M.setTeamField(p, f.key, input.value);
          input.value = M.getTeamField(p, f.key);
          mark();
          edited(`${f.label} → ${input.value}`);
        });
        return h('div', { class: 'field' }, h('label', { text: f.label }), input, h('span'));
      }));

    const teamColors = card('Team colors', 'Used by menus, scoreboards and anything set to "team color".',
      M.TEAM_COLOR_SLOTS.map((s) => colorRow(s.label, null, M.getTeamColor(p, s.key), M.getTeamColor(o, s.key),
        (hex) => M.setTeamColor(p, s.key, hex), { teamChips: false })),
      h('div', { class: 'row', style: 'margin-top:12px' },
        h('button', {
          class: 'btn small', text: 'Copy to team & crowd palettes', onclick: () => {
            const [pri, sec, ter] = M.TEAM_COLOR_SLOTS.map((s) => M.getTeamColor(p, s.key));
            M.setPaletteColor(p, 'teamPalette', 'primaryColor', pri);
            M.setPaletteColor(p, 'teamPalette', 'secondaryColor', sec);
            M.setPaletteColor(p, 'teamPalette', 'tertiaryColor', ter);
            M.setPaletteColor(p, 'crowdPalette', 'primaryColor', pri);
            M.setPaletteColor(p, 'crowdPalette', 'secondaryColor', sec);
            edited('Team colors copied to the team and crowd palettes.');
            rerender();
          },
        })));

    const paletteCard = (key, title, hint) => {
      const rows = M.PALETTE_SLOTS
        .filter((slot) => M.getPaletteColor(p, key, slot))
        .map((slot) => colorRow(slot.replace('Color', '').replace(/^./, (c) => c.toUpperCase()), null,
          M.getPaletteColor(p, key, slot), M.getPaletteColor(o, key, slot),
          (hex) => M.setPaletteColor(p, key, slot, hex)));
      return rows.length ? card(title, hint, rows) : null;
    };

    const logos = ['TEAM_PRIMARY_LOGO', 'TEAM_SECONDARY_LOGO'].map((k) => {
      try {
        const url = JSON.parse(M.getTeamField(p, k)).pngUrl;
        return url && url.startsWith('https://cdn.mcr.ea.com/')
          ? h('div', null, h('img', { class: 'logo-preview', src: url, alt: k }), h('div', { class: 'small muted', text: k === 'TEAM_PRIMARY_LOGO' ? 'Primary' : 'Secondary' }))
          : null;
      } catch { return null; }
    }).filter(Boolean);

    return h('div', null,
      viewHead('Team', 'Name, location and colors for the whole program.'),
      h('div', { class: 'grid' },
        identity,
        teamColors,
        paletteCard('teamPalette', 'Team palette', 'The in-engine palette uniforms and the stadium pull from.'),
        paletteCard('crowdPalette', 'Crowd palette', 'What the fans wear in the stands.'),
        card('Logos', 'Logos are uploaded on the Team Builder website. This file keeps links to them, so change them there and grab the team again.',
          logos.length ? h('div', { class: 'row' }, logos) : note('No logo links found in this file.', 'warn'))));
  }

  // ---------- Uniforms ----------
  function renderUniforms() {
    const p = state.payload;
    const variants = M.deriveVariants(p);
    if (!variants.length) {
      return h('div', null, viewHead('Uniforms'), note('This team file has no uniform parts.', 'warn'));
    }
    if (state.variantIdx >= variants.length) state.variantIdx = 0;
    const v = variants[state.variantIdx];
    const origVariant = M.deriveVariants(state.original).find((x) => x.suffix === v.suffix) || v;

    const tabs = h('div', { class: 'tabs' }, variants.map((x, i) =>
      h('button', { class: 'tab' + (i === state.variantIdx ? ' active' : ''), text: x.label, onclick: () => { state.variantIdx = i; state.swapFrom = null; rerender(); } })));

    const jersey = M.getPart(p, v, 'jersey');
    const helmet = M.getPart(p, v, 'helmet');

    return h('div', null,
      viewHead('Uniforms', 'Pick a uniform, then change its numbers, helmet, brand logo and colors.'),
      tabs,
      brandStudio(v, origVariant),
      jersey && jersey.numberComp ? numbersStudio(jersey, M.getPart(state.original, origVariant, 'jersey'), v) : null,
      h('div', { class: 'grid' },
        helmet ? helmetCard(helmet, M.getPart(state.original, origVariant, 'helmet')) : null,
        swapCard(v),
        M.PART_KINDS.map(({ kind, label }) => partColorsCard(v, origVariant, kind, label))));
  }

  const CHANNEL_NAMES = { colorR: 'Main', colorG: 'Outline', colorB: 'Third' };
  const NUMBER_CHANNELS = ['colorR', 'colorG', 'colorB'];

  // ---------- number previews ----------
  const previews = { index: null, digits: new Map(), thumbs: new Map(), thumbKey: '' };
  const fontKey = (p) => String(p || '').replace('/uniforms/comp/', '/uniforms/').toLowerCase();
  const previewEntry = (fontPath) => (previews.index && previews.index[fontKey(fontPath)]) || null;

  function loadDigits(entry) {
    if (!previews.digits.has(entry.file)) {
      previews.digits.set(entry.file, api.numberPreview(entry.file).then((b) => new Uint8Array(b))
        .catch((err) => { previews.digits.delete(entry.file); throw err; }));
    }
    return previews.digits.get(entry.file);
  }

  // Thumbnails are a tighter crop of the same full-size render, so numbers fill the tile.
  const THUMB_W = 220;
  const THUMB_H = 150;

  function paint(canvas, result) {
    canvas.getContext('2d').putImageData(new ImageData(result.pixels, result.width, result.height), 0, 0);
  }

  function jerseyBaseColor(jersey) {
    const base = M.listPartColors(jersey).find((c) => c.group === 'Base materials');
    return (base && base.hex) || M.getTeamColor(state.payload, 'primary') || '#1c3a5e';
  }

  function numbersStudio(jersey, origJersey, v) {
    const d = state.data;
    const fonts = M.listNumberFonts(d);
    const fontLabel = (f) => f.label || f.displayName;
    const current = M.findFontByPath(d, M.currentNumberFontPath(jersey));
    const currentLabel = current ? fontLabel(current) : String(M.currentNumberFontPath(jersey)).split('/').pop() || '(none)';

    const positions = d.numberSizePositions.filter((pos) => M.getDeep(jersey, ['numberMaterialSettings', 'offsetScaleSpacing', pos.field]));
    if (!positions.some((pos) => pos.key === state.previewPos)) state.previewPos = positions.length ? positions[0].key : 'chest';
    const previewPos = () => positions.find((pos) => pos.key === state.previewPos) || positions[0];

    const colors = () => NUMBER_CHANNELS.map((ch, i) => M.getNumberColor(jersey, ch) || P.DEFAULT_COLORS[i]);
    const background = () => state.previewBg[v.suffix] || jerseyBaseColor(jersey);

    // What a font looks like on this jersey: the live values for the current font,
    // or the font's own tuned spacing and size (what applying it would set).
    const liveParams = () => {
      const pos = previewPos();
      return {
        fontPath: M.currentNumberFontPath(jersey),
        spacing: M.getNumberSpacing(jersey),
        numberAdjust: M.getDeep(jersey, ['numberMaterialSettings', 'playerNumberAdjust']),
        scale: pos ? M.getDeep(jersey, ['numberMaterialSettings', 'offsetScaleSpacing', pos.field]) : null,
      };
    };
    // Mirrors applyNumberFont: profile values win, anything the profile lacks stays as is.
    const fontParams = (font) => {
      const live = liveParams();
      const prof = d.numberLayoutProfiles[font.displayName] || {};
      const pos = previewPos();
      return {
        fontPath: font.path,
        spacing: typeof prof.numberSpacing === 'number' ? prof.numberSpacing : live.spacing,
        numberAdjust: prof.playerNumberAdjust || live.numberAdjust,
        scale: (pos && prof[pos.field]) || live.scale,
      };
    };
    const render = (params, digits, entry, size) => P.renderNumber({
      number: state.previewNumber, digits, available: entry && entry.digits, colors: colors(), background: background(),
      spacing: params.spacing, numberAdjust: params.numberAdjust,
      scaleZ: params.scale && params.scale.z, scaleW: params.scale && params.scale.w,
      width: size && size[0], height: size && size[1],
    });

    // ----- big preview -----
    const big = h('canvas', { class: 'preview-canvas', width: P.WIDTH, height: P.HEIGHT });
    const caption = h('div', { class: 'preview-caption' });
    let hoverFont = null;
    let drawToken = 0;
    async function drawBig() {
      const token = ++drawToken;
      const params = hoverFont ? fontParams(hoverFont) : liveParams();
      const pos = previewPos();
      const entry = previewEntry(params.fontPath);
      let text = hoverFont
        ? `Previewing ${fontLabel(hoverFont)} with its tuned spacing and size. Click it to use it.`
        : `${pos ? pos.label : 'Number'} size study · not a 3D game render`;
      let digits = null;
      if (entry) {
        try { digits = await loadDigits(entry); } catch { text = 'Could not load this font\'s preview.'; }
      } else if (params.fontPath) {
        text = 'No preview image for this font. You can still use it.';
      }
      if (token !== drawToken) return;
      const r = render(params, digits, entry);
      paint(big, r);
      if (digits && r.missing.length) text += ` · no image for digit ${[...new Set(r.missing)].join(', ')}`;
      if (digits && r.spacing !== undefined && r.spacing !== params.spacing) {
        text += ` · #${Number(state.previewNumber)} uses its own spacing (${r.spacing})`;
      }
      caption.textContent = text;
    }

    // ----- font browser -----
    const grid = h('div', { class: 'font-grid' });
    const visible = new Set();
    const thumbSuffix = () => [state.previewNumber, state.previewPos, background(), ...colors(), M.getNumberSpacing(jersey)].join('|');
    async function drawThumb(tile) {
      const suffix = thumbSuffix();
      if (previews.thumbKey !== suffix) { previews.thumbs.clear(); previews.thumbKey = suffix; }
      if (tile.drawnKey === suffix) return;
      tile.drawnKey = suffix;
      const font = tile.font;
      const cached = previews.thumbs.get(font.path);
      const ctx = tile.canvas.getContext('2d');
      if (cached) { ctx.putImageData(cached, 0, 0); return; }
      const entry = previewEntry(font.path);
      if (!entry) { tile.classList.add('no-preview'); return; }
      let digits;
      try { digits = await loadDigits(entry); } catch { tile.drawnKey = null; return; }
      if (tile.drawnKey !== suffix) return;
      paint(tile.canvas, render(fontParams(font), digits, entry, [THUMB_W, THUMB_H]));
      previews.thumbs.set(font.path, ctx.getImageData(0, 0, tile.canvas.width, tile.canvas.height));
    }
    const observer = new IntersectionObserver((items) => {
      items.forEach((it) => {
        if (it.isIntersecting) { visible.add(it.target); drawThumb(it.target); } else visible.delete(it.target);
      });
    }, { root: grid, rootMargin: '120px' });

    const applyFont = (font) => {
      const res = M.applyNumberFont(jersey, font, d);
      if (!res.ok) { toast(res.message, 'err'); return; }
      edited(`Number font → ${fontLabel(font)}` + (res.profileApplied.length ? ' (with its spacing and placement)' : ''));
      toast(res.profileApplied.length
        ? `Font set. Also applied its tuned ${res.profileApplied.join(', ')}.`
        : 'Font set. No tuned layout on file for this font, so spacing and size were left as they were.');
      rerender();
    };

    const tiles = fonts.map((font) => {
      const isCurrent = current && current.path === font.path;
      const canvas = h('canvas', { width: THUMB_W, height: THUMB_H });
      const tile = h('button', {
        class: 'font-tile' + (isCurrent ? ' current' : ''),
        title: `${fontLabel(font)}\n${font.displayName}`,
        onclick: () => { if (!isCurrent) applyFont(font); },
        onmouseenter: () => { hoverFont = font; drawBig(); },
        onmouseleave: () => { if (hoverFont === font) { hoverFont = null; drawBig(); } },
      }, canvas, h('span', { class: 'font-tile-label', text: fontLabel(font) }), isCurrent ? h('span', { class: 'font-tile-tag', text: 'Current' }) : null);
      tile.font = font;
      tile.canvas = canvas;
      tile.search = `${fontLabel(font)} ${font.displayName}`.toLowerCase();
      grid.appendChild(tile);
      observer.observe(tile);
      return tile;
    });

    const count = h('span', { class: 'small muted' });
    const filter = () => {
      const q = state.fontQuery.trim().toLowerCase();
      let n = 0;
      tiles.forEach((t) => { t.hidden = !!q && !q.split(/\s+/).every((w) => t.search.includes(w)); if (!t.hidden) n++; });
      count.textContent = `${n} of ${tiles.length} fonts`;
    };
    const search = h('input', { class: 'input', placeholder: 'Search fonts by school, year or style…', value: state.fontQuery, spellcheck: false });
    search.addEventListener('input', () => { state.fontQuery = search.value; filter(); });
    filter();
    grid.addEventListener('scroll', () => { state.fontGridScroll = grid.scrollTop; });
    requestAnimationFrame(() => { grid.scrollTop = state.fontGridScroll || 0; });

    let refreshTimer = null;
    const refresh = () => {
      drawBig();
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => visible.forEach((t) => drawThumb(t)), 120);
    };

    // ----- controls -----
    const chInfo = M.numberColorChannels(jersey, d);
    const colorRows = chInfo.channels.map((ch) => colorRow(`Number ${CHANNEL_NAMES[ch].toLowerCase()}`, null,
      M.getNumberColor(jersey, ch), M.getNumberColor(origJersey, ch),
      (hex) => { const ok = M.setNumberColor(jersey, ch, hex); if (ok) refresh(); return ok; }));

    const spacing = M.getNumberSpacing(jersey);
    const origSpacing = M.getNumberSpacing(origJersey);
    let spacingRow = null;
    if (spacing !== null) {
      const val = h('span', { class: 'value', text: spacing.toFixed(3) });
      const range = h('input', { type: 'range', min: M.NUMBER_SPACING_MIN, max: M.NUMBER_SPACING_MAX, step: 0.005, value: spacing });
      range.addEventListener('input', () => {
        M.setNumberSpacing(jersey, range.value);
        val.textContent = Number(range.value).toFixed(3);
        edited(`Number spacing → ${Number(range.value).toFixed(3)}`);
        refresh();
      });
      spacingRow = h('div', { class: 'slider-row' }, h('span', { text: 'Spacing' }), range, val,
        h('button', { class: 'btn small ghost', text: 'Reset', disabled: origSpacing === null, onclick: () => { M.setNumberSpacing(jersey, origSpacing); edited('Number spacing reset.'); rerender(); } }));
    }

    const nms = jersey.numberMaterialSettings || {};
    const sizeRows = d.numberSizePositions.map((pos) => {
      const pct = M.getNumberSizePercent(jersey, origJersey, pos.field);
      if (pct === null) return null;
      const unused = (pos.key === 'shoulder' && nms.hasShoulder === false) || (pos.key === 'sleeve' && nms.hasSleeve === false);
      const val = h('span', { class: 'value', text: `${pct}%` });
      const range = h('input', { type: 'range', min: M.NUMBER_SIZE_MIN, max: M.NUMBER_SIZE_MAX, step: 1, value: pct });
      range.addEventListener('input', () => {
        M.setNumberSizePercent(jersey, origJersey, pos.field, range.value);
        val.textContent = `${range.value}%`;
        edited(`${pos.label} number size → ${range.value}%`);
        if (state.previewPos !== pos.key) { state.previewPos = pos.key; posSelect.value = pos.key; }
        refresh();
      });
      return h('div', { class: 'slider-row', title: unused ? 'This jersey does not show numbers here.' : '' },
        h('span', { class: unused ? 'muted' : '', text: pos.label + (unused ? ' (unused)' : '') }), range, val,
        h('button', { class: 'btn small ghost', text: 'Reset', onclick: () => { M.setNumberSizePercent(jersey, origJersey, pos.field, 100); edited(`${pos.label} number size reset.`); rerender(); } }));
    }).filter(Boolean);

    // ----- preview panel controls (preview only, never saved) -----
    const numberInput = h('input', { class: 'input preview-number', value: state.previewNumber, maxLength: 2, inputMode: 'numeric', title: 'Number to preview' });
    numberInput.addEventListener('input', () => {
      numberInput.value = numberInput.value.replace(/\D/g, '').slice(0, 2);
      state.previewNumber = numberInput.value;
      refresh();
    });
    const posSelect = h('select', { class: 'input' }, positions.map((pos) => h('option', { value: pos.key, text: pos.label })));
    posSelect.value = state.previewPos;
    posSelect.addEventListener('change', () => { state.previewPos = posSelect.value; refresh(); });
    const bgPicker = h('input', { type: 'color', value: background() });
    bgPicker.addEventListener('input', () => { state.previewBg[v.suffix] = bgPicker.value.toLowerCase(); refresh(); });

    drawBig();

    return h('section', { class: 'card numbers-studio' },
      h('div', { class: 'card-head' },
        h('h2', { text: `Jersey numbers · ${v.label}` }),
        h('span', { class: 'small muted', text: 'Font, colors, spacing and size of the numbers on this jersey.' })),
      h('div', { class: 'numbers-layout' },
        h('div', null,
          h('div', { class: 'section-label', text: 'Font' }),
          h('div', { class: 'current-font' }, h('b', { text: currentLabel }),
            current ? h('span', { class: 'small muted', text: current.displayName }) : null),
          colorRows.length ? [h('div', { class: 'section-label', text: 'Colors' }), colorRows,
            chInfo.confirmed ? null : note('This font isn\'t in the confirmed list, so the color slots shown are a best guess from the file.', 'warn')] : null,
          spacingRow ? [h('div', { class: 'section-label', text: 'Spacing' }), spacingRow,
            h('div', { class: 'slider-scale' }, h('span', { text: '← Closer together' }), h('span', { text: 'Further apart →' })),
            Array.isArray(nms.playerNumberAdjust) && nms.playerNumberAdjust.length
              ? h('div', { class: 'small muted', text: `${nms.playerNumberAdjust.length} number${nms.playerNumberAdjust.length === 1 ? '' : 's'} (like ${nms.playerNumberAdjust.slice(0, 3).map((a) => a.number).join(', ')}) get their own spacing in game, usually tighter for thin 1s. Type one in the preview to see it.` })
              : null] : null,
          sizeRows.length ? [h('div', { class: 'section-label', text: 'Size' }), sizeRows,
            note('Higher % should give bigger numbers in-game. Two players reported this direction, but it hasn\'t been fully confirmed yet, so check in game.', 'warn')] : null,
          h('div', { class: 'font-browser' },
            h('div', { class: 'row' }, h('div', { class: 'section-label', style: 'margin:0', text: 'Change font' }), h('div', { class: 'spacer' }), count),
            h('p', { class: 'hint', text: 'Shown in this jersey\'s number colors with each font\'s tuned spacing and size. Hover to preview it large, click to use it.' }),
            search, grid)),
        h('div', { class: 'preview-panel' },
          h('div', { class: 'row' }, h('div', { class: 'section-label', style: 'margin:0', text: 'Number preview' }), h('div', { class: 'spacer' }), numberInput),
          big, caption,
          h('div', { class: 'preview-options' },
            positions.length > 1 ? h('div', { class: 'opt' }, h('span', { text: 'Size shown' }), posSelect) : null,
            h('div', { class: 'opt' }, h('span', { text: 'Background' }),
              h('div', { class: 'row' }, bgPicker,
                teamColorChips((hex) => { state.previewBg[v.suffix] = hex; bgPicker.value = hex; refresh(); }),
                h('button', { class: 'btn small ghost', text: 'Jersey color', onclick: () => { delete state.previewBg[v.suffix]; bgPicker.value = background(); refresh(); } })))),
          h('div', { class: 'small muted', text: 'Preview settings are not saved to the team file.' }))));
  }

  function helmetCard(helmet, origHelmet) {
    const d = state.data;
    const shells = pickerOptions(d.catalog.helmetMaterials.shell, (s) => s.label || s.displayName, (s) => s.displayName);
    const currentShell = M.findShell(d, helmet.shellMaterial);
    const picker = searchPicker('shell', shells,
      currentShell ? currentShell.label : String(helmet.shellMaterial || '').split('/').pop(),
      'Search shell finish by school…', (shell) => {
        const res = M.applyHelmetShell(helmet, shell, d);
        if (!res.ok) { toast(res.message, 'err'); return; }
        edited(`Helmet shell → ${shell.label}`);
        toast(res.accessoryMatched ? 'Shell set, and the matching accessory finish too.' : 'Shell set. No matching accessory finish on file, so that was left as it was.', res.accessoryMatched ? 'ok' : 'warn');
        rerender();
      });
    const facemask = M.getFacemaskColor(helmet);
    return card('Helmet', 'Shell finish (matte, chrome, glossy…) and facemask color.',
      h('div', { class: 'section-label', text: 'Shell finish' }), picker,
      facemask ? [h('div', { class: 'section-label', text: 'Facemask' }),
        colorRow('Facemask color', null, facemask, M.getFacemaskColor(origHelmet), (hex) => M.setFacemaskColor(helmet, hex))] : null);
  }

  // ---------- brand logo (vendor decal) ----------
  const decalPreviews = { index: null };
  const DECAL_PIECES = [['jersey', 'Jersey'], ['pants', 'Pants'], ['socks', 'Socks']];
  const DECAL_CHANNEL_NAMES = { colorR: 'main', colorG: 'second', colorB: 'third' };
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const decalKey = (col) => String(col || '').split('/').pop().toLowerCase();

  // The logo drawn in the given region colors ({ R, G, B } hex), or null when
  // there is no preview for it. Vector traces are recolored per region; the
  // metallic "Diamond" art is shown as it is.
  function decalArt(decal, colors) {
    const e = decal && decalPreviews.index && decalPreviews.index[decalKey(decal.col)];
    if (!e) return null;
    if (e.type === 'vector') {
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('viewBox', e.viewBox);
      svg.setAttribute('class', 'decal-art');
      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('transform', e.transform);
      Object.entries(e.regions).forEach(([ch, d]) => {
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', d);
        path.setAttribute('fill', colors[ch] || colors.R);
        g.appendChild(path);
      });
      svg.appendChild(g);
      return svg;
    }
    return h('img', { class: 'decal-art', src: `../assets/decal-previews/${e.file}`, alt: '' });
  }

  function brandStudio(v, origVariant) {
    const d = state.data;
    const p = state.payload;
    const pieces = DECAL_PIECES
      .map(([kind, label]) => ({ kind, label, part: M.getPart(p, v, kind), orig: M.getPart(state.original, origVariant, kind) }))
      .filter((x) => M.findVendorDecalOverlays(x.part).length);
    if (!pieces.length) return null;
    const current = M.currentDecal(p, v, d);
    const isCurrent = (decal) => !!current && current.col === decal.col;

    // Unset channels fall back to the main color so every region still draws.
    const regionColors = (piece) => {
      const c = M.getDecalColors(piece.part) || {};
      const main = c.colorR || M.getTeamColor(p, 'primary') || '#ffffff';
      return { R: main, G: c.colorG || main, B: c.colorB || main };
    };
    const pieceBg = (piece) => (M.listPartColors(piece.part).find((c) => c.group === 'Base materials') || {}).hex || '#1c3a5e';
    const stage = (decal, piece, cls) => h('div', { class: `decal-stage ${cls}`, style: `background-color:${pieceBg(piece)}` },
      decalArt(decal, regionColors(piece)) || h('span', { class: 'decal-missing', text: 'No preview' }));

    // ----- preview panel: the lead piece large, every piece small -----
    const previewBox = h('div', { class: 'decal-preview' });
    const caption = h('div', { class: 'preview-caption' });
    let hover = null;
    const drawPreview = () => {
      const decal = hover || current;
      previewBox.replaceChildren(
        stage(decal, pieces[0], 'big'),
        h('div', { class: 'decal-minis' }, pieces.map((piece) => h('div', null, stage(decal, piece, 'mini'), h('div', { class: 'small muted', text: piece.label })))));
      const e = decal && decalPreviews.index && decalPreviews.index[decalKey(decal.col)];
      const how = e && e.type === 'image' ? 'metallic art, shown in its own colors' : 'shown in each piece\'s logo colors';
      caption.textContent = hover
        ? `Previewing ${hover.label} (${how}). Click it to use it.`
        : decal ? `${decal.label} · ${how}.` : 'No brand logo on this uniform.';
    };

    // ----- gallery -----
    const grid = h('div', { class: 'decal-grid' });
    const drawGrid = () => grid.replaceChildren(...d.catalog.decals.map((decal) => {
      const tile = h('button', {
        class: 'decal-tile' + (isCurrent(decal) ? ' current' : ''),
        title: decal.label,
        onclick: () => {
          if (isCurrent(decal)) return;
          const results = M.applyVendorDecal(p, v, decal, d);
          edited(`Brand logo → ${decal.label}`);
          toast(results.map((r) => `${r.kind}: ${r.ok ? r.note : 'skipped (' + r.note + ')'}`).join(' · '), results.every((r) => r.ok) ? 'ok' : 'warn');
          rerender();
        },
        onmouseenter: () => { hover = decal; drawPreview(); },
        onmouseleave: () => { if (hover === decal) { hover = null; drawPreview(); } },
      }, stage(decal, pieces[0], 'thumb'), h('span', { class: 'font-tile-label', text: decal.label }),
      isCurrent(decal) ? h('span', { class: 'font-tile-tag', text: 'Current' }) : null);
      tile.search = `${decal.label} ${decal.brand || ''}`.toLowerCase();
      return tile;
    }));
    const count = h('span', { class: 'small muted' });
    const filter = () => {
      const q = state.decalQuery.trim().toLowerCase();
      let n = 0;
      [...grid.children].forEach((t) => { t.hidden = !!q && !q.split(/\s+/).every((w) => t.search.includes(w)); if (!t.hidden) n++; });
      count.textContent = `${n} of ${grid.children.length} logos`;
    };
    const search = h('input', { class: 'input', placeholder: 'Search logos (Nike, Jordan, Adidas, Under Armour…)', value: state.decalQuery, spellcheck: false });
    search.addEventListener('input', () => { state.decalQuery = search.value; filter(); });
    const redraw = () => { drawGrid(); filter(); drawPreview(); };

    // ----- logo colors, per piece -----
    const colorRows = pieces.map((piece) => {
      const now = M.getDecalColors(piece.part) || {};
      const was = M.getDecalColors(piece.orig) || {};
      const rows = Object.keys(DECAL_CHANNEL_NAMES).filter((ch) => now[ch]).map((ch) =>
        colorRow(`${piece.label} logo ${DECAL_CHANNEL_NAMES[ch]}`, null, now[ch], was[ch],
          (hex) => { const ok = M.setDecalColor(piece.part, ch, hex); if (ok) redraw(); return ok; }));
      return rows;
    });
    const copyColors = pieces.length > 1 ? h('button', {
      class: 'btn small', text: `Use ${pieces[0].label.toLowerCase()} logo colors on ${pieces.slice(1).map((x) => x.label.toLowerCase()).join(' & ')}`,
      onclick: () => {
        const src = M.getDecalColors(pieces[0].part) || {};
        let n = 0;
        pieces.slice(1).forEach((piece) => Object.keys(DECAL_CHANNEL_NAMES).forEach((ch) => {
          if (src[ch] && M.setDecalColor(piece.part, ch, src[ch])) n++;
        }));
        edited(`Copied ${pieces[0].label.toLowerCase()} logo colors to ${n} swatch${n === 1 ? '' : 'es'}.`);
        rerender();
      },
    }) : null;

    redraw();

    return h('section', { class: 'card brand-studio' },
      h('div', { class: 'card-head' },
        h('h2', { text: `Brand logo · ${v.label}` }),
        h('span', { class: 'small muted', text: `Current: ${current ? current.label : 'none'} · on ${pieces.map((x) => x.label.toLowerCase()).join(', ')}` })),
      h('div', { class: 'studio-layout' },
        h('div', null,
          h('div', { class: 'row' }, h('div', { class: 'section-label', style: 'margin:0', text: 'Change logo' }), h('div', { class: 'spacer' }), count),
          h('p', { class: 'hint', text: 'Swaps the maker\'s logo on the jersey, pants and socks together, with tested placement for Nike, Jordan, Under Armour and Adidas. Hover to preview, click to use.' }),
          search, grid,
          h('div', { class: 'section-label', text: 'Logo colors' }),
          colorRows,
          copyColors ? h('div', { class: 'row', style: 'margin-top:10px' }, copyColors) : null),
        h('div', { class: 'preview-panel' },
          h('div', { class: 'section-label', style: 'margin:0', text: 'Logo preview' }),
          previewBox, caption,
          h('div', { class: 'small muted', text: 'Flat preview on each piece\'s base color, not a 3D render. Placement on the uniform comes from the logo\'s tested settings.' }))));
  }

  function variantColors(v) {
    const p = state.payload;
    const set = new Map();
    M.PART_KINDS.forEach(({ kind }) => {
      const part = M.getPart(p, v, kind);
      M.listPartColors(part).forEach((c) => set.set(c.hex, (set.get(c.hex) || 0) + 1));
      const fm = kind === 'helmet' ? M.getFacemaskColor(part) : null;
      if (fm) set.set(fm, (set.get(fm) || 0) + 1);
      if (part && part.numberComp) {
        ['colorR', 'colorG', 'colorB'].forEach((ch) => {
          const hx = M.getNumberColor(part, ch);
          if (hx) set.set(hx, (set.get(hx) || 0) + 1);
        });
      }
    });
    return [...set.entries()].sort((a, b) => b[1] - a[1]);
  }

  function swapCard(v) {
    const colors = variantColors(v);
    if (!colors.length) return null;
    const target = h('input', { type: 'color', value: state.swapTo || state.swapFrom || colors[0][0] });
    target.addEventListener('input', () => { state.swapTo = target.value.toLowerCase(); });
    const chips = colors.map(([hex, count]) => h('button', {
      class: 'btn small' + (state.swapFrom === hex ? ' primary' : ''),
      title: `${count} place${count === 1 ? '' : 's'}`,
      onclick: () => { state.swapFrom = hex; state.swapTo = null; rerender(); },
    }, h('span', { class: 'chip', style: `background:${hex}` }), hex));
    return card(`Swap a color · ${v.label}`, 'Pick a color used on this uniform, choose its replacement, and every matching swatch on the uniform changes at once.',
      h('div', { class: 'row' }, chips),
      h('div', { class: 'row', style: 'margin-top:12px' },
        h('span', { class: 'muted', text: 'Replace with' }), target,
        teamColorChips((hex) => { target.value = hex; state.swapTo = hex; }),
        h('button', {
          class: 'btn primary small', text: 'Replace', disabled: !state.swapFrom, onclick: () => {
            if (target.value.toLowerCase() === state.swapFrom) { toast('Pick a different replacement color first.', 'warn'); return; }
            const n = M.replaceColorEverywhere(state.payload, v, state.swapFrom, target.value);
            edited(`Replaced ${state.swapFrom} with ${target.value} in ${n} place${n === 1 ? '' : 's'}.`);
            toast(`Updated ${n} swatch${n === 1 ? '' : 'es'} on ${v.label}.`);
            state.swapFrom = target.value.toLowerCase();
            state.swapTo = null;
            rerender();
          },
        })));
  }

  function partColorsCard(v, origVariant, kind, label) {
    const part = M.getPart(state.payload, v, kind);
    const orig = M.getPart(state.original, origVariant, kind);
    const colors = M.listPartColors(part);
    if (!part || !colors.length) return null;
    const groups = {};
    colors.forEach((c) => { (groups[c.group] = groups[c.group] || []).push(c); });
    return card(`${label} colors · ${v.label}`, part.name ? `Template: ${part.name}` : null,
      Object.entries(groups).map(([group, list]) => [
        h('div', { class: 'section-label', text: group }),
        list.map((c) => colorRow(c.label, list.filter((x) => x.label === c.label).length > 1 ? c.channel : null,
          c.hex, (() => { const oc = M.getDeep(orig, c.path); return oc ? M.unitToHex(oc) : null; })(),
          (hex) => M.setColorAt(part, c.path, hex))),
      ]));
  }

  // ---------- Changes ----------
  function renderChanges() {
    const list = changes();
    const reportText = () => [`Changes to ${M.teamTitle(state.payload)}`, '', ...list.map((c) => `${c.label}: ${c.before} -> ${c.after}`)].join('\n');
    const cell = (value, cls) => h('td', { class: `v ${cls}` },
      /^#[0-9a-f]{6}$/i.test(value) ? h('span', { class: 'chip', style: `background:${value}` }) : null, value);
    return h('div', null,
      viewHead('Changes', `${list.length} change${list.length === 1 ? '' : 's'} compared to the team as it was loaded.`,
        h('button', { class: 'btn', text: 'Save report…', disabled: !list.length || !api, onclick: async () => {
          const r = await api.saveReport({ text: reportText(), suggestedName: M.teamTitle(state.payload) });
          if (r && r.path) toast(`Report saved to ${r.path}`);
        } }),
        h('button', { class: 'btn danger', text: 'Undo all changes', disabled: !list.length, onclick: () => {
          if (!confirm('Undo every change and go back to the team as it was loaded?')) return;
          state.payload = M.clone(state.original);
          edited('All changes undone.');
          rerender();
        } })),
      list.length
        ? h('div', { class: 'card' }, h('table', { class: 'changes' },
          h('thead', null, h('tr', null, h('th', { text: 'What' }), h('th', { text: 'Before' }), h('th', { text: 'After' }))),
          h('tbody', null, list.map((c) => h('tr', null, h('td', { text: c.label }), cell(c.before, ''), cell(c.after, 'after'))))))
        : note('No changes yet. Edits you make on the Team and Uniforms pages show up here.'));
  }

  // ---------- Raw JSON ----------
  function renderRaw() {
    const area = h('textarea', { class: 'raw', spellcheck: false, readOnly: !state.rawEditing });
    area.value = JSON.stringify(state.payload, null, 2);
    return h('div', null,
      viewHead('Raw JSON', state.rawEditing ? 'Editing raw JSON. Apply to check it and load it into the editor.' : 'The exact data that gets saved. Read-only unless you turn on editing.',
        h('button', { class: 'btn', text: 'Copy', onclick: () => { navigator.clipboard.writeText(M.serialize(state.payload)); toast('Copied to clipboard.'); } }),
        state.rawEditing
          ? [h('button', { class: 'btn', text: 'Cancel', onclick: () => { state.rawEditing = false; rerender(); } }),
            h('button', { class: 'btn primary', text: 'Apply', onclick: () => {
              try {
                state.payload = M.parseTeamJson(area.value);
                state.rawEditing = false;
                edited('Raw JSON applied.');
                rerender();
              } catch (err) { toast('Not applied: ' + err.message, 'err'); }
            } })]
          : h('button', { class: 'btn', text: 'Edit raw JSON', onclick: () => { state.rawEditing = true; rerender(); } })),
      state.rawEditing ? note('Advanced: a wrong edit here can make the team fail to import. The Changes page shows exactly what you changed.', 'warn') : null,
      area);
  }

  // ---------- actions ----------
  function confirmReplace() {
    if (!state.payload || M.serialize(state.payload) === state.savedText) return true;
    return confirm(`You have unsaved changes to ${M.teamTitle(state.payload)}. Load another team anyway?`);
  }

  async function signIn() {
    if (!api) return toast('Team Builder sign-in only works inside the desktop app.', 'err');
    await api.openSignIn();
    setStatus('Team Builder window open. Sign in, open your team and click Edit.');
  }

  async function openFile() {
    if (!api) return toast('Opening files only works inside the desktop app.', 'err');
    if (!confirmReplace()) return;
    try {
      const f = await api.openFile();
      if (f) loadPayload(f.text, { kind: 'file', path: f.path, name: f.name });
    } catch (err) { toast(err.message, 'err'); }
  }

  async function openCapture(id) {
    if (!confirmReplace()) return;
    try {
      const c = await api.loadCapture(id);
      loadPayload(c.text, { kind: 'capture', path: c.path, name: c.name });
    } catch (err) { toast(err.message, 'err'); }
  }

  async function save() {
    if (!state.payload || !api) return;
    const text = M.serialize(state.payload);
    const ti = M.getDeep(state.payload, ['teamData', 'teamInfos']) || {};
    const r = await api.saveFile({
      text,
      suggestedName: [ti.TEAM_NAME, ti.TEAM_NICKNAME, 'edited'].filter(Boolean).join(' '),
      protectedPaths: state.source && state.source.path ? [state.source.path] : [],
    });
    if (!r) return;
    if (r.error) { toast(r.error, 'err'); return; }
    state.savedText = text;
    edited(`Saved to ${r.path}`);
    toast(`Saved. Import ${r.path} into the MMC editor to build your mod.`);
  }

  // ---------- wiring ----------
  document.querySelectorAll('.sidenav button').forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));
  $('btnSignIn').addEventListener('click', signIn);
  $('btnOpen').addEventListener('click', openFile);
  $('btnSave').addEventListener('click', save);
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    if (e.key.toLowerCase() === 'o') { e.preventDefault(); openFile(); }
  });

  async function init() {
    if (!api) {
      show('home');
      content.prepend(note('The desktop bridge is missing. Start this with "npm start" so sign-in, open and save work.', 'err'));
      return;
    }
    state.data = JSON.parse(await api.loadData());
    try {
      previews.index = JSON.parse(await api.numberPreviewIndex());
    } catch {
      previews.index = {}; // previews are a nice-to-have; editing works without them
    }
    try {
      decalPreviews.index = JSON.parse(await api.decalPreviewIndex());
    } catch {
      decalPreviews.index = {};
    }
    state.captures = await api.listCaptures();
    api.onCaptured((c) => {
      state.captures = [c, ...state.captures.filter((x) => x.id !== c.id && x.url !== c.url)];
      if (!state.payload) { openCapture(c.id); toast(`Grabbed ${c.teamName} from Team Builder.`); return; }
      toast(`Grabbed ${c.teamName} from Team Builder.`, 'ok', { label: 'Edit it now', run: () => openCapture(c.id) });
      if (state.view === 'home') rerender();
    });
    api.onCaptureError((err) => toast(`Couldn't grab the team: ${err.message}`, 'err'));
    show('home');
  }

  init().catch((err) => toast(err.message, 'err'));
})();
