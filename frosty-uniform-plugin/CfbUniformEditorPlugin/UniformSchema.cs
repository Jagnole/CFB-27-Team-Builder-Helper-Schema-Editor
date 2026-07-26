namespace CfbUniformEditorPlugin
{
    /// <summary>
    /// Placeholder mapping onto CFB27's (currently unknown) uniform ebx schema. See
    /// ../docs/ebx-uniform-mapping.md for how these names were derived — they are ported from the
    /// Madden 19/20 SDK profiles (the closest available Frostbite football-game analog) as a
    /// provisional baseline, NOT confirmed against real CFB27 data.
    /// </summary>
    public static class UniformSchema
    {
        /// <summary>
        /// TODO: replace with the real root Ebx type name once identified from an actual CFB27
        /// dump (e.g. via FrostyEditor's Type Explorer / EbxToXmlPlugin against a mounted CFB27
        /// install). Until then this won't match anything and the plugin's AssetDefinition simply
        /// never activates.
        /// </summary>
        public const string RootEbxTypeName = "Cfb27TeamUniformAsset_TODO";

        // Field names below match property accessors (get_X/set_X) found via strings analysis of
        // MADDEN19SDK.dll / MADDEN20SDK.dll. Unverified for CFB27.
        public const string JerseyName = "JerseyName";
        public const string JerseyNumber = "JerseyNumber";
        public const string JerseyType = "JerseyType";
        public const string JerseySleeve = "JerseySleeve";
        public const string JerseyNumberStyle = "JerseyNumberSplit";
        public const string MixMatchJerseyData = "MixMatchJerseyData";

        public const string HelmetPreset = "HelmetPreset";
        public const string PlayerHelmet = "PlayerHelmet";
        public const string MixMatchHelmetData = "MixMatchHelmetData";

        public const string UniformPrimaryColor = "UniformPrimaryColor";
        public const string UniformSecondaryColor = "UniformSecondaryColor";

        public const string TeamUniformAssetName = "TeamUniformAssetName";
        public const string HomeTeamUniformPrefix = "HomeTeamUniformPrefix";
        public const string AwayTeamUniformPrefix = "AwayTeamUniformPrefix";
    }
}
