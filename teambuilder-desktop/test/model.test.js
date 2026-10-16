const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const M = require('../src/core/model.js');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/data/tb-data.json'), 'utf8'));
const sampleText = fs.readFileSync(path.join(__dirname, 'fixtures/sample-team.json'), 'utf8');
const load = () => M.parseTeamJson(sampleText);

test('fixture parses and untouched payload serializes byte-for-byte', () => {
  const p = load();
  assert.equal(M.serialize(p), JSON.stringify(JSON.parse(sampleText)));
  assert.deepEqual(M.changeReport(load(), p), []);
});

test('rejects files that are not team JSON', () => {
  assert.throws(() => M.parseTeamJson('{"foo":1}'), /teamData/);
});

test('team name edit keeps metadata in sync, abbreviation is capped', () => {
  const p = load();
  M.setTeamField(p, 'TEAM_NAME', 'Orlando');
  M.setTeamField(p, 'TEAM_SHORTNAME', 'ORLANDO');
  assert.equal(p.teamData.teamInfos.TEAM_NAME, 'Orlando');
  assert.equal(p.teamData.metadata.teamDisplayName, 'Orlando');
  assert.equal(p.teamData.teamInfos.TEAM_SHORTNAME, 'ORLAN');
});

test('team colors round-trip as 0-255 strings', () => {
  const p = load();
  assert.equal(M.getTeamColor(p, 'primary'), '#723e98');
  M.setTeamColor(p, 'primary', '#ff0010');
  assert.equal(p.teamData.teamInfos.TEAM_BACKGROUNDCOLORR, '255');
  assert.equal(p.teamData.teamInfos.TEAM_BACKGROUNDCOLORB, '16');
});

test('palette colors write x/y/z and leave w alone', () => {
  const p = load();
  M.setPaletteColor(p, 'teamPalette', 'primaryColor', '#000000');
  assert.deepEqual(p.teamData.frostbiteData.teamVisuals.teamPalette.primaryColor.colorChannels, { x: 0, y: 0, z: 0, w: 1 });
});

test('variants group parts by suffix and use website display names', () => {
  const v = M.deriveVariants(load());
  assert.deepEqual(v.map((x) => x.label), ['Home', 'Away', 'Chill Dino']);
  assert.equal(v[0].helmetKey, 'RCVVFYeAOa-home-helmet');
  assert.equal(v[1].pantsKey, undefined);
});

test('number font writes both texture fields and its layout profile', () => {
  const p = load();
  const home = M.deriveVariants(p)[0];
  const jersey = M.getPart(p, home, 'jersey');
  const font = M.listNumberFonts(data).find((f) => data.numberLayoutProfiles[f.displayName]);
  const res = M.applyNumberFont(jersey, font, data);
  assert.equal(res.ok, true);
  const expected = font.path.replace('/uniforms/comp/', '/uniforms/');
  assert.equal(jersey.numberComp.arrayTexture.textureId, expected);
  assert.equal(jersey.numberComp.overlays[0].textures.color.textureId, expected);
  const prof = data.numberLayoutProfiles[font.displayName];
  if (prof.numberSpacing !== undefined) assert.equal(M.getNumberSpacing(jersey), prof.numberSpacing);
  assert.equal(M.findFontByPath(data, M.currentNumberFontPath(jersey)).displayName, font.displayName);
});

test('number font on a jersey with no number layer fails cleanly', () => {
  const p = load();
  const dino = M.deriveVariants(p)[2];
  const res = M.applyNumberFont(M.getPart(p, dino, 'jersey'), M.listNumberFonts(data)[0], data);
  assert.equal(res.ok, false);
});

test('number colors set the tint without inventing extra keys', () => {
  const p = load();
  const jersey = M.getPart(p, M.deriveVariants(p)[0], 'jersey');
  const { channels } = M.numberColorChannels(jersey, data);
  assert.ok(channels.length >= 1);
  const tint = jersey.numberComp.overlays[0].tint;
  tint.TintMode = 'LayerCompTintMode_WithValue'; // left behind by older versions
  M.setNumberColor(jersey, channels[0], '#00ff00');
  assert.equal(M.getNumberColor(jersey, channels[0]), '#00ff00');
  assert.equal(tint.tintMode, 0);
  assert.ok(!('TintMode' in tint), 'stray TintMode removed');
});

test('spacing is clamped to the safe range', () => {
  const p = load();
  const jersey = M.getPart(p, M.deriveVariants(p)[0], 'jersey');
  M.setNumberSpacing(jersey, -2);
  assert.equal(M.getNumberSpacing(jersey), M.NUMBER_SPACING_MIN);
});

test('number size uses the inverted mapping relative to the loaded value', () => {
  const orig = load();
  const p = load();
  const v = M.deriveVariants(p)[0];
  const jersey = M.getPart(p, v, 'jersey');
  const origJersey = M.getPart(orig, v, 'jersey');
  assert.equal(M.getNumberSizePercent(jersey, origJersey, 'backNumberOffsetScale'), 100);
  M.setNumberSizePercent(jersey, origJersey, 'backNumberOffsetScale', 125);
  const back = jersey.numberMaterialSettings.offsetScaleSpacing.backNumberOffsetScale;
  assert.ok(Math.abs(back.z - 0.8660804020100503 * 0.8) < 1e-12);
  assert.equal(M.getNumberSizePercent(jersey, origJersey, 'backNumberOffsetScale'), 125);
});

test('helmet shell sets the matching accessory', () => {
  const p = load();
  const helmet = M.getPart(p, M.deriveVariants(p)[0], 'helmet');
  const shell = data.catalog.helmetMaterials.shell.find((s) =>
    data.catalog.helmetMaterials.accessory.some((a) => a.label === s.label));
  const res = M.applyHelmetShell(helmet, shell, data);
  assert.equal(res.accessoryMatched, true);
  assert.equal(helmet.shellMaterial, shell.path);
  assert.match(helmet.accMaterial, /_Acc_preset$/);
});

test('vendor decal swaps jersey/pants/socks and applies brand placement', () => {
  const p = load();
  const home = M.deriveVariants(p)[0];
  const decal = data.catalog.decals.find((d) => d.brand === 'Jumpman');
  const results = M.applyVendorDecal(p, home, decal, data);
  assert.deepEqual(results.map((r) => r.ok), [true, true, true]);
  const pants = M.getPart(p, home, 'pants').layerCompTexture.overlays[0];
  assert.equal(pants.textures.color.textureId, decal.col);
  assert.equal(pants.transform.scaledTransform.x, data.brandPieceTransform.Jumpman.pants.scaleU);
  assert.equal(pants.textures.layout.textureId, data.brandPieceTransform.Jumpman.pants.layout);
  assert.equal(M.currentDecal(p, home, data).label, decal.label);
});

test('part colors list only set swatches and skip disabled layers', () => {
  const p = load();
  const colors = M.listPartColors(M.getPart(p, M.deriveVariants(p)[0], 'helmet'));
  assert.deepEqual(colors.map((c) => c.label), ['Helmet Shell']);
});

test('replace color everywhere recolors every matching swatch on a uniform', () => {
  const p = load();
  const home = M.deriveVariants(p)[0];
  const n = M.replaceColorEverywhere(p, home, '#723e98', '#cc0000');
  assert.ok(n >= 5, 'expected several purple swatches, got ' + n);
  assert.equal(M.listPartColors(M.getPart(p, home, 'jersey'))[0].hex, '#cc0000');
});

test('change report collapses colors and names the layer', () => {
  const orig = load();
  const p = load();
  const home = M.deriveVariants(p)[0];
  M.setTeamField(p, 'TEAM_NICKNAME', 'Raptors');
  M.setColorAt(M.getPart(p, home, 'jersey'), ['layerCompTexture', 'materials', 1, 'tint', 'colorR'], '#ffffff');
  const report = M.changeReport(orig, p);
  const labels = report.map((r) => r.label);
  assert.ok(labels.includes('Team › TEAM_NICKNAME'));
  assert.ok(labels.includes('Team metadata › teamNickname'));
  const color = report.find((r) => r.label.includes('Sleeve Cuff'));
  assert.equal(color.before, '#723e98');
  assert.equal(color.after, '#ffffff');
  assert.equal(report.length, 3);
});

test('a resized table is reported as a single change', () => {
  const orig = load();
  const p = load();
  const jersey = M.getPart(p, M.deriveVariants(p)[0], 'jersey');
  jersey.numberMaterialSettings.playerNumberAdjust = [{ number: 10, width: -0.5 }, { number: 11, width: -0.7 }];
  const report = M.changeReport(orig, p);
  assert.equal(report.length, 1);
  assert.equal(report[0].before, '1 entry');
  assert.equal(report[0].after, '2 entries');
});

test('logo colors read per piece and only set channels can change', () => {
  const p = load();
  const home = M.deriveVariants(p)[0];
  const pants = M.getPart(p, home, 'pants');
  assert.deepEqual(M.getDecalColors(pants), { colorR: '#0f1b2a', colorG: null, colorB: null });
  assert.equal(M.setDecalColor(pants, 'colorG', '#ff0000'), false);
  assert.equal(M.setDecalColor(pants, 'colorR', '#ff0000'), true);
  assert.equal(M.getDecalColors(pants).colorR, '#ff0000');
  assert.equal(M.getDecalColors(M.getPart(p, home, 'jersey')).colorR, '#ffffff', 'other pieces untouched');
});

// The fixture has no uploaded images, so add one the way the website stores them.
function withCustomLayer() {
  const p = load();
  const home = M.deriveVariants(p)[0];
  p.teamData.frostbiteData.textures = { Abc_collar: { url: 'https://cdn.mcr.ea.com/282/bundles-users/x/Abc_collar/1-0-0-z.png' } };
  M.getPart(p, home, 'jersey').layerCompTexture.overlays.push({
    info: { label: 'Custom Layer 3', slot: '' },
    textures: { color: { textureId: 'Abc_collar' }, rsm: { textureId: 'ContentShared/characters/player/parts/uniforms/recipe/textures/red' } },
    rsm: { rsmR: { reflectance: 0.5, smoothness: 0.65, metalMask: 0.75 }, rsmG: null, rsmB: null },
    tint: { colorR: null, colorG: null, colorB: null, tintMode: 0 },
  });
  return p;
}

test('custom image layers are listed with their image and metal settings', () => {
  const layers = M.listCustomLayers(withCustomLayer());
  assert.equal(layers.length, 1);
  assert.equal(layers[0].label, 'Custom Layer 3');
  assert.match(layers[0].url, /Abc_collar/);
  assert.equal(layers[0].rsm.metalMask, 0.75);
});

test('custom layer check flags removed layers and broken image links', () => {
  const orig = withCustomLayer();
  assert.deepEqual(M.checkCustomLayers(orig, M.clone(orig)), []);
  const lost = M.clone(orig);
  M.getPart(lost, M.deriveVariants(lost)[0], 'jersey').layerCompTexture.overlays.pop();
  assert.match(M.checkCustomLayers(orig, lost).join(' '), /removed/);
  const broken = M.clone(orig);
  broken.teamData.frostbiteData.textures = {};
  assert.match(M.checkCustomLayers(orig, broken).join(' '), /missing from the file/);
});

test('editing colors, fonts and logos keeps every custom layer intact', () => {
  const orig = withCustomLayer();
  const p = M.clone(orig);
  const home = M.deriveVariants(p)[0];
  M.replaceColorEverywhere(p, home, '#723e98', '#cc0000');
  M.applyNumberFont(M.getPart(p, home, 'jersey'), M.listNumberFonts(data)[0], data);
  M.applyVendorDecal(p, home, data.catalog.decals[0], data);
  assert.deepEqual(M.checkCustomLayers(orig, p), []);
  assert.deepEqual(M.getPart(p, home, 'jersey').layerCompTexture.overlays.at(-1), M.getPart(orig, home, 'jersey').layerCompTexture.overlays.at(-1));
});
