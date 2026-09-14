using System;
using System.Collections.Generic;
using Frosty.Core;
using FrostySdk.IO;
using FrostySdk.Managers;
using FrostySdk.Managers.Entries;

namespace CfbUniformEditorPlugin.TeamCreator
{
    public class TeamCreatorRequest
    {
        public string BaseTeamTextureCode { get; set; }
        public string BaseTeamVisualsPath { get; set; }
        public string TeamName { get; set; }
        public string PrefixName { get; set; }
        public string BrandName { get; set; }
        public Dictionary<TextureSlotDefinition, string> TextureFiles { get; set; }
    }

    /// <summary>
    /// Follows the exact pattern confirmed by reverse-engineering a real custom-team .fbmod (see
    /// docs/team-creator.md): edit the base team's TeamVisuals/texture assets IN PLACE rather than
    /// duplicating them under a new name. That matches what a real, working mod actually did, and
    /// sidesteps needing Frosty's asset-duplication API (GUID/reference handling) for v1.
    /// </summary>
    public class TeamCreatorService
    {
        public void CreateTeam(TeamCreatorRequest request, Action<string> log)
        {
            if (!EditTeamVisuals(request, log))
                return;

            ImportTextures(request, log);

            log("--- Done. Review the changes in the Data Explorer, then Save/Export Mod from Frosty as usual. ---");
        }

        private bool EditTeamVisuals(TeamCreatorRequest request, Action<string> log)
        {
            EbxAssetEntry entry = App.AssetManager.GetEbxEntry(request.BaseTeamVisualsPath);
            if (entry == null)
            {
                log($"Could not find a TeamVisuals asset at '{request.BaseTeamVisualsPath}' -- check the path (copy it from the Data Explorer's right-click > Copy Path).");
                return false;
            }

            EbxAsset asset = App.AssetManager.GetEbx(entry);
            dynamic root = asset.RootObject;

            try
            {
                if (!string.IsNullOrEmpty(request.TeamName))
                    root.AssetName = request.TeamName;
                if (!string.IsNullOrEmpty(request.PrefixName))
                    root.PrefixName = request.PrefixName;
                if (!string.IsNullOrEmpty(request.BrandName))
                    root.BrandName = request.BrandName;
            }
            catch (Exception ex)
            {
                // Field names are provisional (see docs/ebx-uniform-mapping.md) -- if this specific
                // TeamVisuals instance doesn't expose one of these properties, don't silently drop
                // the rest of the edit; surface exactly which field failed.
                log($"Failed to set a TeamVisuals field: {ex.Message}. Double check the field names against this asset's actual properties in the Frosty property grid.");
                return false;
            }

            App.AssetManager.ModifyEbx(entry.Name, asset);
            log($"Updated TeamVisuals fields on '{entry.Name}'.");
            return true;
        }

        private void ImportTextures(TeamCreatorRequest request, Action<string> log)
        {
            foreach (KeyValuePair<TextureSlotDefinition, string> kv in request.TextureFiles)
            {
                TextureSlotDefinition slot = kv.Key;
                string filePath = kv.Value;
                string assetPath = slot.ResolvePath(request.BaseTeamTextureCode);

                string error = TextureImportHelper.Import(assetPath, filePath);
                if (error != null)
                    log($"[{slot.FriendlyName}] FAILED: {error}");
                else
                    log($"[{slot.FriendlyName}] imported into '{assetPath}'.");
            }
        }
    }
}
