// Pure editing logic for a Team Builder team JSON (the same file the website
// loads as nonce-primary.json and MMC imports). No DOM, no Electron -- runs in
// the renderer and under `node --test`.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TBModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PARTS_PATH = ['teamData', 'frostbiteData', 'uniformParts'];
  const PART_KINDS = [
    { kind: 'helmet', plural: 'helmets', keyField: 'helmetKey', label: 'Helmet' },
    { kind: 'jersey', plural: 'jerseys', keyField: 'jerseyKey', label: 'Jersey' },
    { kind: 'pants', plural: 'pants', keyField: 'pantsKey', label: 'Pants' },
    { kind: 'socks', plural: 'socks', keyField: 'socksKey', label: 'Socks' },
  ];
  const NUMBER_SPACING_PATH = ['numberMaterialSettings', 'offsetScaleSpacing', 'numberSpacing', 'x'];
  const NUMBER_SPACING_MIN = -0.6;
  const NUMBER_SPACING_MAX = -0.3;
  const NUMBER_SIZE_MIN = 50;
  const NUMBER_SIZE_MAX = 150;
  const NUMBER_OFFSET_SCALE_FIELDS = [
    'chestNumberOffsetScale', 'backNumberOffsetScale', 'shoulderNumberOffsetScale', 'sleeveNumberOffsetScale',
  ];

  const TEAM_FIELDS = [
    { key: 'TEAM_NAME', label: 'School name', metadataKey: 'teamDisplayName' },
    { key: 'TEAM_NICKNAME', label: 'Nickname', metadataKey: 'teamNickname' },
    { key: 'TEAM_SHORTNAME', label: 'Abbreviation', maxLength: 5 },
    { key: 'CITY_NAME', label: 'City' },
    { key: 'CITY_STATE', label: 'State' },
    { key: 'STADIUM_NAME', label: 'Stadium name' },
    { key: 'YEAR_FOUNDED', label: 'Year founded', metadataKey: 'yearFounded', numeric: true },
  ];

  const TEAM_COLOR_SLOTS = [
    { key: 'primary', label: 'Primary', suffix: '' },
    { key: 'secondary', label: 'Secondary', suffix: '2' },
    { key: 'tertiary', label: 'Tertiary', suffix: '3' },
  ];

  const PALETTE_SLOTS = ['primaryColor', 'secondaryColor', 'tertiaryColor', 'quaternaryColor'];

  // ---------- basics ----------
  function getDeep(obj, path) {
    let cur = obj;
    for (const p of path) {
      if (cur == null) return undefined;
      cur = cur[p];
    }
    return cur;
  }

  // Never creates missing intermediate nodes: writing into structure the
  // website didn't produce is exactly how a file ends up importing wrong.
  function setDeep(obj, path, value) {
    let cur = obj;
    for (let i = 0; i < path.length - 1; i++) {
      if (cur[path[i]] == null || typeof cur[path[i]] !== 'object') return false;
      cur = cur[path[i]];
    }
    cur[path[path.length - 1]] = value;
    return true;
  }

  const clone = (v) => JSON.parse(JSON.stringify(v));

  function parseTeamJson(text) {
    const payload = JSON.parse(text);
    if (!payload || typeof payload !== 'object' || !payload.teamData) {
      throw new Error('This is not a Team Builder team file (no "teamData" section).');
    }
    return payload;
  }

  // Compact, matching the website's own single-line format.
  const serialize = (payload) => JSON.stringify(payload);

  function teamTitle(payload) {
    const ti = getDeep(payload, ['teamData', 'teamInfos']) || {};
    return [ti.TEAM_NAME, ti.TEAM_NICKNAME].filter(Boolean).join(' ') || 'Unnamed team';
  }

  // ---------- colors ----------
  const clamp01 = (n) => Math.max(0, Math.min(1, n));

  function unitToHex(c) {
    if (!c || typeof c.r !== 'number') return null;
    const h = (n) => Math.round(clamp01(n) * 255).toString(16).padStart(2, '0');
    return '#' + h(c.r) + h(c.g) + h(c.b);
  }

  function hexToUnit(hex) {
    if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return null;
    const n = parseInt(hex.slice(1), 16);
    return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
  }

  function hexToBytes(hex) {
    const u = hexToUnit(hex);
    return u ? { r: Math.round(u.r * 255), g: Math.round(u.g * 255), b: Math.round(u.b * 255) } : null;
  }

  function bytesToHex(r, g, b) {
    const vals = [r, g, b].map(Number);
    if (vals.some((v) => !Number.isFinite(v))) return null;
    return '#' + vals.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  }

  // ---------- team identity ----------
  function getTeamField(payload, key) {
    const v = getDeep(payload, ['teamData', 'teamInfos', key]);
    return v == null ? '' : String(v);
  }

  function setTeamField(payload, key, value) {
    const field = TEAM_FIELDS.find((f) => f.key === key);
    if (!field) throw new Error('Unknown team field ' + key);
    const infos = getDeep(payload, ['teamData', 'teamInfos']);
    if (!infos) return false;
    let v = String(value);
    if (field.maxLength) v = v.slice(0, field.maxLength);
    infos[key] = v;
    const meta = getDeep(payload, ['teamData', 'metadata']);
    if (field.metadataKey && meta && field.metadataKey in meta) meta[field.metadataKey] = v;
    return true;
  }

  function getTeamColor(payload, slotKey) {
    const slot = TEAM_COLOR_SLOTS.find((s) => s.key === slotKey);
    const ti = getDeep(payload, ['teamData', 'teamInfos']) || {};
    return bytesToHex(
      ti['TEAM_BACKGROUNDCOLORR' + slot.suffix],
      ti['TEAM_BACKGROUNDCOLORG' + slot.suffix],
      ti['TEAM_BACKGROUNDCOLORB' + slot.suffix],
    );
  }

  function setTeamColor(payload, slotKey, hex) {
    const slot = TEAM_COLOR_SLOTS.find((s) => s.key === slotKey);
    const b = hexToBytes(hex);
    const ti = getDeep(payload, ['teamData', 'teamInfos']);
    if (!slot || !b || !ti) return false;
    ti['TEAM_BACKGROUNDCOLORR' + slot.suffix] = String(b.r);
    ti['TEAM_BACKGROUNDCOLORG' + slot.suffix] = String(b.g);
    ti['TEAM_BACKGROUNDCOLORB' + slot.suffix] = String(b.b);
    return true;
  }

  function paletteColorPath(paletteKey, slot) {
    return ['teamData', 'frostbiteData', 'teamVisuals', paletteKey, slot, 'colorChannels'];
  }

  function getPaletteColor(payload, paletteKey, slot) {
    const c = getDeep(payload, paletteColorPath(paletteKey, slot));
    return c ? unitToHex({ r: c.x, g: c.y, b: c.z }) : null;
  }

  function setPaletteColor(payload, paletteKey, slot, hex) {
    const u = hexToUnit(hex);
    const c = getDeep(payload, paletteColorPath(paletteKey, slot));
    if (!u || !c) return false;
    c.x = u.r; c.y = u.g; c.z = u.b;
    return true;
  }

  // ---------- uniform variants ----------
  function deriveVariants(payload) {
    const groups = {};
    const suffixOf = (key, kind) => {
      const m = key.match(new RegExp('-(.+)-' + kind + '$', 'i'));
      return m ? m[1] : null;
    };
    const order = [];
    PART_KINDS.forEach(({ kind, plural, keyField }) => {
      const parts = getDeep(payload, [...PARTS_PATH, plural]) || {};
      Object.keys(parts).forEach((k) => {
        const s = suffixOf(k, kind);
        if (!s) return;
        if (!groups[s]) { groups[s] = { suffix: s }; order.push(s); }
        groups[s][keyField] = k;
      });
    });
    const displayNames = (getDeep(payload, ['teamData', 'frostbiteData', 'teamVisuals', 'uniforms']) || [])
      .map((u) => u.displayName).filter(Boolean);
    return order.map((s) => {
      const nice = displayNames.find((d) => d.replace(/\s+/g, '').toLowerCase() === s.toLowerCase());
      return { label: nice || s.replace(/([a-z])([A-Z])/g, '$1 $2'), ...groups[s] };
    });
  }

  function getPart(payload, variant, kind) {
    const pk = PART_KINDS.find((p) => p.kind === kind);
    const key = variant && variant[pk.keyField];
    return key ? getDeep(payload, [...PARTS_PATH, pk.plural, key]) : null;
  }

  function partPath(variant, kind) {
    const pk = PART_KINDS.find((p) => p.kind === kind);
    const key = variant && variant[pk.keyField];
    return key ? [...PARTS_PATH, pk.plural, key] : null;
  }

  // ---------- jersey number font ----------
  const isUsableFontPath = (p) => !!p && !/\/(numbers|name_fonts)\/?$/i.test(p) && !/_name_array$/i.test(p);
  const stripCompSegment = (p) => p.replace('/uniforms/comp/', '/uniforms/');

  function listNumberFonts(data) {
    const nf = data.catalog.numberFonts;
    return [...nf.jersey, ...(nf.alts || [])].filter((e) => isUsableFontPath(e.path));
  }

  function currentNumberFontPath(part) {
    return getDeep(part, ['numberComp', 'overlays', 0, 'textures', 'color', 'textureId']) ||
      getDeep(part, ['numberComp', 'arrayTexture', 'textureId']) || '';
  }

  function findFontByPath(data, path) {
    const norm = stripCompSegment(String(path || '')).toLowerCase();
    return listNumberFonts(data).find((f) => stripCompSegment(f.path).toLowerCase() === norm) || null;
  }

  function applyNumberFont(part, font, data) {
    const path = stripCompSegment(font.path);
    const okA = setDeep(part, ['numberComp', 'arrayTexture', 'textureId'], path);
    const okO = setDeep(part, ['numberComp', 'overlays', 0, 'textures', 'color', 'textureId'], path);
    if (!okA || !okO) return { ok: false, message: 'This jersey has no number layer to change.' };
    const applied = [];
    const profile = data.numberLayoutProfiles[font.displayName];
    if (profile) {
      if (profile.numberSpacing !== undefined && setDeep(part, NUMBER_SPACING_PATH, profile.numberSpacing)) {
        applied.push('spacing');
      }
      NUMBER_OFFSET_SCALE_FIELDS.forEach((f) => {
        if (profile[f] && setDeep(part, ['numberMaterialSettings', 'offsetScaleSpacing', f], clone(profile[f]))) {
          applied.push(f.replace('NumberOffsetScale', ' placement'));
        }
      });
      if (profile.playerNumberAdjust &&
          setDeep(part, ['numberMaterialSettings', 'playerNumberAdjust'], clone(profile.playerNumberAdjust))) {
        applied.push('per-number kerning');
      }
      if (profile.numberSpacingOverrides &&
          setDeep(part, ['numberMaterialSettings', 'offsetScaleSpacing', 'numberSpacingOverrides'], clone(profile.numberSpacingOverrides))) {
        applied.push('spacing overrides');
      }
    }
    return { ok: true, profileApplied: applied };
  }

  // ---------- number colors ----------
  function numberColorChannels(part, data) {
    const overlay = getDeep(part, ['numberComp', 'overlays', 0]);
    if (!overlay || !overlay.tint) return { channels: [], confirmed: false };
    const key = String(currentNumberFontPath(part)).toLowerCase();
    const known = data.numberFontTintChannels[key] || data.numberFontTintChannels[stripCompSegment(key)];
    if (known) return { channels: known.channels, confirmed: true };
    return { channels: ['colorR', 'colorG', 'colorB'].filter((c) => c in overlay.tint), confirmed: false };
  }

  function getNumberColor(part, channel) {
    return unitToHex(getDeep(part, ['numberComp', 'overlays', 0, 'tint', channel]));
  }

  function setNumberColor(part, channel, hex) {
    const u = hexToUnit(hex);
    const tint = getDeep(part, ['numberComp', 'overlays', 0, 'tint']);
    if (!u || !tint) return false;
    tint[channel] = u;
    tint.TintMode = 'LayerCompTintMode_WithValue';
    return true;
  }

  // ---------- number spacing / size ----------
  function getNumberSpacing(part) {
    const v = getDeep(part, NUMBER_SPACING_PATH);
    return typeof v === 'number' ? v : null;
  }

  function setNumberSpacing(part, value) {
    const v = Math.max(NUMBER_SPACING_MIN, Math.min(NUMBER_SPACING_MAX, Number(value)));
    return Number.isFinite(v) && setDeep(part, NUMBER_SPACING_PATH, v);
  }

  function numberSizePath(field) {
    return ['numberMaterialSettings', 'offsetScaleSpacing', field];
  }

  // Inverted mapping carried over from extension v0.76: a smaller stored z/w
  // renders a bigger number in-game (reported independently twice, not yet
  // confirmed by a controlled test). Percent is relative to the as-loaded value.
  function getNumberSizePercent(part, originalPart, field) {
    const cur = getDeep(part, numberSizePath(field));
    const orig = getDeep(originalPart, numberSizePath(field));
    if (!cur || !orig || !cur.z || typeof orig.z !== 'number') return null;
    return Math.round((orig.z / cur.z) * 100);
  }

  function setNumberSizePercent(part, originalPart, field, percent) {
    const p = Math.max(NUMBER_SIZE_MIN, Math.min(NUMBER_SIZE_MAX, Number(percent)));
    const orig = getDeep(originalPart, numberSizePath(field));
    const cur = getDeep(part, numberSizePath(field));
    if (!orig || !cur || !Number.isFinite(p)) return false;
    const mult = 100 / p;
    cur.z = orig.z * mult;
    cur.w = orig.w * mult;
    return true;
  }

  // ---------- helmet ----------
  function applyHelmetShell(part, shell, data) {
    if (!part || !('shellMaterial' in part)) return { ok: false, message: 'This helmet has no shell material.' };
    part.shellMaterial = shell.path;
    const acc = data.catalog.helmetMaterials.accessory.find((a) => a.label === shell.label);
    if (acc && 'accMaterial' in part) part.accMaterial = acc.path;
    return { ok: true, accessoryMatched: !!acc };
  }

  function findShell(data, path) {
    return data.catalog.helmetMaterials.shell.find((s) => s.path === path) || null;
  }

  function getFacemaskColor(part) {
    return unitToHex(getDeep(part, ['facemaskMaterialSettings', 'faceMaskColor']));
  }

  function setFacemaskColor(part, hex) {
    const u = hexToUnit(hex);
    return !!u && setDeep(part, ['facemaskMaterialSettings', 'faceMaskColor'], u);
  }

  // ---------- vendor decal (brand logo) across jersey/pants/socks ----------
  function findVendorDecalOverlays(part) {
    const overlays = getDeep(part, ['layerCompTexture', 'overlays']);
    if (!Array.isArray(overlays)) return [];
    return overlays.reduce((acc, o, i) => {
      const tid = getDeep(o, ['textures', 'color', 'textureId']);
      if (typeof tid === 'string' && tid.toLowerCase().includes('/decals/vendors/')) acc.push(i);
      return acc;
    }, []);
  }

  function currentDecal(payload, variant, data) {
    for (const kind of ['jersey', 'pants', 'socks']) {
      const part = getPart(payload, variant, kind);
      const idx = findVendorDecalOverlays(part)[0];
      if (idx === undefined) continue;
      const col = getDeep(part, ['layerCompTexture', 'overlays', idx, 'textures', 'color', 'textureId']);
      return data.catalog.decals.find((d) => d.col === col) || { label: col.split('/').pop(), col };
    }
    return null;
  }

  function applyVendorDecal(payload, variant, decal, data) {
    const results = [];
    const brandT = data.brandPieceTransform[decal.brand] || {};
    ['jersey', 'pants', 'socks'].forEach((kind) => {
      const part = getPart(payload, variant, kind);
      const idxs = findVendorDecalOverlays(part);
      if (!idxs.length) { results.push({ kind, ok: false, note: 'no logo layer' }); return; }
      idxs.forEach((i) => {
        const o = part.layerCompTexture.overlays[i];
        setDeep(o, ['textures', 'color', 'textureId'], decal.col);
        setDeep(o, ['textures', 'rsm', 'textureId'], decal.rsm);
        setDeep(o, ['textures', 'normal', 'textureId'], decal.norm);
      });
      const t = (data.materialPieceOverrides[decal.label] || {})[kind] || brandT[kind];
      let note = 'logo swapped';
      if (idxs.length === 1 && t) {
        const o = part.layerCompTexture.overlays[idxs[0]];
        setDeep(o, ['transform', 'scale', 'u'], t.scaleU);
        setDeep(o, ['transform', 'scale', 'v'], t.scaleV);
        setDeep(o, ['transform', 'offset', 'u'], t.offsetU);
        setDeep(o, ['transform', 'offset', 'v'], t.offsetV);
        setDeep(o, ['transform', 'rotate'], t.rotate);
        // scaledTransform is a cached copy the game does not recompute.
        setDeep(o, ['transform', 'scaledTransform', 'x'], t.scaleU);
        setDeep(o, ['transform', 'scaledTransform', 'y'], t.scaleV);
        setDeep(o, ['transform', 'scaledTransform', 'z'], t.offsetU);
        setDeep(o, ['transform', 'scaledTransform', 'w'], t.offsetV);
        if (kind === 'pants' && 'layout' in t) {
          setDeep(o, ['textures', 'layout'], t.layout === null ? null : { textureId: t.layout, sourceType: 0 });
        }
        note += ' + placement';
      } else if (idxs.length > 1) {
        note += ' (two-sided, placement kept)';
      }
      results.push({ kind, ok: true, note });
    });
    return results;
  }

  // ---------- generic part colors ----------
  const isColor = (c) => c && typeof c === 'object' && typeof c.r === 'number' && typeof c.g === 'number' && typeof c.b === 'number';

  // Every tint color that's already set on a part's materials/overlays, so
  // each one gets a swatch. Unset (null) channels are skipped on purpose:
  // filling one in changes what the layer renders, not just its color.
  function listPartColors(part) {
    const out = [];
    const lct = part && part.layerCompTexture;
    if (!lct) return out;
    [['materials', 'Material'], ['overlays', 'Layer']].forEach(([listKey, noun]) => {
      (lct[listKey] || []).forEach((entry, i) => {
        const tint = entry && entry.tint;
        if (!tint) return;
        const label = (entry.info && entry.info.label) || `${noun} ${i + 1}`;
        if (label === 'DISABLED') return;
        ['colorR', 'colorG', 'colorB'].forEach((ch, ci) => {
          if (isColor(tint[ch])) {
            out.push({
              path: ['layerCompTexture', listKey, i, 'tint', ch],
              label: label.trim(),
              channel: ['A', 'B', 'C'][ci],
              group: listKey === 'materials' ? 'Base materials' : 'Layers & stripes',
              hex: unitToHex(tint[ch]),
            });
          }
        });
      });
    });
    return out;
  }

  function setColorAt(part, path, hex) {
    const u = hexToUnit(hex);
    return !!u && setDeep(part, path, u);
  }

  // Recolor every set swatch on a variant that currently matches one exact
  // color -- the quick "swap my purple for red everywhere" edit.
  function replaceColorEverywhere(payload, variant, fromHex, toHex) {
    const u = hexToUnit(toHex);
    let count = 0;
    if (!u) return 0;
    PART_KINDS.forEach(({ kind }) => {
      const part = getPart(payload, variant, kind);
      listPartColors(part).forEach((c) => {
        if (c.hex.toLowerCase() === fromHex.toLowerCase()) { setDeep(part, c.path, { ...u }); count++; }
      });
      if (kind === 'helmet' && getFacemaskColor(part) && getFacemaskColor(part).toLowerCase() === fromHex.toLowerCase()) {
        setFacemaskColor(part, toHex); count++;
      }
      const tint = getDeep(part, ['numberComp', 'overlays', 0, 'tint']);
      if (tint) {
        ['colorR', 'colorG', 'colorB'].forEach((ch) => {
          if (isColor(tint[ch]) && unitToHex(tint[ch]).toLowerCase() === fromHex.toLowerCase()) { tint[ch] = { ...u }; count++; }
        });
      }
    });
    return count;
  }

  // ---------- change report ----------
  function diff(before, after, path = [], out = [], limit = 2000) {
    if (out.length >= limit) return out;
    if (before === after) return out;
    const bObj = before && typeof before === 'object';
    const aObj = after && typeof after === 'object';
    // A table that grew or shrank (e.g. per-number kerning) is one change, not one per entry.
    const resized = Array.isArray(before) && Array.isArray(after) && before.length !== after.length;
    if (bObj && aObj && !resized && Array.isArray(before) === Array.isArray(after)) {
      const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
      keys.forEach((k) => diff(before[k], after[k], [...path, Array.isArray(after) ? Number(k) : k], out, limit));
      return out;
    }
    out.push({ path, before, after });
    return out;
  }

  function describePath(payload, path) {
    const p = path.join('.');
    if (p.startsWith('teamData.teamInfos.')) return 'Team › ' + path[2];
    if (p.startsWith('teamData.metadata.')) return 'Team metadata › ' + path[2];
    if (p.startsWith('teamData.frostbiteData.teamVisuals.')) return 'Team visuals › ' + path.slice(3).join(' › ');
    if (p.startsWith('teamData.frostbiteData.uniformParts.')) {
      const plural = path[3];
      const key = String(path[4]);
      const m = key.match(/-(.+)-(helmet|jersey|pants|socks)$/i);
      const variant = m ? m[1] : key;
      const rest = path.slice(5);
      let label = rest.join(' › ');
      const lct = rest[0] === 'layerCompTexture' && (rest[1] === 'materials' || rest[1] === 'overlays');
      if (lct) {
        const node = getDeep(payload, path.slice(0, 8));
        const name = node && node.info && node.info.label;
        if (name) label = `${name} › ${rest.slice(3).join(' › ')}`;
      }
      return `${variant} ${plural.replace(/s$/, '')} › ${label}`;
    }
    return p;
  }

  const formatValue = (v) => {
    if (isColor(v)) return unitToHex(v);
    if (v === undefined) return '(none)';
    if (Array.isArray(v)) return `${v.length} entr${v.length === 1 ? 'y' : 'ies'}`;
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return s.length > 80 ? '…' + s.slice(-78) : s;
  };

  function changeReport(original, current) {
    // Collapse r/g/b leaf changes into one color change per tint node.
    const raw = diff(original, current);
    const merged = [];
    const seen = new Set();
    raw.forEach((c) => {
      const last = c.path[c.path.length - 1];
      if (['r', 'g', 'b'].includes(last)) {
        const parentPath = c.path.slice(0, -1);
        const k = parentPath.join('\u0000');
        if (seen.has(k)) return;
        seen.add(k);
        merged.push({ path: parentPath, before: getDeep(original, parentPath), after: getDeep(current, parentPath) });
      } else {
        merged.push(c);
      }
    });
    return merged.map((c) => ({
      path: c.path,
      label: describePath(current, c.path),
      before: formatValue(c.before),
      after: formatValue(c.after),
    }));
  }

  return {
    PART_KINDS, TEAM_FIELDS, TEAM_COLOR_SLOTS, PALETTE_SLOTS,
    NUMBER_SPACING_MIN, NUMBER_SPACING_MAX, NUMBER_SIZE_MIN, NUMBER_SIZE_MAX,
    getDeep, setDeep, clone, parseTeamJson, serialize, teamTitle,
    unitToHex, hexToUnit,
    getTeamField, setTeamField, getTeamColor, setTeamColor, getPaletteColor, setPaletteColor,
    deriveVariants, getPart, partPath,
    listNumberFonts, currentNumberFontPath, findFontByPath, applyNumberFont,
    numberColorChannels, getNumberColor, setNumberColor,
    getNumberSpacing, setNumberSpacing, getNumberSizePercent, setNumberSizePercent,
    applyHelmetShell, findShell, getFacemaskColor, setFacemaskColor,
    findVendorDecalOverlays, currentDecal, applyVendorDecal,
    listPartColors, setColorAt, replaceColorEverywhere,
    changeReport,
  };
});
