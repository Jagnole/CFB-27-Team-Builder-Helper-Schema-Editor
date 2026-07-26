namespace CfbUniformEditorPlugin
{
    /// <summary>
    /// Confirmed CFB27 uniform ebx schema, read directly from the real
    /// COLLEGEFOOTBALL27SDK.dll profile (via IL metadata, see ../docs/ebx-uniform-mapping.md) —
    /// not a guess ported from another game's SDK. Field/type names here are exact; what's NOT
    /// yet confirmed is which LoadoutSlotEnum values a real team's data actually uses (see the
    /// doc's "What's still open" section).
    /// </summary>
    public static class UniformSchema
    {
        /// <summary>
        /// UniformVisuals is a root Ebx asset (one per Home/Away/Alt uniform variant) and the
        /// natural registration point for this plugin's AssetDefinition. TeamVisuals (the
        /// team-wide container that lists these via its Uniforms field) is the higher-level asset
        /// a user would browse from — see docs/ebx-uniform-mapping.md for the full hierarchy.
        /// </summary>
        public const string RootEbxTypeName = "UniformVisuals";

        // ---- UniformVisuals ----
        public const string PrefixName = "PrefixName";
        public const string DisplayName = "DisplayName";
        public const string Uniform = "Uniform"; // PointerRef -> Loadout
        public const string CustomAuthenticity = "CustomAuthenticity";

        // ---- Loadout / ItemLoadoutElement ----
        public const string LoadoutElements = "LoadoutElements";
        public const string SlotType = "SlotType"; // LoadoutSlotEnum
        public const string ItemAssetName = "ItemAssetName";
        public const string ItemAssetEmbed = "ItemAssetEmbed"; // PointerRef -> CharacterUniform*Item

        // ---- CharacterUniformJerseyItem ----
        public const string JerseyColorMap = "JerseyColorMap";
        public const string JerseyMaterialMap = "JerseyMaterialMap";
        public const string JerseyNormalMap = "JerseyNormalMap";
        public const string JerseyNumbersArrayMap = "JerseyNumbersArrayMap";
        public const string NumberTexture = "NumberTexture";
        public const string NameplateTexture = "NameplateTexture";
        public const string NumberWidthAdjustmentList = "NumberWidthAdjustmentList";

        // ---- CharacterUniformHelmetItem ----
        public const string HelmetColorMap = "HelmetColorMap";
        public const string ShellMaterialMap = "ShellMaterialMap";
        public const string AccessoryMaterialMap = "AccessoryMaterialMap";
        public const string FacemaskMaterial = "FacemaskMaterial";
        public const string FacemaskCustomColor1 = "FacemaskCustomColor1";
        public const string FacemaskCustomColor2 = "FacemaskCustomColor2";
        public const string FacemaskCustomColor3 = "FacemaskCustomColor3";
        public const string FacemaskCustomColor4 = "FacemaskCustomColor4";
        public const string ChinstrapColor = "ChinstrapColor";

        // ---- HelmetPresetData (shell finish — the ebx analog of the existing Chrome-extension
        // helmet-material picker) ----
        public const string ShellSmoothness = "ShellSmoothness";
        public const string ShellReflectance = "ShellReflectance";
        public const string ShellSparkleReflectance = "ShellSparkleReflectance";
        public const string CoatSmoothness = "CoatSmoothness";
        public const string CoatReflectance = "CoatReflectance";
        public const string MetalFlakeStrength = "MetalFlakeStrength";

        // ---- Team-level colors: TWO different shapes, see docs/ebx-uniform-mapping.md ----
        // TeamColors.Primary/Secondary are ColorRgb (fields R/G/B, capitalized).
        public const string TeamColorsPrimary = "Primary";
        public const string TeamColorsSecondary = "Secondary";
        // NFLTeamAsset.PrimaryColor/SecondaryColor are Vec3 (fields x/y/z, lowercase).
        public const string PrimaryColor = "PrimaryColor";
        public const string SecondaryColor = "SecondaryColor";
    }
}
