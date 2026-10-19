using System.IO;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Runtime.InteropServices;
using System.Windows;
using Microsoft.Web.WebView2.Wpf;
using TextText.Core;
using TextText.Windows;

// Mailbox adapter for sync/stress/coordinator.mjs (role pc-app). The coordinator's JSONL
// stdin/stdout is relayed by windows/scripts/stress-native.ps1 through numbered request
// files (req-000001.json ...) in the session directory; this runner answers each with the
// matching numbered reply file (rep-000001.json ...). Serial: request n+1 is only handled
// after reply n exists. Edits go through the production MainWindow, WindowsBridge and the
// CoreWebView2 input pipeline; nothing here appends through the CLI or a document API.
static class Stress
{
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int maxCount);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr state);
    [DllImport("user32.dll")] static extern bool EnumThreadWindows(uint threadId, EnumWindowsCallback callback, IntPtr state);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")] static extern IntPtr GetDlgItem(IntPtr dialog, int id);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);
    delegate bool EnumWindowsCallback(IntPtr window, IntPtr state);

    sealed class CollaborationTransportGate
    {
        int online = 1;
        public bool Online { get => Volatile.Read(ref online) != 0; set => Volatile.Write(ref online, value ? 1 : 0); }
    }

    sealed record Config(string File, string ItemId, string WorkspaceId, string Title, int TotalMinutes = 20, string? IdentityReceipt = null, JsonElement? LeafMove = null, PrivateActorWorkspace.Isolation? Isolation = null);
    const int MaxRequestBytes = 256 * 1024, MaxText = 64 * 1024, MaxEditText = 1024;
    static readonly TimeSpan ObserveBound = TimeSpan.FromSeconds(30), EditBound = TimeSpan.FromSeconds(15);
    static readonly Regex MarkerPattern = new(@"\[(mac|pc)-(app|web|cli) r(\d+) [a-z]+\d+\]", RegexOptions.Compiled);
    static readonly Regex EditIdPattern = new(@"^r\d{1,5}-pc-app$", RegexOptions.Compiled);
    static readonly Regex IdPattern = new(@"^[a-zA-Z0-9_-]{1,80}$", RegexOptions.Compiled);
    static readonly Regex GenerationPattern = new(@"^generation-(\d{3})$", RegexOptions.Compiled);

    public static int Run(string configPath, string session)
    {
        try
        {
            var config = JsonSerializer.Deserialize<Config>(File.ReadAllText(configPath), Program.Json) ?? throw new Exception("Missing stress config");
            using(var raw=JsonDocument.Parse(File.ReadAllBytes(configPath))) {
                var fields=raw.RootElement.EnumerateObject().Where(p=>p.Name.Equals("isolation",StringComparison.OrdinalIgnoreCase)).ToArray();
                if(fields.Length>0) {
                    if(fields.Length!=1||fields[0].Name!="isolation"||PrivateActorWorkspace.ParseIsolation(fields[0].Value)!=config.Isolation)throw new IOException("Invalid private actor isolation config.");
                }
            }
            Validate(config);
            if (!Path.IsPathFullyQualified(session) || !Directory.Exists(session)) throw new Exception("Stress session directory must be an existing absolute directory created by the relay.");
            if (Directory.EnumerateFiles(session, "rep-*.json").Any() || File.Exists(Path.Combine(session, "events.jsonl"))) throw new Exception("Stress session directory was already used; use a new session directory.");
            File.WriteAllText(Path.Combine(session, "actor.pid"), Environment.ProcessId.ToString());
            var key = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(WindowsIdentity.GetCurrent().User!.Value)))[..24];
            using var instance = new Mutex(true, "Global\\TextText.Desktop." + key, out var created);
            if (!created) throw new Exception("Close TextText before running the stress adapter; two native writers must not share its device journal.");
            using var log = new StreamWriter(Path.Combine(session, "events.jsonl")) { AutoFlush = true };
            void Record(object value) => log.WriteLine(JsonSerializer.Serialize(new { utc = DateTimeOffset.UtcNow, value }));
            using var actorCompleted = new ManualResetEventSlim();
            var assembly = typeof(MainWindow).Assembly;
            var version = assembly.GetName().Version?.ToString() ?? "0";
            var assemblyHash = Program.Hash(File.ReadAllBytes(assembly.Location));
            Record(new { kind = "start", config.ItemId, config.WorkspaceId, nativeAssemblySha256 = assemblyHash, nativeAssemblyVersion = version,
                adapter = "production MainWindow + WindowsBridge", mockedTransport = false });
            var app = new Application();
            app.Exit += (_, args) => Record(new { kind = "dispatcher-exit", args.ApplicationExitCode });
            app.Dispatcher.ShutdownStarted += (_, _) => Record(new { kind = "dispatcher-shutdown-started" });
            // Keep the mailbox process alive long enough to report close evidence.
            app.ShutdownMode = ShutdownMode.OnExplicitShutdown;
            // The tested editor is disposable. A separate offscreen main window
            // keeps WPF's Run loop alive after that editor raises Closed.
            var lifetimeWindow = new Window { ShowInTaskbar = false, ShowActivated = false,
                WindowStyle = WindowStyle.ToolWindow, Width = 1, Height = 1,
                Left = -10000, Top = -10000, Opacity = 0 };
            app.MainWindow = lifetimeWindow;
            lifetimeWindow.Closed += (_, _) => Record(new { kind = "lifetime-window-closed" });
            var transport = new CollaborationTransportGate();
            var generationMatch = GenerationPattern.Match(Path.GetFileName(Path.TrimEndingDirectorySeparator(session)));
            var generation = generationMatch.Success ? int.Parse(generationMatch.Groups[1].Value) : 1;
            MainWindow.WorkspaceFactory = context => new WindowsBridge(context);
            var isolated=config.Isolation is {} isolation ? new PrivateActorWorkspace(isolation,session,config.File,config.WorkspaceId,config.ItemId,config.Title) : null;
            var profile=Path.Combine(Path.GetFullPath(session), "webview-profile");
            var window = isolated is null ? new MainWindow(profile) : new MainWindow(profile,isolated);
            if(isolated is null)window.ActivateFiles([config.File]);
            var exit = 1;
            window.Loaded += async (_, _) =>
            {
                using var timeout = new CancellationTokenSource(TimeSpan.FromMinutes(config.TotalMinutes));
                var runner = new Runner(window, config, session, generation, transport, Record, $"native-mainwindow/{version}/{assemblyHash[..16]}");
                try
                {
                    if(isolated is not null) {
                        await isolated.Ready.Task.WaitAsync(TimeSpan.FromSeconds(90),timeout.Token);
                        var bridge=Program.Field(window,"bridge") as INativeWorkspaceBridge ?? throw new IOException("Private actor bridge is unavailable.");
                        await Program.Until(async()=>{
                            if(!File.Exists(config.File))return false;
                            var ready=JsonSerializer.SerializeToElement(await bridge.InvokeAsync("files.ready",JsonSerializer.SerializeToElement(new{itemId=config.ItemId}),timeout.Token));
                            return ready.GetProperty("ready").GetBoolean()&&File.Exists(config.File);
                        },timeout.Token,"Private actor fixture did not materialize through native sync.");
                        isolated.VerifyFixture();
                        window.ActivateFiles([config.File]);
                    }
                    await runner.Loop(timeout.Token).ConfigureAwait(false);
                    exit = runner.Failure is null ? 0 : 1;
                }
                catch (Exception error)
                {
                    runner.Fail(error.Message);
                    try
                    {
                        if (Program.Field(window, "web") is WebView2 diagnostic && diagnostic.CoreWebView2 is not null)
                            Record(new { kind = "failure-surface", state = await diagnostic.ExecuteScriptAsync("JSON.stringify({heading:document.querySelector('.vault-context-location h2')?.textContent,notices:[...document.querySelectorAll('[role=alert],.vault-notice')].map(x=>x.textContent),editor:!!document.querySelector('[aria-label=\"Document body\"]')?.isContentEditable})") });
                    }
                    catch { /* Preserve the original failure if WebView has already closed. */ }
                }
                finally
                {
                    try
                    {
                        // Keep the mailbox receipt and event log open until the
                        // asynchronous close reply and final flush have finished.
                        var flushed = false;
                        try { flushed = await runner.Flush().ConfigureAwait(false); } catch (Exception error) { runner.Fail(error.Message); }
                        File.WriteAllText(Path.Combine(session, "result.json"), JsonSerializer.Serialize(new { ok = runner.Failure is null && flushed, flushed, error = runner.Failure, config.ItemId }));
                        if (!flushed) exit = 1;
                        typeof(MainWindow).GetField("closing", Program.Private)?.SetValue(window, true);
                        if (!app.Dispatcher.HasShutdownStarted)
                            _ = app.Dispatcher.BeginInvoke(() => { if (window.IsVisible) window.Close(); app.Shutdown(); });
                    }
                    finally { actorCompleted.Set(); }
                }
            };
            // Run an explicit dispatcher lifetime. app.Run(window) can return as
            // soon as the tested main window closes, before the async mailbox
            // handler writes its close-probe reply and result receipt.
            lifetimeWindow.Show();
            window.Show();
            Record(new { kind = "windows-shown", lifetimeVisible = lifetimeWindow.IsVisible, mainIsLifetime = ReferenceEquals(app.MainWindow, lifetimeWindow) });
            try { app.Run(); }
            catch (Exception error)
            {
                // A WPF dispatcher failure must not dispose the mailbox log
                // while its async Loaded handler is still writing the result.
                Record(new { kind = "dispatcher-failed", error = error.GetType().Name, message = error.Message[..Math.Min(error.Message.Length, 300)], stack = (error.StackTrace ?? "")[..Math.Min(error.StackTrace?.Length ?? 0, 2000)] });
                exit = 1;
            }
            Record(new { kind = "dispatcher-returned", exit });
            if (!actorCompleted.Wait(TimeSpan.FromMinutes(config.TotalMinutes + 1)))
            {
                Record(new { kind = "actor-completion-timeout" });
                return 1;
            }
            return exit;
        }
        catch (Exception error) { Console.Error.WriteLine(error.Message); return 1; }
    }

    static void Validate(Config config)
    {
        if (!Path.IsPathFullyQualified(config.File) || !config.File.EndsWith(".textpack", StringComparison.OrdinalIgnoreCase)
            || !config.Title.StartsWith("Six-client acceptance ", StringComparison.Ordinal)
            || (config.LeafMove is null && Path.GetFileNameWithoutExtension(config.File) != config.Title)
            || !Guid.TryParse(config.ItemId, out _) || !IdPattern.IsMatch(config.WorkspaceId)
            || config.TotalMinutes is < 1 or > 120)
            throw new Exception("Invalid stress config: absolute .textpack File, Guid ItemId, WorkspaceId, Title starting 'Six-client acceptance ' equal to the file name, TotalMinutes 1..120.");
        if(config.LeafMove is {} leafMove)LeafMoveObservation.ValidateConfig(config.File,config.Title,leafMove);
        if (config.Isolation is null && TextPackStore.Identity(File.ReadAllBytes(config.File)) != config.ItemId) throw new Exception("Test file identity mismatch.");
    }

    sealed class Runner(MainWindow window, Config config, string session, int generation, CollaborationTransportGate transport, Action<object> log, string adapterName)
    {
        public string? Failure { get; private set; }
        WebView2? view;
        Account? capturedAccount;
        string? capturedRoot;
        object? inputProgress;
        object? historyProgress;
        object? fieldProgress;
        bool opened;
        string? soakRunId;
        readonly string sessionId = "editor-" + Guid.NewGuid().ToString("N");
        readonly string expectedTitle = JsonSerializer.Serialize(config.Title);
        readonly string expectedItem = JsonSerializer.Serialize(config.ItemId);
        string expectedSession => JsonSerializer.Serialize(sessionId);
        bool? flushed;
        int reloads;
        long assetNavigationGeneration;
        int sawKeepEditing;
        readonly TaskCompletionSource closed = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public void Fail(string message) { Failure ??= message; log(new { kind = "failure", message }); }

        public async Task Loop(CancellationToken ct)
        {
            for (var seq = 1; !ct.IsCancellationRequested; seq++)
            {
                var request = await NextRequest(seq, ct);
                if (request is null) break; // total timeout
                var type = request.RootElement.TryGetProperty("type", out var t) && t.ValueKind == JsonValueKind.String ? t.GetString()! : "";
                var round = request.RootElement.TryGetProperty("round", out var r) && r.ValueKind == JsonValueKind.Number ? r.GetInt32() : 0;
                log(new { kind = "request", seq, type, round });
                object reply;
                if (type == "shutdown")
                {
                    // Flush through production before acknowledging, so the relay never ends the task mid-flush.
                    request.Dispose();
                    var ok = false;
                    try { ok = await Flush(); } catch (Exception error) { Fail(error.Message); }
                    Reply(seq, new { type = "shutdown-ack", ok = ok && Failure is null });
                    return;
                }
                if (Failure is not null) reply = new { type = "error", round, message = "Adapter already failed: " + Failure };
                else
                {
                    try { reply = await Handle(type, round, request.RootElement, ct).ConfigureAwait(type != "close-probe"); }
                    catch (OperationCanceledException) { throw; }
                    catch (Exception error) { Fail(error.Message); reply = fieldProgress is not null ? (object)new { type = "error", round, message = error.Message, fieldProgress } : historyProgress is not null ? (object)new { type = "error", round, message = error.Message, historyProgress } : inputProgress is null ? (object)new { type = "error", round, message = error.Message } : new { type = "error", round, message = error.Message, inputProgress }; }
                }
                request.Dispose();
                Reply(seq, reply);
            }
            if (ct.IsCancellationRequested) Fail("Stress adapter total time limit reached.");
        }

        async Task<JsonDocument?> NextRequest(int seq, CancellationToken ct)
        {
            var path = Path.Combine(session, $"req-{seq:D6}.json");
            while (!ct.IsCancellationRequested)
            {
                if (File.Exists(path))
                {
                    var info = new FileInfo(path);
                    if (info.Length > MaxRequestBytes) throw new Exception($"Request {seq} exceeds the message bound.");
                    try { return JsonDocument.Parse(await File.ReadAllBytesAsync(path, ct)); }
                    catch (IOException) { /* relay still moving it into place */ }
                    catch (JsonException) { throw new Exception($"Request {seq} is not valid JSON."); }
                }
                try { await Task.Delay(100, ct); } catch (OperationCanceledException) { break; }
            }
            return null;
        }

        void Reply(int seq, object message)
        {
            var final = Path.Combine(session, $"rep-{seq:D6}.json");
            var temporary = final + ".tmp";
            File.WriteAllText(temporary, JsonSerializer.Serialize(message), new UTF8Encoding(false));
            File.Move(temporary, final);
            log(new { kind = "reply", seq, type = (message.GetType().GetProperty("type")?.GetValue(message) as string) ?? "" });
        }

        async Task<object> Handle(string type, int round, JsonElement request, CancellationToken ct)
        {
            if (request.TryGetProperty("soakSample", out _) && type != "observe") throw new InvalidDataException("Soak sample only supports readonly observe.");
            if (type != "hello") RequireActorScope();
            if (request.TryGetProperty("assetProof", out var assetOnly)) {
                if (request.GetProperty("type").GetString() != "observe") throw new IOException("Asset proof only supports readonly observe.");
                AssetProofObservation.Request(assetOnly);
            }
            switch (type)
            {
                case "hello":
                {
                    var role = request.TryGetProperty("role", out var ro) ? ro.GetString() : null;
                    var mode = request.TryGetProperty("mode", out var mo) ? mo.GetString() : null;
                    if (role != "pc-app") throw new Exception("This native adapter only serves the pc-app role.");
                    if (mode != "real") throw new Exception("The native adapter only runs real mode; it cannot simulate.");
                    if (!request.TryGetProperty("fixture", out var fixture)
                        || !fixture.TryGetProperty("itemId", out var i) || i.GetString() != config.ItemId
                        || !fixture.TryGetProperty("workspaceId", out var w) || w.GetString() != config.WorkspaceId)
                        throw new Exception("Coordinator fixture does not match the configured test item and workspace.");
                    soakRunId = request.TryGetProperty("runId", out var run) ? run.GetString() : null;
                    await Open(ct);
                    if (request.TryGetProperty("identitySchema", out var schema) && schema.GetInt32() == 1)
                        return new { type = "attest", round = 0, mode = "real", workspaceId = config.WorkspaceId, itemId = config.ItemId,
                            finiteSoakCorrelation = 1, binaryAssetObservation = 1, machineId = System.Net.Dns.GetHostName(), adapter = adapterName, generation, sessionId, identity = ObservedIdentity() };
                    return new { type = "attest", round = 0, mode = "real", workspaceId = config.WorkspaceId, itemId = config.ItemId,
                        finiteSoakCorrelation = 1, machineId = System.Net.Dns.GetHostName(), adapter = adapterName, generation, sessionId };
                }
                case "prepare":
                    await RequireSelected(ct);
                    if (request.TryGetProperty("select", out var selection) && selection.GetString() == "Existing fixture text.")
                    {
                        var selected = await view!.ExecuteScriptAsync("(()=>{const e=document.querySelector('[aria-label=\"Document body\"]');if(!e?.isContentEditable||e.textContent.split('Existing fixture text.').length!==2)return false;const w=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode()){const i=n.textContent.indexOf('Existing fixture text.');if(i<0)continue;e.focus();const r=document.createRange();r.setStart(n,i);r.setEnd(n,i+22);const s=window.getSelection();s.removeAllRanges();s.addRange(r);return s.toString()==='Existing fixture text.'}return false})()");
                        if (selected != "true") throw new Exception("Replacement target could not be selected.");
                    }
                    return new { type = "ready", round };
                case "edit":
                {
                    await RequireSelected(ct);
                    if (!request.TryGetProperty("edit", out var edit) || !edit.TryGetProperty("op", out var op) || op.GetString() is not ("append" or "insert-start" or "replace-selection")) throw new Exception("Unsupported edit operation.");
                    var id = edit.TryGetProperty("id", out var ie) ? ie.GetString() ?? "" : "";
                    var text = edit.TryGetProperty("text", out var te) ? te.GetString() ?? "" : "";
                    if (!EditIdPattern.IsMatch(id) || text.Length is 0 or > MaxEditText || text.Contains('\n')) throw new Exception("Edit id or text is out of bounds for this adapter.");
                    inputProgress = null;
                    historyProgress = null;
                    fieldProgress = null;
                    if (edit.TryGetProperty("fieldEdits", out var fields))
                    {
                        var completed = await ExerciseFields(id, text, fields, ct);
                        fieldProgress = null;
                        return new { type = "applied", round, editId = id, fieldProgress = completed, fieldEditIds = new[] { id + "-body", id + "-subtitle" } };
                    }
                    if (edit.TryGetProperty("undoRedo", out var history))
                    {
                        if (history.ValueKind != JsonValueKind.True || op.GetString() != "append" || edit.TryGetProperty("inputSequence", out _)) throw new Exception("Invalid history operation.");
                        var completed = await ExerciseHistory(id, text, ct);
                        historyProgress = null;
                        return new { type = "applied", round, editId = id, historyProgress = completed };
                    }
                    if (edit.TryGetProperty("inputSequence", out var sequence))
                    {
                        if (op.GetString() != "append" || sequence.ValueKind != JsonValueKind.Object
                            || !sequence.TryGetProperty("chunks", out var chunkArray) || chunkArray.ValueKind != JsonValueKind.Array
                            || !sequence.TryGetProperty("intervalMs", out var intervalValue) || !intervalValue.TryGetInt32(out var interval)
                            || interval is < 10 or > 250) throw new Exception("Invalid bounded input sequence.");
                        var chunks = chunkArray.EnumerateArray().Select(chunk => chunk.ValueKind == JsonValueKind.String ? chunk.GetString()! : "").ToArray();
                        if (chunks.Length is < 2 or > 16 || chunks.Distinct(StringComparer.Ordinal).Count() != chunks.Length
                            || string.Concat(chunks) != text || chunks.Any(chunk => chunk.EnumerateRunes().Count() is < 1 or > 50 || chunk.Contains('\n') || chunk.Contains('\r')))
                            throw new Exception("Invalid bounded input sequence.");
                        var acknowledgments = new List<object>();
                        var prefix = "";
                        var started = System.Diagnostics.Stopwatch.StartNew();
                        inputProgress = new { editId = id, chunks = acknowledgments.ToArray(), acceptedPrefix = prefix };
                        for (var index = 0; index < chunks.Length; index++)
                        {
                            if (started.ElapsedMilliseconds >= 15000) throw new Exception("Input sequence deadline exceeded.");
                            await RequireSelected(ct);
                            if (await view!.ExecuteScriptAsync($"window.texttextStressContinuity?.removed === false && window.texttextStressSession === {expectedSession}") != "true") throw new Exception("Editor replaced during input sequence.");
                            inputProgress = new { editId = id, chunks = acknowledgments.ToArray(), acceptedPrefix = prefix, attemptedChunk = new { ordinal = index + 1, text = chunks[index] } };
                            await Insert(id, chunks[index], false, false, ct, started);
                            if (await view!.ExecuteScriptAsync($"window.texttextStressContinuity?.removed === false && window.texttextStressSession === {expectedSession}") != "true") throw new Exception("Editor replaced during input sequence.");
                            var elapsedMs = started.Elapsed.TotalMilliseconds;
                            if (elapsedMs > 15000) throw new Exception("Input sequence deadline exceeded.");
                            prefix += chunks[index];
                            acknowledgments.Add(new { ordinal = index + 1, text = chunks[index], visible = true, elapsedMs });
                            inputProgress = new { editId = id, chunks = acknowledgments.ToArray(), acceptedPrefix = prefix };
                            log(new { kind = "input-chunk", editId = id, ordinal = index + 1, elapsedMs });
                            if (index + 1 < chunks.Length) await Task.Delay(interval, ct);
                        }
                        var completed = inputProgress;
                        inputProgress = null;
                        return new { type = "applied", round, editId = id, inputProgress = completed };
                    }
                    await Insert(id, text, op.GetString() == "insert-start", op.GetString() == "replace-selection", ct);
                    return new { type = "applied", round, editId = id };
                }
                case "transport":
                {
                    if (!request.TryGetProperty("online", out var online) || online.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
                        throw new Exception("Transport control requires a boolean online value.");
                    var next = online.GetBoolean();
                    if (!next) await RequireSelected(ct);
                    else if (!opened || view?.CoreWebView2 is null) throw new Exception("Editor is not open; hello must succeed first.");
                    transport.Online = next;
                    await view!.CoreWebView2.CallDevToolsProtocolMethodAsync("Network.enable", "{}");
                    await view.CoreWebView2.CallDevToolsProtocolMethodAsync("Network.emulateNetworkConditions", JsonSerializer.Serialize(new {
                        offline = !next, latency = 0, downloadThroughput = -1, uploadThroughput = -1,
                        connectionType = next ? "wifi" : "none"
                    }));
                    if (!next && await view.ExecuteScriptAsync($"(()=>{{const shared=document.querySelector('[data-collaboration-item]');return shared?.dataset.collaborationItem === {expectedItem} && !!shared.querySelector('[aria-label=\"Document body\"]')?.isContentEditable}})()") != "true")
                        throw new Exception("Native editor stopped being editable when its remote transport went offline.");
                    if (next)
                    {
                        await view.ExecuteScriptAsync("(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent?.trim()==='Retry');b?.click();return !!b})()");
                        await Program.Until(async () => await view.ExecuteScriptAsync("['ready','saving'].includes(document.querySelector('[data-collaboration-item]')?.dataset.collaborationState)") == "true", ct, "Native collaboration did not recover after transport restoration.");
                    }
                    log(new { kind = "transport", round, online = transport.Online });
                    return new { type = "transport", round, online = transport.Online };
                }
                case "observe":
                {
                    if (request.TryGetProperty("assetProof", out var assetRequest)) AssetProofObservation.Request(assetRequest);
                    JsonElement? soakSample = request.TryGetProperty("soakSample",out var sample) ? SoakSample.Validate(sample,soakRunId) : null;
                    await RequireSelected(ct);
                    var expected = request.TryGetProperty("expectedEditIds", out var ids) && ids.ValueKind == JsonValueKind.Array
                        ? ids.EnumerateArray().Select(e => e.GetString() ?? "").OrderBy(e => e, StringComparer.Ordinal).ToArray() : [];
                    var (text, editIds) = await Observe(expected, ct);
                    var continuous = await view!.ExecuteScriptAsync("window.texttextStressContinuity?.removed === false") == "true";
                    var sessionSeen = await view.ExecuteScriptAsync("window.texttextStressSession ?? null");
                    if (!continuous || sessionSeen != expectedSession) reloads++;
                    log(new { kind = "observed", round, continuous, sessionPresent = sessionSeen == expectedSession, reloads, editIds });
                    var documentSnapshot = request.TryGetProperty("documentSnapshot", out var full) && full.ValueKind == JsonValueKind.True ? await InspectDocument(ct) : (JsonElement?)null;
                    object? folderCaseProof=null; bool? folderCasePending=null; bool? folderCaseReviewVisible=null;
                    if(request.TryGetProperty("folderCase",out var folder)) {
                        RequireActorScope();
                        var observed=FolderCaseObservation.Observe(capturedRoot!,config.ItemId,config.Title,config.File,folder);
                        folderCaseProof=observed.Proof;folderCasePending=observed.Pending;
                        folderCaseReviewVisible=window.OwnedWindows.Count>0||await view.ExecuteScriptAsync("!!document.querySelector('dialog[open]')")=="true";
                        await RequireSelected(ct);
                    }
                    object? leafMoveProof=null;bool? leafMovePending=null;bool? leafMoveReviewVisible=null;
                    if(request.TryGetProperty("leafMove",out var leaf)) {
                        if(config.LeafMove is not {} configuredLeaf)throw new IOException("Leaf observations require an explicit scenario config.");
                        RequireActorScope();var bridge=Program.Field(window,"bridge")??throw new IOException("Selected native bridge missing.");
                        var selectedPath=await LeafMoveObservation.SelectedPath(bridge,config.ItemId,ct);
                        var observed=LeafMoveObservation.Observe(capturedRoot!,config.WorkspaceId,config.ItemId,config.Title,config.File,configuredLeaf,leaf,selectedPath);
                        leafMoveProof=observed.Proof;leafMovePending=observed.Pending;
                        leafMoveReviewVisible=window.OwnedWindows.Count>0||await view.ExecuteScriptAsync("!!document.querySelector('dialog[open]')")=="true";
                        RequireActorScope();await RequireSelected(ct);
                    }
                    object? assetProof = null; bool? assetProofRequiresValidatedLiveSnapshot = null;
                    if (request.TryGetProperty("assetProof", out var assetRaw)) {
                        var sampleId = AssetProofObservation.Request(assetRaw);
                        if (!Guid.TryParseExact(config.ItemId, "D", out var itemUuid) || itemUuid.ToString("D") != config.ItemId ||
                            !Guid.TryParseExact(config.WorkspaceId, "D", out var workspaceUuid) || workspaceUuid.ToString("D") != config.WorkspaceId)
                            throw new IOException("Canonical asset proof identity required.");
                        RequireActorScope();
                        var sourceIdentity = JsonSerializer.SerializeToElement(ObservedIdentity());
                        var sourcePin = sourceIdentity.GetRawText();
                        var initialReloads = reloads;
                        var initialNavigation = Interlocked.Read(ref assetNavigationGeneration);
                        var initialView = view;
                        var bridge = Program.Field(window, "bridge") ?? throw new IOException("Selected native bridge unavailable.");
                        var accountId = capturedAccount?.AccountId ?? throw new IOException("Verified account unavailable.");
                        var initial = await AssetProofObservation.CaptureSession(bridge, config.ItemId, accountId, config.WorkspaceId, new Uri("https://texttext.app"), capturedRoot!, ct);
                        async Task Unchanged() {
                            RequireActorScope(); await RequireSelected(ct); RequireActorScope();
                            if (reloads != initialReloads || JsonSerializer.Serialize(ObservedIdentity()) != sourcePin ||
                                await view!.ExecuteScriptAsync("window.texttextStressContinuity?.removed === false && window.texttextStressSession === " + expectedSession) != "true")
                                throw new IOException("Readonly asset authority changed.");
                            AssetProofObservation.Unchanged(initial, await AssetProofObservation.CaptureSession(bridge, config.ItemId, accountId, config.WorkspaceId, new Uri("https://texttext.app"), capturedRoot!, ct));
                            RequireActorScope();
                            if (!ReferenceEquals(initialView, view) || initialNavigation != Interlocked.Read(ref assetNavigationGeneration) ||
                                JsonSerializer.Serialize(ObservedIdentity()) != sourcePin) throw new IOException("Native view/source changed during observation.");
                        }
                        async Task<string> Canonical(string raw) {
                            var encoded = await view!.ExecuteScriptAsync(AssetProofObservation.CanonicalScript(raw));
                            if (Encoding.UTF8.GetByteCount(encoded) > 2 * 262144) throw new IOException("Canonical document exceeds bound.");
                            return JsonSerializer.Deserialize<string>(encoded) ?? throw new IOException("Canonical document unavailable.");
                        }
                        await Unchanged();
                        var first = await InspectDocument(ct); await Unchanged();
                        AssetProofObservation.RequireUnique(capturedRoot!, config.ItemId, initial.Path);
                        var bytes = AssetProofObservation.Read(capturedRoot!, initial.Path);
                        var pack = AssetProofObservation.Inspect(bytes, config.ItemId); await Unchanged();
                        var last = await InspectDocument(ct); await Unchanged();
                        var canonical = await Canonical(pack.RawDocument); await Unchanged();
                        var firstCanonical = await Canonical(first.GetRawText()); await Unchanged();
                        var lastCanonical = await Canonical(last.GetRawText()); await Unchanged();
                        if (canonical != firstCanonical || canonical != lastCanonical ||
                            !AssetProofObservation.Read(capturedRoot!, initial.Path).SequenceEqual(bytes)) throw new IOException("Pack differs from validated live document.");
                        AssetProofObservation.RequireUnique(capturedRoot!, config.ItemId, initial.Path);
                        documentSnapshot = last; assetProofRequiresValidatedLiveSnapshot = false;
                        assetProof = new { version = 1, sampleId, source = "native-local-pack",
                            scopeHash = sourceIdentity.GetProperty("principalScopeHash").GetString(), workspaceId = config.WorkspaceId,
                            itemId = config.ItemId, relativePath = initial.Path, archiveSha256 = pack.ArchiveHash,
                            documentSha256 = TextPackStore.Hash(Encoding.UTF8.GetBytes(canonical)), assetHashes = pack.Assets,
                            selectedItemId = config.ItemId, selectedPath = initial.Path };
                    }
                    var ordinary = new { type = "state", round, text, editIds, documentSnapshot, soakSample, folderCaseProof, folderCasePending, folderCaseReviewVisible, leafMoveProof,leafMovePending,leafMoveReviewVisible, editor = new { sessionId, reloads } };
                    if (assetProof is null) return ordinary;
                    var enriched = JsonSerializer.SerializeToElement(ordinary).EnumerateObject().ToDictionary(p => p.Name, p => (object?)p.Value.Clone());
                    enriched["assetProof"] = assetProof;
                    enriched["assetProofRequiresValidatedLiveSnapshot"] = assetProofRequiresValidatedLiveSnapshot;
                    return enriched;
                }
                case "close-probe":
                {
                    if (!opened) throw new Exception("Windows close probe requires a joined editor.");
                    await RequireSelected(ct);
                    var result = await CloseProbe(ct).ConfigureAwait(false);
                    log(new { kind = "close-probe", result.closed, result.keepEditingDialog, result.flushed });
                    if (!result.closed || result.keepEditingDialog || !result.flushed)
                        throw new Exception($"Normal editor close failed: closed={result.closed}, keepEditingDialog={result.keepEditingDialog}, flushed={result.flushed}.");
                    return new { type = "close-probe", round, closed = true, keepEditingDialog = false, flushed = true };
                }
                default:
                    throw new Exception("Unsupported coordinator message type.");
            }
        }

        async Task<(bool closed, bool keepEditingDialog, bool flushed)> CloseProbe(CancellationToken ct)
        {
            async Task RecordEditorState(string stage)
            {
                var guard = typeof(MainWindow).GetField("flushGuard", Program.Private)?.GetValue(window);
                var inFlight = guard is not null && typeof(RendererFlushGuard).GetField("pending", Program.Private)?.GetValue(guard) is not null;
                var lastOutcome = guard is null ? null : typeof(RendererFlushGuard).GetField("lastOutcome", Program.Private)?.GetValue(guard) as string;
                log(new { kind = "close-guard-state", stage, inFlight, lastOutcome });
                // Only journal metadata is recorded. Never copy document text,
                // recovery payloads, credentials or file contents into receipts.
                var script = "(()=>{const id=" + expectedItem + ";const keys=Object.keys(localStorage).filter(k=>k.startsWith('texttext:file-collaboration:v1:')&&k.includes(id));return {online:navigator.onLine,hook:typeof window.texttextFlushForSignOut,nativeFlush:window.__texttextNativeFlushDiagnostic??null,notice:document.querySelector('.vault-notice')?.textContent?.slice(0,180)??null,sharedState:document.querySelector('[data-collaboration-state]')?.getAttribute('data-collaboration-state')??null,bridgeErrors:window.__texttextStressBridgeErrors??[],closeFlush:window.__texttextCloseFlush??[],journals:keys.map(k=>{try{const j=JSON.parse(localStorage.getItem(k));return {generation:j.journalGeneration,epoch:j.epoch,pending:j.pending?.length??0,batch:!!j.batch,retired:!!j.retired,unqueuedDirty:!!j.unqueuedDirty}}catch{return {unreadable:true}}})}})()";
                try {
                    // CloseProbe resumes on a worker after its bounded wait; WebView2
                    // remains owned by the dispatcher even when the dialog was dismissed.
                    var activeView = view;
                    if (activeView is null) return;
                    var value = await activeView.Dispatcher.InvokeAsync(() => activeView.CoreWebView2 is null ? Task.FromResult("null") : activeView.ExecuteScriptAsync(script)).Task.Unwrap().WaitAsync(TimeSpan.FromSeconds(2), ct);
                    log(new { kind = "close-editor-state", stage, value });
                }
                catch (Exception error) { log(new { kind = "close-editor-state", stage, error = error.GetType().Name }); }
            }
            await RecordEditorState("before");
            // Capture only the boolean result and timing of the production
            // close hook. A false result with a clean checkpoint is actionable.
            if (view is { } diagnosticView)
            {
                var installed = await diagnosticView.Dispatcher.InvokeAsync(() => diagnosticView.ExecuteScriptAsync("(()=>{const original=window.texttextFlushForSignOut;if(typeof original!=='function')return false;window.__texttextCloseFlush=[];window.texttextFlushForSignOut=async()=>{const started=performance.now();try{const ok=await original();window.__texttextCloseFlush.push({ok:ok===true,ms:Math.round(performance.now()-started)});return ok}catch(error){window.__texttextCloseFlush.push({error:true,ms:Math.round(performance.now()-started)});throw error}};return true})()" )).Task.Unwrap().WaitAsync(TimeSpan.FromSeconds(2), ct);
                log(new { kind = "close-hook-installed", installed });
            }
            // Observe the native modal dialog from a worker because MessageBox
            // runs its own modal loop and can block dispatcher timers.
            var uiThread = GetWindowThreadProcessId(new System.Windows.Interop.WindowInteropHelper(window).Handle, out _);
            _ = Task.Run(() =>
            {
                while (!closed.Task.IsCompleted && !ct.IsCancellationRequested)
                {
                    IntPtr dialog = IntPtr.Zero;
                    EnumThreadWindows(uiThread, (handle, _) =>
                    {
                        if (!IsWindowVisible(handle)) return true;
                        var title = new StringBuilder(256);
                        GetWindowText(handle, title, title.Capacity);
                        if (title.ToString() == "Keep editing") { dialog = handle; return false; }
                        return true;
                    }, IntPtr.Zero);
                    if (dialog != IntPtr.Zero)
                    {
                        Interlocked.Exchange(ref sawKeepEditing, 1);
                        var button = GetDlgItem(dialog, 1);
                        SendMessageTimeout(dialog, 0x0111, new IntPtr(1), button, 0x0002, 1000, out _);
                        PostMessage(dialog, 0x0010, IntPtr.Zero, IntPtr.Zero);
                        return;
                    }
                    Thread.Sleep(40);
                }
            }, ct);
            window.Closing += (_, args) => log(new { kind = "close-window-closing", args.Cancel });
            window.Closed += (_, _) => { log(new { kind = "close-window-closed" }); closed.TrySetResult(); log(new { kind = "close-window-completion-set" }); };
            log(new { kind = "close-window-request" });
            window.Close();
            log(new { kind = "close-window-returned" });
            log(new { kind = "close-probe-wait-enter", completed = closed.Task.IsCompleted });
            try { await closed.Task.WaitAsync(TimeSpan.FromSeconds(30), ct).ConfigureAwait(false); }
            catch (TimeoutException) { /* Report the close timeout below. */ }
            log(new { kind = "close-window-outcome", closed = closed.Task.IsCompleted, keepEditingDialog = Volatile.Read(ref sawKeepEditing) != 0 });
            if (Volatile.Read(ref sawKeepEditing) != 0) { await RecordEditorState("after-dialog"); return (false, true, false); }
            if (!closed.Task.IsCompleted) throw new Exception("Normal editor close did not finish within 30 seconds.");
            // MainWindow only raises Closed after its normal close handler's
            // production FlushEditor path returned success.
            flushed = true;
            return (true, false, true);
        }

        // Ported from the timed acceptance Run: production ready, same root, activation, real editor, shared document.
        async Task Open(CancellationToken ct)
        {
            if (opened) throw new Exception("Duplicate hello.");
            await Program.Until(async () => {
                view = Program.Field(window, "web") as WebView2;
                return view?.CoreWebView2 is not null && await view.ExecuteScriptAsync("typeof window.texttextOpenFile === 'function'") == "true";
            }, ct, "Production desktop did not become ready with its saved sign-in.");
            view!.CoreWebView2.NavigationStarting += (_, _) => Interlocked.Increment(ref assetNavigationGeneration);
            log(new { kind = "workspace-ready" });
            // Record only bridge error codes, never messages, document bytes or
            // authentication payloads. A late checkpoint refusal can explain a
            // close dialog even when the current journal is otherwise clean.
            await view!.ExecuteScriptAsync("window.__texttextStressBridgeErrors=[];window.chrome.webview.addEventListener('message',event=>{let value=event.data;try{if(typeof value==='string')value=JSON.parse(value);const code=value?.error?.code;if(typeof code==='string'){const entries=window.__texttextStressBridgeErrors;entries.push(code.slice(0,48));if(entries.length>32)entries.shift()}}catch{}})");
            var root = Program.Field(window, "root") as string ?? throw new Exception("Missing production workspace root.");
            if (!Path.GetFullPath(config.File).StartsWith(Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                throw new Exception("Test file is not inside the active workspace; workspace selection was not changed.");
            var active = typeof(MainWindow).GetProperty("ActiveWorkspaceId", Program.Private)?.GetValue(window) as string;
            if (active != config.WorkspaceId) throw new Exception("Active workspace does not match the configured fixture workspace.");
            capturedAccount = Program.Field(window, "workspaceAccount") as Account;
            capturedRoot = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar);
            RequireActorScope();
            await Program.Until(async () => await view!.ExecuteScriptAsync($"document.querySelector('.vault-context-location h2')?.textContent?.trim() === {expectedTitle}") == "true", ct, "Production file activation did not open the test item.");
            try
            {
                await Program.Until(async () => await view!.ExecuteScriptAsync(NativeStressReaderAction.Ready) == "true", ct, "Test reader did not expose its edit action.");
            }
            catch (Exception e)
            {
                var state = await view!.ExecuteScriptAsync("JSON.stringify({title:document.querySelector('.vault-context-location h2')?.textContent?.trim(),body:document.querySelector('[aria-label=\"Document body\"]')?.textContent?.slice(0,120),buttons:[...document.querySelectorAll('button')].map(b=>b.getAttribute('aria-label')||b.textContent?.trim()).filter(Boolean).slice(0,30),notices:[...document.querySelectorAll('.vault-notice,[role=\"alert\"]')].map(n=>n.textContent?.trim()).slice(0,5)})");
                throw new Exception("Test reader did not expose its edit action. State: " + state, e);
            }
            await view!.ExecuteScriptAsync(NativeStressReaderAction.Activate);
            await Task.Delay(1000, ct);
            if (await view.ExecuteScriptAsync("!!document.querySelector('[aria-label=\"Document body\"]')?.isContentEditable") != "true")
                await view.ExecuteScriptAsync(NativeStressReaderAction.Activate);
            await Program.Until(async () => await view.ExecuteScriptAsync("!!document.querySelector('[aria-label=\"Document body\"]')?.isContentEditable") == "true", ct, "Test item did not enter the real document editor.");
            await Program.Until(async () => await view.ExecuteScriptAsync($"(()=>{{const shared=document.querySelector('[data-collaboration-state=\"ready\"]');return shared?.dataset.collaborationItem === {expectedItem} && !!shared.querySelector('[aria-label=\"Document body\"]')?.isContentEditable}})()") == "true", ct, "Test editor did not join the shared document; a local-only editor cannot pass six-client readiness.");
            await view.ExecuteScriptAsync($"(()=>{{const initial=document.querySelector('[aria-label=\"Document body\"]');window.texttextStressSession={JsonSerializer.Serialize(sessionId)};window.texttextStressContinuity={{removed:false}};const observer=new MutationObserver(()=>{{if(!initial.isConnected){{window.texttextStressContinuity.removed=true;observer.disconnect()}}}});observer.observe(document.body,{{childList:true,subtree:true}})}})()");
            opened = true;
            log(new { kind = "ready", config.ItemId, sessionId });
        }

        void RequireActorScope()
        {
            var active = Program.Field(window, "workspaceAccount") as Account;
            var signedIn = Program.Field(window, "account") as Account;
            var root = Program.Field(window, "root") as string;
            if (capturedAccount?.AccountId is null || capturedRoot is null || active?.AccountId is null || signedIn?.AccountId is null
                || !AccountIdentity.SameAccount(capturedAccount, active) || !AccountIdentity.SameAccount(capturedAccount, signedIn)
                || active.WorkspaceId != config.WorkspaceId || signedIn.WorkspaceId != config.WorkspaceId
                || root is null || !string.Equals(capturedRoot, Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase))
                throw new Exception("The private test window's verified account, workspace or root changed. Reopen under the expected scope.");
        }

        static byte[] EvidenceBytes(string path, int limit)
        {
            var before = new FileInfo(path);
            if (!before.Exists || before.Length > limit || (before.Attributes & FileAttributes.ReparsePoint) != 0) throw new Exception("Identity evidence file missing or outside bound.");
            var size = before.Length; var modified = before.LastWriteTimeUtc;
            var bytes = File.ReadAllBytes(path); before.Refresh();
            if (bytes.LongLength != size || before.Length != size || before.LastWriteTimeUtc != modified) throw new Exception("Artifact changed while observing identity.");
            return bytes;
        }
        object ObservedIdentity()
        {
            RequireActorScope();
            if (config.IdentityReceipt is null || !Path.IsPathFullyQualified(config.IdentityReceipt)) throw new Exception("Explicit sealed build identity receipt required.");
            using var parsed = JsonDocument.Parse(EvidenceBytes(config.IdentityReceipt, 64 * 1024));
            var receipt = parsed.RootElement;
            if (receipt.GetProperty("schemaVersion").GetInt32() != 1 || receipt.GetProperty("role").GetString() != "pc-app") throw new Exception("Sealed private build identity receipt invalid.");
            var commit = receipt.GetProperty("sourceCommit").GetString() ?? "";
            var sourceReceipt = receipt.GetProperty("sourceReceiptSha256").GetString() ?? "";
            var inputs = receipt.GetProperty("sourceInputSha256").GetString() ?? "";
            if (!Regex.IsMatch(commit, @"^[a-f0-9]{40}\z") || !Regex.IsMatch(sourceReceipt, @"^[a-f0-9]{64}\z") || !Regex.IsMatch(inputs, @"^[a-f0-9]{64}\z")) throw new Exception("Sealed source evidence invalid.");
            var files = new Dictionary<string, string> {
                ["nativeExecutable"] = typeof(MainWindow).Assembly.Location,
                ["core"] = typeof(TextPackStore).Assembly.Location,
                ["actor"] = typeof(Stress).Assembly.Location,
                ["hostRuntime"] = Environment.ProcessPath ?? throw new Exception("Actual actor runtime path unavailable."),
            };
            var ui = Path.Combine(AppContext.BaseDirectory, "Assets");
            if (view?.Source?.GetLeftPart(UriPartial.Path) != "https://texttext.local/index.html") throw new Exception("Loaded UI differs from native assets.");
            foreach (var name in new[] { "app.js", "app.css", "index.html", "mirror-policy.js", "mirror-policy.json" }) files["localUI/" + name] = Path.Combine(ui, name);
            var artifacts = files.ToDictionary(pair => pair.Key, pair => Program.Hash(EvidenceBytes(pair.Value, 256 * 1024 * 1024)), StringComparer.Ordinal);
            var expected = receipt.GetProperty("artifacts").EnumerateObject().ToDictionary(pair => pair.Name, pair => pair.Value.GetString(), StringComparer.Ordinal);
            if (artifacts.Count != expected.Count || artifacts.Any(pair => !expected.TryGetValue(pair.Key, out var hash) || pair.Value != hash)) throw new Exception("Loaded native/Core/UI artifacts differ from sealed source receipt.");
            var account = Program.Field(window, "workspaceAccount") as Account;
            if (account?.AccountId is not { } accountId || !Regex.IsMatch(accountId, @"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\z")) throw new Exception("Verified account identity unavailable.");
            var scope = Program.Hash(Encoding.UTF8.GetBytes("texttext-account-v1\0https://texttext.app\0" + accountId));
            return new { schemaVersion = 1, role = "pc-app", platform = "win32", artifactKind = "private-acceptance",
                principalKind = "authenticated-account", principalScopeHash = scope, runtimeName = "WebView2",
                runtimeVersion = view!.CoreWebView2.Environment.BrowserVersionString, sourceCommit = commit,
                sourceReceiptSha256 = sourceReceipt, artifacts };
        }

        async Task RequireSelected(CancellationToken ct)
        {
            RequireActorScope();
            if (!opened || view?.CoreWebView2 is null) throw new Exception("Editor is not open; hello must succeed first.");
            var allowedStates = transport.Online ? "['ready','saving']" : "['ready','saving','offline','reconnecting']";
            var ok = await view.ExecuteScriptAsync($"(()=>{{const shared=document.querySelector('[data-collaboration-item]');return document.querySelector('.vault-context-location h2')?.textContent?.trim() === {expectedTitle} && {allowedStates}.includes(shared?.dataset.collaborationState) && shared?.dataset.collaborationItem === {expectedItem} && !!shared.querySelector('[aria-label=\"Document body\"]')?.isContentEditable}})()");
            if (ok != "true")
            {
                var state = await view.ExecuteScriptAsync("JSON.stringify({title:document.querySelector('.vault-context-location h2')?.textContent?.trim()??null,collaborationState:document.querySelector('[data-collaboration-item]')?.dataset.collaborationState??null,collaborationItem:document.querySelector('[data-collaboration-item]')?.dataset.collaborationItem??null,editable:!!document.querySelector('[aria-label=\"Document body\"]')?.isContentEditable,notices:[...document.querySelectorAll('.vault-notice,[role=\"alert\"]')].map(e=>e.textContent?.trim())})");
                throw new Exception("Editor is no longer on the dedicated test item in the shared document. State: " + state);
            }
            ct.ThrowIfCancellationRequested();
        }

        async Task<string?> Body()
        {
            RequireActorScope();
            using var snapshot = JsonDocument.Parse(await view!.ExecuteScriptAsync("JSON.stringify({title:document.querySelector('.vault-context-location h2')?.textContent?.trim(),body:document.querySelector('[aria-label=\"Document body\"]')?.textContent??null})"));
            using var parsed = JsonDocument.Parse(snapshot.RootElement.GetString()!);
            if (parsed.RootElement.GetProperty("title").GetString() != config.Title) throw new Exception("Editor navigated away from the dedicated test item.");
            return parsed.RootElement.GetProperty("body").ValueKind == JsonValueKind.String ? parsed.RootElement.GetProperty("body").GetString() : null;
        }

        async Task<JsonElement> InspectDocument(CancellationToken ct)
        {
            await RequireSelected(ct);
            var script = NativeStressDocumentInspection.Script(config.ItemId,config.WorkspaceId);
            var raw = await view!.ExecuteScriptAsync(script);
            if (Encoding.UTF8.GetByteCount(raw) > 262144) throw new Exception("Full live document exceeds bound.");
            using var parsed = JsonDocument.Parse(raw);
            var doc = parsed.RootElement;
            NativeStressDocumentInspection.Validate(doc,config.Title);
            return doc.Clone();
        }

        async Task<object> ExerciseFields(string id, string text, JsonElement fields, CancellationToken ct)
        {
            if (fields.ValueKind != JsonValueKind.Array || fields.GetArrayLength() != 2) throw new Exception("Invalid bounded field sequence.");
            var edits = fields.EnumerateArray().ToArray();
            for (var index = 0; index < 2; index++)
            {
                var field = index == 0 ? "body" : "subtitle"; var edit = edits[index]; var marker = edit.GetProperty("text").GetString();
                if (edit.GetProperty("id").GetString() != id + "-" + field || edit.GetProperty("role").GetString() != "pc-app"
                    || edit.GetProperty("field").GetString() != field || edit.GetProperty("op").GetString() != "append"
                    || string.IsNullOrEmpty(marker) || marker.Length > 1024 || marker.Contains('\n') || marker.Contains('\r') || (index == 0 && marker != text)) throw new Exception("Invalid role-bound field edit.");
            }
            var clock = System.Diagnostics.Stopwatch.StartNew();
            var preserved = (await InspectDocument(ct)).GetProperty("content");
            var progress = new List<object>();
            for (var index = 0; index < 2; index++)
            {
                var edit = edits[index]; var field = edit.GetProperty("field").GetString()!; var marker = edit.GetProperty("text").GetString()!; var editId = edit.GetProperty("id").GetString()!;
                if (NativeStressDocumentInspection.Field(preserved,field).Contains(marker)) throw new Exception("Field marker already present.");
                if (index > 0) await Task.Delay(1, ct);
                fieldProgress = new { role = "pc-app", fields = progress.ToArray(), attemptedField = editId };
                if (field == "body") await Insert(editId, marker, false, false, ct, clock);
                else
                {
                    await RequireSelected(ct);
                    if (await view!.ExecuteScriptAsync("(()=>{const e=document.querySelector('textarea[aria-label=\"Subtitle\"]');if(!e||e.disabled||e.readOnly)return false;e.focus();e.setSelectionRange(e.value.length,e.value.length);return document.activeElement===e})()") != "true") throw new Exception("Existing subtitle is not editable.");
                    await view.CoreWebView2.CallDevToolsProtocolMethodAsync("Input.insertText", JsonSerializer.Serialize(new { text = marker }));
                }
                for (;;)
                {
                    if (clock.ElapsedMilliseconds > 15000) throw new Exception("Field visibility or preservation deadline exceeded.");
                    var current = (await InspectDocument(ct)).GetProperty("content");
                    if (NativeStressDocumentInspection.Field(current,field).Split(marker, StringSplitOptions.None).Length == 2)
                    {
                        var intact = true;
                        foreach (var key in new[] { "body", "subtitle" })
                        {
                            var observed = NativeStressDocumentInspection.Field(current,key); if (key == field) observed = observed.Replace(marker, "", StringComparison.Ordinal);
                            var prior = NativeStressDocumentInspection.Field(preserved,key).EnumerateRunes().ToArray(); var offset = 0;
                            foreach (var rune in observed.EnumerateRunes()) if (offset < prior.Length && rune == prior[offset]) offset++;
                            if (offset != prior.Length) intact = false;
                        }
                        if (intact)
                        {
                            progress.Add(new { ordinal = index + 1, editId, field, text = marker, visible = true, preservedVisibleContent = true, elapsedMs = clock.Elapsed.TotalMilliseconds });
                            preserved = current; fieldProgress = new { role = "pc-app", fields = progress.ToArray() }; break;
                        }
                    }
                    await Task.Delay(25, ct);
                }
            }
            return new { role = "pc-app", fields = progress.ToArray() };
        }

        async Task<object> ExerciseHistory(string id, string text, CancellationToken ct)
        {
            var clock = System.Diagnostics.Stopwatch.StartNew();
            await Task.Delay(450, ct); // Product captureTimeout is 400ms.
            var preserved = await Body() ?? throw new Exception("History baseline unavailable.");
            if (preserved.Contains(text)) throw new Exception("History marker already present.");
            var stages = new List<object>();
            for (var index = 0; index < 3; index++)
            {
                if (index > 0) await Task.Delay(1, ct);
                await RequireSelected(ct);
                var stage = new[] { "insert", "undo", "redo" }[index];
                historyProgress = new { editId = id, stages = stages.ToArray(), attemptedStage = stage };
                if (index == 0) await Insert(id, text, false, false, ct, clock);
                else
                {
                    var key = index == 1 ? "z" : "y";
                    var code = index == 1 ? "KeyZ" : "KeyY";
                    var vk = index == 1 ? 90 : 89;
                    foreach (var kind in new[] { "rawKeyDown", "keyUp" })
                        await view!.CoreWebView2.CallDevToolsProtocolMethodAsync("Input.dispatchKeyEvent", JsonSerializer.Serialize(new { type = kind, modifiers = 2, key, code, windowsVirtualKeyCode = vk, nativeVirtualKeyCode = vk }));
                }
                for (;;)
                {
                    if (clock.ElapsedMilliseconds > 15000) throw new Exception("History visibility or preservation deadline exceeded.");
                    var current = await Body();
                    if (current is not null && current.Split(text, StringSplitOptions.None).Length - 1 == (index == 1 ? 0 : 1))
                    {
                        var stripped = current.Replace(text, "", StringComparison.Ordinal);
                        var prior = preserved.EnumerateRunes().ToArray(); var offset = 0;
                        foreach (var rune in stripped.EnumerateRunes()) if (offset < prior.Length && rune == prior[offset]) offset++;
                        if (offset == prior.Length)
                        {
                            stages.Add(new { stage, editId = id, text, ownOccurrences = index == 1 ? 0 : 1, preservedVisibleContent = true, elapsedMs = clock.Elapsed.TotalMilliseconds });
                            preserved = stripped;
                            historyProgress = new { editId = id, stages = stages.ToArray() };
                            break;
                        }
                    }
                    await Task.Delay(25, ct);
                }
            }
            return new { editId = id, stages = stages.ToArray() };
        }

        async Task Insert(string id, string text, bool start, bool replacing, CancellationToken ct, System.Diagnostics.Stopwatch? sequenceClock = null)
        {
            var before = await Body() ?? throw new Exception("Test editor body is not present.");
            if (before.Contains(text)) throw new Exception("Edit text already present before input: " + id);
            // Real contenteditable focus and a collapsed selection at the end, then the exact text through the input pipeline.
            if (replacing)
            {
                if (await view!.ExecuteScriptAsync("window.getSelection()?.toString()==='Existing fixture text.'") != "true") throw new Exception("Replacement selection changed before input.");
            }
            else await view!.ExecuteScriptAsync($"(()=>{{const e=document.querySelector('[aria-label=\"Document body\"]');e.focus();const r=document.createRange();r.selectNodeContents(e);r.collapse({(start ? "true" : "false")});const s=window.getSelection();s.removeAllRanges();s.addRange(r)}})()");
            log(new { kind = "input", editId = id });
            await view.CoreWebView2.CallDevToolsProtocolMethodAsync("Input.insertText", JsonSerializer.Serialize(new { text }));
            var deadline = DateTimeOffset.UtcNow + EditBound;
            while (true)
            {
                var body = await Body();
                if (body is not null && body.Split(text, StringSplitOptions.None).Length == 2) break;
                if (DateTimeOffset.UtcNow >= deadline || sequenceClock?.ElapsedMilliseconds >= 15000) throw new Exception("Inserted text did not appear exactly once in the visible editor: " + id);
                await Task.Delay(100, ct);
            }
        }

        // Sample until the marker-derived edit IDs equal the expected set and the text is stable, at most 30 s; report what was seen.
        async Task<(string text, string[] editIds)> Observe(string[] expected, CancellationToken ct)
        {
            var deadline = DateTimeOffset.UtcNow + ObserveBound;
            string last = ""; string[] ids = []; var stable = 0;
            while (true)
            {
                var body = await Body();
                if (body is not null)
                {
                    if (body.Length > MaxText) throw new Exception("Visible editor text exceeds the protocol bound.");
                    ids = MarkerPattern.Matches(body).Select(m => $"r{m.Groups[3].Value}-{m.Groups[1].Value}-{m.Groups[2].Value}").Distinct().OrderBy(x => x, StringComparer.Ordinal).ToArray();
                    stable = body == last ? stable + 1 : 0;
                    last = body;
                    if (stable >= 2 && ids.SequenceEqual(expected)) break;
                }
                if (DateTimeOffset.UtcNow >= deadline) { log(new { kind = "observe-timeout", stable, expected = expected.Length, actual = ids.Length }); break; }
                await Task.Delay(250, ct);
            }
            return (last, ids);
        }

        // Idempotent: the production flush runs once, on shutdown or on the way out after a failure.
        public async Task<bool> Flush()
        {
            if (flushed is { } done) return done;
            if (!opened) return (flushed = true).Value;
            var flush = typeof(MainWindow).GetMethod("FlushEditor", Program.Private) ?? throw new Exception("Missing production flush path.");
            var ok = await (Task<bool>)flush.Invoke(window, null)!;
            flushed = ok;
            log(new { kind = "flush", ok });
            if (!ok) Fail("Production editor flush failed; recovery state retained.");
            return ok;
        }
    }
}
