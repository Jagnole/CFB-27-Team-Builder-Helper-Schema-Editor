# Provisional uniform ebx field mapping (Madden 19/20 baseline)

**Status: unverified.** Frosty Toolsuite's stable `1.0.6.3` branch ships no game
profile for CFB 27 — the SDK profiles in `FrostyToolsuite/FrostySdk/Profiles/`
only go up through `MADDEN19SDK.dll` / `MADDEN20SDK.dll`, `FIFA19SDK.dll`,
`FIFA20SDK.dll`, and a handful of other Frostbite titles. Frosty can't mount or
read ebx from a CFB 27 install until a real profile/SDK exists for it, so none
of the field names below have been checked against actual CFB 27 data. They
are a **starting hypothesis**, not a confirmed schema.

## How this list was produced

Madden and CFB 27 are both EA Sports football titles on the Frostbite engine,
and Madden is the closest profile Frosty already supports. Running `strings`
over `FrostySdk/Profiles/MADDEN19SDK.dll` and `MADDEN20SDK.dll` (these are
plain, unobfuscated .NET assemblies — full type/field/enum names are embedded
as readable text even without a decompiler) surfaced the property names below
via their `get_X`/`set_X` accessor pairs. This is a cheap, no-tooling way to
get a rough field list, but it can't tell us:

- the actual containing ebx class name(s) — only that some class somewhere on
  a Madden ebx object has a `JerseyNumber` property, etc.
- field types (string vs. enum vs. nested struct vs. `PointerRef`)
- whether CFB 27 kept these names, renamed them, or restructured them
  entirely (three Madden generations of engine changes between MADDEN20 and
  CFB 27 is plenty of time for a rename)

## Provisional field list

Uniform / jersey:

| Field | Likely meaning |
|---|---|
| `JerseyName` | Team jersey text/name reference |
| `JerseyNumber` | Player jersey number |
| `JerseyType` | Home/away/alt jersey style selector |
| `JerseySleeve` | Sleeve style (see `JerseySleeve_*` enum) |
| `JerseyNumberSpacing` / `JerseyNumberSplit` | Number layout controls |
| `JerseyIndirectTextureHandle` / `JerseyIndirectTexturePlacement` | Texture binding for jersey graphics (fonts/numbers) |
| `JerseyPreset` | A preset/template selector |
| `JerseyWrinkleRbo` | Cloth simulation resource |
| `MixMatchJerseyData` | Mix-and-match jersey component data (this is very likely where per-part customization — the same kind of thing the existing Chrome-extension editor exposes as font/material pickers — lives) |

Helmet:

| Field | Likely meaning |
|---|---|
| `HelmetPreset` | Shell/preset selector |
| `PlayerHelmet` / `PlayerHelmetOption` | On/off/per-player helmet state |
| `HelmetDegIncrement` / `HelmetDegradation` | Wear/damage state |
| `HelmetCenterOffsetList` / `MixMatchHelmetCenterOffset` | Fit/placement offsets |
| `HelmetOnHairSimType` | Hair sim interaction when helmet is worn |
| `MixMatchHelmetData` | Mix-and-match helmet component data (materials/decals — analogous to the Chrome extension's helmet-material picker) |

Colors / team-level:

| Field | Likely meaning |
|---|---|
| `UniformPrimaryColor` / `UniformSecondaryColor` | Team color pair. Frostbite ebx vector/color structs elsewhere in this SDK generation expose lowercase `x`/`y`/`z`/`w` members (confirmed precedent: `ObjectVariationPlugin`'s shader-parameter code reads `vec.x/y/z/w` off a `PointerRef`-referenced value) — `UniformPreviewScreen.SetColorField` in this plugin guesses that shape and falls back gracefully if wrong. |
| `TeamUniformAssetName` / `TeamUniformPrefixName` | Asset naming/lookup keys |
| `HomeTeamUniformPrefix` / `AwayTeamUniformPrefix` | Per-side uniform variant selection |
| `HomeTeamUniformVariation` / `AwayTeamUniformVariation` | Variant index/selector |
| `MixMatchTeamUniformPrefix` | Team-level mix-and-match key |
| `UniformDistribution` | Likely a randomization/weighting table for in-game rosters |
| `IsUniform` / `PropType_Uniform` | Type-tag flags seen on prop/asset enums |

Relevant enums seen (values only — not necessarily on the fields above,
but scoped to the same uniform system):

- `JerseyStyle_{Standard, Jersey_2..5, DBE, Invalid, Max, First}`
- `JerseySleeve_{Standard, Tight, Loose, Long, DBE, Invalid, Max, First}`
- `JerseySleeveDesign_{Standard, Design_1..5, DBE, Invalid, Max, First}`
- `JerseyNumberStyle_{Standard, Style_2..6, DBE, Invalid, Max, First}`
- `JerseyFontStyle_{Standard, Font_2..5, DBE, Invalid, Max, First}`
- `HelmetStripe_{None, Style_1..6, DBE, Invalid, Max, First}`
- `HelmetDecalLocation_{None, Left, Right, Both_Sides, DBE, Invalid, Max, First}`
- `UniformType_{Home, Away, Home_Alt, Away_Alt, DBE, Invalid, Max, First}`
- `UniformShade_{Light, Dark, Neutral, Invald, Max}`
- `UniformTechnique_{Default, Cyber, Holo, Invald, DBE, Max, First}`
- `Helmet_{Standard, Riddell360, RiddellTK, Schutt, SchuttVeng, Schutt_F7, Revolution, Revolution_Speed, Speed_Flex, VengeanceZ10, VicisZero1, X2E, XenithEpic, Xenith_Shadow, Air_XP, Reserved1..16, DBE, Invalid, Max, First}` — real helmet shell/model catalog, directly comparable to the shell-finish picker in the existing Chrome-extension editor.
- `CoachApparel_{First, Sideline1..3, Practice1..3, Facility1..2, Staff1..4, DBE, Invalid, Max}`
- `InjuryEquipment_{Ankle_Tape, Elbow_Pad, Knee_Brace, Wrist_Cast, DBE, Invalid, Max, First}`

Related library/bundle names (found alongside): `Library_Ucm_Uniforms`,
`Library_Mut_Equipment`, `Library_MutUniforms` — these look like bundle or
library-container names, i.e. where uniform ebx assets are grouped, not field
names on a single asset.

## Validating this against real CFB 27 data

This mapping is only useful as a checklist. To confirm or correct it once you
have your own CFB 27 game files and a working Frosty profile for the game:

1. Build the `EbxToXmlPlugin` or `TypeExplorerPlugin` (already in
   `FrostyToolsuite/Plugins/`) alongside FrostyEditor.
2. Open a team/uniform-related ebx asset and dump it to XML, or browse its
   type in the Type Explorer.
3. Compare the real field names against the table above. Update
   `CfbUniformEditorPlugin/UniformSchema.cs` with whatever's actually there —
   that's the single place the rest of the plugin (`FrostyUniformEditor.cs`,
   `UniformPreviewScreen.cs`) reads field names from, specifically so this
   correction is a one-file change.
4. Set `UniformSchema.RootEbxTypeName` to the real containing class name and
   re-test — right now it's a placeholder (`Cfb27TeamUniformAsset_TODO`) that
   matches nothing, so `UniformAssetDefinition` never activates.

## The bigger blocker this doesn't solve

None of the above matters until a CFB 27 **profile** (the equivalent of
`MADDEN20SDK.dll`) exists so Frosty can open the game's data at all — that's
prior reverse-engineering work (bundle/superbundle layout, type hashing,
`ProfileVersion` entry, `IProfile` implementation) independent of this plugin.
See `../README.md` for what that would involve.
