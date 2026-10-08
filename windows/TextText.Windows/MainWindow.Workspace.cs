using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Input;
using System.Windows.Controls;
using TextText.Core;
namespace TextText.Windows;

public sealed partial class MainWindow
{
    private void SetWorkspaceContent(UIElement content)
    {
        var layout = new DockPanel();
        var menu = new Menu(); var file = new MenuItem { Header = "_File" };
        var open = new MenuItem { Header = "Open workspace folder", InputGestureText = "Ctrl+Shift+O", IsEnabled = account is not null };
        open.Click += async (_, _) => await ChooseWorkspaceFolder();
        file.Items.Add(open); menu.Items.Add(file); DockPanel.SetDock(menu, Dock.Top);
        layout.Children.Add(menu); layout.Children.Add(content); Content = layout;
    }
    private void ShowWorkspaceUnavailable()
    {
        var panel = new StackPanel { Width = 380, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        panel.Children.Add(new TextBlock { Text = "Your workspace folder is unavailable. Choose its folder to continue.", TextWrapping = TextWrapping.Wrap });
        var button = new Button { Content = "Open workspace folder", Margin = new Thickness(0,16,0,0) };
        button.Click += async (_, _) => await ChooseWorkspaceFolder(); panel.Children.Add(button);
        SetWorkspaceContent(panel);
    }
    private static string LocationFile(string id) => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "TextText", "Locations", id + ".json");
    private static string WorkspaceRoot(string id)
    {
        var path = LocationFile(id);
        if (!File.Exists(path)) return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "TextText", id);
        var selected = JsonSerializer.Deserialize<string>(File.ReadAllBytes(path)) ?? throw new IOException("Workspace folder unavailable.");
        return WorkspaceLocation.Validate(selected, Origin.AbsoluteUri, id);
    }
    public async Task ChooseWorkspaceFolder(string? initialDirectory = null)
    {
        if (transitioning || closing || account is null) return;
        var picker = new Microsoft.Win32.OpenFolderDialog { Title = "Open workspace folder", Multiselect = false };
        if (initialDirectory is not null && Directory.Exists(initialDirectory)) picker.InitialDirectory = initialDirectory;
        if (picker.ShowDialog(this) != true) return;
        transitioning = true;
        try
        {
            var selected = WorkspaceLocation.Validate(picker.FolderName, Origin.AbsoluteUri, account.WorkspaceId);
            if (string.Equals(selected, root, StringComparison.OrdinalIgnoreCase)) return;
            if (!WorkspaceLocation.HasBinding(selected) && Directory.EnumerateFileSystemEntries(selected).Any())
            {
                MessageBox.Show(this, "Choose an empty folder or a folder already connected to this workspace. Existing files can be added after opening the workspace.", "Open workspace folder"); return;
            }
            if (MessageBox.Show(this, $"Use this folder for {account.Name}? TextText will download this workspace here. Files in the previous folder stay there.", "Open workspace folder", MessageBoxButton.OKCancel) != MessageBoxResult.OK) return;
            if (!await FlushEditor()) { ShowSaveFailure(); return; }
            WorkspaceLocation.Bind(selected, Origin.AbsoluteUri, account.WorkspaceId);
            await OpenWorkspace(selected, () => {
                var path = LocationFile(account.WorkspaceId); Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                var temporary = path + ".pending";
                File.WriteAllBytes(temporary, JsonSerializer.SerializeToUtf8Bytes(selected));
                File.Move(temporary, path, true);
            });
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or InvalidOperationException or System.Runtime.InteropServices.COMException)
        {
            // The old folder and its durable journal remain intact on every failure.
            // OpenWorkspace prepares the replacement before retiring the current view.
            MessageBox.Show(this, "This folder could not be opened. Your previous workspace files have been kept.", "Open workspace folder");
        }
        finally { transitioning = false; if (web is not null) web.IsEnabled = true; }
    }
}
internal sealed class OpenFolderCommand(MainWindow window) : ICommand
{
    public event EventHandler? CanExecuteChanged { add { } remove { } }
    public bool CanExecute(object? parameter) => true;
    public async void Execute(object? parameter) => await window.ChooseWorkspaceFolder();
}
