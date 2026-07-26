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

        // Confirmed field mapping — see UniformSchema.cs and docs/ebx-uniform-mapping.md. Read
        // directly from the real COLLEGEFOOTBALL27SDK.dll's IL metadata (not a guess ported from
        // another game). e.Item.Name matches by simple property name regardless of how deep the
        // edited field sits in the CharacterUniformJerseyItem/HelmetItem object graph.
        private void PgAsset_OnModified(object sender, ItemModifiedEventArgs e)
        {
            switch (e.Item.Name)
            {
                case UniformSchema.JerseyColorMap:
                case UniformSchema.JerseyMaterialMap:
                case UniformSchema.JerseyNormalMap:
                case UniformSchema.JerseyNumbersArrayMap:
                case UniformSchema.NumberTexture:
                case UniformSchema.NameplateTexture:
                case UniformSchema.NumberWidthAdjustmentList:
                    screen.SetJerseyField(e.Item.Name, e.NewValue);
                    break;

                case UniformSchema.HelmetColorMap:
                case UniformSchema.ShellMaterialMap:
                case UniformSchema.AccessoryMaterialMap:
                case UniformSchema.FacemaskMaterial:
                case UniformSchema.ShellSmoothness:
                case UniformSchema.ShellReflectance:
                case UniformSchema.ShellSparkleReflectance:
                case UniformSchema.CoatSmoothness:
                case UniformSchema.CoatReflectance:
                case UniformSchema.MetalFlakeStrength:
                    screen.SetHelmetField(e.Item.Name, e.NewValue);
                    break;

                case UniformSchema.FacemaskCustomColor1:
                case UniformSchema.FacemaskCustomColor2:
                case UniformSchema.FacemaskCustomColor3:
                case UniformSchema.FacemaskCustomColor4:
                case UniformSchema.ChinstrapColor:
                case UniformSchema.TeamColorsPrimary:
                case UniformSchema.TeamColorsSecondary:
                case UniformSchema.PrimaryColor:
                case UniformSchema.SecondaryColor:
                    screen.SetColorField(e.Item.Name, e.NewValue);
                    break;
            }
        }
    }
}
