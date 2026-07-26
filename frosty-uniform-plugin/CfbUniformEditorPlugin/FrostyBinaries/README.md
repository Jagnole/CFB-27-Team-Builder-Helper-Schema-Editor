# FrostyBinaries

This folder is where `CfbUniformEditorPlugin.csproj` expects to find the
compiled Frosty assemblies it references (see the `<Reference>` entries with
`HintPath="FrostyBinaries\..."`). **Nothing in this folder is committed** —
`.gitignore` excludes the `.dll`/`.exe` files here, since they're compiled
binaries from someone else's Frosty build, not this project's code.

Copy these files here from your own working MMC Editor install (wherever
`MMCEditor.exe` lives on your machine — all of them should be sitting right
next to it, possibly in a `ThirdParty` subfolder for the `SharpDX.*` ones):

```
FrostyBinaries/
  FrostySdk.dll
  FrostyCore.dll
  FrostyControls.dll
  FrostyHash.dll
  SharpDX.dll
  SharpDX.Mathematics.dll
  SharpDX.Direct3D11.dll
  SharpDX.DXGI.dll
```

The `SharpDX.*` ones back Frosty's 3D viewport (`Screen`/`IViewport`,
`Frosty.Core.Controls.FrostyViewport`) — anything in this plugin that touches
the live-preview viewport (`UniformPreviewScreen.cs`) needs them too. Use the
exact copies from your MMC Editor install, not some other SharpDX build —
mismatched versions can compile fine but fail at runtime with type-identity
errors.

Why these specific binaries and not the vanilla `FrostyToolsuite` submodule
source: as of writing, only a community fork (MMC Frosty Modding Tools,
v1.1.0.2 confirmed) has `FrostySdk.ProfileVersion.CollegeFootball27` and CFB27
profile support at all — the public `CadeEvs/FrostyToolsuite` `1.0.6.3`
branch vendored in `../../FrostyToolsuite` does not. The plugin has to be
built against binaries that actually know about CFB27, which right now means
these compiled DLLs, not the older submodule source. See
`../../README.md` and `../../docs/ebx-uniform-mapping.md` for the full story.
