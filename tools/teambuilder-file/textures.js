/*
 * textures.js — decide what to do with a uniform export's baked images so
 * they fit the save file's space, and find images in a save file that
 * nothing references any more.
 *
 * Two things make the difference in practice:
 *   - an export's normal/rsm maps are often perfectly uniform, which tells
 *     the renderer nothing and can cost megabytes;
 *   - shrinking the biggest image first keeps detail where it matters,
 *     instead of halving everything together.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./tbfile.js'), require('./uniform.js'));
  } else root.TBTextures = factory(root.TBFile, root.TBUniform);
})(typeof self !== 'undefined' ? self : this, function (TB, U) {
  'use strict';

  const MIN_DIM = 128;

  /** The PNG files a kit actually points at, largest first. */
  function kitImageFiles(kit) {
    const wanted = new Set();
    for (const tex of kit.json.textures || []) if (tex.file) wanted.add(tex.file);
    return [...wanted]
      .filter((f) => kit.files.has(f))
      .sort((a, b) => kit.files.get(b).length - kit.files.get(a).length);
  }

  /**
   * Work out a set of images that fits `budget` bytes.
   *
   * @param kit    {json, files}
   * @param opts   {budget, maxDim, skipFlat, imaging}
   *   imaging is {decode, encode, downscale, flatness}; every call is awaited,
   *   so a synchronous codec (png.js) and an async one (canvas) both work.
   * @returns {Promise<{kit, decisions, totalBytes, fits}>}
   */
  async function planKitTextures(kit, opts) {
    const im = opts.imaging;
    const budget = opts.budget == null ? Infinity : opts.budget;
    const startDim = opts.maxDim || 2048;
    const skipFlat = opts.skipFlat !== false;

    const files = new Map(kit.files);
    const decisions = [];
    const live = [];

    for (const name of kitImageFiles(kit)) {
      const original = files.get(name);
      let img = null, note = null;
      try {
        img = await im.decode(original);
      } catch (e) {
        decisions.push({ file: name, action: 'keep', bytes: original.length, reason: 'not readable as PNG (' + e.message + ')' });
        continue;
      }
      /*
       * A uniform image still means something — a flat colour map IS the
       * colour, a flat normal map is the neutral one the shader expects — so
       * it is stored as a 4x4 instead of being thrown away. Same result on
       * screen, a few dozen bytes instead of megabytes.
       */
      const flat = await im.flatness(img);
      if (skipFlat && flat.flat) {
        const tiny = await im.encode(await im.downscale(img, 4));
        files.set(name, tiny);
        decisions.push({
          file: name, action: 'flatten', bytes: tiny.length, savedBytes: original.length - tiny.length,
          reason: 'every pixel is rgb(' + flat.colour.slice(0, 3).join(',') + ') — kept as 4x4',
        });
        continue;
      }
      let bytes = original;
      let dim = Math.max(img.width, img.height);
      if (dim > startDim) {
        img = await im.downscale(img, startDim);
        bytes = await im.encode(img);
        dim = Math.max(img.width, img.height);
        note = 'shrunk to ' + dim + 'px';
        files.set(name, bytes);
      }
      live.push({ name, img, bytes, dim, original, note });
    }

    /* Shrink the biggest image in turn until the set fits. */
    const total = () => live.reduce((a, e) => a + e.bytes.length, 0);
    let guard = 0;
    while (total() > budget && guard++ < 40) {
      live.sort((a, b) => b.bytes.length - a.bytes.length);
      const worst = live[0];
      const next = Math.max(MIN_DIM, Math.floor(worst.dim / 2));
      if (next >= worst.dim) break;                       // cannot shrink further
      worst.img = await im.downscale(worst.img, next);
      worst.bytes = await im.encode(worst.img);
      worst.dim = Math.max(worst.img.width, worst.img.height);
      worst.note = 'shrunk to ' + worst.dim + 'px';
      files.set(worst.name, worst.bytes);
      if (live.every((e) => e.dim <= MIN_DIM)) break;
    }

    for (const e of live) {
      decisions.push({
        file: e.name,
        action: e.note ? 'shrink' : 'keep',
        bytes: e.bytes.length,
        savedBytes: e.original.length - e.bytes.length,
        reason: e.note || 'kept at ' + e.dim + 'px',
      });
    }
    decisions.sort((a, b) => (b.savedBytes || 0) - (a.savedBytes || 0));
    const totalBytes = total();
    return { kit: { json: kit.json, files }, decisions, totalBytes, fits: totalBytes <= budget };
  }

  /**
   * Which custom images does the save file still point at? A layer names an
   * image by its table key, and other systems name one inside a longer asset
   * path, so both an exact match and a substring count as a reference. The
   * table's own url fields are ignored, since every key appears in its own.
   */
  function textureUsage(recs, loc) {
    const keys = loc.textureMap.entries.map(([k]) => k);
    const ownUrls = new Set();
    for (const [, entry] of loc.textureMap.entries) {
      const url = TB.field(entry, U.F.TEX_URL);
      if (url && url.v) ownUrls.add(url.v);
    }
    const strings = [];
    for (const rec of recs) {
      TB.walk(rec.n, (node) => { if (node.k === 's' && node.v && !ownUrls.has(node.v)) strings.push(node.v); });
    }
    const usage = new Map();
    for (const key of keys) {
      let refs = 0;
      for (const s of strings) if (s === key || s.indexOf(key) >= 0) refs++;
      usage.set(key, refs);
    }
    return usage;
  }

  /**
   * Images that nothing points at and that look like a uniform upload
   * (`<teamCode>_<id>`), so team-wide art — a logo sheet, an end zone — is
   * never touched even when no string in the save names it.
   */
  function unusedTextures(recs, loc) {
    const usage = textureUsage(recs, loc);
    const uploadPattern = new RegExp('^' + loc.teamCode + '_[A-Za-z0-9_]+$');
    const out = [];
    for (const [key, entry] of loc.textureMap.entries) {
      if (usage.get(key) !== 0) continue;
      const blob = TB.field(entry, U.F.TEX_BLOB);
      const bytes = blob ? blob.v.length : 0;
      if (!uploadPattern.test(key)) {
        out.push({ key, bytes, prunable: false, reason: 'not a uniform upload — left alone' });
        continue;
      }
      out.push({ key, bytes, prunable: true, reason: 'no layer points at it' });
    }
    return out;
  }

  /** Drop the named images from the save file's table. */
  function pruneTextures(loc, keys) {
    const drop = new Set(keys);
    const before = loc.textureMap.entries.length;
    let bytes = 0;
    for (const [key, entry] of loc.textureMap.entries) {
      if (!drop.has(key)) continue;
      const blob = TB.field(entry, U.F.TEX_BLOB);
      if (blob) bytes += blob.v.length;
    }
    loc.textureMap.entries = loc.textureMap.entries.filter(([k]) => !drop.has(k));
    return { removed: before - loc.textureMap.entries.length, bytes };
  }

  return { kitImageFiles, planKitTextures, textureUsage, unusedTextures, pruneTextures, MIN_DIM };
});
