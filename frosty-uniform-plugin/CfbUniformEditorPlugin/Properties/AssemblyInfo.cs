using CfbUniformEditorPlugin;
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

// No ProfileVersion entry exists yet for College Football 27 in FrostySdk.ProfileVersion on the
// 1.0.6.3 branch, so there is nothing to gate this plugin on with [PluginValidForProfile] until a
// real CFB27 profile/SDK is built (see ../../docs/ebx-uniform-mapping.md). That means this plugin
// currently loads for every game profile. Once a CFB27 ProfileVersion exists, add:
//   [assembly: PluginValidForProfile((int)ProfileVersion.Cfb27)]

// UniformSchema.RootEbxTypeName is a placeholder (see UniformSchema.cs) — replace it with the
// real Ebx class name once it's identified from an actual CFB27 dump.
[assembly: RegisterAssetDefinition(UniformSchema.RootEbxTypeName, typeof(UniformAssetDefinition))]
