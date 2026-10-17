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
    public static async Task Run(string temporary, Action<bool, string> assert)
    {
        var files = new TextPackStore(Path.Combine(temporary, "checkpoint-account"), Path.Combine(temporary, "checkpoint-account-state"));
        var original = files.Write("Notes/Account.textpack", Pack("Original")); var remote = new Test.Fake();
        var sync = new SyncEngine(files, remote); await sync.SyncAsync();
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
        using (var b = new SharedEditingStore(files, new SyncEngine(files, remote), "account-b")) {
            var denied = false;
            try { await b.OpenAsync("account-note", original.Path, TextPackStore.Hash(projected)); }
            catch (SharedAccountMismatchException) { denied = true; }
            assert(denied && File.ReadAllBytes(journal).SequenceEqual(retained) && files.Read(original.Path).SequenceEqual(projected),
                "new account cannot acquire or rewrite another account's pending checkpoint");
        }
        using (var a = new SharedEditingStore(files, new SyncEngine(files, remote), "account-a")) {
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
        var cleanFile = cleanFiles.Write(original.Path, cleanBytes); var cleanSync = new SyncEngine(cleanFiles, cleanRemote); await cleanSync.SyncAsync();
        var cleanJournal = JsonSerializer.Serialize(new { version = 1, accountId = "account-a", epoch = 1, seq = 0, journalGeneration = 5,
            revision = cleanFile.Hash, relativePath = cleanFile.Path, update = "AAA=", pending = Array.Empty<string>() });
        using (var a = new SharedEditingStore(cleanFiles, cleanSync, "account-a")) {
            var opened = await a.OpenAsync("account-note", cleanFile.Path, cleanFile.Hash);
            await a.CheckpointAsync(opened.SessionToken, cleanFile.Hash, cleanBytes,
                new("account-note", cleanFile.Path, cleanFile.Hash, cleanFile.Hash, 1, 0, 5, cleanJournal, false)); a.Close(opened.SessionToken);
        }
        using (var b = new SharedEditingStore(cleanFiles, new SyncEngine(cleanFiles, cleanRemote), "account-b")) {
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
        using (var verified = new SharedEditingStore(files, new SyncEngine(files, remote), "account-a")) {
            var denied = false;
            try { await verified.OpenAsync("account-note", original.Path, TextPackStore.Hash(projected)); }
            catch (SharedAccountMismatchException) { denied = true; }
            assert(denied && File.ReadAllBytes(journal).SequenceEqual(unboundBytes), "verified account cannot silently claim an unbound pending checkpoint");
        }
        assert(remote.UploadCount == 1, "account checkpoint refusal uploads no retained work");
    }
}
