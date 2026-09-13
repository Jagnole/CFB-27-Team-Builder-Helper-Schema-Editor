using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using Frosty.Controls;
using Frosty.Core;
using Frosty.Core.Controls;

namespace CfbUniformEditorPlugin.TeamCreator
{
    [TemplatePart(Name = PART_BaseTeamCode, Type = typeof(TextBox))]
    [TemplatePart(Name = PART_BaseTeamVisualsPath, Type = typeof(TextBox))]
    [TemplatePart(Name = PART_TeamName, Type = typeof(TextBox))]
    [TemplatePart(Name = PART_PrefixName, Type = typeof(TextBox))]
    [TemplatePart(Name = PART_BrandName, Type = typeof(TextBox))]
    [TemplatePart(Name = PART_TextureSlotsPanel, Type = typeof(Panel))]
    [TemplatePart(Name = PART_CreateButton, Type = typeof(Button))]
    [TemplatePart(Name = PART_Log, Type = typeof(TextBox))]
    public class TeamCreatorTabItem : FrostyTabItem
    {
        private const string PART_BaseTeamCode = "PART_BaseTeamCode";
        private const string PART_BaseTeamVisualsPath = "PART_BaseTeamVisualsPath";
        private const string PART_TeamName = "PART_TeamName";
        private const string PART_PrefixName = "PART_PrefixName";
        private const string PART_BrandName = "PART_BrandName";
        private const string PART_TextureSlotsPanel = "PART_TextureSlotsPanel";
        private const string PART_CreateButton = "PART_CreateButton";
        private const string PART_Log = "PART_Log";

        private TextBox baseTeamCodeBox;
        private TextBox baseTeamVisualsPathBox;
        private TextBox teamNameBox;
        private TextBox prefixNameBox;
        private TextBox brandNameBox;
        private Panel textureSlotsPanel;
        private Button createButton;
        private TextBox logBox;

        private readonly Dictionary<TextureSlotDefinition, string> selectedFiles = new Dictionary<TextureSlotDefinition, string>();
        private readonly TeamCreatorService service = new TeamCreatorService();

        static TeamCreatorTabItem()
        {
            DefaultStyleKeyProperty.OverrideMetadata(typeof(TeamCreatorTabItem), new FrameworkPropertyMetadata(typeof(TeamCreatorTabItem)));
        }

        public override void OnApplyTemplate()
        {
            base.OnApplyTemplate();

            baseTeamCodeBox = GetTemplateChild(PART_BaseTeamCode) as TextBox;
            baseTeamVisualsPathBox = GetTemplateChild(PART_BaseTeamVisualsPath) as TextBox;
            teamNameBox = GetTemplateChild(PART_TeamName) as TextBox;
            prefixNameBox = GetTemplateChild(PART_PrefixName) as TextBox;
            brandNameBox = GetTemplateChild(PART_BrandName) as TextBox;
            textureSlotsPanel = GetTemplateChild(PART_TextureSlotsPanel) as Panel;
            createButton = GetTemplateChild(PART_CreateButton) as Button;
            logBox = GetTemplateChild(PART_Log) as TextBox;

            BuildTextureSlotRows();

            if (createButton != null)
                createButton.Click += CreateButton_Click;
        }

        private void BuildTextureSlotRows()
        {
            if (textureSlotsPanel == null)
                return;

            textureSlotsPanel.Children.Clear();
            selectedFiles.Clear();

            string lastCategory = null;
            foreach (TextureSlotDefinition slot in TextureSlotDefinitions.All)
            {
                if (slot.Category != lastCategory)
                {
                    lastCategory = slot.Category;
                    textureSlotsPanel.Children.Add(new TextBlock
                    {
                        Text = slot.Category,
                        FontWeight = FontWeights.Bold,
                        Margin = new Thickness(0, 10, 0, 4)
                    });
                }

                Grid row = new Grid { Margin = new Thickness(0, 2, 0, 2) };
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(220) });
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

                TextBlock label = new TextBlock { Text = slot.FriendlyName, VerticalAlignment = VerticalAlignment.Center };
                Grid.SetColumn(label, 0);

                TextBox pathBox = new TextBox { IsReadOnly = true, VerticalContentAlignment = VerticalAlignment.Center, Margin = new Thickness(4, 0, 4, 0) };
                Grid.SetColumn(pathBox, 1);

                Button browseButton = new Button { Content = "Browse...", Padding = new Thickness(8, 2, 8, 2) };
                Grid.SetColumn(browseButton, 2);
                browseButton.Click += (s, e) =>
                {
                    FrostyOpenFileDialog ofd = new FrostyOpenFileDialog("Choose image for " + slot.FriendlyName, "Image Files (*.png;*.dds;*.tga)|*.png;*.dds;*.tga|All Files (*.*)|*.*", "TeamCreator");
                    if (ofd.ShowDialog())
                    {
                        selectedFiles[slot] = ofd.FileName;
                        pathBox.Text = ofd.FileName;
                    }
                };

                row.Children.Add(label);
                row.Children.Add(pathBox);
                row.Children.Add(browseButton);
                textureSlotsPanel.Children.Add(row);
            }
        }

        private void Log(string message)
        {
            if (logBox == null)
                return;
            logBox.AppendText(message + Environment.NewLine);
            logBox.ScrollToEnd();
        }

        private void CreateButton_Click(object sender, RoutedEventArgs e)
        {
            string baseTeamCode = baseTeamCodeBox?.Text?.Trim();
            string baseTeamVisualsPath = baseTeamVisualsPathBox?.Text?.Trim();
            string teamName = teamNameBox?.Text?.Trim();
            string prefixName = prefixNameBox?.Text?.Trim();
            string brandName = brandNameBox?.Text?.Trim();

            if (string.IsNullOrEmpty(baseTeamCode) || string.IsNullOrEmpty(baseTeamVisualsPath))
            {
                Log("Enter both the base team's texture code and its TeamVisuals asset path before creating a team.");
                return;
            }

            Log($"--- Creating team from base '{baseTeamCode}' ---");

            TeamCreatorRequest request = new TeamCreatorRequest
            {
                BaseTeamTextureCode = baseTeamCode,
                BaseTeamVisualsPath = baseTeamVisualsPath,
                TeamName = teamName,
                PrefixName = prefixName,
                BrandName = brandName,
                TextureFiles = selectedFiles.ToDictionary(kv => kv.Key, kv => kv.Value),
            };

            service.CreateTeam(request, Log);
        }
    }
}
