# CFB 27 Uniform Editor — Frosty Toolsuite plugin (Phase 0/1 scaffold)

A [Frosty Toolsuite](https://github.com/CadeEvs/FrostyToolsuite) plugin
project targeting the **`1.0.6.3`** stable branch, aimed at a custom
uniform-editing panel with a live preview for EA Sports College Football 27.
This is unrelated to the Chrome extension in the rest of this repo — that
project edits Team Builder's web JSON API; this one is a desktop Frosty
Toolsuite plugin that would eventually edit the game's actual `ebx` assets.

**This is Phase 0/1 only: getting a solution that builds, plus a first pass at
mapping the uniform ebx structure.** It is not a working editor yet — see
[Known blockers](#known-blockers-before-this-can-do-anything-real) before
expecting it to open a CFB 27 install.

## Layout

```
frosty-uniform-plugin/
  FrostyToolsuite/              git submodule -> CadeEvs/FrostyToolsuite @ 1.0.6.3
  CfbUniformEditorPlugin/       the plugin project itself
    CfbUniformEditorPlugin.csproj
    Properties/AssemblyInfo.cs   plugin registration attributes
    UniformSchema.cs             confirmed ebx type/field name constants (see docs/)
    UniformAssetDefinition.cs    hooks the editor into Frosty's asset system
    FrostyUniformEditor.cs       docked editor: property grid + live-preview viewport
    UniformPreviewScreen.cs      placeholder render screen (see docs/ebx-uniform-mapping.md)
    Themes/Generic.xaml          WPF control template for the editor
  CfbUniformEditorPlugin.sln    solution referencing FrostyEditor + this plugin
  docs/ebx-uniform-mapping.md  confirmed uniform-asset field mapping (from a real profile DLL)
```

## Building (Windows only)

Frosty Toolsuite is a Windows-only .NET Framework 4.8 WPF application (uses
`Microsoft.NET.Sdk.WindowsDesktop`, D3D11 via SharpDX, native C++ components).
**It cannot be built or run in a Linux container** — there's no WPF/Desktop
runtime on Linux, .NET Framework doesn't run there, and this scaffold was
written without ever compiling it. Build and test on your own Windows machine
with Visual Studio 2019/2022:

1. Clone this repo and initialize the submodule:
   ```
   git submodule update --init --recursive
   ```
2. Open `frosty-uniform-plugin/CfbUniformEditorPlugin.sln` in Visual Studio.
3. Set the solution configuration to **`Developer - Debug`**, platform **`x64`**.
4. Build the solution. This builds both `FrostyEditor` (from the submodule)
   and `CfbUniformEditorPlugin`; the plugin's post-build step copies its DLL
   into `FrostyToolsuite/FrostyEditor/bin/Developer/Debug/Plugins/` so
   `FrostyEditor.exe` picks it up next launch.
   - If you build `FrostyEditor` with a different configuration/platform,
     rebuild the plugin with the matching one too, or the post-build xcopy
     will create a `Plugins` folder next to the wrong output directory.
5. Run `FrostyToolsuite/FrostyEditor/bin/Developer/Debug/FrostyEditor.exe`.
   The plugin has no `[PluginValidForProfile]` restriction (see below), so it
   loads regardless of which game profile you open. `UniformSchema.RootEbxTypeName`
   is now set to a real ebx type (`UniformVisuals`) — but this vanilla
   `1.0.6.3` build still has no CFB 27 profile to actually open a CFB 27
   install and hand you one, see blocker #1 below.

## Known blockers before this can do anything real

1. **This vendored `1.0.6.3` submodule still has no CFB 27 profile built in.**
   A real `COLLEGEFOOTBALL27SDK.dll` profile *does* exist — it came from a
   Frosty install on the repo owner's machine that already lists CFB 27 in
   its profile picker — but that install is a different build/fork than the
   vanilla `CadeEvs/FrostyToolsuite@1.0.6.3` this plugin is scaffolded
   against. Dropping the DLL into this submodule's `FrostySdk/Profiles/`
   folder alone won't make vanilla `FrostyEditor` recognize CFB 27 — it also
   needs a `ProfileVersion` enum entry and the surrounding `IProfile`/bundle-
   format plumbing that only exists in whatever build the DLL came from.
   Finding (or being pointed at) that build/fork, and possibly repointing
   this project's submodule at it, is the next real blocker — separate from
   the ebx schema work below, which is now done.
2. **The uniform ebx field mapping is now confirmed, not a guess.** See
   [`docs/ebx-uniform-mapping.md`](docs/ebx-uniform-mapping.md) — read
   directly from the real `COLLEGEFOOTBALL27SDK.dll`'s .NET metadata (class
   names, field names, field *types*) via `monodis`, no game or Frosty
   install required for this part. `UniformSchema.RootEbxTypeName` is now set
   to `UniformVisuals`, a real root ebx asset type. What's still unconfirmed
   is which `LoadoutSlotEnum` values a real team's data actually uses — see
   the doc's "What's still open" section.
3. **The live preview is still a stub.** `UniformPreviewScreen` just clears
   the viewport to a flat color, now reading either of the two confirmed
   color shapes (`Vec3`'s `x/y/z` or `ColorRgb`'s `R/G/B`, see the doc).
   Real mesh/material rendering needs the real CFB27 mesh/texture resource
   types on `CharacterUniformJerseyItem`/`HelmetItem`
   (`JerseyMaterialMap`/`HelmetColorMap`/etc., all currently unresolved
   `PointerRef`s) — `Plugins/MeshSetPlugin/Screens/MultiMeshPreviewScreen.cs`
   in the submodule is the pattern to follow once those are identified.

## Next steps (not done here)

- Identify the Frosty build/fork the `COLLEGEFOOTBALL27SDK.dll` profile came
  from, and decide whether to repoint this project's submodule at it instead
  of vanilla `1.0.6.3`.
- Once Frosty can actually open a CFB 27 install: export a real `TeamVisuals`/
  `UniformVisuals`/`Loadout` via Type Explorer or `EbxToXmlPlugin` (both
  already in the submodule) to confirm the open items in
  `docs/ebx-uniform-mapping.md` (real `LoadoutSlotEnum` values, actual
  `PointerRef` resource types).
- Replace `UniformPreviewScreen`'s flat-color stub with a real mesh/material
  render once those resource types are confirmed.
