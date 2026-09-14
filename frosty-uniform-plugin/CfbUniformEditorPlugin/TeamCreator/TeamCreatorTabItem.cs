using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using Frosty.Controls;
using Frosty.Core;
using Frosty.Core.Controls;
using FrostySdk.Managers.Entries;

namespace CfbUniformEditorPlugin.TeamCreator
{
    [TemplatePart(Name = PART_BaseTeamPicker, Type = typeof(ComboBox))]
    [TemplatePart(Name = PART_LoadTeamButton, Type = typeof(Button))]
    [TemplatePart(Name = PART_BaseTeamCode, Type = typeof(ComboBox))]
    [TemplatePart(Name = PART_BaseTeamVisualsPath, Type = typeof(TextBox))]
    [TemplatePart(Name = PART_TeamName, Type = typeof(TextBox))]
    [TemplatePart(Name = PART_PrefixName, Type = typeof(TextBox))]
    [TemplatePart(Name = PART_BrandName, Type = typeof(TextBox))]
    [TemplatePart(Name = PART_TextureSlotsPanel, Type = typeof(Panel))]
    [TemplatePart(Name = PART_CreateButton, Type = typeof(Button))]
    [TemplatePart(Name = PART_Log, Type = typeof(TextBox))]
    public class TeamCreatorTabItem : FrostyTabItem
    {
        private const string PART_BaseTeamPicker = "PART_BaseTeamPicker";
        private const string PART_LoadTeamButton = "PART_LoadTeamButton";
        private const string PART_BaseTeamCode = "PART_BaseTeamCode";
        private const string PART_BaseTeamVisualsPath = "PART_BaseTeamVisualsPath";
        private const string PART_TeamName = "PART_TeamName";
        private const string PART_PrefixName = "PART_PrefixName";
        private const string PART_BrandName = "PART_BrandName";
        private const string PART_TextureSlotsPanel = "PART_TextureSlotsPanel";
        private const string PART_CreateButton = "PART_CreateButton";
        private const string PART_Log = "PART_Log";

        private ComboBox baseTeamPicker;
        private Button loadTeamButton;
        private ComboBox baseTeamCodeBox;
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

            baseTeamPicker = GetTemplateChild(PART_BaseTeamPicker) as ComboBox;
            loadTeamButton = GetTemplateChild(PART_LoadTeamButton) as Button;
            baseTeamCodeBox = GetTemplateChild(PART_BaseTeamCode) as ComboBox;
            baseTeamVisualsPathBox = GetTemplateChild(PART_BaseTeamVisualsPath) as TextBox;
            teamNameBox = GetTemplateChild(PART_TeamName) as TextBox;
            prefixNameBox = GetTemplateChild(PART_PrefixName) as TextBox;
            brandNameBox = GetTemplateChild(PART_BrandName) as TextBox;
            textureSlotsPanel = GetTemplateChild(PART_TextureSlotsPanel) as Panel;
            createButton = GetTemplateChild(PART_CreateButton) as Button;
            logBox = GetTemplateChild(PART_Log) as TextBox;

            BuildTextureSlotRows();
            PopulateBaseTeamPicker();
            PopulateTextureCodeCandidates();

            if (loadTeamButton != null)
                loadTeamButton.Click += LoadTeamButton_Click;
            if (createButton != null)
                createButton.Click += CreateButton_Click;
        }

        private void PopulateBaseTeamPicker()
        {
            if (baseTeamPicker == null)
                return;

            try
            {
                List<EbxAssetEntry> teams = service.EnumerateBaseTeams();
                baseTeamPicker.DisplayMemberPath = "DisplayName";
                baseTeamPicker.ItemsSource = teams;
                if (teams.Count == 0)
                    Log("No TeamVisuals assets found -- is a CollegeFootball27 install actually loaded?");
            }
            catch (Exception ex)
            {
                Log($"Could not list existing teams: {ex.Message}");
            }
        }

        private void PopulateTextureCodeCandidates()
        {
            if (baseTeamCodeBox == null)
                return;

            try
            {
                baseTeamCodeBox.ItemsSource = service.EnumerateTextureCodeCandidates();
            }
            catch (Exception ex)
            {
                Log($"Could not scan for texture-suffix codes: {ex.Message}");
            }
        }

        private void LoadTeamButton_Click(object sender, RoutedEventArgs e)
        {
            EbxAssetEntry entry = baseTeamPicker?.SelectedItem as EbxAssetEntry;
            if (entry == null)
            {
                Log("Pick a team from the list above first.");
                return;
            }

            if (baseTeamVisualsPathBox != null)
                baseTeamVisualsPathBox.Text = entry.Name;

            try
            {
                service.ReadCurrentIdentity(entry, out string teamName, out string prefixName, out string brandName);
                if (teamNameBox != null) teamNameBox.Text = teamName;
                if (prefixNameBox != null) prefixNameBox.Text = prefixName;
                if (brandNameBox != null) brandNameBox.Text = brandName;
            }
            catch (Exception ex)
            {
                Log($"Loaded the path, but couldn't read current identity fields: {ex.Message}. You can still fill them in by hand.");
                return;
            }

            Log($"Loaded '{entry.DisplayName}'. Current identity fields are shown below -- edit whichever you want to change, pick or browse a texture-suffix code, choose replacement images, then click Replace Team Assets.");
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
                Log("Pick a team to replace (and Load Team) and choose a texture-suffix code before replacing anything.");
                return;
            }

            Log($"--- Replacing assets on '{baseTeamVisualsPath}' (texture code '{baseTeamCode}') ---");

            TeamCreatorRequest request = new TeamCreatorRequest
            {
                BaseTeamTextureCode = baseTeamCode,
                BaseTeamVisualsPath = baseTeamVisualsPath,
                TeamName = teamName,
                PrefixName = prefixName,
                BrandName = brandName,
                TextureFiles = selectedFiles.ToDictionary(kv => kv.Key, kv => kv.Value),
            };

            service.ReplaceTeamAssets(request, Log);
        }
    }
}
