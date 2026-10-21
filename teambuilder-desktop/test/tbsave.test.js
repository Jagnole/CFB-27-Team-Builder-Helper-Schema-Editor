const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Tdf = require('../src/core/tdf.js');
const TbSave = require('../src/core/tbsave.js');
const TbPackage = require('../src/tbpackage.js');
const M = require('../src/core/model.js');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/data/tb-data.json'), 'utf8'));
const sample = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/sample-team.json'), 'utf8'));
// No real save ships with the tests (they hold a whole team); build one from the
// sample team the way a save stores it: TDF with the same tags, every jersey
// carrying a width for each number 10-99, in a package laid out like a real one.
Object.values(sample.teamData.frostbiteData.uniformParts.jerseys).forEach((j) => {
  const nms = j.numberMaterialSettings;
  if (!nms) return;
  const base = nms.offsetScaleSpacing.numberSpacing.x;
  const own = new Map((nms.playerNumberAdjust || []).map((a) => [a.number, a.width]));
  nms.playerNumberAdjust = Array.from({ length: 90 }, (_, i) => ({ number: i + 10, width: own.has(i + 10) ? own.get(i + 10) : base }));
});
const plain = TbSave.fromJson(sample);
const pkgBytes = TbPackage.buildPackage(plain, { size: TbPackage.KNOWN_LAYOUT.size });
const open = () => {
  const pkg = TbPackage.readPackage(pkgBytes);
  const view = TbSave.toView(Tdf.decode(pkg.plain));
  return { pkg, view, payload: view.payload };
};

test('TDF ints round-trip, including multi-byte and negative values', () => {
  for (const v of [0, 1, 63, 64, 127, 8191, 8192, 1e6, -1, -64, -100000]) {
    const root = { t: Tdf.T.STRUCT, fields: [{ tag: 'VALU', node: { t: Tdf.T.INT, v } }] };
    assert.equal(Tdf.decode(Tdf.encode(root)).fields[0].node.v, v);
  }
  assert.deepEqual([...Tdf.encodeString('ab')], [3, 97, 98, 0]);
  assert.equal(Tdf.tagToString(...Tdf.tagToBytes('TXID')), 'TXID');
});

test('decode then encode reproduces the bytes exactly', () => {
  assert.ok(Buffer.from(Tdf.encode(Tdf.decode(plain))).equals(Buffer.from(plain)));
  assert.throws(() => Tdf.decode(plain.subarray(0, plain.length - 20)), /ends early|not terminated|Unterminated/);
});

test('package layout: header kept, zero padding checked, same size on write', () => {
  const { pkg } = open();
  assert.equal(pkg.offset, 17950);
  assert.equal(pkg.knownLayout, true);
  assert.ok(Buffer.from(pkg.plain).equals(Buffer.from(plain)));
  const bad = Buffer.from(pkgBytes);
  bad[bad.length - 1] = 7;
  assert.throws(() => TbPackage.readPackage(bad), /Unexpected data/);
  assert.throws(() => TbPackage.readPackage(Buffer.from('PK\u0003\u0004 not a save at all')), /FBCHUNKS/);
});

test('save tags map onto the team JSON shape the editors use', () => {
  const { payload } = open();
  const v = M.deriveVariants(payload);
  assert.deepEqual(v.map((x) => x.jerseyKey), ['RCVVFYeAOa-home-jersey', 'RCVVFYeAOa-away-jersey', 'RCVVFYeAOa-ChillDino-jersey']);
  const jersey = M.getPart(payload, v[0], 'jersey');
  assert.match(M.currentNumberFontPath(jersey), /FIU_jersey_2021_NUM_Array$/);
  assert.equal(M.getNumberColor(jersey, 'colorR'), '#ffffff');
  assert.ok(Math.abs(M.getNumberSpacing(jersey) + 0.38) < 1e-6);
  assert.equal(M.getTeamField(payload, 'TEAM_NAME'), 'Daytona');
  assert.equal(M.getTeamColor(payload, 'primary'), '#723e98');
  assert.equal(M.currentDecal(payload, v[0], data).label, 'Nike Cotton (2022)');
  assert.match(M.getPart(payload, v[0], 'helmet').shellMaterial, /preset/);
});

test('edits are written into the save and survive a reload; nothing else changes', () => {
  const { pkg, view, payload } = open();
  const v = M.deriveVariants(payload);
  const jersey = M.getPart(payload, v[0], 'jersey');
  M.setTeamField(payload, 'TEAM_NICKNAME', 'Raptors');
  M.setTeamColor(payload, 'primary', '#ff0010');
  M.applyNumberFont(jersey, M.listNumberFonts(data)[5], data);
  M.setNumberColor(jersey, 'colorR', '#00ff00');
  M.setNumberSpacing(jersey, -0.45);
  M.applyVendorDecal(payload, v[0], data.catalog.decals.find((d) => d.brand === 'Jumpman'), data);
  M.applyHelmetShell(M.getPart(payload, v[0], 'helmet'), data.catalog.helmetMaterials.shell[3], data);

  const r = TbSave.applyView(pkg.plain, view.leaves, payload);
  assert.deepEqual(r.problems, []);
  assert.ok(r.changed > 10);
  const out = TbPackage.writePackage(pkgBytes, pkg, r.bytes);
  assert.equal(out.length, pkgBytes.length);
  assert.ok(out.subarray(0, pkg.offset).equals(pkgBytes.subarray(0, pkg.offset)), 'header untouched');

  const again = TbSave.toView(Tdf.decode(TbPackage.readPackage(out).plain)).payload;
  assert.deepEqual(TbSave.differences(again, payload), [], 'reloaded save matches what was on screen');
  const j2 = M.getPart(again, v[0], 'jersey');
  assert.equal(M.getTeamField(again, 'TEAM_NICKNAME'), 'Raptors');
  assert.equal(M.getNumberColor(j2, 'colorR'), '#00ff00');
  assert.equal(M.currentDecal(again, v[0], data).brand, 'Jumpman');
});

test('an untouched save is written back byte-for-byte', () => {
  const { pkg, view, payload } = open();
  const r = TbSave.applyView(pkg.plain, view.leaves, payload);
  assert.equal(r.changed, 0);
  assert.ok(Buffer.from(r.bytes).equals(Buffer.from(pkg.plain)));
});

test('changes a save file cannot hold are refused, not silently dropped', () => {
  const { pkg, view, payload } = open();
  payload.teamData.teamInfos.BRAND_NEW = 'x';
  const r = TbSave.applyView(pkg.plain, view.leaves, payload);
  assert.equal(r.bytes, null);
  assert.match(r.problems.join(' '), /BRAND_NEW/);

  const typed = open();
  M.getPart(typed.payload, M.deriveVariants(typed.payload)[0], 'jersey').numberMaterialSettings.offsetScaleSpacing.numberSpacing.x = 'wide';
  assert.match(TbSave.applyView(typed.pkg.plain, typed.view.leaves, typed.payload).problems.join(' '), /expected a number/);
});

test('editors skip fields a save file does not have instead of adding them', () => {
  const { payload } = open();
  const jersey = M.getPart(payload, M.deriveVariants(payload)[0], 'jersey');
  const tint = jersey.numberComp.overlays[0].tint;
  assert.ok(!('colorB' in tint), 'unset channel is absent in a save file');
  assert.equal(M.setNumberColor(jersey, 'colorB', '#123456'), false);
  assert.ok(!('colorB' in tint));
});

test('per-number spacing in a save: fonts set every number, the slider shifts them all', () => {
  const { pkg, view, payload } = open();
  const jersey = M.getPart(payload, M.deriveVariants(payload)[0], 'jersey');
  const list = jersey.numberMaterialSettings.playerNumberAdjust;
  assert.equal(list.length, 90);
  const font = M.listNumberFonts(data).find((f) => (data.numberLayoutProfiles[f.displayName] || {}).playerNumberAdjust);
  const prof = data.numberLayoutProfiles[font.displayName];
  assert.ok(M.applyNumberFont(jersey, font, data).profileApplied.includes('per-number kerning'));
  const listed = prof.playerNumberAdjust[0];
  assert.equal(list.find((e) => e.number === listed.number).width, listed.width);
  const unlisted = list.find((e) => !prof.playerNumberAdjust.some((a) => a.number === e.number));
  assert.equal(unlisted.width, prof.numberSpacing);
  const before = list.map((e) => e.width);
  M.setNumberSpacing(jersey, M.getNumberSpacing(jersey) + 0.05);
  list.forEach((e, i) => assert.ok(Math.abs(e.width - before[i] - 0.05) < 1e-6));
  const r = TbSave.applyView(pkg.plain, view.leaves, payload);
  assert.deepEqual(r.problems, []);
});

test('embedded images over 1 MB decode (only list and map counts are capped)', () => {
  const big = new Uint8Array(2222213);
  big.set([0x89, 0x50, 0x4e, 0x47], 0);
  const root = { t: Tdf.T.STRUCT, fields: [{ tag: 'BDAT', node: { t: Tdf.T.BLOB, bytes: big } }] };
  const back = Tdf.decode(Tdf.encode(root));
  assert.equal(back.fields[0].node.size, big.length);
  const tooLong = Tdf.encode(root).subarray(0, 1000);
  assert.throws(() => Tdf.decode(tooLong), /ends early/);
});
