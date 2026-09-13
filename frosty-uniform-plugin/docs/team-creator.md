# Team Creator tool tab

A standalone tool panel (via `RegisterTabExtension`, not tied to any one open
asset) added to `CfbUniformEditorPlugin`, aimed at automating the tedious part
of building a custom team: editing team-identity fields and re-importing
~26 logo/UI texture slots, without hand-duplicating each asset one at a time.

**This does not write `.fbmod` files itself.** It runs inside Frosty/MMC
Editor and drives the tool's own real, already-working `AssetManager`/texture
APIs — the same ones the built-in "Import" action and Duplication plugin use
— so we never need to touch the mod-file encryption or reimplement ebx
writing. You still Save/Export Mod from Frosty normally when done.

## Where the texture slot list came from

Reverse-engineered from a real custom-team `.fbmod` (`Bayside Breakers`, built
in a community Frosty fork). Full breakdown of that analysis — the `.fbmod`
binary format, the `FMENC001` payload encryption we hit and didn't attempt to
break, and the complete resource list — isn't reproduced here; the short
version relevant to this tool:

- Every logo/UI texture asset is **edited in place** under the base team's
  existing name — never renamed. The mod cloned San Jose State and just
  overwrote pixel content behind slots like
  `tmlg_ncaa_primary_sanjosestate`.
- `TeamVisuals` (`content/footballcharacter/teamvisuals/<team>`) is likewise
  edited in place, not duplicated.
- The exact slot list this tool automates is `TeamCreator/TextureSlotDefinitions.cs`
  — logos + UI backgrounds only for v1. Mascot costume and stadium/field
  branding were also confirmed present in the reference mod but are
  deliberately left out here (different base-asset choice per team, and a
  separate decision from "make my own team").

## Two things you have to supply by hand (v1 limitation)

The tool can't auto-discover these from inside Frosty (or at least, this
version doesn't try to), so you look them up once per base team:

1. **Texture-suffix code** (e.g. `sanjosestate`) — search the Data Explorer
   for any `tmlg_ncaa_primary_*` asset and copy the suffix after the last
   underscore.
2. **`TeamVisuals` asset path** — search for `teamvisuals` and copy the exact
   path of your base team's instance (right-click → Copy Path).

These are **not guaranteed to derive from each other** — a team's `TeamVisuals`
short name and its texture-suffix code can differ (e.g. `sanjos` vs.
`sanjosestate` in the reference mod) — hence two separate fields rather than
one "pick a team" dropdown. A future version could build a proper lookup
once real team data confirms the relationship.

## Field-name risk

`TeamVisuals.AssetName` / `PrefixName` / `BrandName` are the field names this
tool tries to set, per the schema mapped in `docs/ebx-uniform-mapping.md` —
confirmed as real fields on the `UniformVisuals` side (`AssetName`,
`PrefixName`) via a live game asset (see the earlier property-grid
screenshot in this project's history) but **not independently confirmed on
`TeamVisuals` itself**. If a field name is wrong, the tool reports exactly
which one failed rather than silently skipping it — check that field in
Frosty's own property grid and correct `TeamCreatorService.cs` if needed.

## Texture import implementation notes

`TeamCreator/TextureImportHelper.cs` reimplements the relevant slice of
`Plugins/TexturePlugin/FrostyTextureEditor.cs`'s import logic directly in
this plugin (P/Invokes `thirdparty/dxtex.dll` itself) rather than referencing
`TexturePlugin.dll`, so it has no dependency beyond what's already in
`FrostyBinaries/`. Deliberately scoped to `TextureType.TT_2d` only — every
slot in the list is a plain 2D texture, so the cubemap/array mip-reinterleave
branch in the original code (not relevant here) is left out. Always imports
at the *target* asset's existing pixel format (never offers a format choice),
since this tool only ever replaces pixel content, not format.

Known risk areas, in rough order of likelihood of causing a first-try failure:
- P/Invoke struct marshaling (`BlobData`, `TextureImportOptions`) — copied
  field-for-field from the original, but marshaling bugs are exactly the kind
  of thing that only surfaces at runtime, not compile time.
- Whichever profile-specific branch (`ProfilesLibrary.MustAddChunks`) applies
  to CollegeFootball27 — copied both branches from the original code, but
  which one CFB27 actually needs hasn't been exercised yet.
- Compressed-format block-alignment requirements (source image dimensions
  must be divisible by 4) — the tool surfaces this as an error message rather
  than crashing, but hasn't been tested against a real compressed slot yet.

If import fails on a specific slot, the error message names the slot and
what didn't match — that's the starting point for fixing it, not a byte-level
mystery like the `.fbmod` encryption was.
