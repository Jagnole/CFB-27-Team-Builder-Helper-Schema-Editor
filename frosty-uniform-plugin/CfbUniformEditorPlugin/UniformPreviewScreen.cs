using Frosty.Core;
using Frosty.Core.Viewport;
using SharpDX;

namespace CfbUniformEditorPlugin
{
    /// <summary>
    /// Placeholder live-preview screen. No real CFB27 mesh/material resource types are known yet
    /// (see ../docs/ebx-uniform-mapping.md), so for now this only clears the viewport to a flat
    /// swatch driven by the jersey's primary/secondary color fields — it proves the wiring from
    /// property-grid edits through to the render loop. Replace with an actual mesh render once
    /// the real resource types are confirmed (see MeshSetPlugin.Screens.MultiMeshPreviewScreen in
    /// the FrostyToolsuite submodule for that pattern).
    /// </summary>
    public class UniformPreviewScreen : Screen
    {
        private Color4 swatchColor = new Color4(0.35f, 0.35f, 0.4f, 1.0f);

        public override void Update(double timestep)
        {
        }

        public override void Render()
        {
            Viewport.Context.ClearRenderTargetView(Viewport.ColorBufferRTV, swatchColor);
        }

        public void SetJerseyField(string fieldName, object value)
        {
            App.Logger.Log($"Uniform preview: jersey field '{fieldName}' changed (mesh rendering not wired up yet)");
        }

        public void SetHelmetField(string fieldName, object value)
        {
            App.Logger.Log($"Uniform preview: helmet field '{fieldName}' changed (mesh rendering not wired up yet)");
        }

        public void SetColorField(string fieldName, object value)
        {
            // Two confirmed shapes in the real CFB27 SDK (see docs/ebx-uniform-mapping.md):
            // NFLTeamAsset.PrimaryColor/SecondaryColor and ChinstrapColor/FacemaskCustomColorN are
            // Vec3/Vec4 (lowercase x/y/z), but TeamColors.Primary/Secondary is ColorRgb
            // (capitalized R/G/B). Try both rather than guessing one.
            try
            {
                dynamic c = value;
                swatchColor = new Color4((float)c.x, (float)c.y, (float)c.z, 1.0f);
                return;
            }
            catch
            {
                // not a Vec3/Vec4 shape — fall through and try ColorRgb below
            }

            try
            {
                dynamic c = value;
                swatchColor = new Color4((float)c.R, (float)c.G, (float)c.B, 1.0f);
                return;
            }
            catch
            {
                App.Logger.LogWarning($"Uniform preview: couldn't read '{fieldName}' as a color — neither the Vec3/Vec4 (x/y/z) nor ColorRgb (R/G/B) shape matched (see docs/ebx-uniform-mapping.md)");
            }
        }
    }
}
