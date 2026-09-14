using Frosty.Controls;
using Frosty.Core;

namespace CfbUniformEditorPlugin.TeamCreator
{
    public class TeamCreatorTabExtension : TabExtension
    {
        public override string TabItemName => "Team Replacer";

        public override FrostyTabItem TabContent => new TeamCreatorTabItem();
    }
}
