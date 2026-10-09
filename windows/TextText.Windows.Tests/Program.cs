// Startup regression for the native bridge: listing and readiness must answer
// while a remote sync pass holds the sync gate. The shared renderer abandons
// bootstrap reads after 8 seconds, so a slow first pass used to leave the
// installed Windows app blank and then report a connection timeout.
using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO.Compression;
using System.Text.Json;
using TextText.Core;
using TextText.Windows;

var failures = 0;
void Assert(bool condition, string name) { Console.WriteLine((condition ? "ok   " : "FAIL ") + name); if (!condition) failures++; }
static byte[] Pack(string body, string id) {
    using var output = new MemoryStream();
    using (var zip = new ZipArchive(output, ZipArchiveMode.Create, true)) using (var writer = new StreamWriter(zip.CreateEntry("text.md").Open())) writer.Write("---\ntextTextId: \"" + id + "\"\n---\n" + body);
    return output.ToArray();
}
static JsonElement Json(object? value) => JsonSerializer.SerializeToElement(value);

var temporaryRoot = Path.GetTempPath();
if (OperatingSystem.IsMacOS() && temporaryRoot.StartsWith("/var/")) temporaryRoot = "/private" + temporaryRoot;
var temp = Path.Combine(temporaryRoot, "texttext-windows-bridge-" + Guid.NewGuid().ToString("N"));
var root = Path.Combine(temp, "workspace"); var state = Path.Combine(temp, "state");
Directory.CreateDirectory(root); Directory.CreateDirectory(state);
try {
    var local = new TextPackStore(root, state).Write("Notes/Startup.textpack", Pack("startup", "startup-1"));
    var transport = new StalledTransport();
    var events = new ConcurrentQueue<string>();
    var context = new WorkspaceContext(root, "11111111-2222-3333-4444-555555555555", new Uri("https://texttext.app"), () => Task.FromResult("fixture-token"), (name, _) => { events.Enqueue(name); return Task.CompletedTask; });
    using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(60));
    var bridge = new WindowsBridge(context, transport, state);
    try {
        await transport.ManifestStarted.Task.WaitAsync(deadline.Token);
        // The first remote pass now holds the sync gate and will not finish until released.
        var clock = Stopwatch.StartNew();
        var listing = Json(await bridge.InvokeAsync("files.list", Json(new { }), deadline.Token));
        var listed = clock.Elapsed;
        Assert(listed < WindowsBridge.GateWait + TimeSpan.FromSeconds(3), $"listing answers while the sync pass holds the gate ({listed.TotalMilliseconds:F0} ms)");
        Assert(listing.GetProperty("items").GetArrayLength() == 1 && listing.GetProperty("items")[0].GetProperty("itemId").GetString() == "startup-1", "listing contains the local file");
        Assert(listing.GetProperty("items")[0].GetProperty("canEditContent").GetBoolean() && listing.GetProperty("fullAccess").GetBoolean(), "owner default permissions apply before the gate is available");
        clock.Restart();
        var ready = Json(await bridge.InvokeAsync("files.ready", Json(new { itemId = "startup-1" }), deadline.Token));
        Assert(clock.Elapsed < WindowsBridge.GateWait + TimeSpan.FromSeconds(3) && !ready.GetProperty("ready").GetBoolean(), "readiness answers not-ready instead of waiting for the pass");
        Assert(!events.Contains("texttext:vault-changed"), "no refresh is announced while the pass still runs");

        // Release the pass with restrictive server capabilities; the bridge must ask the renderer to list again.
        transport.Capabilities = new WorkspaceCapabilities(false, false, [], new Dictionary<string, bool> { ["startup-1"] = false });
        transport.Release.SetResult();
        var refreshed = false;
        for (var waited = 0; waited < 100 && !refreshed; waited++) { await Task.Delay(100, deadline.Token); refreshed = events.Contains("texttext:vault-changed"); }
        Assert(refreshed, "a refresh is announced once the pass releases the gate");
        Assert(events.Contains("texttext:vault-sync-status"), "sync status is still reported after the pass");
        clock.Restart();
        var authoritative = Json(await bridge.InvokeAsync("files.list", Json(new { }), deadline.Token));
        Assert(clock.Elapsed < TimeSpan.FromSeconds(1), "listing with a free gate does not pay the bounded wait");
        Assert(!authoritative.GetProperty("fullAccess").GetBoolean() && !authoritative.GetProperty("items")[0].GetProperty("canEditContent").GetBoolean(), "the refreshed listing carries the authoritative permissions");
        Assert(new TextPackStore(root, state).Describe(local.Path).Hash == local.Hash, "the local file is untouched");
    } finally { bridge.Dispose(); await Task.Delay(200); }
} finally { try { Directory.Delete(temp, true); } catch { /* best effort */ } }
Console.WriteLine(failures == 0 ? "All Windows bridge startup tests passed." : failures + " failure(s).");
return failures == 0 ? 0 : 1;

sealed class StalledTransport : ISyncTransport
{
    public readonly TaskCompletionSource ManifestStarted = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public readonly TaskCompletionSource Release = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public WorkspaceCapabilities? Capabilities { get; set; }
    public async Task<IReadOnlyList<RemoteItem>> ManifestAsync(CancellationToken cancellation = default)
    {
        ManifestStarted.TrySetResult();
        await Release.Task.WaitAsync(cancellation);
        return [];
    }
    public Task<RemotePack> DownloadAsync(string itemId, CancellationToken cancellation = default) => throw new NotSupportedException();
    public Task<string> UploadAsync(string itemId, string path, byte[] data, string? baseRevision, string operationId, CancellationToken cancellation = default) => Task.FromResult("r1");
    public Task<string> RenameAsync(string itemId, string from, string to, string baseRevision, string operationId, CancellationToken cancellation = default) => throw new NotSupportedException();
    public Task DeleteAsync(string itemId, string path, string baseRevision, string operationId, CancellationToken cancellation = default) => throw new NotSupportedException();
}
