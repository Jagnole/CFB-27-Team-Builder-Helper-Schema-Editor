using System;
using System.Collections.Generic;
using System.Linq;
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
    /// The game has no "add a team" path -- every custom team a player can actually load is one of
    /// the game's existing teams with its assets overwritten. So this tool's job is: pick one of
    /// those existing teams, load what it currently has, and replace whichever pieces the user
    /// wants to change. It follows the exact pattern confirmed by reverse-engineering a real
    /// custom-team .fbmod (see docs/team-creator.md): edit the base team's TeamVisuals/texture
    /// assets IN PLACE rather than duplicating them under a new name -- that matches what a real,
    /// working mod actually did, and sidesteps needing Frosty's asset-duplication API (GUID/
    /// reference handling) entirely.
    /// </summary>
    public class TeamCreatorService
    {
        private const string TeamVisualsEbxType = "TeamVisuals";
        private const string TextureCodeScanPrefix = "tmlg_ncaa_primary_";

        /// <summary>
        /// Every existing team a player could pick to replace, for the "1. Pick a team" dropdown.
        /// </summary>
        public List<EbxAssetEntry> EnumerateBaseTeams()
        {
            return App.AssetManager.EnumerateEbx(type: TeamVisualsEbxType)
                .OrderBy(e => e.Filename, StringComparer.OrdinalIgnoreCase)
                .ToList();
        }

        /// <summary>
        /// Candidate texture-suffix codes, scraped from every tmlg_ncaa_primary_&lt;code&gt; asset
        /// that actually exists. Not guaranteed to match a given TeamVisuals asset's own short name
        /// (see docs/team-creator.md) -- this is a pick-list to save hand-searching the Data
        /// Explorer, not an authoritative lookup.
        /// </summary>
        public List<string> EnumerateTextureCodeCandidates()
        {
            List<string> codes = new List<string>();
            foreach (ResAssetEntry entry in App.AssetManager.EnumerateRes())
            {
                string filename = entry.Filename;
                if (filename.StartsWith(TextureCodeScanPrefix, StringComparison.OrdinalIgnoreCase))
                    codes.Add(filename.Substring(TextureCodeScanPrefix.Length));
            }
            codes.Sort(StringComparer.OrdinalIgnoreCase);
            return codes;
        }

        /// <summary>
        /// Reads whatever this team's TeamVisuals currently has for the identity fields, so the UI
        /// can show "what's there now" instead of blank boxes before the user replaces any of it.
        /// Best-effort: a missing/renamed field comes back as null rather than throwing, since this
        /// is just pre-filling a form, not the authoritative write path (EditTeamVisuals still
        /// surfaces a hard error if a field name turns out to be wrong when actually saving).
        /// </summary>
        public void ReadCurrentIdentity(EbxAssetEntry entry, out string teamName, out string prefixName, out string brandName)
        {
            teamName = null;
            prefixName = null;
            brandName = null;

            EbxAsset asset = App.AssetManager.GetEbx(entry);
            dynamic root = asset.RootObject;

            teamName = TryReadString(() => (string)root.AssetName);
            prefixName = TryReadString(() => (string)root.PrefixName);
            brandName = TryReadString(() => (string)root.BrandName);
        }

        private static string TryReadString(Func<string> read)
        {
            try { return read(); }
            catch { return null; }
        }

        public void ReplaceTeamAssets(TeamCreatorRequest request, Action<string> log)
        {
            // Top-level safety net: anything unexpected here becomes a log line instead of an
            // unhandled exception, which Frosty's own top-level handler shows as a bare, useless
            // "Object reference not set..." dialog with no indication of what actually broke.
            try
            {
                if (!EditTeamVisuals(request, log))
                    return;

                ImportTextures(request, log);

                log("--- Done. Review the changes in the Data Explorer, then Save/Export Mod from Frosty as usual. ---");
            }
            catch (Exception ex)
            {
                log($"Unexpected error: {ex.Message}");
            }
        }

        private bool EditTeamVisuals(TeamCreatorRequest request, Action<string> log)
        {
            EbxAssetEntry entry = App.AssetManager.GetEbxEntry(request.BaseTeamVisualsPath);
            if (entry == null)
            {
                log($"Could not find a TeamVisuals asset at '{request.BaseTeamVisualsPath}' -- check the path (copy it from the Data Explorer's right-click > Copy Path).");
                return false;
            }

            try
            {
                EbxAsset asset = App.AssetManager.GetEbx(entry);
                dynamic root = asset.RootObject;

                if (!string.IsNullOrEmpty(request.TeamName))
                    root.AssetName = request.TeamName;
                if (!string.IsNullOrEmpty(request.PrefixName))
                    root.PrefixName = request.PrefixName;
                if (!string.IsNullOrEmpty(request.BrandName))
                    root.BrandName = request.BrandName;

                App.AssetManager.ModifyEbx(entry.Name, asset);
            }
            catch (Exception ex)
            {
                // Field names are provisional (see docs/ebx-uniform-mapping.md) -- if this specific
                // TeamVisuals instance doesn't expose one of these properties, don't silently drop
                // the rest of the edit; surface exactly which field failed.
                log($"Failed to set a TeamVisuals field: {ex.Message}. Double check the field names against this asset's actual properties in the Frosty property grid.");
                return false;
            }

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

                string error;
                try
                {
                    error = TextureImportHelper.Import(assetPath, filePath);
                }
                catch (Exception ex)
                {
                    error = $"Unexpected error: {ex.Message}";
                }

                if (error != null)
                    log($"[{slot.FriendlyName}] FAILED: {error}");
                else
                    log($"[{slot.FriendlyName}] imported into '{assetPath}'.");
            }
        }
    }
}
