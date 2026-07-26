# CFB 27 Uniform Editor — Frosty plugin (Phase 0/1 scaffold)

A Frosty Toolsuite plugin project aimed at a custom uniform-editing panel
with a live preview for EA Sports College Football 27. This is unrelated to
the Chrome extension in the rest of this repo — that project edits Team
Builder's web JSON API; this one is a desktop Frosty plugin that would
eventually edit the game's actual `ebx` assets.

**This is Phase 0/1 only: getting a solution that builds, plus mapping the
uniform ebx structure.** It is not a working editor yet — see
[Known blockers](#known-blockers-before-this-can-do-anything-real) before
expecting it to open a CFB 27 install.

## Which Frosty this targets

There are two Frosty builds involved here, and they're not the same thing:

- **`CadeEvs/FrostyToolsuite` `1.0.6.3`** (public, vendored as the
  `FrostyToolsuite/` git submodule) — the vanilla stable release. It has
  **no CFB 27 support at all**: no `ProfileVersion` entry, no profile SDK.
  It's kept here purely as a readable source reference for the plugin API
  (`AssetDefinition`, `FrostyAssetEditor`, `Screen`/`FrostyViewport`, the
  bundled example plugins) — it is **not** what this plugin actually builds
  or runs against.
- **MMC Frosty Modding Tools `v1.1.0.2`** (a community fork, distributed as a
  binary release via the College Football/Madden modding Discord —
  [repo](https://github.com/bphit4/MMC-Frosty-Modding-Tools/releases/tag/v1.1.0.2),
  no public source) — this one has `FrostySdk.ProfileVersion.CollegeFootball27`
  confirmed present (verified directly from the DLL's .NET metadata) and is
  what actually lists CFB 27 in its profile picker. **This is what the
  plugin is built against** — see `CfbUniformEditorPlugin/FrostyBinaries/README.md`.

## Layout

```
frosty-uniform-plugin/
  FrostyToolsuite/              git submodule -> CadeEvs/FrostyToolsuite @ 1.0.6.3
                                (source reference only — not built)
  CfbUniformEditorPlugin/       the plugin project itself
    CfbUniformEditorPlugin.csproj
    FrostyBinaries/             (gitignored) drop your own MMC Editor DLLs here — see its README
    Properties/AssemblyInfo.cs   plugin registration attributes
    UniformSchema.cs             confirmed ebx type/field name constants (see docs/)
    UniformAssetDefinition.cs    hooks the editor into Frosty's asset system
    FrostyUniformEditor.cs       docked editor: property grid + live-preview viewport
    UniformPreviewScreen.cs      placeholder render screen (see docs/ebx-uniform-mapping.md)
    Themes/Generic.xaml          WPF control template for the editor
  CfbUniformEditorPlugin.sln    solution containing just the plugin project
  docs/ebx-uniform-mapping.md  confirmed uniform-asset field mapping (from a real profile DLL)
```

## Building (Windows only)

This is a Windows-only .NET Framework 4.8 WPF plugin (uses
`Microsoft.NET.Sdk.WindowsDesktop`, references D3D11-backed types). **It
cannot be built or run in a Linux container** — there's no WPF/Desktop
runtime on Linux, .NET Framework doesn't run there, and this scaffold was
written without ever compiling it. Build and test on your own Windows
machine with Visual Studio 2019/2022:

1. Clone this repo. The submodule is optional (source reference only —
   `git submodule update --init --recursive` if you want it).
2. Copy `FrostySdk.dll`, `FrostyCore.dll`, `FrostyControls.dll`,
   `FrostyHash.dll`, and the `SharpDX.*` DLLs (`SharpDX.dll`,
   `SharpDX.Mathematics.dll`, `SharpDX.Direct3D11.dll`, `SharpDX.DXGI.dll`)
   from your own MMC Editor install into
   `CfbUniformEditorPlugin/FrostyBinaries/` (see the README there — these
   are gitignored, you supply your own copies).
3. Open `frosty-uniform-plugin/CfbUniformEditorPlugin.sln` in Visual Studio.
4. Set the solution configuration to **`Developer - Debug`**, platform **`x64`**.
5. Build. To have the plugin DLL auto-copy into your MMC Editor's `Plugins`
   folder after each build, set the `MMC_EDITOR_DIR` environment variable to
   that install's folder (the one containing `MMCEditor.exe`) before opening
   Visual Studio — otherwise the build still succeeds, just copy
   `CfbUniformEditorPlugin.dll` into that `Plugins` folder by hand.
6. Launch MMC Editor, select the CollegeFootball27 profile. The plugin is
   gated with `[PluginValidForProfile((int)ProfileVersion.CollegeFootball27)]`,
   so it only activates for that profile — and `UniformSchema.RootEbxTypeName`
   is set to a real ebx type (`UniformVisuals`), so it should attach as soon
   as you open one, once you actually have a CFB 27 install mounted.

## Known blockers before this can do anything real

1. **The plugin hasn't actually been opened against a live CFB 27 install
   yet.** Everything here — the API surface, the `ProfileVersion` entry, the
   `UniformVisuals` ebx type — is confirmed via static analysis of real
   binaries (`monodis` against the MMC `FrostySdk.dll`/profile DLL), not by
   running MMC Editor itself, since this sandbox can't run Windows software.
   The build steps above are untested end-to-end — expect a first real build
   to surface a small mismatch or two.
2. **Which `LoadoutSlotEnum` values a real team's data actually uses isn't
   confirmed.** See [`docs/ebx-uniform-mapping.md`](docs/ebx-uniform-mapping.md)
   — the obvious candidates (`LoadoutSlot_OuterShirt` for jersey,
   `LoadoutSlot_HeadWear` for helmet, etc.) are inference from naming, not
   verified against an exported `ItemLoadoutElement.SlotType`.
3. **The live preview is still a stub.** `UniformPreviewScreen` just clears
   the viewport to a flat color (reading either confirmed color shape —
   `Vec3`'s `x/y/z` or `ColorRgb`'s `R/G/B`). Real mesh/material rendering
   needs the actual CFB27 mesh/texture resource types behind
   `CharacterUniformJerseyItem`/`HelmetItem`'s `PointerRef` fields
   (`JerseyMaterialMap`, `HelmetColorMap`, etc.), which are still unresolved.
   `Plugins/MeshSetPlugin/Screens/MultiMeshPreviewScreen.cs` in the vendored
   submodule is the pattern to follow once those are identified.

## Next steps (not done here)

- Build this against your MMC Editor install (steps above) and report back
  what breaks.
- Once it loads: open a real team's `TeamVisuals`/`UniformVisuals`/`Loadout`
  and confirm the open items in `docs/ebx-uniform-mapping.md` — real
  `LoadoutSlotEnum` values, actual `PointerRef` resource types.
- Replace `UniformPreviewScreen`'s flat-color stub with a real mesh/material
  render once those resource types are confirmed.

## A note on the MMC Editor install itself

Setting this plugin up doesn't require touching anything about how MMC
Editor/Mod Manager is installed — just copying four DLLs out of an install
you already have. Worth flagging independent of this plugin: the MMC install
guide has you replace the game's `EAAntiCheat.GameServiceLauncher.exe` with a
modified one from the download. That's a decision to make with real
information about what that binary does, not something to do routinely —
it's an unverified third-party replacement for a security-relevant component,
distributed outside any official channel.
