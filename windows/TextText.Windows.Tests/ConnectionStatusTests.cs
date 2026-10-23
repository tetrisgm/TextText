using System.Net;
using System.Text.Json;
using TextText.Core;
using TextText.Windows;

static class ConnectionStatusTests
{
    public static async Task Run(string temporary, Action<bool, string> check)
    {
        foreach (var kind in new[] { "ready", "conflict", "retained-conflict", "auth-required", "offline" }) {
            var root = Path.Combine(temporary, "connection-" + kind);
            var state = Path.Combine(temporary, "connection-state-" + kind);
            Directory.CreateDirectory(root);
            if (kind == "retained-conflict") {
                Directory.CreateDirectory(state);
                var retained = new SyncEngine.State();
                retained.Outbox.Add(new SyncEngine.Operation("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "conflict", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "Notes/Retained.textpack", null, null, new string('a',64), null, true));
                File.WriteAllText(Path.Combine(state,"sync.json"), JsonSerializer.Serialize(retained));
            }
            // Preserve the existing broad conflict contract, including scan issues.
            if (kind == "conflict") File.WriteAllText(Path.Combine(root, "invalid.textpack"), "invalid fixture pack");
            var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var scheduled = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var observed = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
            var finishSchedule = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var paused = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
            var context = new WorkspaceContext(root, "fixture-workspace", new Uri("https://fixture.test"),
                () => Task.FromResult("fixture"), (name, data) => {
                    if (name == "texttext:vault-sync-status") {
                        var value = JsonSerializer.SerializeToElement(data); observed.TrySetResult(value);
                        if (value.TryGetProperty("schedulerFailure", out var reason) && reason.ValueKind == JsonValueKind.String) paused.TrySetResult(value);
                    }
                    return Task.CompletedTask;
                }, MirrorPolicyFactory: () => NativePolicyTestHost.Create(beforeRequest: async script => {
                    // Stop after the first reported pass before retiring the bridge.
                    // Cancelling an in-flight shared evaluator would poison later tests.
                    if (script.StartsWith("window.texttextMirrorPolicy.schedule(", StringComparison.Ordinal)) {
                        scheduled.TrySetResult();
                        await finishSchedule.Task;
                        throw new IOException("Fixture stops after first reported pass.");
                    }
                    entered.TrySetResult();
                    await release.Task;
                }));
            var bridge = new WindowsBridge(context, new Remote(kind), state);
            try {
                await entered.Task.WaitAsync(TimeSpan.FromSeconds(10));
                var startup = JsonSerializer.SerializeToElement(await bridge.InvokeAsync("files.connection", JsonSerializer.SerializeToElement(new { }), default));
                check(startup.TryGetProperty("connecting", out var connecting) && connecting.GetBoolean(), kind + ": initial sync is connecting");
                release.TrySetResult();
                var emitted = await observed.Task.WaitAsync(TimeSpan.FromSeconds(15));
                await scheduled.Task.WaitAsync(TimeSpan.FromSeconds(15));
                var snapshot = JsonSerializer.SerializeToElement(await bridge.InvokeAsync("files.connection", JsonSerializer.SerializeToElement(new { }), default));
                check(emitted.ToString() == snapshot.ToString(), kind + ": event and connection snapshot match");
                check(emitted.TryGetProperty("workspaceId", out var id) && id.GetString() == "fixture-workspace"
                    && emitted.TryGetProperty("webURL", out var url) && url.GetString() == "https://fixture.test/vault/fixture-workspace",
                    kind + ": status retains workspace identity and web URL");
                var semantics = kind switch {
                    "ready" => snapshot.GetProperty("onlineReady").GetBoolean() && !snapshot.GetProperty("hasConflicts").GetBoolean(),
                    "conflict" or "retained-conflict" => !snapshot.GetProperty("onlineReady").GetBoolean() && snapshot.GetProperty("hasConflicts").GetBoolean(),
                    "auth-required" => snapshot.TryGetProperty("authenticationRequired", out var auth) && auth.GetBoolean(),
                    _ => !snapshot.GetProperty("onlineReady").GetBoolean() && !snapshot.GetProperty("hasConflicts").GetBoolean()
                };
                if (kind == "retained-conflict") check(snapshot.GetProperty("message").GetString() == "Some documents have conflicting changes. Both copies are retained.", "retained conflict explanation preserved in snapshot and event");
                if (kind == "conflict") check(snapshot.GetProperty("message").GetString() == "Some files are temporarily unavailable or invalid. Other files continue syncing.", "scan error retains its distinct explanation");
                check(semantics, kind + ": conservative readiness and explicit authentication retained");
                var contacted = kind is "ready" or "conflict" or "retained-conflict";
                check(snapshot.GetProperty("remoteManifestResponses").GetInt64() == (contacted ? 1 : 0), kind + ": only successful manifest response counts");
                check(contacted ? DateTimeOffset.TryParse(snapshot.GetProperty("lastRemoteManifestUtc").GetString(), out _) : snapshot.GetProperty("lastRemoteManifestUtc").ValueKind == JsonValueKind.Null, kind + ": remote timestamp reflects actual response");
                finishSchedule.TrySetResult();
                var stopped = await paused.Task.WaitAsync(TimeSpan.FromSeconds(10));
                check(!stopped.GetProperty("onlineReady").GetBoolean() && stopped.GetProperty("message").GetString() == "Sync is paused. Restart TextText to reconnect.", kind + ": scheduler failure exposed as paused");
                check(stopped.GetProperty("hasConflicts").GetBoolean() == (kind is "conflict" or "retained-conflict"), kind + ": scheduler failure preserves known conflict");
                check(stopped.GetProperty("authenticationRequired").GetBoolean() == (kind == "auth-required"), kind + ": scheduler failure preserves authentication requirement");
            } finally {
                release.TrySetResult();
                finishSchedule.TrySetResult();
                await bridge.RetireAsync();
            }
        }
        var proofStore = new TextPackStore(Path.Combine(temporary, "proof-vault"), Path.Combine(temporary, "proof-state"));
        var proofEngine = new SyncEngine(proofStore, new Remote("ready"), mirrorPolicy: NativePolicyTestHost.Create());
        var responses = 0;
        proofEngine.RemoteManifestReceived += () => responses++;
        await proofEngine.SyncAsync();
        check(responses == 1, "direct full pass records one actual manifest response");
        await proofEngine.SyncAsync(localChangesOnly: true);
        check(responses == 1, "local-only idle pass creates no remote contact proof");
        var flags = System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic;
        var gate = (SemaphoreSlim)typeof(SyncEngine).GetField("gate", flags)!.GetValue(proofEngine)!;
        await gate.WaitAsync();
        try { await proofEngine.SyncAsync(); } finally { gate.Release(); }
        check(responses == 1, "busy-gate skipped pass creates no remote contact proof");
    }

    sealed class Remote(string kind) : ISyncTransport
    {
        public Task<IReadOnlyList<RemoteItem>> ManifestAsync(CancellationToken ct = default)
        {
            if (kind == "auth-required") throw new HttpRequestException("fixture auth", null, HttpStatusCode.Unauthorized);
            if (kind == "offline") throw new HttpRequestException("fixture offline", null, HttpStatusCode.ServiceUnavailable);
            return Task.FromResult<IReadOnlyList<RemoteItem>>([]);
        }
        public Task<RemotePack> DownloadAsync(string id, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<string> UploadAsync(string id, string path, byte[] bytes, string? revision, string operation, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<string> RenameAsync(string id, string from, string to, string revision, string operation, CancellationToken ct = default) => throw new NotSupportedException();
        public Task DeleteAsync(string id, string path, string revision, string operation, CancellationToken ct = default) => throw new NotSupportedException();
    }
}
