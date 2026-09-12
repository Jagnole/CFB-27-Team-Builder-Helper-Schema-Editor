#!/usr/bin/env node
/*
 * cli.js — inspect a Team Builder save file and import uniforms into it.
 *
 *   node cli.js info       TEAMBUILDER-003
 *   node cli.js roundtrip  TEAMBUILDER-003
 *   node cli.js uniforms   TEAMBUILDER-003
 *   node cli.js clone      TEAMBUILDER-003 --from HOME --name Alt1 [--display "Alt 1"]
 *   node cli.js prune      TEAMBUILDER-003 [--apply] [-o OUT]
 *   node cli.js import     TEAMBUILDER-003 kit.zip [--name Alt1] [--from HOME]
 *                          [--display "Jordan Alt"] [--prune] [--max-dim 2048]
 *                          [--keep-flat] [--skip-baked] [--grow] [-o OUT]
 *
 * Space: a save file is a fixed 7.5 MiB. --prune reclaims images nothing
 * points at, baked images are shrunk biggest-first to fit, and flat ones are
 * dropped. --grow writes a bigger file by rewriting the header's size fields,
 * which is UNTESTED against the game.
 */
'use strict';
const fs = require('fs');
const zlib = require('zlib');
const TB = require('./tbfile.js');
const U = require('./uniform.js');
const KZ = require('./kitzip.js');
const PNG = require('./png.js');
const TX = require('./textures.js');

const z = TB.zlibNode(zlib);
const imaging = PNG.imaging(PNG.nodeZlib(zlib));
const kb = (n) => (n / 1024).toFixed(0) + ' KB';

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o') out.out = argv[++i];
    else if (a.startsWith('--')) {
      const key = a.slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) out[key] = argv[++i];
      else out[key] = true;
    } else out._.push(a);
  }
  return out;
}

async function open(path) {
  const raw = new Uint8Array(fs.readFileSync(path));
  const container = await TB.Container.open(raw, z);
  return { raw, container, recs: TB.parsePayload(container.payload) };
}

async function save(container, recs, path, opts) {
  opts = opts || {};
  const payload = TB.buildPayload(recs);
  const file = await container.build(payload, z, opts);
  fs.writeFileSync(path, file);
  const comp = container.compressedLengthOf(file.subarray(container.streamOffset));
  const grew = file.length !== container.totalSize;
  console.log('wrote ' + path + ' (' + file.length + ' bytes, ' + comp + ' compressed, ' +
    (file.length - container.streamOffset - comp) + ' bytes spare)' +
    (grew ? '\n  NOTE: this file is larger than the original ' + container.totalSize +
      ' bytes. The original size is exactly 7.5 MiB, which looks like a deliberate' +
      '\n        save budget, so a grown file may be rejected. Untested — try it and keep the original.' : ''));
}

const CMDS = {
  async info([path]) {
    const { container, recs } = await open(path);
    console.log('container      ' + container.totalSize + ' bytes total');
    console.log('header block   ' + container.streamOffset + ' bytes');
    console.log('payload        ' + container.payload.length + ' bytes (' + container.originalCompressedSize + ' compressed)');
    console.log('free space     ' + container.freeSpace + ' bytes');
    console.log('records        ' + recs.map(r => '#' + r.h.toString(16)).join(', '));
    const loc = U.locate(recs);
    console.log('team code      ' + loc.teamCode);
    console.log('uniforms       ' + U.listVariants(loc).join(', '));
    console.log('custom images  ' + (loc.textureMap ? loc.textureMap.entries.length : 0));
    const unused = TX.unusedTextures(recs, loc);
    const prunable = unused.filter((u) => u.prunable);
    if (prunable.length) {
      const total = prunable.reduce((a, u) => a + u.bytes, 0);
      console.log('unreferenced   ' + prunable.length + ' image(s), ' + kb(total) +
        ' reclaimable with --prune');
      for (const u of prunable) console.log('   - ' + u.key + '  ' + kb(u.bytes));
    }
  },

  async prune([path], args) {
    const { container, recs } = await open(path);
    const loc = U.locate(recs);
    const unused = TX.unusedTextures(recs, loc);
    for (const u of unused) {
      console.log((u.prunable ? 'prunable ' : 'kept     ') + u.key.padEnd(34) +
        kb(u.bytes).padStart(9) + '  ' + u.reason);
    }
    const keys = unused.filter((u) => u.prunable).map((u) => u.key);
    if (!keys.length) return console.log('nothing to reclaim');
    if (!args.apply) {
      return console.log('\n' + keys.length + ' image(s) would be removed — add --apply to write the file');
    }
    const result = TX.pruneTextures(loc, keys);
    console.log('\nremoved ' + result.removed + ' image(s), ' + kb(result.bytes) + ' of image data');
    await save(container, recs, args.out || path.replace(/(\.[^./]*)?$/, '') + '-pruned', { grow: !!args.grow });
  },

  async roundtrip([path]) {
    const { raw, container, recs } = await open(path);
    const payload = TB.buildPayload(recs);
    const same = payload.length === container.payload.length && payload.every((v, i) => v === container.payload[i]);
    console.log('payload re-serializes byte for byte: ' + same);
    const rebuilt = await container.build(payload, z);
    const reopened = await TB.Container.open(rebuilt, z);
    const stable = reopened.payload.length === container.payload.length &&
      reopened.payload.every((v, i) => v === container.payload[i]);
    console.log('rebuilt file re-reads to the same payload: ' + stable);
    console.log('rebuilt file size matches original: ' + (rebuilt.length === raw.length));
    if (!same || !stable) process.exitCode = 1;
  },

  async uniforms([path]) {
    const { recs } = await open(path);
    const loc = U.locate(recs);
    const names = U.displayNames(loc);
    if (!loc.uniformList) console.log('WARNING: no uniform list found in this file');
    for (const variant of U.listVariants(loc)) {
      const parts = U.SLOTS.map((slot) => {
        const piece = U.piece(loc, variant, slot);
        const ov = piece && U.layerArray(piece, 'overlay');
        const mat = piece && U.layerArray(piece, 'material');
        return slot + '(' + (ov ? ov.items.length : 0) + ' overlays, ' + (mat ? mat.items.length : 0) + ' materials)';
      });
      const listed = U.isListed(loc, variant);
      console.log(variant.padEnd(14) + (listed ? 'in game as "' + names.get(variant) + '"' : 'NOT IN THE UNIFORM LIST').padEnd(28) +
        parts.join('  '));
    }
  },

  async clone([path], args) {
    const { container, recs } = await open(path);
    const loc = U.locate(recs);
    const from = args.from || 'HOME';
    const name = U.sanitizeVariant(args.name || 'Copy');
    const result = U.cloneVariant(loc, from, name, { displayName: args.display });
    console.log('cloned ' + from + ' -> ' + name + ', shown in game as "' + result.displayName + '"' +
      (result.listed ? '' : '\n  WARNING: could not add it to the team uniform list, so the game will not offer it'));
    await save(container, recs, args.out || path.replace(/(\.[^./]*)?$/, '') + '-' + name);
  },

  async import([path, kitPath], args) {
    const { container, recs } = await open(path);
    const loc = U.locate(recs);
    let kit = await KZ.readKit(new Uint8Array(fs.readFileSync(kitPath)), KZ.inflateRawNode(zlib));
    console.log('kit "' + (kit.json.uniformName || '?') + '" for ' + (kit.json.team || '?') +
      ' (schema v' + kit.json.schemaVersion + ', ' + kit.files.size + ' files)');

    // reclaim space from images nothing points at any more
    let reclaimed = 0;
    if (args.prune) {
      const keys = TX.unusedTextures(recs, loc).filter((u) => u.prunable).map((u) => u.key);
      const result = TX.pruneTextures(loc, keys);
      reclaimed = result.bytes;
      console.log('reclaimed      ' + result.removed + ' unreferenced image(s), ' + kb(reclaimed));
    }

    // make the export's baked images fit the space there is
    const margin = 64 * 1024;
    const budget = args.grow ? Infinity
      : Math.max(0, container.freeSpace + reclaimed - margin);
    if (!args['skip-baked']) {
      const plan = await TX.planKitTextures(kit, {
        budget,
        maxDim: args['max-dim'] ? Number(args['max-dim']) : 2048,
        skipFlat: !args['keep-flat'],
        imaging,
      });
      kit = plan.kit;
      console.log('images         ' + kb(plan.totalBytes) + ' after planning' +
        (budget === Infinity ? '' : ' (budget ' + kb(budget) + ')') +
        (plan.fits ? '' : ' — STILL TOO BIG'));
      for (const d of plan.decisions) {
        const mark = { flatten: '.', shrink: '~', keep: '=' }[d.action] || '=';
        console.log('   ' + mark + ' ' +
          d.file.padEnd(28) + kb(d.bytes).padStart(9) + '  ' + d.reason);
      }
    }

    const report = U.importKit(recs, kit, {
      name: args.name ? U.sanitizeVariant(args.name) : undefined,
      displayName: args.display,
      source: args.from,
      skipBakedTextures: !!args['skip-baked'],
      maxTextureBytes: args['max-texture-bytes'] ? Number(args['max-texture-bytes']) : undefined,
    });
    console.log('variant        ' + report.variant + ' (cloned from ' + report.clonedFrom + ')');
    console.log('shown in game  ' + (report.listed ? '"' + report.displayName + '"' :
      'NO — the uniform list could not be updated'));
    console.log('applied        ' + report.applied.length + ' changes');
    for (const line of report.applied) console.log('   + ' + line);
    if (report.textures.length) {
      console.log('images added   ' + report.textures.length);
      for (const t of report.textures) console.log('   * ' + t.file + ' -> ' + t.key + ' (' + kb(t.bytes) + ')');
    }
    if (report.skipped.length) {
      console.log('skipped        ' + report.skipped.length);
      for (const line of report.skipped) console.log('   - ' + line);
    }
    if (report.unmapped.length) {
      console.log('not imported   (no confirmed field mapping yet)');
      for (const line of report.unmapped) console.log('   ? ' + line);
    }
    await save(container, recs, args.out || path.replace(/(\.[^./]*)?$/, '') + '-' + report.variant,
      { grow: !!args.grow });
  },
};

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._.shift();
  if (!cmd || !CMDS[cmd]) {
    console.error(fs.readFileSync(__filename, 'utf8').split('*/')[0].split('\n').slice(2).join('\n').replace(/^ \* ?/gm, ''));
    process.exit(cmd ? 1 : 0);
  }
  await CMDS[cmd](args._, args);
})().catch((e) => { console.error('error: ' + e.message); process.exit(1); });
