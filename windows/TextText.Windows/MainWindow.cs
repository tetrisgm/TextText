using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net.Http;
using System.IO;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using TextText.Core;
namespace TextText.Windows;

public sealed record WorkspaceContext(string Root, string WorkspaceId, Uri Origin, Func<Task<string>> TokenProvider, Func<string,object?,Task> Emit, string Access = "owner");
public sealed partial class MainWindow : Window
{
    public static Func<WorkspaceContext, INativeWorkspaceBridge>? WorkspaceFactory { get; set; }
    private static readonly Uri Origin = new("https://texttext.app");
    private readonly HttpClient http = new(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(60) };
    private readonly ConcurrentDictionary<string,CancellationTokenSource> requests = new();
    private readonly CancellationTokenSource lifetime = new();
    private Account? account;
    private AvailableWorkspace? selectedWorkspace;
    private string ActiveWorkspaceId => selectedWorkspace?.Id ?? account?.WorkspaceId ?? "";
    private string ActiveWorkspaceName => selectedWorkspace?.Name ?? account?.Name ?? "Workspace";
    private WebView2? web;
    private INativeWorkspaceBridge? bridge;
    private string root = "";
    private bool closing, transitioning;
    private readonly RendererFlushGuard flushGuard = new();
    public MainWindow()
    {
        Title = "TextText"; Width = 1200; Height = 850; MinWidth = 720; MinHeight = 480;
        Loaded += async (_,_) => {
            try { account = CredentialStore.Load(); if(account is not null) { selectedWorkspace = WorkspaceSelection.Load(account.WorkspaceId); await OpenWorkspace(); } else ShowLogin(); }
            catch { if (account is not null) ShowWorkspaceUnavailable(); else ShowLogin("Your saved sign-in could not be opened. Please sign in again."); }
        };
        Closing += (_,e) => {
            if(closing) return;
            if(web?.CoreWebView2 is not null) { e.Cancel = true; _ = RequestClose(); }
            else closing = true;
        };
        Closed += (_,_) => { lifetime.Cancel(); foreach(var request in requests.Values) request.Cancel(); bridge?.Dispose(); web?.Dispose(); http.Dispose(); };
    }
    private async Task<bool> FlushEditor()
    {
        if(web?.CoreWebView2 is not { } core) return true;
        web.IsEnabled = false;
        return await flushGuard.FlushAsync(async script => { await core.ExecuteScriptAsync(script); });
    }
    private void ShowSaveFailure() => MessageBox.Show(this,"Your latest edits have not finished saving. TextText will stay open so you can resolve the save in the editor.","Keep editing",MessageBoxButton.OK,MessageBoxImage.Information);
    private async Task RequestClose()
    {
        if(transitioning || closing) return;
        transitioning = true;
        try {
            if(!await FlushEditor()) { ShowSaveFailure(); return; }
            closing = true; Close();
        } finally { transitioning = false; if(!closing && web is not null) web.IsEnabled = true; }
    }
    private void ShowLogin(string message = "Sign in to open your TextText workspace.")
    {
        var panel = new StackPanel { Width = 360, VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Center };
        panel.Children.Add(new TextBlock { Text = "TextText", FontSize = 30, Margin = new Thickness(0,0,0,20) });
        var status = new TextBlock { Text = message, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0,0,0,16) };
        panel.Children.Add(status);
        var button = new Button { Content = "Sign in", Padding = new Thickness(16,10,16,10) };
        button.Click += async (_,_) => {
            button.IsEnabled = false;
            try { status.Text = "Finish signing in in your browser."; await Login(lifetime.Token); await OpenWorkspace(); }
            catch(OperationCanceledException) { status.Text = "Sign-in expired. Please try again."; }
            catch { status.Text = "Could not finish signing in. Please try again."; }
            finally { button.IsEnabled = true; }
        };
        panel.Children.Add(button); SetWorkspaceContent(panel);
    }
    private async Task Login(CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromMinutes(10));
        using var start = await http.PostAsJsonAsync(new Uri(Origin,"/api/link/start"), new { name = "TextText on Windows" }, timeout.Token);
        start.EnsureSuccessStatusCode();
        using var link = JsonDocument.Parse(await start.Content.ReadAsStringAsync(timeout.Token));
        var verify = new Uri(link.RootElement.GetProperty("verifyUrl").GetString()!);
        if(verify.GetLeftPart(UriPartial.Authority) != Origin.GetLeftPart(UriPartial.Authority) || verify.AbsolutePath != "/connect/link") throw new InvalidOperationException("Invalid sign-in URL");
        var pollToken = link.RootElement.GetProperty("pollToken").GetString();
        OpenExternal(verify.AbsoluteUri);
        while(true)
        {
            await Task.Delay(TimeSpan.FromSeconds(3),timeout.Token);
            using var response = await http.PostAsJsonAsync(new Uri(Origin,"/api/link/poll"),new { pollToken },timeout.Token);
            response.EnsureSuccessStatusCode();
            using var result = JsonDocument.Parse(await response.Content.ReadAsStringAsync(timeout.Token));
            var status = result.RootElement.GetProperty("status").GetString();
            if(status == "expired") throw new OperationCanceledException();
            if(status != "approved") continue;
            var token = result.RootElement.GetProperty("token").GetString()!;
            using var request = new HttpRequestMessage(HttpMethod.Get,new Uri(Origin,"/api/vault"));
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer",token);
            using var workspace = await http.SendAsync(request,timeout.Token); workspace.EnsureSuccessStatusCode();
            using var data = JsonDocument.Parse(await workspace.Content.ReadAsStringAsync(timeout.Token));
            var id = data.RootElement.GetProperty("workspaceId").GetString()!;
            if(!Guid.TryParse(id,out _)) throw new InvalidOperationException("Invalid workspace");
            account = new Account(token,id,data.RootElement.GetProperty("name").GetString() ?? "Workspace");
            CredentialStore.Save(account); return;
        }
    }
    private async Task OpenWorkspace(string? selectedRoot = null, Action? beforeCommit = null, AvailableWorkspace? replacement = null, Func<Task>? prepareCommit = null)
    {
        var identity = account ?? throw new InvalidOperationException("Sign in required");
        var active = identity with { WorkspaceId = replacement?.Id ?? ActiveWorkspaceId, Name = replacement?.Name ?? ActiveWorkspaceName };
        if(!Guid.TryParse(active.WorkspaceId,out _)) throw new InvalidOperationException("Invalid workspace");
        var nextRoot = selectedRoot ?? WorkspaceRoot(active.WorkspaceId);
        Directory.CreateDirectory(nextRoot);
        WorkspaceLocation.Bind(nextRoot, Origin.AbsoluteUri, active.WorkspaceId);
        var nextWeb = new WebView2 { Width = 1, Height = 1, IsHitTestVisible = false };
        // WPF WebView2 initialization requires a live presentation source.
        // Stage it behind the current content rather than awaiting an unattached view.
        var previousContent = Content as UIElement;
        Content = null;
        var staging = new Grid();
        staging.Children.Add(nextWeb);
        if (previousContent is not null) staging.Children.Add(previousContent);
        Content = staging;
        INativeWorkspaceBridge? nextBridge = null;
        try
        {
        var profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"TextText","WebView2",active.WorkspaceId);
        var environment = await CoreWebView2Environment.CreateAsync(null,profile);
        await nextWeb.EnsureCoreWebView2Async(environment);
        var core = nextWeb.CoreWebView2;
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.AreHostObjectsAllowed = false;
        core.Settings.IsPasswordAutosaveEnabled = false;
        core.Settings.IsGeneralAutofillEnabled = false;
        core.SetVirtualHostNameToFolderMapping("texttext.local",Path.Combine(AppContext.BaseDirectory,"Assets"),CoreWebView2HostResourceAccessKind.DenyCors);
        core.NavigationStarting += (_,e) => { if(!IsLocal(e.Uri)) { e.Cancel = true; OpenExternal(e.Uri); } };
        core.NewWindowRequested += (_,e) => { e.Handled = true; OpenExternal(e.Uri); };
        core.PermissionRequested += (_,e) => e.State = CoreWebView2PermissionState.Deny;
        core.DownloadStarting += (_,e) => {
            // Shared gallery/recovery exports are generated by our own renderer.
            // Keep remote and navigated content from initiating downloads.
            var source = e.DownloadOperation.Uri;
            if(!IsLocal(core.Source) || !(source.StartsWith("blob:https://texttext.local/",StringComparison.Ordinal) || source.StartsWith("data:",StringComparison.Ordinal))) { e.Cancel = true; return; }
            var dialog = new Microsoft.Win32.SaveFileDialog { FileName = Path.GetFileName(e.ResultFilePath), Title = "Save file", OverwritePrompt = true };
            e.Handled = true;
            if(dialog.ShowDialog(this) == true) e.ResultFilePath = dialog.FileName;
            else e.Cancel = true;
        };
        core.WindowCloseRequested += (_,_) => { _ = RequestClose(); };
        core.WebMessageReceived += Receive;
        if (prepareCommit is not null) await prepareCommit();
        nextBridge = WorkspaceFactory?.Invoke(new(nextRoot, active.WorkspaceId, Origin,
            () => Task.FromResult(active.Token),
            (name, detail) => EmitForView(nextWeb, name, detail), replacement?.Access ?? selectedWorkspace?.Access ?? "owner"));
        beforeCommit?.Invoke();
        var oldWeb = web; var oldBridge = bridge;
        if (oldWeb?.CoreWebView2 is { } oldCore) oldCore.WebMessageReceived -= Receive;
        foreach (var request in requests.Values) request.Cancel();
        root = nextRoot; web = nextWeb; bridge = nextBridge;
        if (replacement is not null) selectedWorkspace = replacement;
        staging.Children.Remove(nextWeb);
        nextWeb.Width = double.NaN; nextWeb.Height = double.NaN; nextWeb.IsHitTestVisible = true;
        SetWorkspaceContent(nextWeb);
        oldBridge?.Dispose(); oldWeb?.Dispose();
        core.Navigate("https://texttext.local/index.html");
        }
        catch {
            if (!ReferenceEquals(web, nextWeb)) {
                nextBridge?.Dispose(); nextWeb.Dispose();
                if (previousContent is not null) staging.Children.Remove(previousContent);
                Content = previousContent;
            }
            throw;
        }
    }
    private static bool IsLocal(string url) => Uri.TryCreate(url,UriKind.Absolute,out var uri) && uri.Scheme == "https" && uri.Host == "texttext.local" && uri.IsDefaultPort;
    private static void OpenExternal(string url)
    {
        if(Uri.TryCreate(url,UriKind.Absolute,out var uri) && (uri.Scheme == "https" || uri.Scheme == "http")) Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
    }
    private async void Receive(object? sender,CoreWebView2WebMessageReceivedEventArgs e)
    {
        if(!ReferenceEquals(sender, web?.CoreWebView2) || !IsLocal(e.Source)) return;
        string? id = null, method = null;
        try {
            using var message = JsonDocument.Parse(e.WebMessageAsJson);
            var input = message.RootElement;
            id = input.GetProperty("id").GetString();
            if(string.IsNullOrEmpty(id) || id.Length > 128) return;
            method = input.GetProperty("method").GetString()!;
            var parameters = input.TryGetProperty("params",out var p) ? p.Clone() : JsonSerializer.SerializeToElement(new {});
            if(method == "native.fileOpenResult") { AcceptFileOpen(id, parameters); return; }
            if(method == "native.flushResult") { flushGuard.Accept(id,parameters.TryGetProperty("ok",out var ok) && ok.ValueKind == JsonValueKind.True); return; }
            using var cancellation = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
            if(!requests.TryAdd(id,cancellation)) return;
            try { var result = await Dispatch(method,parameters,cancellation.Token); if (ReferenceEquals(sender, web?.CoreWebView2)) Reply(new { id,result }); }
            finally { requests.TryRemove(id,out _); }
        }
        catch(OperationCanceledException) { ReplyForSource(sender, new { id,error = new { message = "Request cancelled",code = "CANCELLED" } }); }
        catch(FileChangedException) { ReplyForSource(sender, new { id,error = new { message = "This file changed. Its current contents have been preserved.",code = method?.StartsWith("collaboration.") == true ? "local_changed" : "conflict" } }); }
        catch(SharedSessionClosedException) { ReplyForSource(sender, new { id,error = new { message = "This editing session has closed.",code = "session_closed" } }); }
        catch(FileNotFoundException) { ReplyForSource(sender, new { id,error = new { message = "This file is not available on this device yet.",code = "not_found" } }); }
        catch(NotSupportedException error) { ReplyForSource(sender, new { id,error = new { message = error.Message,code = "unsupported" } }); }
        catch { ReplyForSource(sender, new { id,error = new { message = "The operation could not be completed. Please try again.",code = "NATIVE_ERROR" } }); }
    }
    private async Task<object?> Dispatch(string method,JsonElement p,CancellationToken ct)
    {
        switch(method)
        {
            case "native.status": return new { workspaceId = ActiveWorkspaceId,root,name = ActiveWorkspaceName,connected = account is not null,available = true };
            case "native.cancel": if(p.TryGetProperty("requestId",out var request) && requests.TryGetValue(request.GetString() ?? "",out var cancellation)) cancellation.Cancel(); return null;
            case "native.http": return await Http(p,ct);
            case "native.openWeb": OpenExternal(new Uri(Origin,"/vault/" + ActiveWorkspaceId).AbsoluteUri); return null;
            case "native.recovery": {
                // The renderer cannot choose a shell path. Resolve only the
                // current native workspace's validated recovery directory.
                var directory = bridge is null ? null : await bridge.InvokeAsync("files.recoveryDirectory",JsonSerializer.SerializeToElement(new {}),ct) as string;
                if (directory is null || !Path.IsPathFullyQualified(directory)) throw new InvalidOperationException("Recovery location is unavailable.");
                Process.Start(new ProcessStartInfo(directory) { UseShellExecute = true }); return null;
            }
            case "native.openFolder": Process.Start(new ProcessStartInfo(root) { UseShellExecute = true }); return null;
            case "native.workspacesList": return await ListWorkspaces(ct);
            case "native.workspaceOpen": await SwitchWorkspace(p,ct); return null;
            case "native.chooseWorkspaceFolder": await ChooseWorkspaceFolder(); return null;
            case "native.settings": MessageBox.Show(this,$"{account?.Name}\n\nFiles: {root}","TextText settings",MessageBoxButton.OK,MessageBoxImage.Information); return null;
            case "native.signOut":
                if(MessageBox.Show(this,"Log out of TextText? Your saved files remain on this computer.","TextText",MessageBoxButton.OKCancel) != MessageBoxResult.OK) return null;
                if(transitioning) return null;
                transitioning = true;
                try {
                    if(!await FlushEditor()) { ShowSaveFailure(); return null; }
                    foreach(var pending in requests.Values) pending.Cancel();
                    CredentialStore.Clear(); bridge?.Dispose(); bridge = null; account = null; selectedWorkspace = null;
                    _ = Dispatcher.BeginInvoke(() => { web?.Dispose(); web = null; ShowLogin(); });
                } finally { transitioning = false; if(web is not null) web.IsEnabled = true; }
                return null;
            default: return bridge is null ? throw new InvalidOperationException("Workspace unavailable") : await bridge.InvokeAsync(method,p,ct);
        }
    }
    private async Task<object> Http(JsonElement p,CancellationToken ct)
    {
        var active = account ?? throw new InvalidOperationException("Sign in required");
        var path = p.TryGetProperty("path",out var pathElement) ? pathElement.GetString() : p.GetProperty("url").GetString();
        if(path is null || !path.StartsWith('/') || path.StartsWith("//") || path.Contains('\\')) throw new InvalidOperationException("Invalid API path");
        var uri = new Uri(Origin,path);
        var allowed = "/api/vault/" + ActiveWorkspaceId;
        if(uri.GetLeftPart(UriPartial.Authority) != Origin.GetLeftPart(UriPartial.Authority) || !(uri.AbsolutePath == allowed || uri.AbsolutePath.StartsWith(allowed + "/",StringComparison.Ordinal) || uri.AbsolutePath == "/api/vault/extract")) throw new InvalidOperationException("API path outside workspace");
        var method = p.GetProperty("method").GetString()!.ToUpperInvariant();
        if(method is not ("GET" or "HEAD" or "POST" or "PUT" or "PATCH" or "DELETE")) throw new InvalidOperationException("Unsupported method");
        using var request = new HttpRequestMessage(new HttpMethod(method),uri);
        if(p.TryGetProperty("body",out var body) && body.ValueKind == JsonValueKind.String) request.Content = new ByteArrayContent(Convert.FromBase64String(body.GetString()!));
        if(p.TryGetProperty("headers",out var headers)) foreach(var header in headers.EnumerateObject()) {
            if(header.Name.Equals("Content-Type",StringComparison.OrdinalIgnoreCase)) request.Content?.Headers.TryAddWithoutValidation(header.Name,header.Value.GetString());
            else if(header.Name.Equals("If-Match",StringComparison.OrdinalIgnoreCase) || header.Name.Equals("If-None-Match",StringComparison.OrdinalIgnoreCase) || header.Name.Equals("Accept",StringComparison.OrdinalIgnoreCase) || header.Name.StartsWith("X-TextText-",StringComparison.OrdinalIgnoreCase)) request.Headers.TryAddWithoutValidation(header.Name,header.Value.GetString());
        }
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer",active.Token);
        using var response = await http.SendAsync(request,HttpCompletionOption.ResponseHeadersRead,ct);
        const int limit = 64 * 1024 * 1024;
        if(response.Content.Headers.ContentLength > limit) throw new InvalidDataException("Response exceeds size limit.");
        using var input = await response.Content.ReadAsStreamAsync(ct); using var output = new MemoryStream();
        var buffer = new byte[65536]; int count;
        while((count = await input.ReadAsync(buffer,ct)) > 0) { if(output.Length + count > limit) throw new InvalidDataException("Response exceeds size limit."); output.Write(buffer,0,count); }
        return new { status = (int)response.StatusCode, headers = response.Headers.Concat(response.Content.Headers).Where(h => !h.Key.Equals("Set-Cookie",StringComparison.OrdinalIgnoreCase)).ToDictionary(h => h.Key,h => string.Join(", ",h.Value)),body = Convert.ToBase64String(output.ToArray()) };
    }
    private void ReplyForSource(object? sender, object value) { if (ReferenceEquals(sender, web?.CoreWebView2)) Reply(value); }
    private void Reply(object value) { if(web?.CoreWebView2 is { } core) core.PostWebMessageAsJson(JsonSerializer.Serialize(value)); }
    private Task EmitForView(WebView2 owner, string name, object? detail) => Dispatcher.InvokeAsync(() => {
        if (ReferenceEquals(owner, web)) Reply(new { @event = name, detail });
    }).Task;
    public Task EmitEventAsync(string name,object? detail) => Dispatcher.InvokeAsync(() => Reply(new { @event = name,detail })).Task;
}
