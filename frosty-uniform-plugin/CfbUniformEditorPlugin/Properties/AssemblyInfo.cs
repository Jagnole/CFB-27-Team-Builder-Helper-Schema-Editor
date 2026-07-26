using CfbUniformEditorPlugin;
using FrostySdk;
using Frosty.Core.Attributes;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Windows;

[assembly: ComVisible(false)]

[assembly: ThemeInfo(
    ResourceDictionaryLocation.None,
    ResourceDictionaryLocation.SourceAssembly
)]

[assembly: Guid("c79578d1-1957-4b0d-8733-31c90037c4c3")]

[assembly: PluginDisplayName("CFB27 Uniform Editor")]
[assembly: PluginAuthor("Jagnole")]
[assembly: PluginVersion("0.1.0.0")]

// ProfileVersion.CollegeFootball27 is a real, confirmed enum entry in the MMC Frosty Modding
// Tools v1.1.0.2 FrostySdk.dll this plugin now builds against (see ../../README.md and
// ../../docs/ebx-uniform-mapping.md) — so, unlike the vanilla 1.0.6.3 submodule, there's something
// real to gate on.
[assembly: PluginValidForProfile((int)ProfileVersion.CollegeFootball27)]

// UniformSchema.RootEbxTypeName is a real Ebx type (UniformVisuals), confirmed from the profile
// SDK's IL metadata — see UniformSchema.cs and docs/ebx-uniform-mapping.md.
[assembly: RegisterAssetDefinition(UniformSchema.RootEbxTypeName, typeof(UniformAssetDefinition))]
