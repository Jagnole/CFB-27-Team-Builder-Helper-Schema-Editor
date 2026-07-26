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
    UniformSchema.cs             placeholder ebx type/field name constants
    UniformAssetDefinition.cs    hooks the editor into Frosty's asset system
    FrostyUniformEditor.cs       docked editor: property grid + live-preview viewport
    UniformPreviewScreen.cs      placeholder render screen (see docs/ebx-uniform-mapping.md)
    Themes/Generic.xaml          WPF control template for the editor
  CfbUniformEditorPlugin.sln    solution referencing FrostyEditor + this plugin
  docs/ebx-uniform-mapping.md  provisional uniform-asset field mapping
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
   The plugin currently has no `[PluginValidForProfile]` restriction (see
   below), so it loads regardless of which game profile you open — though
   right now it won't actually attach to any real asset until the ebx type
   name in `UniformSchema.RootEbxTypeName` is filled in.

## Known blockers before this can do anything real

1. **No CFB 27 game profile exists in Frosty.** The `1.0.6.3` branch ships
   compiled per-game SDK profiles (`FrostySdk/Profiles/*.dll` —
   `MADDEN19SDK.dll`, `MADDEN20SDK.dll`, `FIFA20SDK.dll`, etc.) but nothing
   for College Football 27. Without one, Frosty can't mount a CFB 27 install,
   list its bundles, or read any ebx at all — that's a separate, larger
   reverse-engineering effort (bundle/superbundle layout, type hashing, a
   `ProfileVersion` entry, an `IProfile` implementation) that has to happen
   before this plugin can be pointed at real game data.
2. **The uniform ebx field mapping is a guess.** See
   [`docs/ebx-uniform-mapping.md`](docs/ebx-uniform-mapping.md) — it's ported
   from Madden 19/20 (the closest existing Frosty profile, same football/
   Frostbite lineage) via a `strings` pass over the compiled SDK DLLs, not
   from any real CFB 27 data. `UniformSchema.RootEbxTypeName` is a literal
   placeholder (`Cfb27TeamUniformAsset_TODO`) that matches nothing until you
   replace it.
3. **The live preview is a stub.** `UniformPreviewScreen` just clears the
   viewport to a flat color (best-effort read of `UniformPrimaryColor`/
   `UniformSecondaryColor`, falling back silently if the field shape doesn't
   match the guess). Real mesh/material rendering — the actual "live preview
   of the uniform" — needs the real CFB27 mesh/texture resource types, which
   also aren't known yet. `Plugins/MeshSetPlugin/Screens/MultiMeshPreviewScreen.cs`
   in the submodule is the pattern to follow once those are identified.

## Next steps (not done here)

- Get a working CFB 27 profile into Frosty (or confirm one already exists in
  the modding community) so `FrostyEditor` can actually open the game.
- Use that access to dump a real uniform ebx asset (Type Explorer /
  EbxToXmlPlugin, both already in the submodule) and correct
  `UniformSchema.cs` against it.
- Replace `UniformPreviewScreen`'s flat-color stub with a real mesh/material
  render once the resource types are confirmed.
