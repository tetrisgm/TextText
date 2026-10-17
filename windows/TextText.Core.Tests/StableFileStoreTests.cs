using System.IO.Compression;
using System.Reflection;
using System.Text.Json;
using TextText.Core;

static class StableFileStoreTests
{
    static byte[] Pack(string body)
    {
        using var output = new MemoryStream();
        using (var zip = new ZipArchive(output, ZipArchiveMode.Create, true))
        using (var writer = new StreamWriter(zip.CreateEntry("text.md").Open()))
            writer.Write("---\ntextTextId: \"stable-file\"\n---\n" + body);
        return output.ToArray();
    }
    static void BeforeCommit(TextPackStore store, Action? action) =>
        (typeof(TextPackStore).GetProperty("BeforeWriteCommitForTesting", BindingFlags.Instance | BindingFlags.NonPublic)
            ?? throw new Exception("Missing deterministic commit seam.")).SetValue(store, action);

    public static void Run(string temp, Action<bool, string> assert)
    {
        foreach (var change in new[] { "in-place", "rename-over", "rapid", "delete", "create" }) {
            var store = new TextPackStore(Path.Combine(temp, "stable-" + change), Path.Combine(temp, "stable-state-" + change));
            const string path = "Notes/Stable.textpack";
            byte[] original = Pack("original"), pending = Pack("accepted local intent"), external = Pack("newest external");
            string? expected = change == "create" ? null : store.Write(path, original).Hash;
            var operation = Guid.NewGuid().ToString();
            var notifications = 0; store.Changed += () => notifications++;
            BeforeCommit(store, () => {
                if (change == "delete") File.Delete(store.Resolve(path));
                else if (change == "rename-over") TextPackStore.AtomicWrite(store.Resolve(path), external);
                else if (change == "rapid") {
                    for (var index = 0; index < 5; index++) File.WriteAllBytes(store.Resolve(path), Pack("rapid " + index));
                    File.WriteAllBytes(store.Resolve(path), external);
                } else File.WriteAllBytes(store.Resolve(path), external);
            });
            var refused = false;
            try { store.WriteIdempotent(path, pending, expected, operation); } catch (FileChangedException) { refused = true; }
            assert(refused && notifications == 0, "staged " + change + " race refuses without success notification");
            assert(change == "delete" ? !File.Exists(store.Resolve(path)) : store.Read(path).SequenceEqual(external),
                "staged " + change + " race preserves the newest external state");
            var journal = Path.Combine(store.StateDirectory, "mutation-" + operation + ".json");
            var receipt = JsonSerializer.Deserialize<FileMutationReceipt>(File.ReadAllText(journal))!;
            assert(!receipt.Committed && receipt.Hash == TextPackStore.Hash(pending), "staged " + change + " race retains unacknowledged operation intent");
            assert(!Directory.GetFiles(Path.GetDirectoryName(store.Resolve(path))!, "*.tmp").Any(), "refused staging leaves no temporary projection");
            BeforeCommit(store, null);
            var combined = Pack("newest external\naccepted local intent");
            var current = File.Exists(store.Resolve(path)) ? store.Describe(path).Hash : null;
            var saved = store.WriteIdempotent(path, combined, current, Guid.NewGuid().ToString());
            assert(saved.Hash == TextPackStore.Hash(combined) && store.Read(path).SequenceEqual(combined) && notifications == 1,
                "fresh reconciled " + change + " intent succeeds once after refusal");
        }
        var boundedStore = new TextPackStore(Path.Combine(temp, "stable-partial"), Path.Combine(temp, "stable-partial-state"));
        var complete = Pack("complete archive");
        var known = boundedStore.Write("Partial.textpack", complete);
        File.WriteAllBytes(boundedStore.Resolve(known.Path), complete[..(complete.Length / 2)]);
        assert(boundedStore.Scan().Count == 0 && boundedStore.LastScanErrors.Count == 1, "partial archive is rejected without inventing a document");
        TextPackStore.AtomicWrite(boundedStore.Resolve(known.Path), complete);
        assert(boundedStore.Scan().Single().Hash == known.Hash && boundedStore.LastScanErrors.Count == 0, "atomic repair restores the exact known archive");
        var oversized = boundedStore.Resolve("Oversized.textpack");
        using (var sparse = new FileStream(oversized, FileMode.CreateNew, FileAccess.Write)) sparse.SetLength(64L * 1024 * 1024 + 1);
        var oversizedRefused = false;
        try { boundedStore.Read("Oversized.textpack"); } catch (InvalidDataException) { oversizedRefused = true; }
        assert(oversizedRefused && new FileInfo(oversized).Length == 64L * 1024 * 1024 + 1,
            "oversized external projection refuses before allocation and leaves sparse bytes intact");
        if (OperatingSystem.IsWindows()) {
            using (var writer = new FileStream(boundedStore.Resolve(known.Path), FileMode.Open, FileAccess.ReadWrite, FileShare.ReadWrite)) {
                var refused = false; try { boundedStore.Read(known.Path); } catch (IOException) { refused = true; }
                assert(refused, "Windows stable read refuses an active in-place writer");
            }
            assert(boundedStore.Read(known.Path).SequenceEqual(complete), "Windows stable read recovers after external writer closes");
        } else Console.WriteLine("SKIP Windows file-sharing stability requires actual Windows");
    }
}
