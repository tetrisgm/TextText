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
    private async Task<object> ListWorkspaces(CancellationToken ct)
    {
        var identity = account ?? throw new InvalidOperationException("Sign in required");
        var directory = new WorkspaceDirectory(http,Origin,() => Task.FromResult(identity.Token));
        var rows = await directory.ListAsync(ct);
        return new { currentId = ActiveWorkspaceId, workspaces = rows.Select(row => new { id=row.Id,name=row.Name,access=row.Access }) };
    }
    private async Task SwitchWorkspace(JsonElement parameters,CancellationToken ct)
    {
        if(parameters.ValueKind != JsonValueKind.Object || parameters.EnumerateObject().Count()!=1 || !parameters.TryGetProperty("workspaceId",out var value) || value.ValueKind!=JsonValueKind.String)throw new InvalidOperationException("Choose a workspace.");
        if(transitioning || closing)throw new InvalidOperationException("Finish the current operation first.");
        var identity=account ?? throw new InvalidOperationException("Sign in required");
        var id=value.GetString()!;
        transitioning=true;
        try {
            using var deadline=CancellationTokenSource.CreateLinkedTokenSource(ct,lifetime.Token);deadline.CancelAfter(TimeSpan.FromSeconds(30));
            var directory=new WorkspaceDirectory(http,Origin,()=>Task.FromResult(identity.Token));
            var selected=await directory.AuthorizeAsync(id,deadline.Token);
            if(id==ActiveWorkspaceId)return;
            await OpenWorkspace(replacement:selected,prepareCommit:async()=>{
                if(!ReferenceEquals(account,identity))throw new InvalidOperationException("Account changed.");
                if(!await FlushEditor())throw new IOException("Save the current document before switching workspaces.");
                // Discovery may have become stale while WebView prepared or edits flushed.
                await directory.AuthorizeAsync(id,deadline.Token);
                if(!ReferenceEquals(account,identity))throw new InvalidOperationException("Account changed.");
            },beforeCommit:()=>WorkspaceSelection.Save(identity.WorkspaceId,selected));
        } finally {transitioning=false;if(web is not null)web.IsEnabled=true;}
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
            var selected = WorkspaceLocation.Validate(picker.FolderName, Origin.AbsoluteUri, ActiveWorkspaceId);
            if (string.Equals(selected, root, StringComparison.OrdinalIgnoreCase)) return;
            if (!WorkspaceLocation.HasBinding(selected) && Directory.EnumerateFileSystemEntries(selected).Any())
            {
                MessageBox.Show(this, "Choose an empty folder or a folder already connected to this workspace. Existing files can be added after opening the workspace.", "Open workspace folder"); return;
            }
            if (MessageBox.Show(this, $"Use this folder for {ActiveWorkspaceName}? TextText will download this workspace here. Files in the previous folder stay there.", "Open workspace folder", MessageBoxButton.OKCancel) != MessageBoxResult.OK) return;
            if (!await FlushEditor()) { ShowSaveFailure(); return; }
            WorkspaceLocation.Bind(selected, Origin.AbsoluteUri, ActiveWorkspaceId);
            await OpenWorkspace(selected, () => {
                var path = LocationFile(ActiveWorkspaceId); Directory.CreateDirectory(Path.GetDirectoryName(path)!);
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
