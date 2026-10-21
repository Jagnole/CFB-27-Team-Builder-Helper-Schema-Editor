// TEAMBUILDER save files <-> the website team JSON shape the editor works on.
//
// A save file holds the same team structure as the website JSON, TDF-encoded
// with 4-letter tags (TDAT/FDAT/TMUF/JRSY/... = teamData/frostbiteData/
// uniformParts/jerseys/...). toView() names the tags we know, so every editor
// in the app works on a save file unchanged; tags we don't know keep their raw
// name and are shown but not used. Each value in the view remembers where it
// came from, and applyView() writes changed values back into those exact bytes
// (strings, ints and floats only, like the Offline Editor). It then re-reads the
// result and refuses to save if anything on screen didn't make it into the file.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./tdf.js'));
  else root.TBSave = factory(root.TBTdf);
})(typeof self !== 'undefined' ? self : this, function (Tdf) {
  'use strict';

  const { T } = Tdf;

  // Tag -> JSON key, where the tag always means the same thing.
  const NAMES = {
    TDAT: 'teamData', TINF: 'teamInfos', TMDA: 'metadata', FDAT: 'frostbiteData',
    TEXT: 'textures', BDAT: 'data', TMUF: 'uniformParts',
    JRSY: 'jerseys', HELM: 'helmets', PANT: 'pants', SOCK: 'socks',
    LCTX: 'layerCompTexture', MATE: 'materials', MOVE: 'overlays', OVLS: 'overlays', CIDM: 'cidMaskLayers',
    TXTS: 'textures', TXID: 'textureId', NORM: 'normal', TRSM: 'rsm',
    NMER: 'numberComp', ARTX: 'arrayTexture', NMST: 'numberMaterialSettings', OSPC: 'offsetScaleSpacing',
    NUSP: 'numberSpacing', CNOS: 'chestNumberOffsetScale', BNOS: 'backNumberOffsetScale',
    SNOS: 'shoulderNumberOffsetScale', LNOS: 'sleeveNumberOffsetScale',
    VECX: 'x', VECY: 'y', VECZ: 'z', VECW: 'w',
    TINT: 'tint', TRFM: 'transform', SCAL: 'scale', OFFS: 'offset', STRN: 'scaledTransform', UPOS: 'u', VPOS: 'v',
    SHMT: 'shellMaterial', ACMT: 'accMaterial',
  };
  const RGB = { COLR: 0, COLG: 1, COLB: 2 };

  // COLR/COLG/COLB depend on where they sit: a texture slot, a tint channel, or a color component.
  function nameFor(tag, parents) {
    const parent = parents[parents.length - 1];
    const grand = parents[parents.length - 2];
    if (tag in RGB) {
      if (parent === 'TXTS' && tag === 'COLR') return 'color';
      if (parent === 'TINT') return ['colorR', 'colorG', 'colorB'][RGB[tag]];
      if (grand === 'TINT' && parent in RGB) return ['r', 'g', 'b'][RGB[tag]];
      return tag;
    }
    return NAMES[tag] || tag;
  }

  // ---------- save -> view ----------
  function toView(rootNode) {
    const leaves = [];
    function view(node, tags, path) {
      switch (node.t) {
        case T.INT: case T.FLOAT: case T.STRING:
          leaves.push({ path, node });
          return node.v;
        case T.BLOB: return { embeddedBytes: node.size };
        case T.STRUCT: {
          const obj = {};
          node.fields.forEach(({ tag, node: child }) => {
            let key = nameFor(tag, tags);
            if (key in obj) key = `${tag}#${Object.keys(obj).filter((k) => k.startsWith(tag)).length}`;
            obj[key] = view(child, tags.concat(tag), path.concat(key));
          });
          return obj;
        }
        case T.LIST: return node.items.map((item, i) => view(item, tags, path.concat(i)));
        case T.MAP: {
          const obj = {};
          node.entries.forEach(({ k, v }) => {
            const key = String(k.v !== undefined ? k.v : `#${Object.keys(obj).length}`);
            obj[key] = view(v, tags, path.concat(key));
          });
          return obj;
        }
        default: throw new Error(`Unknown TDF type ${node.t}.`);
      }
    }
    const payload = view(rootNode, [], []);
    return { payload, leaves };
  }

  const getAt = (obj, path) => path.reduce((o, k) => (o == null ? undefined : o[k]), obj);
  const close = (a, b) => a === b || (typeof a === 'number' && typeof b === 'number' &&
    Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b)));

  // Paths where two views differ (float32 rounding ignored).
  function differences(a, b, path = [], out = [], limit = 50) {
    if (out.length >= limit) return out;
    if (close(a, b)) return out;
    const isObj = (x) => x && typeof x === 'object';
    if (!isObj(a) || !isObj(b) || Array.isArray(a) !== Array.isArray(b)) { out.push(path.join('.') || '(root)'); return out; }
    if (Array.isArray(a) && a.length !== b.length) { out.push(`${path.join('.')} (list size)`); return out; }
    new Set([...Object.keys(a), ...Object.keys(b)]).forEach((k) => differences(a[k], b[k], path.concat(k), out, limit));
    return out;
  }

  // ---------- view -> save ----------
  // Returns { bytes, changed, problems }. bytes is null when anything on screen
  // can't be stored in the save file.
  function applyView(plain, leaves, payload) {
    const edits = [];
    const problems = [];
    leaves.forEach(({ path, node }) => {
      const cur = getAt(payload, path);
      if (close(cur, node.v)) return;
      const where = path.join('.');
      if (node.t === T.STRING) {
        if (typeof cur !== 'string') { problems.push(`${where}: expected text.`); return; }
        edits.push({ s: node.s, e: node.e, bytes: Tdf.encodeString(cur) });
      } else if (node.t === T.FLOAT) {
        if (typeof cur !== 'number' || !Number.isFinite(cur)) { problems.push(`${where}: expected a number.`); return; }
        if (Math.fround(cur) === node.v) return;
        edits.push({ s: node.s, e: node.e, bytes: Tdf.encodeFloat(cur) });
      } else if (node.t === T.INT) {
        const v = typeof cur === 'boolean' ? Number(cur) : cur;
        if (!Number.isSafeInteger(v)) { problems.push(`${where}: expected a whole number.`); return; }
        edits.push({ s: node.s, e: node.e, bytes: Tdf.encodeInt(v) });
      }
    });
    if (problems.length) return { bytes: null, changed: 0, problems };
    const bytes = edits.length ? Tdf.splice(plain, edits) : plain;
    // Re-read what would be saved and compare it with what's on screen.
    const after = toView(Tdf.decode(bytes)).payload;
    const missed = differences(after, payload);
    if (missed.length) {
      return {
        bytes: null,
        changed: edits.length,
        problems: missed.map((p) => `${p}: this change can't be stored in a TEAMBUILDER save file.`),
      };
    }
    return { bytes, changed: edits.length, problems: [] };
  }

  // ---------- view -> new save (test fixtures only) ----------
  const REVERSE = Object.fromEntries(Object.entries(NAMES).filter(([t]) => t !== 'OVLS' && t !== 'TEXT').map(([t, n]) => [n, t]));
  const MAPS = new Set(['teamInfos', 'metadata', 'jerseys', 'helmets', 'pants', 'socks']);

  function fromJson(obj) {
    function tagFor(key, parents) {
      const parent = parents[parents.length - 1];
      const grand = parents[parents.length - 2];
      if (key === 'color' && parent === 'TXTS') return 'COLR';
      if (parent === 'TINT' && /^color[RGB]$/.test(key)) return `COL${key.slice(-1)}`;
      if (grand === 'TINT' && parent in RGB && /^[rgb]$/.test(key)) return `COL${key.toUpperCase()}`;
      if (key === 'overlays' && parent === 'NMER') return 'OVLS';
      if (key === 'textures' && parent === 'FDAT') return 'TEXT';
      if (REVERSE[key]) return REVERSE[key];
      if (/^[A-Z ]{1,4}$/.test(key)) return key;
      // Unknown JSON keys get a stable made-up tag starting with Z (no real tag
      // we name does) so fixtures stay complete.
      let h = 0;
      for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
      return 'Z' + Array.from({ length: 3 }, (_, i) => String.fromCharCode(65 + ((h >> (i * 5)) % 26))).join('');
    }
    function node(v, tags, isMap) {
      if (typeof v === 'string') return { t: T.STRING, v };
      if (typeof v === 'boolean') return { t: T.INT, v: Number(v) };
      if (typeof v === 'number') return Number.isInteger(v) ? { t: T.INT, v } : { t: T.FLOAT, v };
      if (Array.isArray(v)) {
        const items = v.filter((x) => x !== null).map((x) => node(x, tags));
        // A TDF list has one element type: whole numbers among floats become floats.
        if (items.some((i) => i.t === T.FLOAT)) items.forEach((i) => { if (i.t === T.INT) i.t = T.FLOAT; });
        const et = items.length ? items[0].t : T.STRUCT;
        if (items.some((i) => i.t !== et)) throw new Error('Mixed list element types.');
        return { t: T.LIST, et, items };
      }
      if (isMap) {
        const entries = Object.entries(v).filter(([, x]) => x !== null).map(([k, x]) => ({ k: { t: T.STRING, v: k }, v: node(x, tags) }));
        // A TDF map has one value type: mixed text/number maps store text.
        let vt = entries.length ? entries[0].v.t : T.STRING;
        if (entries.some((e) => e.v.t !== vt)) {
          entries.forEach((e) => { if (e.v.t !== T.STRING) e.v = { t: T.STRING, v: String(e.v.v) }; });
          vt = T.STRING;
        }
        return { t: T.MAP, kt: T.STRING, vt, entries };
      }
      const fields = [];
      Object.entries(v).forEach(([k, x]) => {
        if (x === null || x === undefined) return;
        const tag = tagFor(k, tags);
        const isMapField = MAPS.has(k) || tag === 'TEXT';
        fields.push({ tag, node: node(x, tags.concat(tag), isMapField) });
      });
      return { t: T.STRUCT, fields };
    }
    return Tdf.encode(node(obj, [], false));
  }

  return { NAMES, nameFor, toView, applyView, differences, fromJson };
});
