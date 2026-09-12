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
    LAYER_NAME: 0xafe9a6,     //   { LABEL, SLOT_CONFIG }
    LABEL: 0xac18b2,
    SLOT_CONFIG: 0xf4cbce,    //   set on the patch slots: nike / conference / bowl
    CID_LAYERS: 0x2d998e,     // the piece's CID mask slots
    CID_LINK: 0x648ad3,
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
    /* clampUv is intentionally not written — see applyKit. */
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

  // --------------------------------------------------------- slot semantics
  /*
   * A piece's 20 overlay slots are fixed-purpose, and which purpose sits at
   * which index depends on the uniform's preset: index 0 is the base, a few
   * early ones are stripe patterns, then "Custom Layer 1/2" for user decals,
   * and three patch slots that name their own config path.
   *
   * A kit numbers its layers by ITS uniform's node names, so overlay_3 in an
   * export is not overlay_3 here. Placing by index put a vendor logo in a
   * shoulder-stripe slot; the decals have to be placed by what they are.
   */
  const SLOT_CONFIG_PATTERNS = {
    vendor: /nike_patch_slot/i,
    conference: /conference_logo_slot/i,
    bowl: /bowl_patch_slot/i,
  };

  function overlayList(piece) {
    const arr = layerArray(piece, 'overlay');
    return arr && arr.k === 'a' ? arr.items : [];
  }
  function layerLabel(layer) {
    const nameNode = TB.field(layer, F.LAYER_NAME);
    const label = nameNode && TB.field(nameNode, F.LABEL);
    return label ? label.v : '';
  }
  function layerSlotConfig(layer) {
    const nameNode = TB.field(layer, F.LAYER_NAME);
    const cfg = nameNode && TB.field(nameNode, F.SLOT_CONFIG);
    return cfg ? cfg.v : '';
  }
  function colorLink(layer) {
    const textures = TB.field(layer, F.TEXTURES);
    const slot = textures && TB.field(textures, F.TEX_COLOR);
    const link = slot && TB.field(slot, F.LINK);
    return link ? link.v : '';
  }

  /** What kind of thing is this asset path? */
  function classifyLink(link) {
    const s = String(link || '');
    if (/\/decals\/vendors\//i.test(s)) return 'vendor';
    if (/\/decals\/conferences\//i.test(s)) return 'conference';
    if (/bowl_patch|bowl_decal/i.test(s)) return 'bowl';
    if (/\/decals\//i.test(s)) return 'decal';
    if (/seams/i.test(s)) return 'seams';
    if (/stripes?/i.test(s)) return 'stripe';
    if (/fabric|holes|mesh/i.test(s)) return 'fabric';
    return 'other';
  }

  /** Which body part does a stripe asset name mention? */
  const BODY_PARTS = ['collar', 'sleevecuffs', 'cuffs', 'sleeves', 'upperbody', 'shoulder',
                      'sidepanel', 'side', 'waist', 'legs', 'knee'];
  function bodyPart(name) {
    const s = String(name || '').toLowerCase().replace(/[^a-z]/g, '');
    for (const part of BODY_PARTS) if (s.includes(part)) return part;
    return null;
  }

  /**
   * Find the overlay slot a kit layer belongs in. Returns {layer, why} or null.
   * `used` collects slots already taken during this import so two decals do
   * not land on top of each other.
   */
  function findSlot(piece, kind, hint, used) {
    const overlays = overlayList(piece);
    const free = (l) => !used.has(l);
    if (SLOT_CONFIG_PATTERNS[kind]) {
      const re = SLOT_CONFIG_PATTERNS[kind];
      const hit = overlays.find((l) => re.test(layerSlotConfig(l)));
      if (hit) return { layer: hit, why: kind + ' patch slot' };
    }
    if (kind === 'decal') {
      /*
       * Where a team logo goes depends on what the uniform has been through.
       * A uniform edited in Team Builder has "Custom Layer N" slots; an
       * untouched one has the EA placeholder logos sitting in those same
       * slots; a blank one has bare slots. Try them in that order.
       */
      const notPatch = (l) => !layerSlotConfig(l);
      const tiers = [
        [(l) => /^custom layer/i.test(layerLabel(l)), 'custom layer slot'],
        [(l) => notPatch(l) && /EA_Decal|\/decals\/teams\//i.test(colorLink(l)), 'team logo slot'],
        [(l) => notPatch(l) && /logo|decal/i.test(layerLabel(l)), 'logo slot'],
        [(l) => notPatch(l) && !layerLabel(l) && !colorLink(l), 'free slot'],
      ];
      for (const [test, why] of tiers) {
        const hit = overlays.find((l) => free(l) && test(l));
        if (hit) {
          const label = layerLabel(hit);
          return { layer: hit, why: why + (label ? ' "' + label + '"' : ' #' + overlays.indexOf(hit)) };
        }
      }
      return null;
    }
    if (kind === 'stripe') {
      const part = bodyPart(hint);
      const stripes = overlays.filter((l) => /stripe/i.test(layerLabel(l)) || /stripe/i.test(colorLink(l)));
      if (part) {
        const hit = stripes.find((l) => free(l) && bodyPart(layerLabel(l) + ' ' + colorLink(l)) === part);
        if (hit) return { layer: hit, why: '"' + layerLabel(hit) + '" (' + part + ')' };
      }
      return null;
    }
    if (kind === 'base') {
      const hit = overlays.find((l) => /seam/i.test(layerLabel(l)));
      if (hit) return { layer: hit, why: '"' + layerLabel(hit) + '" (the full-UV base layer)' };
      return overlays.length ? { layer: overlays[0], why: 'the first overlay' } : null;
    }
    return null;
  }

  /** Materials pair up by what the asset is, not by position. */
  function findMaterial(piece, link, used) {
    const arr = layerArray(piece, 'material');
    if (!arr || arr.k !== 'a') return null;
    const want = classifyLink(link);
    const holes = /holes|mesh/i.test(String(link));
    const candidates = arr.items.filter((l) => !used.has(l));
    const same = candidates.find((l) => {
      const cur = colorLink(l);
      if (want === 'fabric') return holes === /holes|mesh/i.test(cur);
      return classifyLink(cur) === want;
    });
    if (same) return { layer: same, why: '"' + layerLabel(same) + '"' };
    return candidates.length ? { layer: candidates[0], why: '"' + layerLabel(candidates[0]) + '"' } : null;
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

    /*
     * Group the kit by (piece, layer) first. A kit layer is one thing — a
     * decal with its colour/normal/rsm maps, its tint and its transform — and
     * it has to be placed as one thing, in the slot that matches what it is.
     */
    const groups = new Map();
    const groupFor = (slot, layerName) => {
      const key = slot + '/' + layerName;
      if (!groups.has(key)) {
        groups.set(key, { slot, layerName, textures: [], colors: [], layer: null });
      }
      return groups.get(key);
    };
    for (const tex of json.textures || []) groupFor(slotName(tex.slot), tex.layerName).textures.push(tex);
    for (const col of json.colors || []) groupFor(slotName(col.slot), col.layerName).colors.push(col);
    for (const lay of json.layers || []) groupFor(slotName(lay.slot), lay.layerName).layer = lay;

    const usedOverlays = new Map();   // piece slot -> Set of layers already written
    const usedMaterials = new Map();
    const takenSet = (map, slot) => {
      if (!map.has(slot)) map.set(slot, new Set());
      return map.get(slot);
    };
    const texCache = new Map();

    /** Embed a PNG from the export once, and return its key in the file. */
    const embed = (file) => {
      if (texCache.has(file)) return texCache.get(file);
      const png = files.get(file);
      if (!png) { note(report.skipped, 'image ' + file, 'not in the export'); return null; }
      if (opts.maxTextureBytes && png.length > opts.maxTextureBytes) {
        note(report.skipped, 'image ' + file, png.length + ' bytes over the limit');
        return null;
      }
      const key = addTexture(loc, png, { random: opts.random });
      texCache.set(file, key);
      report.textures.push({ file, key, bytes: png.length });
      return key;
    };

    for (const group of groups.values()) {
      const pieceNode = pieceFor(group.slot);
      if (!pieceNode) { note(report.skipped, group.slot + '/' + group.layerName, 'no such piece'); continue; }
      const isMaterial = /^material_/i.test(group.layerName);

      /* What is this layer? The asset it points at says so; a layer made of
         uploaded images is the creator's flattened base. */
      const linked = group.textures.find((t) => t.link);
      const uploaded = group.textures.filter((t) => t.file);
      let kind = linked ? classifyLink(linked.link) : (uploaded.length ? 'base' : null);
      if (isMaterial) kind = 'material';
      if (!kind) { note(report.skipped, group.slot + '/' + group.layerName, 'nothing to write'); continue; }

      if (kind === 'base' && opts.skipBakedTextures) {
        note(report.skipped, group.slot + '/' + group.layerName, 'flattened base skipped');
        continue;
      }

      const found = isMaterial
        ? findMaterial(pieceNode, linked ? linked.link : '', takenSet(usedMaterials, group.slot))
        : findSlot(pieceNode, kind, (linked && linked.link) || group.layerName,
                   takenSet(usedOverlays, group.slot));
      if (!found) {
        note(report.skipped, group.slot + '/' + group.layerName + ' (' + kind + ')',
             'no matching slot in this uniform');
        continue;
      }
      (isMaterial ? takenSet(usedMaterials, group.slot) : takenSet(usedOverlays, group.slot)).add(found.layer);

      const where = group.slot + '/' + group.layerName + ' -> ' + found.why;
      let wrote = 0;
      for (const tex of group.textures) {
        const value = tex.link || (tex.file ? embed(tex.file) : null);
        if (!value) continue;
        if (setTextureLink(found.layer, tex.role, value)) wrote++;
        else note(report.skipped, where + ' ' + tex.role, 'unknown role');
      }
      const tint = TB.field(found.layer, F.TINT);
      for (const col of group.colors) {
        const chan = { colorr: F.COLOR_R, colorg: F.COLOR_G, colorb: F.COLOR_B }[String(col.tint || '').toLowerCase()];
        const rgb = hexToRgb(col.value);
        if (tint && chan && rgb && setColorStruct(TB.field(tint, chan), rgb)) wrote++;
      }
      if (group.layer) {
        /* Scale, offset and rotation travel with the decal. Clamping and the
           blend weights do not: every kit layer reports clampUv false, and
           un-clamping a decal slot makes the game repeat the logo across the
           whole piece — which is exactly what went wrong in game. */
        if (group.layer.transform) { setTransform(found.layer, group.layer.transform); wrote++; }
        if (group.layer.rsm) setRsm(found.layer, group.layer.rsm);
      }
      note(report.applied, where, wrote + ' field' + (wrote === 1 ? '' : 's'));
    }

    // fonts, matched by asset path rather than by field position
    const printing = json.printing || {};
    const numberFont = printing.jersey && printing.jersey.number && printing.jersey.number.font;
    if (numberFont && numberFont.link) {
      let n = 0;
      for (const slot of SLOTS) { const p = pieceFor(slot); if (p) n += setFontLinks(p, 'number', numberFont.link); }
      note(report.applied, 'number font -> ' + numberFont.link.split('/').pop(), n + ' field' + (n === 1 ? '' : 's'));
    }
    const nameFont = printing.jersey && printing.jersey.nameplate && printing.jersey.nameplate.font;
    if (nameFont && nameFont.link) {
      let n = 0;
      for (const slot of SLOTS) { const p = pieceFor(slot); if (p) n += setFontLinks(p, 'name', nameFont.link); }
      note(report.applied, 'nameplate font -> ' + nameFont.link.split('/').pop(), n + ' field' + (n === 1 ? '' : 's'));
    }

    // seam/stripe CID masks: one per piece, written into the piece's first CID slot
    for (const mask of json.cidMasks || []) {
      const pieceNode = pieceFor(slotName(mask.slot));
      const arr = pieceNode && TB.field(TB.field(pieceNode, F.LAYER_COMP), F.CID_LAYERS);
      if (!arr || arr.k !== 'a' || !arr.items.length || !mask.link) {
        note(report.skipped, 'cid mask ' + mask.slot, 'no CID slot found');
        continue;
      }
      const link = TB.field(arr.items[0], F.CID_LINK);
      if (link) {
        link.v = mask.link;
        note(report.applied, 'cid mask ' + slotName(mask.slot) + ' -> ' + mask.link.split('/').pop());
      }
      if (mask.channels) report.unmapped.push('cidMasks[' + mask.slot + '].channels');
    }

    for (const [what, present] of [
      ['printing.*.colors / spacing / widthAdjustments / positions', printing.jersey || printing.helmet],
      ['helmetSettings.facemaskColor', json.helmetSettings && json.helmetSettings.facemaskColor],
      ['socksSettings.underSockColor', json.socksSettings && json.socksSettings.underSockColor],
      ['accessoryPalette', json.accessoryPalette && json.accessoryPalette.enabled],
      ['layers[].blend and clampUv (deliberately left as the uniform had them)', (json.layers || []).length],
    ]) if (present) report.unmapped.push(what);
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
    classifyLink, findSlot, findMaterial, overlayList, layerLabel, layerSlotConfig, colorLink,
    findUniformList, listEntryFor, displayNames, isListed,
    addTexture, applyKit, importKit, sanitizeVariant,
    assetKey, slugKey, layerAt, layerArray, hexToRgb, randomTextureId,
  };
});
