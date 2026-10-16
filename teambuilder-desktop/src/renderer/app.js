(function () {
  'use strict';
  const M = window.TBModel;
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

  // A color swatch + hex box. `onSet(hex)` mutates the payload and returns true on success.
  function colorRow(name, sub, hex, originalHex, onSet) {
    const picker = h('input', { type: 'color', value: hex || '#000000' });
    const text = h('input', { class: 'input hex', value: hex || '', maxLength: 7, spellcheck: false });
    const wrap = h('div', { class: 'swatch' + (originalHex && hex && originalHex !== hex ? ' changed' : '') }, picker);
    const commit = (value, fromPicker) => {
      if (!/^#[0-9a-f]{6}$/i.test(value)) { toast('Use a six-digit hex color like #FF850B.', 'err'); text.value = picker.value; return; }
      if (!onSet(value.toLowerCase())) { toast(`Could not set ${name}.`, 'err'); return; }
      if (fromPicker) text.value = value; else picker.value = value;
      wrap.classList.toggle('changed', !!originalHex && originalHex !== value.toLowerCase());
      edited(`${name} → ${value}`);
    };
    picker.addEventListener('input', () => commit(picker.value, true));
    text.addEventListener('change', () => commit(text.value.trim().startsWith('#') ? text.value.trim() : '#' + text.value.trim(), false));
    return h('div', { class: 'color-row' },
      h('div', { class: 'name', title: name }, name, sub ? h('span', { class: 'chan', text: sub }) : null),
      wrap, text);
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
        (hex) => M.setTeamColor(p, s.key, hex))),
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
      h('div', { class: 'grid' },
        jersey && jersey.numberComp ? numbersCard(jersey, M.getPart(state.original, origVariant, 'jersey'), v) : null,
        helmet ? helmetCard(helmet, M.getPart(state.original, origVariant, 'helmet')) : null,
        brandCard(v),
        swapCard(v),
        M.PART_KINDS.map(({ kind, label }) => partColorsCard(v, origVariant, kind, label))));
  }

  const CHANNEL_NAMES = { colorR: 'Main', colorG: 'Outline', colorB: 'Third' };

  function numbersCard(jersey, origJersey, v) {
    const d = state.data;
    const fonts = pickerOptions(M.listNumberFonts(d), (f) => f.label || f.displayName, (f) => f.displayName);
    const current = M.findFontByPath(d, M.currentNumberFontPath(jersey));
    const currentLabel = current ? (current.label || current.displayName) : String(M.currentNumberFontPath(jersey)).split('/').pop();

    const fontPicker = searchPicker('font', fonts, currentLabel, 'Search by school or year…', (font) => {
      const res = M.applyNumberFont(jersey, font, d);
      if (!res.ok) { toast(res.message, 'err'); return; }
      edited(`Number font → ${font.label || font.displayName}` + (res.profileApplied.length ? ` (with its spacing and placement)` : ''));
      toast(res.profileApplied.length
        ? `Font set. Also applied its tuned ${res.profileApplied.join(', ')}.`
        : 'Font set. No tuned layout on file for this font, so spacing and size were left as they were.');
      rerender();
    });

    const chInfo = M.numberColorChannels(jersey, d);
    const colorRows = chInfo.channels.map((ch) => colorRow(`Number ${CHANNEL_NAMES[ch].toLowerCase()}`, null,
      M.getNumberColor(jersey, ch), M.getNumberColor(origJersey, ch), (hex) => M.setNumberColor(jersey, ch, hex)));

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
      });
      spacingRow = h('div', { class: 'slider-row' }, h('span', { text: 'Spacing' }), range, val,
        h('button', { class: 'btn small ghost', text: 'Reset', disabled: origSpacing === null, onclick: () => { M.setNumberSpacing(jersey, origSpacing); edited('Number spacing reset.'); rerender(); } }));
    }

    const nms = jersey.numberMaterialSettings || {};
    const sizeRows = state.data.numberSizePositions.map((pos) => {
      const pct = M.getNumberSizePercent(jersey, origJersey, pos.field);
      if (pct === null) return null;
      const unused = (pos.key === 'shoulder' && nms.hasShoulder === false) || (pos.key === 'sleeve' && nms.hasSleeve === false);
      const val = h('span', { class: 'value', text: `${pct}%` });
      const range = h('input', { type: 'range', min: M.NUMBER_SIZE_MIN, max: M.NUMBER_SIZE_MAX, step: 1, value: pct });
      range.addEventListener('input', () => {
        M.setNumberSizePercent(jersey, origJersey, pos.field, range.value);
        val.textContent = `${range.value}%`;
        edited(`${pos.label} number size → ${range.value}%`);
      });
      return h('div', { class: 'slider-row', title: unused ? 'This jersey does not show numbers here.' : '' },
        h('span', { class: unused ? 'muted' : '', text: pos.label + (unused ? ' (unused)' : '') }), range, val,
        h('button', { class: 'btn small ghost', text: 'Reset', onclick: () => { M.setNumberSizePercent(jersey, origJersey, pos.field, 100); edited(`${pos.label} number size reset.`); rerender(); } }));
    }).filter(Boolean);

    return card(`Jersey numbers · ${v.label}`, 'Font, colors, spacing and size of the numbers on this jersey.',
      h('div', { class: 'section-label', text: 'Font' }), fontPicker,
      colorRows.length ? [h('div', { class: 'section-label', text: 'Colors' }), colorRows,
        chInfo.confirmed ? null : note('This font isn\'t in the confirmed list, so the color slots shown are a best guess from the file.', 'warn')] : null,
      spacingRow ? [h('div', { class: 'section-label', text: 'Spacing' }), spacingRow] : null,
      sizeRows.length ? [h('div', { class: 'section-label', text: 'Size' }), sizeRows,
        note('Higher % should give bigger numbers in-game. Two players reported this direction, but it hasn\'t been fully confirmed yet, so check in game.', 'warn')] : null);
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

  function brandCard(v) {
    const d = state.data;
    const p = state.payload;
    const hasAny = ['jersey', 'pants', 'socks'].some((k) => M.findVendorDecalOverlays(M.getPart(p, v, k)).length);
    if (!hasAny) return null;
    const current = M.currentDecal(p, v, d);
    const options = pickerOptions(d.catalog.decals, (x) => x.label, (x) => x.col.split('/').pop());
    return card('Brand logo', 'Swaps the maker\'s logo on the jersey, pants and socks together, with tested placement for Nike, Jordan, Under Armour and Adidas.',
      searchPicker('decal', options, current && current.label, 'Search brand…', (decal) => {
        const results = M.applyVendorDecal(p, v, decal, d);
        edited(`Brand logo → ${decal.label}`);
        toast(results.map((r) => `${r.kind}: ${r.ok ? r.note : 'skipped (' + r.note + ')'}`).join(' · '), results.every((r) => r.ok) ? 'ok' : 'warn');
        rerender();
      }));
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
