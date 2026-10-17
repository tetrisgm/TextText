using System.IO.Compression;
using System.Text.Json;
using TextText.Core;

static class CheckpointAccountTests
{
    static byte[] Pack(string body)
    {
        using var output = new MemoryStream();
        using (var zip = new ZipArchive(output, ZipArchiveMode.Create, true))
        using (var writer = new StreamWriter(zip.CreateEntry("text.md").Open())) writer.Write("---\ntextTextId: \"account-note\"\n---\n" + body);
        return output.ToArray();
    }
    static async Task QueuedAccount(string temporary, Action<bool,string> assert)
    {
        var files = new TextPackStore(Path.Combine(temporary,"account-outbox"),Path.Combine(temporary,"account-outbox-state"));
        var remote = new Test.Fake();
        var original = files.Write("Notes/Account.textpack",Pack("Original account A"));
        var a = Test.NewSync(files,remote,"account-a"); await a.SyncAsync();
        var pending = Pack("Retained account A offline edit"); files.Write(original.Path,pending,original.Hash);
        remote.FailBeforeCommit=true;
        try{await a.SyncAsync();throw new Exception("Expected offline upload refusal");}catch(HttpRequestException){}
        var statePath=Path.Combine(files.StateDirectory,"sync.json");var saved=File.ReadAllBytes(statePath);
        var state=JsonSerializer.Deserialize<SyncEngine.State>(saved)!;
        assert(state.AccountId=="account-a" && state.Outbox.Count==1,"native outbox persists its verified account with the pending operation");
        var requests=remote.ManifestCount;var uploads=remote.UploadCount;var denied=false;
        try{_=Test.NewSync(files,remote,"account-b");}catch(SharedAccountMismatchException){denied=true;}
        assert(denied && File.ReadAllBytes(statePath).SequenceEqual(saved) && files.Read(original.Path).SequenceEqual(pending)
            && remote.ManifestCount==requests && remote.UploadCount==uploads,"different account cannot open or replay a retained native outbox");
        await Test.NewSync(files,remote,"account-a").SyncAsync();
        assert(remote.Data.SequenceEqual(pending) && remote.Operations.Last()==state.Outbox[0].Id
            && JsonSerializer.Deserialize<SyncEngine.State>(File.ReadAllBytes(statePath))!.Outbox.Count==0,
            "original account resumes exact persisted operation identity and bytes");
        // Legacy state needs explicit adoption even when its queue looks clean.
        var legacy=JsonSerializer.Deserialize<SyncEngine.State>(saved)!;legacy.AccountId=null;
        var unbound=JsonSerializer.SerializeToUtf8Bytes(legacy);TextPackStore.AtomicWrite(statePath,unbound);denied=false;
        try{_=Test.NewSync(files,remote,"account-a");}catch(SharedAccountMismatchException){denied=true;}
        assert(denied && File.ReadAllBytes(statePath).SequenceEqual(unbound),"verified principal cannot silently adopt an unbound legacy outbox");
    }
    public static async Task Run(string temporary, Action<bool, string> assert)
    {
        var files = new TextPackStore(Path.Combine(temporary, "checkpoint-account"), Path.Combine(temporary, "checkpoint-account-state"));
        var original = files.Write("Notes/Account.textpack", Pack("Original")); var remote = new Test.Fake();
        var sync = Test.NewSync(files, remote); await sync.SyncAsync();
        var bytes = Pack("Private pending A edit");
        SharedCheckpoint Checkpoint(string? account, bool pending, long generation = 1) => new("account-note", original.Path, TextPackStore.Hash(bytes), original.Hash, 1, 0, generation,
            JsonSerializer.Serialize(new { version = 1, accountId = account, epoch = 1, seq = 0, journalGeneration = generation, revision = original.Hash,
                relativePath = original.Path, update = "AAA=", pending = pending ? new[] { "AAA=" } : Array.Empty<string>() }), pending);
        using (var a = new SharedEditingStore(files, sync, "account-a")) {
            var opened = await a.OpenAsync("account-note", original.Path, original.Hash);
            await a.CheckpointAsync(opened.SessionToken, original.Hash, bytes, Checkpoint("account-a", true)); a.Close(opened.SessionToken);
        }
        var journal = Path.Combine(files.StateDirectory, "shared-editing", "account-note", "checkpoint.json");
        var retained = File.ReadAllBytes(journal); var projected = files.Read(original.Path);
        using (var b = new SharedEditingStore(files, Test.NewSync(files, remote), "account-b")) {
            var denied = false;
            try { await b.OpenAsync("account-note", original.Path, TextPackStore.Hash(projected)); }
            catch (SharedAccountMismatchException) { denied = true; }
            assert(denied && File.ReadAllBytes(journal).SequenceEqual(retained) && files.Read(original.Path).SequenceEqual(projected),
                "new account cannot acquire or rewrite another account's pending checkpoint");
        }
        using (var a = new SharedEditingStore(files, Test.NewSync(files, remote), "account-a")) {
            var resumed = await a.OpenAsync("account-note", original.Path, TextPackStore.Hash(projected));
            assert(resumed.Checkpoint?.Journal == JsonSerializer.Deserialize<SharedCheckpoint>(retained)!.Journal, "original account resumes its exact retained checkpoint");
            var forged = false;
            try { await a.CheckpointAsync(resumed.SessionToken, resumed.Document.Hash, bytes, Checkpoint("account-b", true, 2)); }
            catch (SharedAccountMismatchException) { forged = true; }
            assert(forged && File.ReadAllBytes(journal).SequenceEqual(retained), "native checkpoint rejects a renderer-supplied different account");
            a.Close(resumed.SessionToken);
        }
        var cleanFiles = new TextPackStore(Path.Combine(temporary, "clean-account"), Path.Combine(temporary, "clean-account-state"));
        var cleanBytes = Pack("Canonical acknowledged content"); var cleanRemote = new Test.Fake();
        var cleanFile = cleanFiles.Write(original.Path, cleanBytes); var cleanSync = Test.NewSync(cleanFiles, cleanRemote); await cleanSync.SyncAsync();
        var cleanJournal = JsonSerializer.Serialize(new { version = 1, accountId = "account-a", epoch = 1, seq = 0, journalGeneration = 5,
            revision = cleanFile.Hash, relativePath = cleanFile.Path, update = "AAA=", pending = Array.Empty<string>() });
        using (var a = new SharedEditingStore(cleanFiles, cleanSync, "account-a")) {
            var opened = await a.OpenAsync("account-note", cleanFile.Path, cleanFile.Hash);
            await a.CheckpointAsync(opened.SessionToken, cleanFile.Hash, cleanBytes,
                new("account-note", cleanFile.Path, cleanFile.Hash, cleanFile.Hash, 1, 0, 5, cleanJournal, false)); a.Close(opened.SessionToken);
        }
        using (var b = new SharedEditingStore(cleanFiles, Test.NewSync(cleanFiles, cleanRemote), "account-b")) {
            var opened = await b.OpenAsync("account-note", cleanFile.Path, cleanFile.Hash);
            var archives = Directory.GetFiles(Path.Combine(cleanFiles.StateDirectory, "shared-editing", "account-note"), "archived-account-*.json");
            assert(opened.Checkpoint == null && archives.Length == 1 && JsonSerializer.Deserialize<SharedCheckpoint>(File.ReadAllBytes(archives[0]))?.Journal == cleanJournal,
                "account change archives only an acknowledged clean baseline before a fresh session");
            assert(cleanFiles.Read(cleanFile.Path).SequenceEqual(cleanBytes), "clean account handoff does not rewrite canonical file bytes");
        }
        // An unbound legacy pending record is never attributed by whoever opens next.
        var bound = JsonSerializer.Deserialize<SharedCheckpoint>(retained)!;
        var unbound = bound with { Journal = bound.Journal.Replace("\"accountId\":\"account-a\",", "") };
        TextPackStore.AtomicWrite(journal, JsonSerializer.SerializeToUtf8Bytes(unbound)); var unboundBytes = File.ReadAllBytes(journal);
        using (var verified = new SharedEditingStore(files, Test.NewSync(files, remote), "account-a")) {
            var denied = false;
            try { await verified.OpenAsync("account-note", original.Path, TextPackStore.Hash(projected)); }
            catch (SharedAccountMismatchException) { denied = true; }
            assert(denied && File.ReadAllBytes(journal).SequenceEqual(unboundBytes), "verified account cannot silently claim an unbound pending checkpoint");
        }
        assert(remote.UploadCount == 1, "account checkpoint refusal uploads no retained work");
        await QueuedAccount(temporary, assert);
    }
}
