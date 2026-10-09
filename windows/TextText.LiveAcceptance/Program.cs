using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using System.Windows;
using Microsoft.Web.WebView2.Wpf;
using TextText.Core;
using TextText.Windows;

// Explicit, test-only runner. Production MainWindow owns authentication, HTTP,
// watchers, journals and rendering. No substituted bridge or network responses.
// Only a pre-created, identity-checked Six-client acceptance TextPack is edited.
static class Program
{
    sealed record Plan(string File, string ItemId, string Title, string RunId,
        DateTimeOffset StartUtc, int Rounds, int IntervalMs, int ObserveSeconds,
        string[] ExpectedMarkers);
    const BindingFlags Private = BindingFlags.Instance | BindingFlags.NonPublic;
    static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };
    static object? Field(MainWindow window, string name) => typeof(MainWindow).GetField(name, Private)?.GetValue(window);
    static string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    static string Marker(Plan plan, int round) => $"[pc-app:{plan.RunId}:{round:D2}]";

    [STAThread] static int Main(string[] args)
    {
        if (args.Length != 2) { Console.Error.WriteLine("Usage: TextText.LiveAcceptance <plan.json> <new-receipt-directory>"); return 2; }
        try
        {
            var plan = JsonSerializer.Deserialize<Plan>(File.ReadAllText(args[0]), Json) ?? throw new Exception("Missing plan");
            Validate(plan);
            if (Directory.Exists(args[1])) throw new Exception("Receipt directory already exists; use a fresh run directory.");
            var key = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(WindowsIdentity.GetCurrent().User!.Value)))[..24];
            using var instance = new Mutex(true, "Global\\TextText.Desktop." + key, out var created);
            if (!created) throw new Exception("Close TextText before running acceptance; two native writers must not share its device journal.");
            Directory.CreateDirectory(args[1]);
            using var log = new StreamWriter(Path.Combine(args[1], "events.jsonl")) { AutoFlush = true };
            void Record(object value) => log.WriteLine(JsonSerializer.Serialize(new { utc = DateTimeOffset.UtcNow, value }));
            Record(new { kind = "start", plan.ItemId, plan.RunId, plan.StartUtc,
                nativeAssemblySha256 = Hash(File.ReadAllBytes(typeof(MainWindow).Assembly.Location)),
                adapter = "production MainWindow + WindowsBridge", mockedTransport = false });
            var app = new Application();
            MainWindow.WorkspaceFactory = context => new WindowsBridge(context);
            var window = new MainWindow(Path.Combine(Path.GetFullPath(args[1]), "webview-profile"));
            var exit = 1;
            // MainWindow's production Loaded callback is registered first.
            window.Loaded += async (_, _) =>
            {
                using var timeout = new CancellationTokenSource(TimeSpan.FromMinutes(12));
                try
                {
                    await Run(window, plan, Record, timeout.Token);
                    File.WriteAllText(Path.Combine(args[1], "result.json"), JsonSerializer.Serialize(new { ok = true, plan.ItemId, plan.RunId }));
                    exit = 0;
                }
                catch (Exception error)
                {
                    Record(new { kind = "failure", message = error.Message });
                    File.WriteAllText(Path.Combine(args[1], "result.json"), JsonSerializer.Serialize(new { ok = false, error = error.Message, plan.ItemId, plan.RunId }));
                }
                finally
                {
                    // Use the production flush-on-close path. A failed flush
                    // deliberately keeps the window/journal available for recovery.
                    window.Close();
                }
            };
            app.Run(window);
            return exit;
        }
        catch (Exception error) { Console.Error.WriteLine(error.Message); return 1; }
    }

    static void Validate(Plan plan)
    {
        if (!Path.IsPathFullyQualified(plan.File) || !plan.File.EndsWith(".textpack", StringComparison.OrdinalIgnoreCase)
            || !plan.Title.StartsWith("Six-client acceptance ", StringComparison.Ordinal)
            || Path.GetFileNameWithoutExtension(plan.File) != plan.Title
            || !Guid.TryParse(plan.ItemId, out _) || !System.Text.RegularExpressions.Regex.IsMatch(plan.RunId, "^[a-zA-Z0-9_-]{1,40}$")
            || plan.Rounds is < 1 or > 32 || plan.IntervalMs is < 500 or > 10000 || plan.ObserveSeconds is < 5 or > 120
            || plan.StartUtc < DateTimeOffset.UtcNow || plan.StartUtc > DateTimeOffset.UtcNow.AddMinutes(5)
            || plan.ExpectedMarkers is null || plan.ExpectedMarkers.Length > 256
            || plan.ExpectedMarkers.Any(value => string.IsNullOrEmpty(value) || value.Length > 100))
            throw new Exception("Invalid or expired bounded acceptance plan.");
        if (TextPackStore.Identity(File.ReadAllBytes(plan.File)) != plan.ItemId) throw new Exception("Test file identity mismatch.");
    }

    static async Task Until(Func<Task<bool>> condition, CancellationToken ct, string message)
    {
        using var bound = CancellationTokenSource.CreateLinkedTokenSource(ct);
        bound.CancelAfter(TimeSpan.FromSeconds(45));
        try { while (!await condition()) await Task.Delay(100, bound.Token); }
        catch (OperationCanceledException) { throw new Exception(message); }
    }

    static async Task Run(MainWindow window, Plan plan, Action<object> record, CancellationToken ct)
    {
        WebView2? view = null;
        await Until(async () => {
            view = Field(window, "web") as WebView2;
            return view?.CoreWebView2 is not null && await view.ExecuteScriptAsync("typeof window.texttextOpenFile === 'function'") == "true";
        }, ct, "Production desktop did not become ready with its saved sign-in.");
        record(new { kind = "workspace-ready" });
        var root = Field(window, "root") as string ?? throw new Exception("Missing production workspace root.");
        if (!Path.GetFullPath(plan.File).StartsWith(Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            throw new Exception("Test file is not inside the active workspace; workspace selection was not changed.");
        var core = view!.CoreWebView2;
        window.ActivateFiles([plan.File]);
        var expectedTitle = JsonSerializer.Serialize(plan.Title);
        await Until(async () => await view.ExecuteScriptAsync($"document.querySelector('.vault-context-location h2')?.textContent?.trim() === {expectedTitle}") == "true", ct, "Production file activation did not open the test item.");
        await Until(async () => await view.ExecuteScriptAsync("!!document.querySelector('button[aria-label=\"Edit card\"]') || !!document.querySelector('[aria-label=\"Document body\"]')?.isContentEditable") == "true", ct, "Test reader did not expose its edit action.");
        await view.ExecuteScriptAsync("document.querySelector('button[aria-label=\"Edit card\"]')?.click()");
        await Until(async () => await view.ExecuteScriptAsync("!!document.querySelector('[aria-label=\"Document body\"]')?.isContentEditable") == "true", ct, "Test item did not enter the real document editor.");
        if (DateTimeOffset.UtcNow >= plan.StartUtc) throw new Exception("Editor missed the coordinated start; discard this run and schedule a fresh one.");
        record(new { kind = "ready", plan.ItemId });
        var last = "";
        async Task<string> Snapshot()
        {
            var started = DateTimeOffset.UtcNow;
            while (true)
            {
                using var snapshot = JsonDocument.Parse(await view.ExecuteScriptAsync("JSON.stringify({title:document.querySelector('.vault-context-location h2')?.textContent?.trim(),body:document.querySelector('[aria-label=\"Document body\"]')?.textContent,notices:[...document.querySelectorAll('.vault-notice,[role=\"alert\"]')].map(e=>e.textContent),reader:!!document.querySelector('[aria-label=\"Note card\"]')})"));
                var data = snapshot.RootElement.GetString()!;
                using var parsed = JsonDocument.Parse(data);
                if (parsed.RootElement.GetProperty("title").GetString() != plan.Title) throw new Exception("Editor navigated away from the dedicated test item.");
                if (data != last) { record(new { kind = "editor", snapshot = parsed.RootElement.Clone() }); last = data; }
                if (parsed.RootElement.TryGetProperty("body", out var body) && body.ValueKind == JsonValueKind.String)
                {
                    if ((DateTimeOffset.UtcNow - started).TotalMilliseconds > 100)
                        record(new { kind = "editor-gap", milliseconds = (DateTimeOffset.UtcNow - started).TotalMilliseconds });
                    return body.GetString()!;
                }
                if ((DateTimeOffset.UtcNow - started).TotalSeconds >= 5) throw new Exception("Test editor disappeared for five seconds; see the recorded notices and reader state.");
                await Task.Delay(100, ct);
            }
        }
        for (var round = 0; round < plan.Rounds; round++)
        {
            var due = plan.StartUtc.AddMilliseconds(round * plan.IntervalMs);
            while (DateTimeOffset.UtcNow < due) { await Snapshot(); await Task.Delay(100, ct); }
            var marker = Marker(plan, round);
            await view.ExecuteScriptAsync("(()=>{const e=document.querySelector('[aria-label=\"Document body\"]');e.focus();const r=document.createRange();r.selectNodeContents(e);r.collapse(false);const s=window.getSelection();s.removeAllRanges();s.addRange(r)})()");
            record(new { kind = "input", marker });
            await core.CallDevToolsProtocolMethodAsync("Input.insertText", JsonSerializer.Serialize(new { text = " " + marker }));
            await Snapshot();
        }
        var finish = DateTimeOffset.UtcNow.AddSeconds(plan.ObserveSeconds);
        string final = "";
        while (DateTimeOffset.UtcNow < finish) { final = await Snapshot(); await Task.Delay(100, ct); }
        foreach (var marker in plan.ExpectedMarkers.Concat(Enumerable.Range(0, plan.Rounds).Select(round => Marker(plan, round))).Distinct())
            if (final.Split(marker, StringSplitOptions.None).Length != 2) throw new Exception("Expected marker missing or duplicated in visible editor: " + marker);
        var flush = typeof(MainWindow).GetMethod("FlushEditor", Private) ?? throw new Exception("Missing production flush path.");
        if (!await (Task<bool>)flush.Invoke(window, null)!) throw new Exception("Production editor flush failed; recovery state retained.");
        var bytes = File.ReadAllBytes(plan.File);
        if (TextPackStore.Identity(bytes) != plan.ItemId) throw new Exception("Persisted file identity changed.");
        var markdown = TextPackStore.Markdown(bytes);
        foreach (var marker in plan.ExpectedMarkers.Concat(Enumerable.Range(0, plan.Rounds).Select(round => Marker(plan, round))).Distinct())
            if (markdown.Split(marker, StringSplitOptions.None).Length != 2) throw new Exception("Expected marker missing or duplicated on disk: " + marker);
        record(new { kind = "verified", visibleBodySha256 = Hash(Encoding.UTF8.GetBytes(final)), packSha256 = Hash(bytes), plan.ItemId });
    }
}
