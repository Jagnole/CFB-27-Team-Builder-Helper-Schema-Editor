using Frosty.Controls;
using Frosty.Core;

namespace CfbUniformEditorPlugin.TeamCreator
{
    public class TeamCreatorTabExtension : TabExtension
    {
        public override string TabItemName => "Team Creator";

        public override FrostyTabItem TabContent => new TeamCreatorTabItem();
    }
}
