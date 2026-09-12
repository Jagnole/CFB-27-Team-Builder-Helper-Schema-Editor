#!/usr/bin/env node
/*
 * selftest.js — checks the codec and the importer against your own files.
 *
 *   node selftest.js TEAMBUILDER-003 [kit.zip]
 *
 * Nothing is written to disk; the save file is only read.
 */
'use strict';
const fs = require('fs');
const zlib = require('zlib');
const TB = require('./tbfile.js');
const U = require('./uniform.js');
const KZ = require('./kitzip.js');

const z = TB.zlibNode(zlib);
let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail ? '  — ' + detail : ''));
  if (!ok) failures++;
}
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

(async () => {
  const [savePath, kitPath] = process.argv.slice(2);
  if (!savePath) {
    console.error('usage: node selftest.js TEAMBUILDER-00n [kit.zip]');
    process.exit(2);
  }
  const raw = new Uint8Array(fs.readFileSync(savePath));
  const container = await TB.Container.open(raw, z);
  check('container opens', true, container.payload.length + ' byte payload, ' +
    container.freeSpace + ' bytes spare');

  const recs = TB.parsePayload(container.payload);
  check('payload re-serializes byte for byte', same(TB.buildPayload(recs), container.payload));

  const rebuilt = await container.build(TB.buildPayload(recs), z);
  check('rebuilt file keeps the container size', rebuilt.length === raw.length);
  const reopened = await TB.Container.open(rebuilt, z);
  check('rebuilt file re-reads to the same payload', same(reopened.payload, container.payload));

  const loc = U.locate(recs);
  const variants = U.listVariants(loc);
  check('uniforms found', variants.length > 0, variants.join(', '));
  check('every uniform resolves all four pieces',
    variants.every((v) => U.SLOTS.every((s) => !!U.piece(loc, v, s))));

  // clone, then confirm the copy is independent of its source
  const source = variants.includes('HOME') ? 'HOME' : variants[0];
  U.cloneVariant(loc, source, 'SelfTest');
  check('clone adds a uniform', U.listVariants(loc).includes('SelfTest'));
  const clonePiece = U.piece(loc, 'SelfTest', 'jersey');
  const srcPiece = U.piece(loc, source, 'jersey');
  const cloneOverlay = U.layerArray(clonePiece, 'overlay').items[0];
  const label = TB.field(TB.field(cloneOverlay, U.F.LAYER_NAME), U.F.LABEL);
  const before = label ? label.v : null;
  if (label) label.v = 'touched by selftest';
  const srcLabel = TB.field(TB.field(U.layerArray(srcPiece, 'overlay').items[0], U.F.LAYER_NAME), U.F.LABEL);
  check('clone is a deep copy', !srcLabel || srcLabel.v !== 'touched by selftest');
  if (label) label.v = before;
  check('clone re-serializes', TB.buildPayload(recs).length > 0);

  U.removeVariant(loc, 'SelfTest');
  check('remove undoes the clone', !U.listVariants(loc).includes('SelfTest'));
  check('file is unchanged after clone + remove', same(TB.buildPayload(recs), container.payload));

  if (kitPath) {
    const kit = await KZ.readKit(new Uint8Array(fs.readFileSync(kitPath)), KZ.inflateRawNode(zlib));
    check('kit reads', !!kit.json.schemaVersion,
      '"' + kit.json.uniformName + '", ' + kit.files.size + ' files');
    const report = U.importKit(recs, kit, { name: 'SelfTestKit', skipBakedTextures: true });
    check('kit import writes changes', report.applied.length > 0, report.applied.length + ' changes');
    const payload = TB.buildPayload(recs);
    const withKit = await container.build(payload, z);
    const back = await TB.Container.open(withKit, z);
    check('file with the imported uniform re-reads', same(back.payload, payload));
    const recs2 = TB.parsePayload(back.payload);
    const loc2 = U.locate(recs2);
    check('imported uniform is present after a full re-read',
      U.listVariants(loc2).includes('SelfTestKit'));
    const untouched = U.SLOTS.every((s) => {
      const a = U.piece(loc2, source, s);
      const w = new TB.Writer(); TB.writeValue(w, a);
      return w.bytes().length > 0;
    });
    check('source uniform still parses', untouched);
  }

  console.log(failures ? '\n' + failures + ' check(s) failed' : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('error: ' + e.message); process.exit(1); });
