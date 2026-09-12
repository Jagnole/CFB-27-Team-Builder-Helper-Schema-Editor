/*
 * uniform.js — read and edit the uniform section of a Team Builder save file,
 * and import a uniform exported by cfbuniformcreator.com (kit.json + PNGs).
 *
 * Field hashes are the save file's own 24-bit field ids. They were recovered
 * by structural analysis of a real save (see FORMAT.md); everything that is
 * inferred rather than proven is marked INFERRED here and in FORMAT.md.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./tbfile.js'));
  else root.TBUniform = factory(root.TBFile);
})(typeof self !== 'undefined' ? self : this, function (TB) {
  'use strict';

  const F = {
    // piece (one helmet/jersey/pants/socks design)
    LAYER_COMP: 0x383db2,     // container of the layer arrays
    OVERLAYS: 0xa5fdb6,       // overlay_1..overlay_N
    MATERIALS: 0x251db6,      // material_1..material_N
    EXTRA_LAYERS: 0x2d998e,   // further layer array (purpose unconfirmed)
    PRESET_LINK: 0x321cb6,    // preset asset path
    DESIGN_NAME: 0x651bba,    // recipe/design name
    // one layer (overlay or material)
    LAYER_NAME: 0xafe9a6,     //   { LABEL, ? }
    LABEL: 0xac18b2,
    OVERRIDES: 0x733bcb,      //   { ?, ?, RSM }
    RSM: 0x723bcb,            //   { SHININESS, REFLECTIVITY, METALNESS }
    SHININESS: 0xebdcb6, REFLECTIVITY: 0xac59ca, METALNESS: 0x28ddce,
    TINT: 0xb49bd2,           //   { COLOR_B, COLOR_G, COLOR_R, TINT_MODE }
    TINT_MODE: 0xe4dbd2,
    COLOR_B: 0x22fb8e, COLOR_G: 0x27fb8e, COLOR_R: 0x32fb8e,
    TRANSFORM: 0xad29d3,
    CLAMP: 0x76cd8e,          //   { U, V } 1/1 = clamped, 0/0 = tiling
    OFFSET: 0xb369be,         //   { U, V }
    ROTATE: 0x21fdca,         //   degrees
    SCALE: 0x6c38ce,          //   { U, V }
    PACKED_UV: 0xae4ccf,      //   { offsetV, scaleU, scaleV, offsetU } mirror
    UV_W: 0xf758da, UV_X: 0xf858da, UV_Y: 0xf958da, UV_Z: 0xfa58da,
    VEC_U: 0xf30bd7, VEC_V: 0xf30bdb,
    BLEND: 0xa4cb8a,          //   { mode, color, normal, rsm, occlusion }
    BLEND_MODE: 0xe4db8a, BLEND_COLOR: 0x22fb8e, BLEND_NORMAL: 0xa2fcba,
    BLEND_RSM: 0xe238be, BLEND_OCCLUSION: 0x624bca,
    TEXTURES: 0x338dd3,       //   { COLOR_TEX, LAYOUT_TEX, NORMAL_TEX, RSM_TEX, ... }
    TEX_COLOR: 0x32fb8e, TEX_LAYOUT: 0x741eb2, TEX_NORMAL: 0xadfcba, TEX_RSM: 0xed2cd3,
    LINK: 0x648ad3, LINK_FLAG: 0x259cd3,
    // uniform asset entry
    ASSET_NAME: 0xee3c87, ASSET_SLUG: 0x6de8c2,
    ASSET_SLOT: 0x2f3bc3,     //   slot id: 93 helmet, 98 jersey, 97 pants, 94 socks
    ASSET_BASE: 0x2f3bcf,     //   254 on the stock Home/Away, the slot id on an alternate
    // the team's uniform list — what the game actually reads to offer a uniform
    UL_STOCK: 0xa6f98e,       //   1 on Home/Away, 0 on an alternate
    UL_NAME: 0x2e0b93,        //   the name shown in game ("Chill Dino")
    UL_GEAR: 0x73ead6,
    GEAR_ENABLED: 0x7438b2,
    GEAR_SLOTS: 0x335bb2,     //     six slots: helmet, jersey, pants, socks, two shoes
    SLOT_LABEL: 0xee9c92, SLOT_LINK: 0xee1ca6, SLOT_ID: 0x704ecf,
    GEAR_KIND: 0x704eb3,      //     6 = home, 3 = away, 8 = alternate
    UNIFORM_LIST: 0xa95bb3,
    // custom texture entry
    TEX_BLOB: 0x74488a, TEX_URL: 0x78498f,
  };

  const SLOTS = ['helmet', 'jersey', 'pants', 'socks'];
  const f32 = (v) => ({ k: 'f', v: v });
  const int = (v) => ({ k: 'i', v: v });
  const str = (v) => ({ k: 's', v: v });

  // ------------------------------------------------------------------ locate
  /**
   * Find the uniform structures by shape, not by position, so the same code
   * keeps working if unrelated parts of the file move around.
   */
  function locate(recs) {
    const found = { assetMap: null, pieceMaps: {}, textureMap: null, teamCode: null, uniformList: null };
    for (const rec of recs) {
      TB.walk(rec.n, (node) => {
        if (node.k !== 'm' || !node.entries.length) return;
        const keys = node.entries.map(e => e[0]);
        const assetRe = /^U_([A-Za-z0-9]+)_(HELMET|JERSEY|PANTS|SOCKS)_(.+)$/;
        if (!found.assetMap && keys.every(k => assetRe.test(k))) {
          found.assetMap = node;
          found.teamCode = keys[0].match(assetRe)[1];
          return;
        }
        for (const slot of SLOTS) {
          const re = new RegExp('^([A-Za-z0-9]+)-(.+)-' + slot + '$');
          if (!found.pieceMaps[slot] && keys.every(k => re.test(k)) && node.vt === TB.T.OBJ) {
            found.pieceMaps[slot] = node;
          }
        }
        if (!found.textureMap && node.vt === TB.T.OBJ &&
            node.entries.every(([, v]) => TB.field(v, F.TEX_BLOB) || TB.field(v, F.TEX_URL))) {
          found.textureMap = node;
        }
      });
    }
    if (!found.assetMap) throw new Error('no uniform asset map found in this save file');
    for (const slot of SLOTS) {
      if (!found.pieceMaps[slot]) throw new Error('no ' + slot + ' design map found in this save file');
    }
    found.uniformList = findUniformList(recs, found.assetMap);
    return found;
  }

  /**
   * The team's uniform list. A design in the maps above is invisible in game
   * unless this list offers it, so it is found by content: the array whose
   * items name the most uniform assets.
   */
  function findUniformList(recs, assetMap) {
    const assetNames = new Set(assetMap.entries.map(([k]) => k));
    let best = null, bestScore = 0;
    for (const rec of recs) {
      TB.walk(rec.n, (node) => {
        if (node.k !== 'a' || !node.items.length) return;
        let score = 0;
        for (const item of node.items) {
          if (item.k !== 'o') return;
          TB.walk(item, (n) => { if (n.k === 's' && assetNames.has(n.v)) score++; });
        }
        if (score > bestScore) { bestScore = score; best = node; }
      });
    }
    return best;
  }

  /**
   * Which list entry offers this variant, found through its asset names.
   * Returns null for a variant the file does not have, so this can be asked
   * before a clone as well as after one.
   */
  function listEntryFor(loc, name) {
    const info = variants(loc).find((v) => v.name === name);
    if (!loc.uniformList || !info) return null;
    const wanted = new Set(Object.values(info.assets));
    for (const item of loc.uniformList.items) {
      let hit = false;
      TB.walk(item, (n) => { if (n.k === 's' && wanted.has(n.v)) hit = true; });
      if (hit) return item;
    }
    return null;
  }

  /**
   * Index the variants in the file. The asset entry for each piece carries the
   * design key it points at, so the design map keys are read from the data
   * rather than rebuilt: the stock variants are named HOME/AWAY in asset names
   * but home/away in design keys, and only the file knows which is which.
   */
  function variants(loc) {
    const byName = new Map();
    for (const [key, asset] of loc.assetMap.entries) {
      const m = key.match(/^U_[A-Za-z0-9]+_(HELMET|JERSEY|PANTS|SOCKS)_(.+)$/);
      if (!m) continue;
      const slot = m[1].toLowerCase(), name = m[2];
      if (!byName.has(name)) byName.set(name, { name, assets: {}, slugs: {} });
      const v = byName.get(name);
      v.assets[slot] = key;
      const slugNode = TB.field(asset, F.ASSET_SLUG);
      v.slugs[slot] = slugNode ? slugNode.v : slugKey(loc.teamCode, slot, name);
    }
    return Array.from(byName.values());
  }

  /** Variant names present in the file, e.g. ['HOME','AWAY','Darkout']. */
  function listVariants(loc) { return variants(loc).map(v => v.name); }

  function variantInfo(loc, name) {
    const v = variants(loc).find(x => x.name === name);
    if (!v) throw new Error('no such uniform variant: ' + name);
    return v;
  }

  /** Variant name -> the name shown in game, where the list gives one. */
  function displayNames(loc) {
    const out = new Map();
    if (!loc.uniformList) return out;
    for (const v of variants(loc)) {
      const entry = listEntryFor(loc, v.name);
      const nameField = entry && TB.field(entry, F.UL_NAME);
      out.set(v.name, nameField ? nameField.v : v.name);
    }
    return out;
  }

  /** Is this variant offered by the team's uniform list? */
  function isListed(loc, name) { return !!listEntryFor(loc, name); }

  /** The design object for one piece of one variant. */
  function piece(loc, name, slot) {
    return TB.mapGet(loc.pieceMaps[slot], variantInfo(loc, name).slugs[slot]);
  }

  const assetKey = (code, slot, variant) => 'U_' + code + '_' + slot.toUpperCase() + '_' + variant;
  const slugKey = (code, slot, variant) => code + '-' + variant + '-' + slot;

  const KIND_ALTERNATE = 8;
  const STOCK_BASE_MARKER = 254;
  const PIECE_WORD = { helmet: 'Helmet', jersey: 'Jersey', pants: 'Pants', socks: 'Socks' };

  /**
   * Copy an existing variant into a new one: the four designs, the four asset
   * entries, AND an entry in the team's uniform list. The list is the part
   * the game reads when it offers a uniform — without it the designs sit in
   * the file unused, which is exactly what happened before this was found.
   *
   * @param opts {{displayName?:string}} the name shown in game; it may contain
   *   spaces, unlike the variant id, which ends up inside asset names.
   */
  function cloneVariant(loc, sourceVariant, newVariant, opts) {
    opts = opts || {};
    const code = loc.teamCode;
    const displayName = opts.displayName || newVariant;
    if (listVariants(loc).includes(newVariant)) throw new Error('variant already exists: ' + newVariant);
    const src = variantInfo(loc, sourceVariant);
    const renames = [];

    for (const slot of SLOTS) {
      const srcSlug = src.slugs[slot];
      const dstSlug = slugKey(code, slot, newVariant);
      const srcPiece = TB.mapGet(loc.pieceMaps[slot], srcSlug);
      if (!srcPiece) throw new Error('source design missing: ' + srcSlug);
      const copy = TB.cloneNode(srcPiece);
      const srcAssetName = src.assets[slot];
      const dstAssetName = assetKey(code, slot, newVariant);
      TB.walk(copy, (node) => {
        if (node.k !== 's' || !node.v) return;
        node.v = node.v.split(srcSlug).join(dstSlug).split(srcAssetName).join(dstAssetName);
      });
      TB.mapSet(loc.pieceMaps[slot], dstSlug, copy);

      const asset = TB.cloneNode(TB.mapGet(loc.assetMap, srcAssetName));
      const nameField = TB.field(asset, F.ASSET_NAME);
      const slugField = TB.field(asset, F.ASSET_SLUG);
      if (nameField) nameField.v = dstAssetName;
      if (slugField) slugField.v = dstSlug;
      /* The stock Home and Away carry 254 here; every alternate carries its
         own slot id, so a copy of a stock uniform has to be switched over. */
      const slotField = TB.field(asset, F.ASSET_SLOT);
      const baseField = TB.field(asset, F.ASSET_BASE);
      if (slotField && baseField && baseField.v === STOCK_BASE_MARKER) baseField.v = slotField.v;
      TB.mapSet(loc.assetMap, dstAssetName, asset);
      renames.push({ slot, from: srcAssetName, to: dstAssetName });
    }

    const listed = addListEntry(loc, sourceVariant, displayName, renames);
    return { variant: newVariant, displayName, listed };
  }

  /**
   * Add the new uniform to the team's list, copying the source's entry and
   * pointing it at the new assets.
   */
  function addListEntry(loc, sourceVariant, displayName, renames) {
    const list = loc.uniformList;
    const source = listEntryFor(loc, sourceVariant);
    if (!list || !source) return false;
    const entry = TB.cloneNode(source);

    const nameField = TB.field(entry, F.UL_NAME);
    if (nameField) nameField.v = displayName;
    const stock = TB.field(entry, F.UL_STOCK);
    if (stock) stock.v = 0;                       // a copy is never Home or Away

    const gear = TB.field(entry, F.UL_GEAR);
    if (gear) {
      const kind = TB.field(gear, F.GEAR_KIND);
      if (kind) kind.v = KIND_ALTERNATE;
      const slots = TB.field(gear, F.GEAR_SLOTS);
      if (slots && slots.k === 'a') {
        for (const item of slots.items) {
          const link = TB.field(item, F.SLOT_LINK);
          const label = TB.field(item, F.SLOT_LABEL);
          const match = link && renames.find((r) => r.from === link.v);
          if (match) {
            link.v = match.to;
            if (label) label.v = displayName + ' ' + PIECE_WORD[match.slot];
          } else if (label) {
            /* shoes and anything else keep their asset, but follow the name */
            const word = label.v.split(/\s+/).pop();
            label.v = displayName + ' ' + word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
          }
        }
      }
    }
    list.items.push(entry);
    return true;
  }

  /** Remove a variant from the uniform list, the asset map and the designs. */
  function removeVariant(loc, name) {
    const v = variantInfo(loc, name);
    const entry = listEntryFor(loc, name);
    if (entry && loc.uniformList) {
      loc.uniformList.items = loc.uniformList.items.filter((it) => it !== entry);
    }
    const assetKeys = Object.values(v.assets);
    loc.assetMap.entries = loc.assetMap.entries.filter(([k]) => !assetKeys.includes(k));
    for (const slot of SLOTS) {
      loc.pieceMaps[slot].entries = loc.pieceMaps[slot].entries.filter(([k]) => k !== v.slugs[slot]);
    }
  }

  // --------------------------------------------------------------- texture io
  const TEX_ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  function randomTextureId(code, rnd) {
    let s = '';
    for (let i = 0; i < 10; i++) s += TEX_ID_CHARS[Math.floor((rnd ? rnd() : Math.random()) * TEX_ID_CHARS.length)];
    return code + '_' + s;
  }

  /**
   * Store a PNG in the save file's custom-texture table and return its key.
   * Uploaded textures in a real save also carry a cdn.mcr.ea.com URL; a
   * locally added one has no URL yet, so the field is written empty
   * (INFERRED: whether the game re-uploads it on save is untested).
   */
  function addTexture(loc, png, opts) {
    opts = opts || {};
    if (!loc.textureMap) throw new Error('this save file has no custom-texture table to add to');
    const key = opts.key || randomTextureId(loc.teamCode, opts.random);
    const entry = { k: 'o', m: [
      { h: F.TEX_BLOB, t: TB.T.BLOB, n: { k: 'b', v: png } },
      { h: F.TEX_URL, t: TB.T.STR, n: str(opts.url || '') },
    ] };
    TB.mapSet(loc.textureMap, key, entry);
    return key;
  }

  // ------------------------------------------------------------- kit helpers
  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return null;
    const v = parseInt(m[1], 16);
    return { r: ((v >> 16) & 255) / 255, g: ((v >> 8) & 255) / 255, b: (v & 255) / 255 };
  }
  function setColorStruct(node, rgb) {
    if (!node || node.k !== 'o' || !rgb) return false;
    TB.setField(node, F.COLOR_R, f32(rgb.r));
    TB.setField(node, F.COLOR_G, f32(rgb.g));
    TB.setField(node, F.COLOR_B, f32(rgb.b));
    return true;
  }
  /** overlay_3 -> {kind:'overlay', index:2}; material_1 -> {kind:'material', index:0} */
  function parseLayerName(name) {
    const m = /^(overlay|material)_(\d+)$/.exec(String(name || ''));
    if (!m) return null;
    return { kind: m[1], index: parseInt(m[2], 10) - 1 };
  }
  function layerArray(piece, kind) {
    const lc = TB.field(piece, F.LAYER_COMP);
    if (!lc) return null;
    return TB.field(lc, kind === 'material' ? F.MATERIALS : F.OVERLAYS);
  }
  function layerAt(piece, name) {
    const ref = parseLayerName(name);
    if (!ref) return null;
    const arr = layerArray(piece, ref.kind);
    if (!arr || arr.k !== 'a' || ref.index >= arr.items.length) return null;
    return arr.items[ref.index];
  }
  const ROLE_FIELD = { color: F.TEX_COLOR, normal: F.TEX_NORMAL, rsm: F.TEX_RSM, layout: F.TEX_LAYOUT };

  function setTextureLink(layer, role, link) {
    const textures = TB.field(layer, F.TEXTURES);
    const hash = ROLE_FIELD[String(role || '').toLowerCase()];
    if (!textures || !hash) return false;
    let slot = TB.field(textures, hash);
    if (!slot) {
      slot = { k: 'o', m: [{ h: F.LINK, t: TB.T.STR, n: str('') }, { h: F.LINK_FLAG, t: TB.T.INT, n: int(0) }] };
      TB.setField(textures, hash, slot);
    }
    TB.setField(slot, F.LINK, str(link));
    return true;
  }

  function setTransform(layer, xf) {
    const t = TB.field(layer, F.TRANSFORM);
    if (!t || !xf) return false;
    const num = (v, dflt) => (typeof v === 'number' && isFinite(v) ? v : dflt);
    const scaleU = num(xf.scaleU, 0), scaleV = num(xf.scaleV, 0);
    const offU = num(xf.offsetU, 0), offV = num(xf.offsetV, 0);
    const scale = TB.field(t, F.SCALE), offset = TB.field(t, F.OFFSET);
    if (scale) { TB.setField(scale, F.VEC_U, f32(scaleU)); TB.setField(scale, F.VEC_V, f32(scaleV)); }
    if (offset) { TB.setField(offset, F.VEC_U, f32(offU)); TB.setField(offset, F.VEC_V, f32(offV)); }
    TB.setField(t, F.ROTATE, f32(num(xf.rotate, 0)));
    if ('clampUv' in xf) {
      const clamp = TB.field(t, F.CLAMP);
      const c = xf.clampUv ? 1 : 0;
      if (clamp) { TB.setField(clamp, F.VEC_U, f32(c)); TB.setField(clamp, F.VEC_V, f32(c)); }
    }
    // the packed mirror of offset/scale the renderer also reads
    const packed = TB.field(t, F.PACKED_UV);
    if (packed) {
      TB.setField(packed, F.UV_W, f32(offV));
      TB.setField(packed, F.UV_X, f32(scaleU));
      TB.setField(packed, F.UV_Y, f32(scaleV));
      TB.setField(packed, F.UV_Z, f32(offU));
    }
    return true;
  }

  function setBlend(layer, blend) {
    const b = TB.field(layer, F.BLEND);
    if (!b || !blend) return false;
    const put = (hash, v) => { if (typeof v === 'number' && isFinite(v)) TB.setField(b, hash, f32(v)); };
    put(F.BLEND_COLOR, blend.color);
    put(F.BLEND_NORMAL, blend.normal);
    put(F.BLEND_RSM, blend.rsm);
    put(F.BLEND_OCCLUSION, blend.occlusion);
    return true;
  }

  function setRsm(layer, rsm) {
    const ov = TB.field(layer, F.OVERRIDES);
    const target = ov && TB.field(ov, F.RSM);
    if (!target || !rsm) return false;
    const pct = (v) => (typeof v === 'number' && isFinite(v) ? (v > 1 ? v / 100 : v) : null);
    const put = (hash, v) => { const n = pct(v); if (n !== null) TB.setField(target, hash, f32(n)); };
    put(F.SHININESS, rsm.shininess);
    put(F.REFLECTIVITY, rsm.reflectivity);
    put(F.METALNESS, rsm.metalness);
    return true;
  }

  const FONT_PATH_RE = /(characters\/player\/parts\/uniforms\/jerseys\/(numbers|name_fonts)\/)/i;
  /** Replace every number/name font link in a piece with the kit's font. */
  function setFontLinks(piece, kind, link) {
    let n = 0;
    TB.walk(piece, (node) => {
      if (node.k !== 's' || !FONT_PATH_RE.test(node.v)) return;
      const isName = /\/name_fonts\//i.test(node.v);
      if ((kind === 'name') !== isName) return;
      node.v = link;
      n++;
    });
    return n;
  }

  // ----------------------------------------------------------------- kit apply
  /**
   * Write a cfbuniformcreator.com kit into one variant of the save file.
   *
   * @param loc      result of locate()
   * @param variant  variant name to write into (must already exist; clone one first)
   * @param kit      {json: parsed kit.json, files: Map<path, Uint8Array>}
   * @param opts     {maxTextureBytes, skipBakedTextures, random}
   * @returns a report of what was written and what was skipped
   */
  function applyKit(loc, variant, kit, opts) {
    opts = opts || {};
    const json = kit.json, files = kit.files || new Map();
    const report = { variant, applied: [], skipped: [], textures: [], unmapped: [] };
    const pieceFor = (slot) => piece(loc, variant, slot);

    const slotName = (s) => String(s || '').toLowerCase();
    const note = (list, what, detail) => list.push(detail ? what + ' (' + detail + ')' : what);

    // 1. textures: in-game asset links, and PNGs uploaded from the creator
    const texCache = new Map();
    for (const tex of json.textures || []) {
      const slot = slotName(tex.slot), pieceNode = pieceFor(slot);
      const layer = pieceNode && layerAt(pieceNode, tex.layerName);
      if (!layer) { note(report.skipped, 'texture ' + slot + '/' + tex.layerName + '/' + tex.role, 'no such layer'); continue; }
      if (tex.link) {
        if (setTextureLink(layer, tex.role, tex.link)) note(report.applied, 'texture link ' + slot + '/' + tex.layerName + '/' + tex.role);
        else note(report.skipped, 'texture link ' + slot + '/' + tex.layerName + '/' + tex.role, 'unknown role');
        continue;
      }
      if (!tex.file) continue;                       // empty slot in the kit
      const png = files.get(tex.file);
      if (!png) { note(report.skipped, 'texture ' + tex.file, 'not in kit archive'); continue; }
      if (opts.skipBakedTextures) { note(report.skipped, 'texture ' + tex.file, 'baked textures skipped'); continue; }
      if (opts.maxTextureBytes && png.length > opts.maxTextureBytes) {
        note(report.skipped, 'texture ' + tex.file, png.length + ' bytes over the ' + opts.maxTextureBytes + ' byte limit');
        continue;
      }
      let key = texCache.get(tex.file);
      if (!key) {
        key = addTexture(loc, png, { random: opts.random });
        texCache.set(tex.file, key);
        report.textures.push({ file: tex.file, key, bytes: png.length });
      }
      if (setTextureLink(layer, tex.role, key)) note(report.applied, 'texture ' + slot + '/' + tex.layerName + '/' + tex.role + ' -> ' + key);
      else note(report.skipped, 'texture ' + tex.file, 'unknown role ' + tex.role);
    }

    // 2. tint colours
    for (const col of json.colors || []) {
      const slot = slotName(col.slot), pieceNode = pieceFor(slot);
      const layer = pieceNode && layerAt(pieceNode, col.layerName);
      const tint = layer && TB.field(layer, F.TINT);
      const chan = { colorr: F.COLOR_R, colorg: F.COLOR_G, colorb: F.COLOR_B }[String(col.tint || '').toLowerCase()];
      const rgb = hexToRgb(col.value);
      if (!tint || !chan || !rgb) { note(report.skipped, 'colour ' + slot + '/' + col.layerName + '/' + col.tint); continue; }
      if (setColorStruct(TB.field(tint, chan), rgb)) note(report.applied, 'colour ' + slot + '/' + col.layerName + '/' + col.tint + ' = ' + col.value);
      else note(report.skipped, 'colour ' + slot + '/' + col.layerName + '/' + col.tint, 'no colour struct');
    }

    // 3. layer transform / blend / tint mode
    for (const lay of json.layers || []) {
      const slot = slotName(lay.slot), pieceNode = pieceFor(slot);
      const layer = pieceNode && layerAt(pieceNode, lay.layerName);
      if (!layer) { note(report.skipped, 'layer ' + slot + '/' + lay.layerName, 'no such layer'); continue; }
      if (lay.transform && setTransform(layer, lay.transform)) note(report.applied, 'transform ' + slot + '/' + lay.layerName);
      if (lay.blend && setBlend(layer, lay.blend)) note(report.applied, 'blend ' + slot + '/' + lay.layerName);
      if (lay.rsm) setRsm(layer, lay.rsm);
      if (lay.tintMode && /WithValue$/.test(lay.tintMode)) {
        const tint = TB.field(layer, F.TINT);
        if (tint) TB.setField(tint, F.TINT_MODE, int(0));
      }
      if (lay.label || lay.name) {
        const nameNode = TB.field(layer, F.LAYER_NAME);
        const label = nameNode && TB.field(nameNode, F.LABEL);
        if (label) label.v = String(lay.label || lay.name);
      }
    }

    // 4. fonts (patched by asset path, which is unambiguous in the file)
    const printing = json.printing || {};
    const numberFont = printing.jersey && printing.jersey.number && printing.jersey.number.font;
    if (numberFont && numberFont.link) {
      let n = 0;
      for (const slot of SLOTS) { const p = pieceFor(slot); if (p) n += setFontLinks(p, 'number', numberFont.link); }
      note(report.applied, 'number font -> ' + numberFont.link, n + ' field' + (n === 1 ? '' : 's'));
    }
    const nameFont = printing.jersey && printing.jersey.nameplate && printing.jersey.nameplate.font;
    if (nameFont && nameFont.link) {
      let n = 0;
      for (const slot of SLOTS) { const p = pieceFor(slot); if (p) n += setFontLinks(p, 'name', nameFont.link); }
      note(report.applied, 'nameplate font -> ' + nameFont.link, n + ' field' + (n === 1 ? '' : 's'));
    }

    // 5. parts of the kit this importer does not write yet
    const unmapped = [
      ['printing.*.colors / spacing / widthAdjustments / positions', printing.jersey || printing.helmet],
      ['helmetSettings.facemaskColor', json.helmetSettings && json.helmetSettings.facemaskColor],
      ['socksSettings.underSockColor', json.socksSettings && json.socksSettings.underSockColor],
      ['accessoryPalette', json.accessoryPalette && json.accessoryPalette.enabled],
      ['cidMasks', json.cidMasks && json.cidMasks.length],
    ];
    for (const [what, present] of unmapped) if (present) report.unmapped.push(what);
    return report;
  }

  /** Convenience: clone a source variant and immediately write a kit into it. */
  function importKit(recs, kit, opts) {
    opts = opts || {};
    const loc = locate(recs);
    const variants = listVariants(loc);
    const source = opts.source || (variants.includes('HOME') ? 'HOME' : variants[0]);
    const name = opts.name || sanitizeVariant((kit.json && kit.json.uniformName) || 'Imported');
    const displayName = opts.displayName || (kit.json && kit.json.uniformName) || name;
    let listed = isListed(loc, name);
    if (!variants.includes(name)) {
      const cloned = cloneVariant(loc, source, name, { displayName });
      listed = cloned.listed;
    }
    const report = applyKit(loc, name, kit, opts);
    report.clonedFrom = source;
    report.displayName = displayName;
    report.listed = listed;
    if (!listed) {
      report.unmapped.push('the team uniform list could not be found, so the game will not offer this uniform');
    }
    return report;
  }

  /** Variant names live inside asset paths, so keep them path-safe. */
  function sanitizeVariant(s) {
    const v = String(s).replace(/[^A-Za-z0-9]+/g, '');
    return v || 'Imported';
  }

  return {
    F, SLOTS, locate, variants, listVariants, variantInfo, piece, cloneVariant, removeVariant,
    findUniformList, listEntryFor, displayNames, isListed,
    addTexture, applyKit, importKit, sanitizeVariant,
    assetKey, slugKey, layerAt, layerArray, hexToRgb, randomTextureId,
  };
});
