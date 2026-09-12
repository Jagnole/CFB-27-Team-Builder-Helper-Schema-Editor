#!/usr/bin/env node
/*
 * cli.js — inspect a Team Builder save file and import uniforms into it.
 *
 *   node cli.js info       TEAMBUILDER-003
 *   node cli.js roundtrip  TEAMBUILDER-003
 *   node cli.js uniforms   TEAMBUILDER-003
 *   node cli.js clone      TEAMBUILDER-003 --from HOME --name Alt1 -o OUT
 *   node cli.js import     TEAMBUILDER-003 kit.zip [--name Alt1] [--from HOME]
 *                          [--max-texture-bytes N] [--skip-baked] [-o OUT]
 */
'use strict';
const fs = require('fs');
const zlib = require('zlib');
const TB = require('./tbfile.js');
const U = require('./uniform.js');
const KZ = require('./kitzip.js');

const z = TB.zlibNode(zlib);

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

async function save(container, recs, path) {
  const payload = TB.buildPayload(recs);
  const file = await container.build(payload, z);
  fs.writeFileSync(path, file);
  const comp = container.compressedLengthOf(file.subarray(container.streamOffset));
  console.log('wrote ' + path + ' (' + file.length + ' bytes, ' + comp +
    ' compressed, ' + (container.totalSize - container.streamOffset - comp) + ' bytes spare)');
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
    for (const variant of U.listVariants(loc)) {
      const parts = U.SLOTS.map((slot) => {
        const piece = U.piece(loc, variant, slot);
        const ov = piece && U.layerArray(piece, 'overlay');
        const mat = piece && U.layerArray(piece, 'material');
        return slot + '(' + (ov ? ov.items.length : 0) + ' overlays, ' + (mat ? mat.items.length : 0) + ' materials)';
      });
      console.log(variant.padEnd(14) + parts.join('  '));
    }
  },

  async clone([path], args) {
    const { container, recs } = await open(path);
    const loc = U.locate(recs);
    const from = args.from || 'HOME';
    const name = U.sanitizeVariant(args.name || 'Copy');
    U.cloneVariant(loc, from, name);
    console.log('cloned ' + from + ' -> ' + name);
    await save(container, recs, args.out || path.replace(/(\.[^./]*)?$/, '') + '-' + name);
  },

  async import([path, kitPath], args) {
    const { container, recs } = await open(path);
    const kit = await KZ.readKit(new Uint8Array(fs.readFileSync(kitPath)), KZ.inflateRawNode(zlib));
    console.log('kit "' + (kit.json.uniformName || '?') + '" for ' + (kit.json.team || '?') +
      ' (schema v' + kit.json.schemaVersion + ', ' + kit.files.size + ' files)');
    const report = U.importKit(recs, kit, {
      name: args.name ? U.sanitizeVariant(args.name) : undefined,
      source: args.from,
      skipBakedTextures: !!args['skip-baked'],
      maxTextureBytes: args['max-texture-bytes'] ? Number(args['max-texture-bytes']) : undefined,
    });
    console.log('variant        ' + report.variant + ' (cloned from ' + report.clonedFrom + ')');
    console.log('applied        ' + report.applied.length + ' changes');
    for (const line of report.applied) console.log('   + ' + line);
    if (report.textures.length) {
      console.log('images added   ' + report.textures.length);
      for (const t of report.textures) console.log('   * ' + t.file + ' -> ' + t.key + ' (' + t.bytes + ' bytes)');
    }
    if (report.skipped.length) {
      console.log('skipped        ' + report.skipped.length);
      for (const line of report.skipped) console.log('   - ' + line);
    }
    if (report.unmapped.length) {
      console.log('not imported   (no confirmed field mapping yet)');
      for (const line of report.unmapped) console.log('   ? ' + line);
    }
    await save(container, recs, args.out || path.replace(/(\.[^./]*)?$/, '') + '-' + report.variant);
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
