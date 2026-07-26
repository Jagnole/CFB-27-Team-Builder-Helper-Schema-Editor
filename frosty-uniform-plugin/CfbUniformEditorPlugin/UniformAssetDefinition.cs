using Frosty.Core;
using Frosty.Core.Controls;
using FrostySdk.Interfaces;

namespace CfbUniformEditorPlugin
{
    public class UniformAssetDefinition : AssetDefinition
    {
        public override FrostyAssetEditor GetEditor(ILogger logger)
        {
            return new FrostyUniformEditor(logger);
        }
    }
}
