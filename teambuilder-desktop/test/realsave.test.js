// Checks against a real TEAMBUILDER save, which isn't kept in the repo (it
// holds a whole team). Point TB_SAVE at one to run it:
//   TB_SAVE=path/to/TEAMBUILDER-005 npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Tdf = require('../src/core/tdf.js');
const TbSave = require('../src/core/tbsave.js');
const TbPackage = require('../src/tbpackage.js');
const M = require('../src/core/model.js');

const file = process.env.TB_SAVE;
const skip = !file || !fs.existsSync(file) ? 'set TB_SAVE to a real TEAMBUILDER save to run' : false;
const data = M.mergeExtraFonts(
  JSON.parse(fs.readFileSync(path.join(__dirname, '../src/data/tb-data.json'), 'utf8')),
  JSON.parse(fs.readFileSync(path.join(__dirname, '../src/data/extra-fonts.json'), 'utf8')));

test('real save: decodes and re-encodes byte for byte', { skip }, () => {
  const pkg = TbPackage.readPackage(fs.readFileSync(file));
  assert.ok(Buffer.from(Tdf.encode(Tdf.decode(pkg.plain))).equals(Buffer.from(pkg.plain)));
});

test('real save: every editor finds its fields, and edits survive save + reload', { skip }, () => {
  const buf = fs.readFileSync(file);
  const pkg = TbPackage.readPackage(buf);
  const view = TbSave.toView(Tdf.decode(pkg.plain));
  const p = view.payload;
  assert.ok(M.getTeamField(p, 'TEAM_NAME'));
  const variants = M.deriveVariants(p);
  assert.ok(variants.length > 0);
  const v = variants[0];
  const jersey = M.getPart(p, v, 'jersey');
  const helmet = M.getPart(p, v, 'helmet');
  assert.ok(M.currentNumberFontPath(jersey));
  assert.ok(M.getNumberColor(jersey, 'colorR'));
  assert.equal(typeof M.getNumberSpacing(jersey), 'number');
  assert.ok(M.getFacemaskColor(helmet));
  assert.deepEqual(M.checkCustomLayers(p, M.clone(p)), []);

  const untouched = TbSave.applyView(pkg.plain, view.leaves, p);
  assert.equal(untouched.changed, 0);

  M.setTeamField(p, 'TEAM_NICKNAME', 'Testers');
  // Every uniform: some saves carry a full 10-99 list, others a short one.
  const withList = M.listNumberFonts(data).find((f) => (data.numberLayoutProfiles[f.displayName] || {}).playerNumberAdjust);
  variants.forEach((x) => {
    const j = M.getPart(p, x, 'jersey');
    if (j && j.numberComp) assert.equal(M.applyNumberFont(j, withList, data, { fixedLists: true }).ok, true);
  });
  M.setNumberColor(jersey, 'colorR', '#123456');
  M.applyVendorDecal(p, v, data.catalog.decals[0], data);
  M.setFacemaskColor(helmet, '#654321');
  const r = TbSave.applyView(pkg.plain, view.leaves, p);
  assert.deepEqual(r.problems, []);
  const out = TbPackage.writePackage(buf, pkg, r.bytes);
  assert.equal(out.length, buf.length);
  const again = TbSave.toView(Tdf.decode(TbPackage.readPackage(out).plain)).payload;
  assert.deepEqual(TbSave.differences(again, p), []);
});
