using System.Collections.Generic;

namespace CfbUniformEditorPlugin.TeamCreator
{
    public class TextureSlotDefinition
    {
        public string Category { get; }
        public string FriendlyName { get; }

        /// <summary>
        /// Asset path template with a single {code} placeholder for the base team's texture-suffix
        /// code (NOT the same as the TeamVisuals asset's own short name -- see docs/team-creator.md).
        /// </summary>
        public string PathTemplate { get; }

        public TextureSlotDefinition(string category, string friendlyName, string pathTemplate)
        {
            Category = category;
            FriendlyName = friendlyName;
            PathTemplate = pathTemplate;
        }

        public string ResolvePath(string code) => PathTemplate.Replace("{code}", code);
    }

    /// <summary>
    /// Confirmed by direct reverse-engineering of a real custom-team .fbmod (see
    /// docs/team-creator.md) -- every one of these is edited IN PLACE under the base team's
    /// existing asset name, never renamed. Deliberately scoped to v1: logos + UI backgrounds only.
    /// Mascot costume and stadium/field branding are left out for now (different base-asset choice
    /// per team, and stadium swaps are a separate decision from "make my own team").
    /// </summary>
    public static class TextureSlotDefinitions
    {
        public static readonly IReadOnlyList<TextureSlotDefinition> All = new List<TextureSlotDefinition>
        {
            // Logos
            new TextureSlotDefinition("Logos", "Primary logo (NCAA)", "content/ui/imageassetlibraries/global/teamlogos/teamlogos/assets/ncaa/tmlg_ncaa_primary_{code}"),
            new TextureSlotDefinition("Logos", "3D logo", "content/ui/imageassetlibraries/global/teamlogos/teamlogos3d/assets/tl3d_primary_{code}"),
            new TextureSlotDefinition("Logos", "3D logo on white", "content/ui/imageassetlibraries/global/teamlogos/teamlogos3donwhite/assets/tl3dow_primary_{code}"),
            new TextureSlotDefinition("Logos", "Gold logo", "content/ui/imageassetlibraries/global/teamlogos/teamlogosgold/assets/tlgo_{code}"),
            new TextureSlotDefinition("Logos", "Logo on white", "content/ui/imageassetlibraries/global/teamlogos/teamlogosonwhite/assets/tlow_{code}"),
            new TextureSlotDefinition("Logos", "White logo", "content/ui/imageassetlibraries/global/teamlogos/whiteteamlogos/assets/wtl_{code}"),
            new TextureSlotDefinition("Logos", "Logo sticker", "content/ui/imageassetlibraries/global/teamlogos/teamlogosstickers/assets/tlst_{code}"),
            new TextureSlotDefinition("Logos", "Secondary logo", "content/ui/imageassetlibraries/global/teamlogossecondary/assets/tlsec_secondary_{code}"),
            new TextureSlotDefinition("Logos", "Team decal", "content/ui/imageassetlibraries/global/teamdecals/assets/tdcl_{code}"),

            // UI backgrounds / assets
            new TextureSlotDefinition("UI Backgrounds", "Team background", "content/ui/imageassetlibraries/global/teambackgrounds/assets/tbak_{code}"),
            new TextureSlotDefinition("UI Backgrounds", "Main menu background", "content/ui/imageassetlibraries/global/teambackgrounds/assets/mainmenu/tbak_mainmenu_{code}"),
            new TextureSlotDefinition("UI Backgrounds", "Left bars", "content/ui/imageassetlibraries/global/teambackgrounds/assets/ltbars/tbak_ltbars_{code}"),
            new TextureSlotDefinition("UI Backgrounds", "Right bars", "content/ui/imageassetlibraries/global/teambackgrounds/assets/rtbars/tbak_rtbars_{code}"),
            new TextureSlotDefinition("UI Backgrounds", "Team select (left)", "content/ui/imageassetlibraries/global/teamselectbackgrounds/assets/left/tsb_left_{code}"),
            new TextureSlotDefinition("UI Backgrounds", "Team select (right)", "content/ui/imageassetlibraries/global/teamselectbackgrounds/assets/right/tsb_right_{code}"),
            new TextureSlotDefinition("UI Backgrounds", "Utility background", "content/ui/imageassetlibraries/global/utbackgrounds/assets/utb_{code}"),
            new TextureSlotDefinition("UI Backgrounds", "Dynasty hub background", "content/ui/imageassetlibraries/global/dynastyrtghubbackgrounds/assets/dynasty/drhb_dynasty_{code}"),
            new TextureSlotDefinition("UI Backgrounds", "Road to Glory hub background", "content/ui/imageassetlibraries/global/dynastyrtghubbackgrounds/assets/rtg/drhb_rtg_{code}"),
            new TextureSlotDefinition("UI Backgrounds", "Player card background", "content/ui/imageassetlibraries/global/playercardbackgrounds/assets/pcb_{code}"),
            new TextureSlotDefinition("UI Backgrounds", "Hero photo", "content/ui/imageassetlibraries/global/teamassets/assets/photos/tast_photos_{code}_hero"),
            new TextureSlotDefinition("UI Backgrounds", "Sign 1", "content/ui/imageassetlibraries/global/teamassets/assets/signs/tast_signs_{code}_sign1"),
            new TextureSlotDefinition("UI Backgrounds", "Sign 2", "content/ui/imageassetlibraries/global/teamassets/assets/signs/tast_signs_{code}_sign2"),
            new TextureSlotDefinition("UI Backgrounds", "Sticker pack", "content/ui/imageassetlibraries/global/teamassets/assets/stickerpacks/tast_stickerpacks_{code}"),
            new TextureSlotDefinition("UI Backgrounds", "Sticker 0", "content/ui/imageassetlibraries/global/teamassets/assets/stickers/tast_stickers_{code}_sticker0"),
            new TextureSlotDefinition("UI Backgrounds", "Sticker 1", "content/ui/imageassetlibraries/global/teamassets/assets/stickers/tast_stickers_{code}_sticker1"),
            new TextureSlotDefinition("UI Backgrounds", "Sticker 2", "content/ui/imageassetlibraries/global/teamassets/assets/stickers/tast_stickers_{code}_sticker2"),
        };
    }
}
