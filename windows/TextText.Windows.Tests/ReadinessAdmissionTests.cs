using System.Collections.Concurrent;
using System.IO.Compression;
using System.Text.Json;
using TextText.Core;
using TextText.Windows;

static class ReadinessAdmissionTests
{
    public static async Task RunFlood(string temporary, Action<bool, string> check)
    {
        var root = Path.Combine(temporary, "pressure-vault");
        var state = Path.Combine(temporary, "pressure-state");
        var store = new TextPackStore(root, state);
        byte[] Pack(string body) {
            using var bytes = new MemoryStream();
            using (var zip = new ZipArchive(bytes, ZipArchiveMode.Create, true))
                using (var writer = new StreamWriter(zip.CreateEntry("text.md").Open()))
                    writer.Write("---\ntextTextId: pressure-item\ntitle: Fixture\n---\n" + body);
            return bytes.ToArray();
        }
        var local = store.Write("Notes/Pressure.textpack", Pack("before"));
        var remote = new Remote();
        await new SyncEngine(store, remote, mirrorPolicy: NativePolicyTestHost.Create()).SyncAsync();
        var expected = Pack("exact queued update");
        store.Write(local.Path, expected, local.Hash);
        remote.Uploads = 0; remote.Hold = true; remote.LateScanRelease.Set();
        var context = new WorkspaceContext(root, "fixture-workspace", new Uri("https://fixture.test"),
            () => Task.FromResult("fixture"), (_, _) => Task.CompletedTask,
            MirrorPolicyFactory: () => NativePolicyTestHost.Create());
        var bridge = new WindowsBridge(context, remote, state);
        try {
            await remote.Entered.Task.WaitAsync(TimeSpan.FromSeconds(10));
            var requests = new List<Task<object?>>();
            for (var wave = 0; wave < 40 && remote.Uploads == 0; wave++) {
                for (var index = 0; index < 4; index++)
                    requests.Add(bridge.InvokeAsync("files.ready", JsonSerializer.SerializeToElement(new { itemId = local.ItemId }), default));
                if (wave == 0) remote.Release.TrySetResult();
                await Task.Delay(400);
            }
            await Task.WhenAll(requests).WaitAsync(TimeSpan.FromSeconds(10));
            check(remote.Uploads == 1, "continuous real readiness requests permit exactly one queued upload");
            check(remote.Bytes is not null && remote.Bytes.SequenceEqual(expected), "readiness pressure uploads exact queued bytes");
            check(store.Read(local.Path).SequenceEqual(expected), "readiness pressure preserves exact local bytes");
        } finally {
            remote.Release.TrySetResult();
            await bridge.RetireAsync();
        }
    }

    public static async Task Run(string temporary, Action<bool, string> check)
    {
        var root = Path.Combine(temporary, "readiness-vault");
        var state = Path.Combine(temporary, "readiness-state");
        var store = new TextPackStore(root, state);
        using var bytes = new MemoryStream();
        using (var zip = new ZipArchive(bytes, ZipArchiveMode.Create, true))
            using (var writer = new StreamWriter(zip.CreateEntry("text.md").Open()))
                writer.Write("---\ntextTextId: readiness-item\ntitle: Fixture\n---\nexact fixture body");
        var local = store.Write("Notes/Fixture.textpack", bytes.ToArray());
        var remote = new Remote();
        await new SyncEngine(store, remote, mirrorPolicy: NativePolicyTestHost.Create()).SyncAsync();
        remote.Hold = true;
        var finish = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var events = new ConcurrentQueue<JsonElement>();
        var context = new WorkspaceContext(root, "fixture-workspace", new Uri("https://fixture.test"), () => Task.FromResult("fixture"),
            (name, data) => { if (name == "texttext:vault-sync-status") events.Enqueue(JsonSerializer.SerializeToElement(data)); return Task.CompletedTask; },
            MirrorPolicyFactory: () => NativePolicyTestHost.Create(beforeRequest: async script => {
                // A later item scan is deliberately slow. Admission must precede it.
                if (script.StartsWith("window.texttextMirrorPolicy.savedRename(", StringComparison.Ordinal)) await finish.Task;
            }));
        var bridge = new WindowsBridge(context, remote, state);
        try {
            await remote.Entered.Task.WaitAsync(TimeSpan.FromSeconds(10));
            var ready = bridge.InvokeAsync("files.ready", JsonSerializer.SerializeToElement(new { itemId = local.ItemId }), default);
            check(!ready.IsCompleted, "real bridge readiness waits for current remote response");
            remote.Release.TrySetResult();
            var result = JsonSerializer.SerializeToElement(await ready.WaitAsync(TimeSpan.FromSeconds(4)));
            check(result.GetProperty("ready").GetBoolean(), "earliest files.ready request receives foreground admission before slow item scan");
            if (!result.GetProperty("ready").GetBoolean()) return;
            var opened = JsonSerializer.SerializeToElement(await bridge.InvokeAsync("collaboration.open",
                JsonSerializer.SerializeToElement(new { itemId = local.ItemId, path = local.Path, hash = local.Hash }), default).WaitAsync(TimeSpan.FromSeconds(4)));
            check(!string.IsNullOrEmpty(opened.GetProperty("sessionToken").GetString()), "real readiness then collaboration.open completes before slow item scan");
            check(!events.Any(value => value.GetProperty("onlineReady").GetBoolean()), "yielded passes never announce completed ready status");
            check(store.Describe(local.Path).Hash == local.Hash, "foreground admission preserves exact local document");
        } finally {
            remote.Release.TrySetResult(); remote.LateScanRelease.Set(); finish.TrySetResult();
            await bridge.RetireAsync();
        }
    }

    sealed class Remote : ISyncTransport
    {
        public bool Hold;
        public readonly ManualResetEventSlim LateScanRelease = new();
        public IReadOnlyList<string> Folders { get {

            if (Hold && !LateScanRelease.Wait(TimeSpan.FromSeconds(15))) throw new TimeoutException("Fixture late scan not released");
            return [];
        } }
        public readonly TaskCompletionSource Entered = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public readonly TaskCompletionSource Release = new(TaskCreationOptions.RunContinuationsAsynchronously);
        byte[]? bytes; string? path; string? item;
        public int Uploads;
        public byte[]? Bytes => bytes;
        public async Task<IReadOnlyList<RemoteItem>> ManifestAsync(CancellationToken ct = default) {
            if (Hold) { Entered.TrySetResult(); await Release.Task.WaitAsync(ct); }
            return bytes is null ? [] : [new(item!, path!, TextPackStore.Hash(bytes))];
        }
        public Task<string> UploadAsync(string id, string file, byte[] data, string? revision, string operation, CancellationToken ct = default) {
            bytes = data; path = file; item = id; Interlocked.Increment(ref Uploads); return Task.FromResult(TextPackStore.Hash(data));
        }
        public Task<RemotePack> DownloadAsync(string id, CancellationToken ct = default) => Task.FromResult(new RemotePack(bytes!, path!, TextPackStore.Hash(bytes!)));
        public Task<string> RenameAsync(string id, string from, string to, string revision, string operation, CancellationToken ct = default) => throw new NotSupportedException();
        public Task DeleteAsync(string id, string path, string revision, string operation, CancellationToken ct = default) => throw new NotSupportedException();
    }
}
