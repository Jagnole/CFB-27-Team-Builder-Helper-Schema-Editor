# CFB 27 uniform ebx field mapping

**Status: confirmed from a real CFB 27 profile SDK**, supplied by the repo owner
(`COLLEGEFOOTBALL27SDK.dll`, found in a Frosty install's `Profiles/` folder —
same slot `MADDEN20SDK.dll` etc. occupy in stock Frosty). This replaces the
earlier Madden-19/20-derived guess entirely.

## How this was produced

`COLLEGEFOOTBALL27SDK.dll` is a plain, unobfuscated .NET assembly, so its full
type metadata — class names, field names, field *types*, inheritance — is
readable directly, without needing to run the game or Frosty at all. This
sandbox has no Windows/.NET runtime, but `mono-utils`' `monodis` disassembler
runs fine on Linux against a .NET assembly's metadata tables:

```
monodis --typedef  CFB27SDK.dll   # every class name + what it extends
monodis --fields    CFB27SDK.dll   # every field, with its declared type
monodis --property  CFB27SDK.dll   # public property names (field name minus leading `_`)
```

Field *names* and *types* below are exact — they're read straight out of
.NET metadata, not inferred. What's still unconfirmed is anything that
depends on the actual game data (which enum values a real team uses, how
bundles reference these assets, etc.) — that needs the profile actually
loaded into a working Frosty + a real CFB 27 install, which is a separate
step from this static analysis (see `../README.md`).

Field types referencing other game types show as `<BROKEN CLASS ...>` in
`monodis` output because it can't resolve cross-assembly references without
`FrostySdk.dll` loaded — the *name* of the field is still exact, just not
its resolved type. Cross-referencing against the `--typedef` table (which
lists real class names and inheritance) fills most of that in.

## The asset hierarchy

```
TeamVisuals (root asset, extends Asset)
  Uniforms: List<PointerRef>            -> UniformVisuals (one per Home/Away/Alt/etc.)
  TeamPalette, CrowdPalette, KhakiPalette, GearOverrideTexture, ...
  PracticeUniforms, PracticeQBJerseys, PracticeUniformShades
  UniformEvents: List<PointerRef>       -> UniformEvent
  Palettes: List<PaletteElement>
  PrefixName, AssetName, TeamFaction, TeamVenue, BrandName, PrimaryLogoId
  OrigId: FootballStaticTeams_DBE (legacy enum name — Madden-lineage leftover)
  FetchUniforms: bool

UniformVisuals (root asset, extends Asset)     <- current plugin's RootEbxTypeName
  PrefixName, DisplayName, AssetName: string
  Uniform: PointerRef                   -> Loadout
  Combine: PointerRef
  CustomAuthenticity: LoadoutAuthenticity_DBE
  CanRemix, IsCustom, CurrentOfficial: bool

Loadout (root asset, extends Asset)
  LoadoutElements: List<ItemLoadoutElement>
  LoadoutTag: string, DisplayOrder: int
  LoadoutCategory: LoadoutCategory_DBE, LoadoutType: LoadoutType_DBE
  OutfitType: CharacterOutfitType_DBE

ItemLoadoutElement (extends Asset)
  SlotType: LoadoutSlotEnum             -> which body/gear slot this fills
                                            (relevant: LoadoutSlot_OuterShirt,
                                            LoadoutSlot_HeadWear, LoadoutSlot_OuterPants,
                                            LoadoutSlot_OuterSocks, LoadoutSlot_CaptainPatch,
                                            LoadoutSlot_HelmetFlag, LoadoutSlot_HelmetBumper — ~90
                                            slots total cover the whole character, not just uniform)
  ItemAssetName: string, ItemAssetEmbed: PointerRef  -> the actual per-slot item, e.g. CharacterUniformJerseyItem
  Blends / Transforms / FieldOverrides / PaletteMods: List<PointerRef>
  ItemInstanceTag: string, ZOrder: int
```

This is a modern Frostbite "gear/loadout" cosmetic system — the same kind of
per-slot equip architecture used for character customization elsewhere in
recent EA titles — applied to team uniforms rather than a flat
`TeamUniformAssetName`-style string field like the Madden 19/20 SDKs used.
Editing a uniform means walking `TeamVisuals.Uniforms` → `UniformVisuals.Uniform`
→ `Loadout.LoadoutElements` → the slot's `CharacterUniform*Item`, not editing
one flat asset.

## Per-slot item classes (all extend `FootballCharacterItemBase`, itself a `PartItem`)

**`CharacterUniformJerseyItem`** — jersey mesh/material/number/nameplate config:
`JerseyColorMap`, `JerseyMaterialMap`, `JerseyNormalMap`, `JerseyRSMMap`,
`JerseySleevesMaterialMap`, `JerseyNumbersArrayMap`, `NumberTexture`,
`NameplateTexture`, `NumberRSM`/`NameplateRSM` (`Vec3`), `PartItemRef`
(-> `JerseyPartItemReference`), `NumberWidthAdjustmentList` /
`ShoulderNumberWidthAdjustmentList` / `SleevesNumberWidthAdjustmentList`
(`List<NumberWidthAdjustment>` — each just `{ Number: int, Width: float }`),
plus a cluster of float spacing controls (`PlayerDefaultNumberSpacing`,
`PlayerDefaultSleevesNumberSpacing`, `PlayerDefaultShoulderNumberSpacing`,
`PlayerNameMinimumWidth`/`MaximumWidth`/`ScaleAtMinimum`) and bools
(`IsCaptainPatchEnabled`, `IsCaptainPatchInPlayoff`, `EnableNumberSpacingOverrides`,
`ShoulderFallbackToPreset`, `SleevesFallbackToPreset`, `IsComposited`,
`UsesDirectReferences`).

**`CharacterUniformHelmetItem`** — helmet mesh/material/facemask config:
`HelmetColorMap`, `ShellMaterialMap`, `AccessoryMaterialMap`, `HelmetStickerMap`,
`FaceMaskMaterialMap`, `FaceMaskClipMaterialMap`, `FacemaskMaterial`,
`FacemaskPaletteString`, `FacemaskCustomColor1..4` (`Vec4`), `ChinstrapColor`
(`Vec3`), `PartItemRef` (-> `HelmetPartItemReference`), `PlayerDefaultNumberSpacing`
(`float`), `IsComposited`, `UsesDirectReferences`.

**`CharacterUniformPantsItem`**: `PartItemRef`, weather variants
(`RainWeatherModel`/`Material`, `ColdWeatherModel`/`Material`), `ItemWeatherDefault`
(enum `ItemWeather`), `IsComposited`.

**`CharacterUniformSocksItem`**: `PartItemRef`, `OuterSock` (bool),
`SockHeightAdjustment` (bool), `IsComposited`.

The `PartItemRef` on each of the above resolves (by name, via
`JerseyPartItemReference`/`HelmetPartItemReference` — each just `{ Id, AssetName }`)
to a **`JerseyPartItem`** / **`HelmetPartItem`** (both extend `PartItem`), which
hold the actual per-part visual settings:

- `HelmetPartItem`: `prideStickerSettings` (`pride_sticker_settings`: sticker
  texture/RSM/count), `helmetMaterialSettings` (`helmet_material_settings`:
  number RSM/placement, `List<MixMatchPlayerNumberAdj>`, has-front/back-number
  flags), `faceMaskMaterialSettings` (`face_mask_material_settings`: RSM +
  color), plus a set of `*MaterialMap`/`*ESMaterialMap`/`*Blueprint` fields
  for shell/accessory/facemask.
- `JerseyPartItem`: `Captainpatch` (`CaptainPatch` — texture/RSM/colors 1-4 +
  `MixMatchCaptainPatchType` enum + transform), `numberMaterialSettings`
  (`jersey_material_settings`: per-location number RSM for
  back/sleeve/shoulder/front, `List<MixMatchPlayerNumberAdj>`,
  unique-tens-digit flags per location), `fontMaterialSettings`
  (`jersey_font_settings`: nameplate indirect-texture placement/offset/scale),
  `numberOverrides` (`jersey_number_texture_overrides`: per-location
  override color maps).

**Helmet shell/finish presets** — the closest ebx analog to the existing
Chrome-extension editor's helmet-material picker — live in `HelmetPresetData`:
`ShellSmoothness`, `ShellReflectance`, `ShellSparkleReflectance`,
`ShellSparkleSmoothness`, `ShellMetalMask`, `CoatSmoothness`, `CoatReflectance`,
`MetalFlakeStrength`, `MetalFlakeUVScale2`, `FacemaskColor` — all `Vec3`/`Vec4`,
i.e. this is where "Matte finish" etc. is actually parameterized.

## Team-level colors

**`TeamColors`** (plain embedded struct, not its own asset): exactly two
fields, `Primary` and `Secondary`, both type **`ColorRgb`** — *not* `Vec3`/`Vec4`.
`ColorRgb` exposes `R`, `G`, `B` (capitalized!) plus a `ColorGamut` metadata
enum, a different member-naming convention than `Vec3`/`Vec4`'s lowercase
`x`/`y`/`z`/`w`. `NFLTeamAsset` (a root asset — the name is a leftover from
this codebase's Madden/NFL lineage, no CFB27-specific subclass was found in
this SDK) separately has `PrimaryColor`/`SecondaryColor` typed as `Vec3`
directly, `TeamName`, `TeamLocation`, `LogoImage`, `LogoMovie`,
`OverallRating` — this looks like CFB 27's actual team-record asset, uniform
color data included.

**Practical consequence for `UniformPreviewScreen.SetColorField`**: the earlier
placeholder code assumed a Frostbite vector's lowercase `x`/`y`/`z` — correct
for `NFLTeamAsset.PrimaryColor`/`SecondaryColor` (confirmed `Vec3`), but wrong
for `TeamColors.Primary`/`Secondary` (confirmed `ColorRgb`, capitalized
`R`/`G`/`B`). The code now tries lowercase `x`/`y`/`z` first and falls back to
`R`/`G`/`B` before giving up.

## What's still open

- **Vec3 vs Vec4 for helmet colors**: `ChinstrapColor` is `Vec3` but
  `FacemaskCustomColor1..4` are `Vec4` — both are handled by the same `x/y/z`
  read (alpha `w` is simply ignored for `Vec3` reads, which is safe since we
  never dereference `.w` unless the value is actually `Vec4`-typed).
- **Which `LoadoutSlotEnum` values are the ones actually used for team
  uniforms** vs. the ~90 slots that cover the rest of character customization
  (hair, tattoos, etc.) hasn't been confirmed against a real team's exported
  `Loadout` — the obvious candidates are `LoadoutSlot_OuterShirt` (jersey),
  `LoadoutSlot_HeadWear` (helmet), `LoadoutSlot_OuterPants`,
  `LoadoutSlot_OuterSocks`, `LoadoutSlot_CaptainPatch`, `LoadoutSlot_HelmetFlag`,
  `LoadoutSlot_HelmetBumper`, but that's inference from naming, not confirmed
  by an actual exported `ItemLoadoutElement.SlotType` value.
- **Enum literal values** (`LoadoutCategory_DBE`, `LoadoutType_DBE`,
  `CharacterOutfitType_DBE`, `FootballStaticTeams_DBE`, etc.) weren't fully
  enumerated here — `monodis --typedef`/`--fields` on the same DLL will list
  every literal if needed.
- This static analysis tells us the **shape** of the data. It says nothing
  about how to get Frosty to actually *open* a CFB 27 install and hand you a
  real `TeamVisuals`/`UniformVisuals` instance to test against — that's a
  separate question about which Frosty build/fork the profile DLL came from
  (see `../README.md`).
