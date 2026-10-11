using System.IO;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
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
    sealed class CollaborationTransportGate
    {
        int online = 1;
        public bool Online { get => Volatile.Read(ref online) != 0; set => Volatile.Write(ref online, value ? 1 : 0); }
    }

    sealed record Config(string File, string ItemId, string WorkspaceId, string Title, int TotalMinutes = 20);
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
            Validate(config);
            if (!Path.IsPathFullyQualified(session) || !Directory.Exists(session)) throw new Exception("Stress session directory must be an existing absolute directory created by the relay.");
            if (Directory.EnumerateFiles(session, "rep-*.json").Any() || File.Exists(Path.Combine(session, "events.jsonl"))) throw new Exception("Stress session directory was already used; use a new session directory.");
            File.WriteAllText(Path.Combine(session, "actor.pid"), Environment.ProcessId.ToString());
            var key = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(WindowsIdentity.GetCurrent().User!.Value)))[..24];
            using var instance = new Mutex(true, "Global\\TextText.Desktop." + key, out var created);
            if (!created) throw new Exception("Close TextText before running the stress adapter; two native writers must not share its device journal.");
            using var log = new StreamWriter(Path.Combine(session, "events.jsonl")) { AutoFlush = true };
            void Record(object value) => log.WriteLine(JsonSerializer.Serialize(new { utc = DateTimeOffset.UtcNow, value }));
            var assembly = typeof(MainWindow).Assembly;
            var version = assembly.GetName().Version?.ToString() ?? "0";
            var assemblyHash = Program.Hash(File.ReadAllBytes(assembly.Location));
            Record(new { kind = "start", config.ItemId, config.WorkspaceId, nativeAssemblySha256 = assemblyHash, nativeAssemblyVersion = version,
                adapter = "production MainWindow + WindowsBridge", mockedTransport = false });
            var app = new Application();
            var transport = new CollaborationTransportGate();
            var generationMatch = GenerationPattern.Match(Path.GetFileName(Path.TrimEndingDirectorySeparator(session)));
            var generation = generationMatch.Success ? int.Parse(generationMatch.Groups[1].Value) : 1;
            MainWindow.WorkspaceFactory = context => new WindowsBridge(context);
            var window = new MainWindow(Path.Combine(Path.GetFullPath(session), "webview-profile"));
            window.ActivateFiles([config.File]);
            var exit = 1;
            window.Loaded += async (_, _) =>
            {
                using var timeout = new CancellationTokenSource(TimeSpan.FromMinutes(config.TotalMinutes));
                var runner = new Runner(window, config, session, generation, transport, Record, $"native-mainwindow/{version}/{assemblyHash[..16]}");
                try
                {
                    await runner.Loop(timeout.Token);
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
                    // Production flush-on-close. A failed flush keeps journals and the failure recorded;
                    // this disposable test window still closes so the one-off task ends.
                    var flushed = false;
                    try { flushed = await runner.Flush(); } catch (Exception error) { runner.Fail(error.Message); }
                    File.WriteAllText(Path.Combine(session, "result.json"), JsonSerializer.Serialize(new { ok = runner.Failure is null && flushed, flushed, error = runner.Failure, config.ItemId }));
                    if (!flushed) exit = 1;
                    typeof(MainWindow).GetField("closing", Program.Private)?.SetValue(window, true);
                    window.Close();
                }
            };
            app.Run(window);
            return exit;
        }
        catch (Exception error) { Console.Error.WriteLine(error.Message); return 1; }
    }

    static void Validate(Config config)
    {
        if (!Path.IsPathFullyQualified(config.File) || !config.File.EndsWith(".textpack", StringComparison.OrdinalIgnoreCase)
            || !config.Title.StartsWith("Six-client acceptance ", StringComparison.Ordinal)
            || Path.GetFileNameWithoutExtension(config.File) != config.Title
            || !Guid.TryParse(config.ItemId, out _) || !IdPattern.IsMatch(config.WorkspaceId)
            || config.TotalMinutes is < 1 or > 120)
            throw new Exception("Invalid stress config: absolute .textpack File, Guid ItemId, WorkspaceId, Title starting 'Six-client acceptance ' equal to the file name, TotalMinutes 1..120.");
        if (TextPackStore.Identity(File.ReadAllBytes(config.File)) != config.ItemId) throw new Exception("Test file identity mismatch.");
    }

    sealed class Runner(MainWindow window, Config config, string session, int generation, CollaborationTransportGate transport, Action<object> log, string adapterName)
    {
        public string? Failure { get; private set; }
        WebView2? view;
        bool opened;
        readonly string sessionId = "editor-" + Guid.NewGuid().ToString("N");
        readonly string expectedTitle = JsonSerializer.Serialize(config.Title);
        readonly string expectedItem = JsonSerializer.Serialize(config.ItemId);
        string expectedSession => JsonSerializer.Serialize(sessionId);
        bool? flushed;
        int reloads;

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
                    try { reply = await Handle(type, round, request.RootElement, ct); }
                    catch (OperationCanceledException) { throw; }
                    catch (Exception error) { Fail(error.Message); reply = new { type = "error", round, message = error.Message }; }
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
                    await Open(ct);
                    return new { type = "attest", round = 0, mode = "real", workspaceId = config.WorkspaceId, itemId = config.ItemId,
                        machineId = System.Net.Dns.GetHostName(), adapter = adapterName, generation, sessionId };
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
                    await RequireSelected(ct);
                    var expected = request.TryGetProperty("expectedEditIds", out var ids) && ids.ValueKind == JsonValueKind.Array
                        ? ids.EnumerateArray().Select(e => e.GetString() ?? "").OrderBy(e => e, StringComparer.Ordinal).ToArray() : [];
                    var (text, editIds) = await Observe(expected, ct);
                    var continuous = await view!.ExecuteScriptAsync("window.texttextStressContinuity?.removed === false") == "true";
                    var sessionSeen = await view.ExecuteScriptAsync("window.texttextStressSession ?? null");
                    if (!continuous || sessionSeen != expectedSession) reloads++;
                    log(new { kind = "observed", round, continuous, sessionPresent = sessionSeen == expectedSession, reloads, editIds });
                    return new { type = "state", round, text, editIds, editor = new { sessionId, reloads } };
                }
                default:
                    throw new Exception("Unsupported coordinator message type.");
            }
        }

        // Ported from the timed acceptance Run: production ready, same root, activation, real editor, shared document.
        async Task Open(CancellationToken ct)
        {
            if (opened) throw new Exception("Duplicate hello.");
            await Program.Until(async () => {
                view = Program.Field(window, "web") as WebView2;
                return view?.CoreWebView2 is not null && await view.ExecuteScriptAsync("typeof window.texttextOpenFile === 'function'") == "true";
            }, ct, "Production desktop did not become ready with its saved sign-in.");
            log(new { kind = "workspace-ready" });
            var root = Program.Field(window, "root") as string ?? throw new Exception("Missing production workspace root.");
            if (!Path.GetFullPath(config.File).StartsWith(Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                throw new Exception("Test file is not inside the active workspace; workspace selection was not changed.");
            var active = typeof(MainWindow).GetProperty("ActiveWorkspaceId", Program.Private)?.GetValue(window) as string;
            if (active != config.WorkspaceId) throw new Exception("Active workspace does not match the configured fixture workspace.");
            window.ActivateFiles([config.File]);
            await Program.Until(async () => await view!.ExecuteScriptAsync($"document.querySelector('.vault-context-location h2')?.textContent?.trim() === {expectedTitle}") == "true", ct, "Production file activation did not open the test item.");
            await Program.Until(async () => await view!.ExecuteScriptAsync("!!document.querySelector('button[aria-label=\"Edit card\"]') || !!document.querySelector('[aria-label=\"Document body\"]')?.isContentEditable") == "true", ct, "Test reader did not expose its edit action.");
            await view!.ExecuteScriptAsync("document.querySelector('button[aria-label=\"Edit card\"]')?.click()");
            await Program.Until(async () => await view.ExecuteScriptAsync("!!document.querySelector('[aria-label=\"Document body\"]')?.isContentEditable") == "true", ct, "Test item did not enter the real document editor.");
            await Program.Until(async () => await view.ExecuteScriptAsync($"(()=>{{const shared=document.querySelector('[data-collaboration-state=\"ready\"]');return shared?.dataset.collaborationItem === {expectedItem} && !!shared.querySelector('[aria-label=\"Document body\"]')?.isContentEditable}})()") == "true", ct, "Test editor did not join the shared document; a local-only editor cannot pass six-client readiness.");
            await view.ExecuteScriptAsync($"(()=>{{const initial=document.querySelector('[aria-label=\"Document body\"]');window.texttextStressSession={JsonSerializer.Serialize(sessionId)};window.texttextStressContinuity={{removed:false}};const observer=new MutationObserver(()=>{{if(!initial.isConnected){{window.texttextStressContinuity.removed=true;observer.disconnect()}}}});observer.observe(document.body,{{childList:true,subtree:true}})}})()");
            opened = true;
            log(new { kind = "ready", config.ItemId, sessionId });
        }

        async Task RequireSelected(CancellationToken ct)
        {
            if (!opened || view?.CoreWebView2 is null) throw new Exception("Editor is not open; hello must succeed first.");
            var ok = await view.ExecuteScriptAsync($"(()=>{{const shared=document.querySelector('[data-collaboration-item]');return document.querySelector('.vault-context-location h2')?.textContent?.trim() === {expectedTitle} && ['ready','saving'].includes(shared?.dataset.collaborationState) && shared?.dataset.collaborationItem === {expectedItem} && !!shared.querySelector('[aria-label=\"Document body\"]')?.isContentEditable}})()");
            if (ok != "true")
            {
                var state = await view.ExecuteScriptAsync("JSON.stringify({title:document.querySelector('.vault-context-location h2')?.textContent?.trim()??null,collaborationState:document.querySelector('[data-collaboration-item]')?.dataset.collaborationState??null,collaborationItem:document.querySelector('[data-collaboration-item]')?.dataset.collaborationItem??null,editable:!!document.querySelector('[aria-label=\"Document body\"]')?.isContentEditable,notices:[...document.querySelectorAll('.vault-notice,[role=\"alert\"]')].map(e=>e.textContent?.trim())})");
                throw new Exception("Editor is no longer on the dedicated test item in the shared document. State: " + state);
            }
            ct.ThrowIfCancellationRequested();
        }

        async Task<string?> Body()
        {
            using var snapshot = JsonDocument.Parse(await view!.ExecuteScriptAsync("JSON.stringify({title:document.querySelector('.vault-context-location h2')?.textContent?.trim(),body:document.querySelector('[aria-label=\"Document body\"]')?.textContent??null})"));
            using var parsed = JsonDocument.Parse(snapshot.RootElement.GetString()!);
            if (parsed.RootElement.GetProperty("title").GetString() != config.Title) throw new Exception("Editor navigated away from the dedicated test item.");
            return parsed.RootElement.GetProperty("body").ValueKind == JsonValueKind.String ? parsed.RootElement.GetProperty("body").GetString() : null;
        }

        async Task Insert(string id, string text, bool start, bool replacing, CancellationToken ct)
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
                if (DateTimeOffset.UtcNow >= deadline) throw new Exception("Inserted text did not appear exactly once in the visible editor: " + id);
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
