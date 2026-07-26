using System.Windows;
using Frosty.Core.Controls;
using FrostySdk.Interfaces;

namespace CfbUniformEditorPlugin
{
    [TemplatePart(Name = PART_AssetPropertyGrid, Type = typeof(FrostyPropertyGrid))]
    [TemplatePart(Name = PART_Renderer, Type = typeof(FrostyViewport))]
    public class FrostyUniformEditor : FrostyAssetEditor
    {
        private const string PART_AssetPropertyGrid = "PART_AssetPropertyGrid";
        private const string PART_Renderer = "PART_Renderer";

        private FrostyPropertyGrid pgAsset;
        private FrostyViewport viewport;
        private readonly UniformPreviewScreen screen = new UniformPreviewScreen();

        public FrostyUniformEditor(ILogger inLogger)
            : base(inLogger)
        {
        }

        public override void OnApplyTemplate()
        {
            base.OnApplyTemplate();

            pgAsset = GetTemplateChild(PART_AssetPropertyGrid) as FrostyPropertyGrid;
            if (pgAsset != null)
            {
                pgAsset.OnModified += PgAsset_OnModified;
            }

            viewport = GetTemplateChild(PART_Renderer) as FrostyViewport;
            if (viewport != null)
            {
                viewport.Screen = screen;
            }
        }

        // Provisional field mapping — see UniformSchema.cs and docs/ebx-uniform-mapping.md. These
        // names are an unverified baseline ported from the Madden 19/20 SDK profiles; they may not
        // match CFB27's real ebx field names until validated against an actual dump.
        private void PgAsset_OnModified(object sender, ItemModifiedEventArgs e)
        {
            switch (e.Item.Name)
            {
                case UniformSchema.JerseyName:
                case UniformSchema.JerseyNumber:
                case UniformSchema.JerseyType:
                case UniformSchema.JerseySleeve:
                case UniformSchema.MixMatchJerseyData:
                    screen.SetJerseyField(e.Item.Name, e.NewValue);
                    break;

                case UniformSchema.HelmetPreset:
                case UniformSchema.PlayerHelmet:
                case UniformSchema.MixMatchHelmetData:
                    screen.SetHelmetField(e.Item.Name, e.NewValue);
                    break;

                case UniformSchema.UniformPrimaryColor:
                case UniformSchema.UniformSecondaryColor:
                    screen.SetColorField(e.Item.Name, e.NewValue);
                    break;
            }
        }
    }
}
