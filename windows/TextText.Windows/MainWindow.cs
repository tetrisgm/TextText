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

public sealed partial class MainWindow : Window
{
    public static Func<WorkspaceContext, INativeWorkspaceBridge>? WorkspaceFactory { get; set; }
    private static readonly Uri Origin = new("https://texttext.app");
    private readonly HttpClient http = new(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(60) };
    private readonly ConcurrentDictionary<string,CancellationTokenSource> requests = new();
    private readonly CancellationTokenSource lifetime = new();
    private Account? account;
    private Account? workspaceAccount;
    private AvailableWorkspace? selectedWorkspace;
    private string ActiveWorkspaceId => selectedWorkspace?.Id ?? account?.WorkspaceId ?? "";
    private string ActiveWorkspaceName => selectedWorkspace?.Name ?? account?.Name ?? "Workspace";
    private WebView2? web;
    private LegacyDraftsWindow? legacyDraftsWindow;
    private INativeWorkspaceBridge? bridge;
    private string root = "";
    private bool closing, transitioning;
    private long workspaceOpenGeneration;
    private bool closeAfterActivation;
    private readonly RendererFlushGuard flushGuard = new();
    private readonly string? webViewProfile;
#if TEXTTEXT_STRESS_ACTOR
    private readonly PrivateActorWorkspace? privateActorWorkspace;
    public MainWindow(string webViewProfile, PrivateActorWorkspace workspace) : this(webViewProfile) { privateActorWorkspace = workspace; }
#endif
    // Integration tests can isolate browser drafts while retaining the real
    // native transport. The application entry point always uses the default.
    public MainWindow(string? webViewProfile = null)
    {
        this.webViewProfile = webViewProfile;
        Title = "TextText"; Width = 1200; Height = 850; MinWidth = 720; MinHeight = 480;
        Loaded += OnLoaded;
        Closing += (_,e) => {
            if(closing) return;
            if(web?.CoreWebView2 is not null) { e.Cancel = true; _ = RequestClose(); }
            else closing = true;
        };
        Closed += (_,_) => { lifetime.Cancel(); foreach(var request in requests.Values) request.Cancel(); bridge?.Dispose(); web?.Dispose(); http.Dispose(); };
    }
    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
#if TEXTTEXT_STRESS_ACTOR
        if(privateActorWorkspace is {} isolated) {
            try {
                var captured=CredentialStore.Load() ?? throw new IOException("The private actor requires the existing signed-in account.");
                var accountId=await AccountIdentity.ResolveAsync(http,Origin,captured.Token,captured.AccountId,lifetime.Token);
                var verified=captured with {AccountId=accountId};account=verified;
                var directory=new WorkspaceDirectory(http,Origin,()=>Task.FromResult(captured.Token));
                var selected=await directory.AuthorizeAsync(isolated.WorkspaceId,lifetime.Token);
                lifetime.Token.ThrowIfCancellationRequested();
                if(!ReferenceEquals(account,verified)||CredentialStore.Load()!=captured)throw new SharedAccountMismatchException();
                isolated.PrepareVerified(Origin,accountId);
                await OpenWorkspace(isolated.Root,replacement:selected,prepareCommit:async()=>{
                    var reauthorized=await directory.AuthorizeAsync(isolated.WorkspaceId,lifetime.Token);
                    if(reauthorized!=selected||!ReferenceEquals(account,verified)||CredentialStore.Load()!=captured)throw new SharedAccountMismatchException();
                    isolated.RevalidateBeforeBinding(Origin,accountId);
                });
                isolated.VerifyPublished(Origin,accountId);
                isolated.Ready.TrySetResult();
            } catch(Exception error) { isolated.Ready.TrySetException(error); }
            return;
        }
#endif
        try { account = CredentialStore.Load(); if(account is not null) { try { await VerifyAccountIdentity(lifetime.Token); } catch { ShowAccountVerificationRequired(); return; } selectedWorkspace = WorkspaceSelection.Load(account.WorkspaceId); await OpenWorkspace(); } else ShowLogin(); }
        catch (LegacyAccountStateException) { ShowRetainedWorkReview(); }
        catch { if (account is not null) ShowWorkspaceUnavailable(); else ShowLogin("Your saved sign-in could not be opened. Please sign in again."); }
    }
    private Task<bool> FlushEditor() => FlushEditorWithTimeout(null);
    private async Task<bool> FlushEditorWithTimeout(TimeSpan? timeout)
    {
        if(web?.CoreWebView2 is not { } core) return true;
        return await flushGuard.FlushAsync(async script => { await core.ExecuteScriptAsync(script); }, timeout);
    }
    private async Task<bool> FlushEditorForClose()
    {
        // A shared editor can briefly remount while a file change is being
        // reconciled. Its first flush can report false even though the next
        // durable checkpoint succeeds. Never close on a failed flush, but give
        // that transition a short chance to finish before showing a warning.
        for (var attempt = 0; attempt < 2; attempt++)
        {
            if (await FlushEditorWithTimeout(TimeSpan.FromSeconds(8))) return true;
            if (attempt == 0) await Task.Delay(250);
        }
        return false;
    }
    private void ShowSaveFailure() => MessageBox.Show(this,"Your latest edits have not finished saving. TextText will stay open so you can resolve the save in the editor.","Keep editing",MessageBoxButton.OK,MessageBoxImage.Information);
    private async Task RequestClose()
    {
        if(closing) return;
        if(transitioning) { if(activatingFile) closeAfterActivation = true; return; }
        transitioning = true;
        // Stop accepting keyboard/pointer input before the renderer captures its
        // final local barrier. Disabling native input leaves script/bridge
        // dispatch alive; failure restores the existing editor in finally.
        if(web is not null) web.IsEnabled = false;
        try {
            if(!await FlushEditorForClose()) { ShowSaveFailure(); return; }
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
            var accountId = await AccountIdentity.ResolveAsync(http, Origin, token, null, timeout.Token);
            timeout.Token.ThrowIfCancellationRequested();
            account = new Account(token,id,data.RootElement.GetProperty("name").GetString() ?? "Workspace", accountId);
            CredentialStore.Save(account); return;
        }
    }
    private void ShowAccountVerificationRequired()
    {
        var panel = new StackPanel { Width = 380, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        var status = new TextBlock { Text = "Reconnect to verify this account. Your saved work remains on this device.", TextWrapping = TextWrapping.Wrap };
        panel.Children.Add(status);
        var retry = new Button { Content = "Try again", Margin = new Thickness(0,16,0,0) };
        retry.Click += async (_, _) => {
            retry.IsEnabled = false;
            try { await VerifyAccountIdentity(lifetime.Token); selectedWorkspace = WorkspaceSelection.Load(account!.WorkspaceId); await OpenWorkspace(); }
            catch { status.Text = "Could not open this account. Reconnect and try again. Your saved work is unchanged."; }
            finally { retry.IsEnabled = true; }
        };
        panel.Children.Add(retry); SetWorkspaceContent(panel);
    }
    private async Task VerifyAccountIdentity(CancellationToken ct)
    {
        var captured = account ?? throw new InvalidOperationException("Sign in required");
        var accountId = await AccountIdentity.ResolveAsync(http, Origin, captured.Token, captured.AccountId, ct);
        ct.ThrowIfCancellationRequested();
        if (!ReferenceEquals(account, captured)) throw new InvalidOperationException("Account changed. Saved work is unchanged.");
        if (captured.AccountId is not null) return;
        var verified = captured with { AccountId = accountId };
        CredentialStore.Save(verified);
        account = verified;
    }
    private async Task OpenWorkspace(string? selectedRoot = null, Action? beforeCommit = null, AvailableWorkspace? replacement = null, Func<Task>? prepareCommit = null)
    {
        var generation = ++workspaceOpenGeneration;
        var stageInitial = bridge is null && web is null;
        var identity = account ?? throw new InvalidOperationException("Sign in required");
        bool IsCurrentOpen() => generation == workspaceOpenGeneration && ReferenceEquals(account, identity) && !lifetime.IsCancellationRequested;
        void RequireCurrentOpen() { lifetime.Token.ThrowIfCancellationRequested(); if (!IsCurrentOpen()) throw new SharedAccountMismatchException(); }
        var active = identity with { WorkspaceId = replacement?.Id ?? ActiveWorkspaceId, Name = replacement?.Name ?? ActiveWorkspaceName };
        if(!Guid.TryParse(active.WorkspaceId,out _)) throw new InvalidOperationException("Invalid workspace");
#if TEXTTEXT_STRESS_ACTOR
        string nextRoot;
        if(privateActorWorkspace is {} isolatedRoot) {
            if(active.WorkspaceId!=isolatedRoot.WorkspaceId||selectedRoot!=isolatedRoot.Root)throw new IOException("Private actor workspace cannot change.");
            nextRoot=isolatedRoot.Root;
        } else nextRoot=selectedRoot ?? WorkspaceRoot(active.WorkspaceId);
#else
        var nextRoot = selectedRoot ?? WorkspaceRoot(active.WorkspaceId);
#endif
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
        var profile = webViewProfile ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"TextText","WebView2",active.AccountId ?? "legacy",active.WorkspaceId);
        var environment = await CoreWebView2Environment.CreateAsync(null,profile);
        RequireCurrentOpen();
        await nextWeb.EnsureCoreWebView2Async(environment);
        RequireCurrentOpen();
        var core = nextWeb.CoreWebView2;
        var policyPageReady = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        core.NavigationCompleted += (_,e) => {
            if(e.IsSuccess && IsLocal(core.Source))policyPageReady.TrySetResult();
            else { policyPageReady.TrySetException(new IOException("The workspace page did not load.")); nextBridge?.InitialViewFailed(); }
        };
        core.ProcessFailed += (_,_) => nextBridge?.InitialViewFailed();
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
        RequireCurrentOpen();
        var factory = WorkspaceFactory;
        var context = new WorkspaceContext(nextRoot, active.WorkspaceId, Origin,
            () => Task.FromResult(active.Token),
            (name, detail) => EmitForView(nextWeb, name, detail), replacement?.Access ?? selectedWorkspace?.Access ?? "owner", active.AccountId,
            () => CreateMirrorPolicy(nextWeb, active, policyPageReady.Task), DeferInitialSync: true);
        INativeWorkspaceBridge? CreateBridge() => factory?.Invoke(context);
        Task<INativeWorkspaceBridge?> Construct() => stageInitial
            ? BridgeConstruction.CreateAsync(CreateBridge, IsCurrentOpen, lifetime.Token)
            : Task.FromResult(CreateBridge());
        try { nextBridge = await Construct(); }
        catch(LegacyAccountStateException) {
#if TEXTTEXT_STRESS_ACTOR
            if(privateActorWorkspace is not null)throw;
#endif
            if(!await ReviewRetainedWork(nextRoot,active,identity))throw;
            RequireCurrentOpen();
            nextBridge = await Construct();
        }
        RequireCurrentOpen();
        beforeCommit?.Invoke();
        var oldWeb = web; var oldBridge = bridge;
        if (oldWeb?.CoreWebView2 is { } oldCore) oldCore.WebMessageReceived -= Receive;
        foreach (var request in requests.Values) request.Cancel();
        root = nextRoot; web = nextWeb; bridge = nextBridge; workspaceAccount = active;
        if (replacement is not null) selectedWorkspace = replacement;
        staging.Children.Remove(nextWeb);
        nextWeb.Width = double.NaN; nextWeb.Height = double.NaN; nextWeb.IsHitTestVisible = true;
        SetWorkspaceContent(nextWeb);
        oldBridge?.Dispose(); oldWeb?.Dispose();
        core.Navigate("https://texttext.local/index.html");
        }
        catch (Exception openingError) {
            if (!ReferenceEquals(web, nextWeb)) {
                var failures = new List<Exception> { openingError };
                try { if (nextBridge is not null) await nextBridge.RetireAsync(); }
                catch (Exception retirementError) { failures.Add(retirementError); }
                try { nextWeb.Dispose(); }
                catch (Exception disposalError) { failures.Add(disposalError); }
                try {
                    if (generation == workspaceOpenGeneration && !lifetime.IsCancellationRequested && ReferenceEquals(Content, staging)) {
                        if (previousContent is not null) staging.Children.Remove(previousContent);
                        Content = previousContent;
                    }
                } catch (Exception restorationError) { failures.Add(restorationError); }
                if (failures.Count > 1) throw new AggregateException(failures);
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
        if(!ReferenceEquals(sender, CurrentCore()) || !IsLocal(e.Source)) return;
        string? id = null, method = null;
        try {
            using var message = JsonDocument.Parse(e.WebMessageAsJson);
            var input = message.RootElement;
            id = input.GetProperty("id").GetString();
            if(string.IsNullOrEmpty(id) || id.Length > 128) return;
            method = input.GetProperty("method").GetString()!;
            var parameters = input.TryGetProperty("params",out var p) ? p.Clone() : JsonSerializer.SerializeToElement(new {});
            if(method == "native.fileOpenResult") { AcceptFileOpen(id, parameters); return; }
            if(method == "native.flushResult") { flushGuard.Accept(id,parameters.TryGetProperty("ok",out var ok) && ok.ValueKind == JsonValueKind.True,parameters.TryGetProperty("durability",out var durability) ? durability : null,parameters.TryGetProperty("idle",out var idle) && idle.ValueKind == JsonValueKind.True); return; }
            using var cancellation = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
            if(!requests.TryAdd(id,cancellation)) return;
            try { var result = await Dispatch(method,parameters,cancellation.Token); ReplyForSource(sender, new { id,result }); }
            finally { requests.TryRemove(id,out _); }
        }
        catch(OperationCanceledException) { ReplyForSource(sender, new { id,error = new { message = "Request cancelled",code = "CANCELLED" } }); }
        catch(SharedAccountMismatchException) { ReplyForSource(sender, new { id,error = new { message = "Return to the original account to continue these saved edits.",code = "account_changed" } }); }
        catch(FileChangedException) { ReplyForSource(sender, new { id,error = new { message = "This file changed. Its current contents have been preserved.",code = method?.StartsWith("collaboration.") == true ? "local_changed" : "conflict" } }); }
        catch(HandoffNotOpenException) { ReplyForSource(sender, new { id,error = new { message = "Shared editing has not opened. Try connecting again.",code = "handoff_not_open" } }); }
        catch(SharedSessionClosedException) { ReplyForSource(sender, new { id,error = new { message = "This editing session has closed.",code = "session_closed" } }); }
        catch(FileNotFoundException) { ReplyForSource(sender, new { id,error = new { message = "This file is not available on this device yet.",code = "not_found" } }); }
        catch(NotSupportedException error) { ReplyForSource(sender, new { id,error = new { message = error.Message,code = "unsupported" } }); }
        catch { ReplyForSource(sender, new { id,error = new { message = "The operation could not be completed. Please try again.",code = "NATIVE_ERROR" } }); }
    }
    private async Task<object?> Dispatch(string method,JsonElement p,CancellationToken ct)
    {
        switch(method)
        {
            case "native.status": return new { localHandoffVersion = 1, accountId = workspaceAccount?.AccountId, workspaceId = ActiveWorkspaceId,root,name = ActiveWorkspaceName,connected = account is not null,available = true };
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
#if TEXTTEXT_STRESS_ACTOR
                if(privateActorWorkspace is not null)throw new IOException("The private actor cannot change the saved sign-in.");
#endif
                if(MessageBox.Show(this,"Log out of TextText? Your saved files remain on this computer.","TextText",MessageBoxButton.OKCancel) != MessageBoxResult.OK) return null;
                if(transitioning) return null;
                transitioning = true;
                try {
                    if(!await FlushEditor()) { ShowSaveFailure(); return null; }
                    foreach(var pending in requests.Values) pending.Cancel();
                    legacyDraftsWindow?.Close(); legacyDraftsWindow=null;
                    CredentialStore.Clear(); bridge?.Dispose(); bridge = null; account = null; workspaceAccount = null; selectedWorkspace = null;
                    _ = Dispatcher.BeginInvoke(() => { web?.Dispose(); web = null; ShowLogin(); });
                } finally { transitioning = false; if(web is not null) web.IsEnabled = true; }
                return null;
            default: return bridge is null ? throw new InvalidOperationException("Workspace unavailable") : await bridge.InvokeAsync(method,p,ct);
        }
    }
    private async Task<object> Http(JsonElement p,CancellationToken ct)
    {
        var active = workspaceAccount ?? account ?? throw new InvalidOperationException("Sign in required");
        if(account is null || !AccountIdentity.SameAccount(active,account)) throw new SharedAccountMismatchException();
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
        if (request.Headers.TryGetValues("X-TextText-Account", out var expected) && (active.AccountId is null || expected.Single() != active.AccountId)) throw new SharedAccountMismatchException();
        if (active.AccountId is not null) { request.Headers.Remove("X-TextText-Account"); request.Headers.TryAddWithoutValidation("X-TextText-Account", active.AccountId); }
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer",active.Token);
        using var response = await http.SendAsync(request,HttpCompletionOption.ResponseHeadersRead,ct);
        const int limit = 64 * 1024 * 1024;
        if(response.Content.Headers.ContentLength > limit) throw new InvalidDataException("Response exceeds size limit.");
        using var input = await response.Content.ReadAsStreamAsync(ct); using var output = new MemoryStream();
        var buffer = new byte[65536]; int count;
        while((count = await input.ReadAsync(buffer,ct)) > 0) { if(output.Length + count > limit) throw new InvalidDataException("Response exceeds size limit."); output.Write(buffer,0,count); }
        return new { status = (int)response.StatusCode, headers = response.Headers.Concat(response.Content.Headers).Where(h => !h.Key.Equals("Set-Cookie",StringComparison.OrdinalIgnoreCase)).ToDictionary(h => h.Key,h => string.Join(", ",h.Value)),body = Convert.ToBase64String(output.ToArray()) };
    }
    private CoreWebView2? CurrentCore()
    {
        if(closing || lifetime.IsCancellationRequested) return null;
        try { return web?.CoreWebView2; }
        catch(ObjectDisposedException) { return null; }
    }
    private void ReplyForSource(object? sender, object value) { if (sender is not null && ReferenceEquals(sender, CurrentCore())) Reply(value); }
    private void Reply(object value)
    {
        if(CurrentCore() is not { } core) return;
        try { core.PostWebMessageAsJson(JsonSerializer.Serialize(value)); }
        catch(ObjectDisposedException) { /* The window closed while an async request was finishing. */ }
    }
    private Task EmitForView(WebView2 owner, string name, object? detail) => Dispatcher.InvokeAsync(() => {
        if (ReferenceEquals(owner, web)) Reply(new { @event = name, detail });
    }).Task;
    public Task EmitEventAsync(string name,object? detail) => Dispatcher.InvokeAsync(() => Reply(new { @event = name,detail })).Task;
}
