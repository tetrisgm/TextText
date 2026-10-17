using System.IO.Compression;
using System.Text.Json;
using TextText.Core;

static class CheckpointFailureTests
{
    static byte[] Pack(string body)
    {
        using var output = new MemoryStream();
        using (var zip = new ZipArchive(output, ZipArchiveMode.Create, true))
        using (var writer = new StreamWriter(zip.CreateEntry("text.md").Open()))
            writer.Write("---\ntextTextId: \"test-1\"\n---\n" + body);
        return output.ToArray();
    }

    public static async Task NoSpaceProjection(Action<bool, string> assert)
    {
        var location = Environment.GetEnvironmentVariable("TEXTTEXT_CHECKPOINT_NOSPACE_VOLUME");
        if (string.IsNullOrWhiteSpace(location)) return;
        var volume = Path.GetFullPath(location);
        var drive = new DriveInfo(Path.GetPathRoot(volume)!);
        if (File.ReadAllText(Path.Combine(volume, ".texttext-checkpoint-test-volume")) != "texttext checkpoint ENOSPC fixture v1\n" ||
            drive.TotalSize < 16 * 1024 * 1024 || drive.TotalSize > 128 * 1024 * 1024 || volume != drive.RootDirectory.FullName)
            throw new InvalidOperationException("Refusing to fill anything except the explicitly marked tiny test volume");
        var temporary = Path.Combine(volume, "checkpoint-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(temporary);
        var files = new TextPackStore(Path.Combine(temporary, "workspace"), Path.Combine(temporary, "state"));
        var initial = files.Write("Notes/NoSpace.textpack", Pack("Original")); var remote = new Test.Fake();
        var sync = Test.NewSync(files, remote); await sync.SyncAsync();
        using var editing = new SharedEditingStore(files, sync);
        var session = await editing.OpenAsync("test-1", initial.Path, initial.Hash);
        SharedCheckpoint Checkpoint(byte[] bytes, long generation) => new("test-1", initial.Path, TextPackStore.Hash(bytes), initial.Hash, 1, 0, generation,
            JsonSerializer.Serialize(new { version = 1, epoch = 1, seq = 0, journalGeneration = generation, revision = initial.Hash,
                relativePath = initial.Path, update = "AAA=", pending = new[] { "AAA=" } }), true);
        var first = Pack("Durable before disk full");
        var saved = await editing.CheckpointAsync(session.SessionToken, initial.Hash, first, Checkpoint(first, 1));
        var journal = Path.Combine(files.StateDirectory, "shared-editing", "test-1", "checkpoint.json"); var previous = File.ReadAllBytes(journal);
        var fill = Path.Combine(volume, "checkpoint-fill-" + Guid.NewGuid().ToString("N"));
        try {
            using var stream = new FileStream(fill, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough);
            foreach (var length in new[] { 1024 * 1024, 4096 }) {
                    var block = new byte[length]; Array.Fill(block, (byte)0x5a);
                    while (true) { try { stream.Write(block); stream.Flush(true); }
                        catch (IOException error) when ((error.HResult & 0xffff) is 39 or 112) { break; } }
            }
            var next = Pack("Retained edit after real disk-full refusal"); var refused = false;
            try { await editing.CheckpointAsync(session.SessionToken, saved.Hash, next, Checkpoint(next, 2)); }
            catch (IOException error) when ((error.HResult & 0xffff) is 39 or 112) { refused = true; }
            assert(refused && File.ReadAllBytes(journal).SequenceEqual(previous), "real disk-full checkpoint cannot acknowledge a newer generation");
            assert(files.Read(initial.Path).SequenceEqual(first) && remote.UploadCount == 1, "real disk-full refusal preserves durable projection without upload");
            Console.WriteLine("Disk-full fixture bytes before repair: " + stream.Length);
            stream.SetLength(0); stream.Flush(true); stream.Dispose();
            File.Delete(fill);
            var deadline = DateTime.UtcNow.AddSeconds(10);
            while (drive.AvailableFreeSpace < 8 * 1024 * 1024 && DateTime.UtcNow < deadline) await Task.Delay(100);
            assert(drive.AvailableFreeSpace >= 8 * 1024 * 1024, "disk-full fixture verifies reclaimed space before retry");
            Console.WriteLine("Disk-full fixture free bytes after repair: " + drive.AvailableFreeSpace);
            editing.Close(session.SessionToken);
            using var recovered = new SharedEditingStore(files, Test.NewSync(files, remote));
            var opened = await recovered.OpenAsync("test-1", initial.Path, saved.Hash);
            var retried = await recovered.CheckpointAsync(opened.SessionToken, saved.Hash, next, Checkpoint(next, 2)); recovered.Close(opened.SessionToken);
            using var fresh = new SharedEditingStore(files, Test.NewSync(files, remote));
            var verified = await fresh.OpenAsync("test-1", initial.Path, retried.Hash);
            assert(verified.Checkpoint is { JournalGeneration: 2, Pending: true } &&
                TextPackStore.Markdown(files.Read(initial.Path)).Contains("Retained edit after real disk-full refusal"), "real disk-full repair retries and reopens retained pending work");
        } finally { if (File.Exists(fill)) File.Delete(fill); }
    }

    public static async Task UnavailableProjection(string temp, Action<bool, string> assert)
    {
        using var scenario = JsonDocument.Parse(File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory, "checkpoint-unavailable.json")));
        var spec = scenario.RootElement;
        var files = new TextPackStore(Path.Combine(temp, "unavailable-projection"), Path.Combine(temp, "unavailable-projection-state"));
        var initial = files.Write(spec.GetProperty("path").GetString()!, Pack("Original"));
        var remote = new Test.Fake();
        var sync = Test.NewSync(files, remote); await sync.SyncAsync();
        using var editing = new SharedEditingStore(files, sync);
        var session = await editing.OpenAsync("test-1", initial.Path, initial.Hash);
        SharedCheckpoint Checkpoint(byte[] bytes, long generation) => new("test-1", initial.Path, TextPackStore.Hash(bytes), initial.Hash, 1, 0, generation,
            JsonSerializer.Serialize(new { version = 1, epoch = 1, seq = 0, journalGeneration = generation, revision = initial.Hash,
                relativePath = initial.Path, update = "AAA=", pending = new[] { "AAA=" } }), true);
        var first = Pack(spec.GetProperty("firstBody").GetString()!);
        var saved = await editing.CheckpointAsync(session.SessionToken, initial.Hash, first, Checkpoint(first, spec.GetProperty("firstGeneration").GetInt64()));
        var directory = Path.Combine(files.StateDirectory, "shared-editing", "test-1");
        var journal = Path.Combine(directory, "checkpoint.json"); var previous = File.ReadAllBytes(journal);
        var projected = Path.Combine(files.Root, initial.Path); var held = Path.Combine(files.StateDirectory, "unavailable-projection.textpack");
        // Hold outside the managed root: another visible same-ID TextPack is
        // a valid external rename, not an unavailable projection.
        File.Move(projected, held);
        var next = Pack(spec.GetProperty("pendingBody").GetString()!); var generation = spec.GetProperty("nextGeneration").GetInt64();
        var refused = false;
        try { await editing.CheckpointAsync(session.SessionToken, saved.Hash, next, Checkpoint(next, generation)); }
        catch (FileNotFoundException) { refused = true; }
        assert(refused && File.ReadAllBytes(journal).SequenceEqual(previous), "unavailable projection cannot acknowledge a newer generation");
        assert(!File.Exists(projected) && File.ReadAllBytes(held).SequenceEqual(first), "unavailable projection is not recreated or overwritten");
        assert(!File.Exists(Path.Combine(directory, "intent.json")) && remote.UploadCount == 1, "unavailable projection publishes no intent or remote mutation");
        File.Move(held, projected); editing.Close(session.SessionToken);
        using var reopened = new SharedEditingStore(files, Test.NewSync(files, remote));
        var restored = await reopened.OpenAsync("test-1", initial.Path, saved.Hash);
        var recovered = await reopened.CheckpointAsync(restored.SessionToken, saved.Hash, next, Checkpoint(next, generation));
        reopened.Close(restored.SessionToken);
        using var fresh = new SharedEditingStore(files, Test.NewSync(files, remote));
        var verified = await fresh.OpenAsync("test-1", initial.Path, recovered.Hash);
        assert(verified.Checkpoint is { Pending: true } cp && cp.JournalGeneration == generation &&
            TextPackStore.Markdown(files.Read(initial.Path)).Contains(spec.GetProperty("pendingBody").GetString()!), "restored projection retries and reopens with all pending work");
    }

    public static async Task Run(string temp, Action<bool, string> assert)
    {
        var files = new TextPackStore(Path.Combine(temp, "checkpoint-io"), Path.Combine(temp, "checkpoint-io-state"));
        var initial = files.Write("Notes/Checkpoint.textpack", Pack("Original"));
        var remote = new Test.Fake();
        var sync = Test.NewSync(files, remote);
        await sync.SyncAsync();
        using var editing = new SharedEditingStore(files, sync);
        var session = await editing.OpenAsync("test-1", initial.Path, initial.Hash);
        SharedCheckpoint Checkpoint(byte[] bytes, long generation) => new("test-1", initial.Path,
            TextPackStore.Hash(bytes), initial.Hash, 1, 0, generation,
            JsonSerializer.Serialize(new { version = 1, epoch = 1, seq = 0, journalGeneration = generation,
                revision = initial.Hash, relativePath = initial.Path, update = "AAA=", pending = new[] { "AAA=" } }), true);
        var first = Pack("First durable edit");
        var saved = await editing.CheckpointAsync(session.SessionToken, initial.Hash, first, Checkpoint(first, 1));
        var directory = Path.Combine(files.StateDirectory, "shared-editing", "test-1");
        var journalPath = Path.Combine(directory, "checkpoint.json");
        var priorBytes = File.ReadAllBytes(journalPath);
        var second = Pack("Pending during checkpoint failure");
        using var cancelled = new CancellationTokenSource();
        cancelled.Cancel();
        var rejected = false;
        try { await editing.CheckpointAsync(session.SessionToken, saved.Hash, second, Checkpoint(second, 2), cancelled.Token); }
        catch (OperationCanceledException) { rejected = true; }
        assert(rejected && files.Describe(initial.Path).Hash == saved.Hash && File.ReadAllBytes(journalPath).SequenceEqual(priorBytes),
            "cancelled checkpoint preserves prior durable projection and generation");
        assert(!File.Exists(Path.Combine(directory, "intent.json")) && remote.UploadCount == 1,
            "cancelled checkpoint publishes no intent or remote mutation");

        // Windows denies replacement without FileShare.Delete while still permitting
        // production recovery reads. Unix rename semantics do not enforce this lock.
        if (!OperatingSystem.IsWindows()) return;
        rejected = false;
        using (var held = new FileStream(journalPath, FileMode.Open, FileAccess.Read, FileShare.Read))
        {
            try { await editing.CheckpointAsync(session.SessionToken, saved.Hash, second, Checkpoint(second, 2)); }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException) { rejected = true; }
            assert(rejected && File.ReadAllBytes(journalPath).SequenceEqual(priorBytes),
                "checkpoint replacement failure cannot acknowledge a newer durable generation");
            assert(File.Exists(Path.Combine(directory, "intent.json")) && remote.UploadCount == 1,
                "failed checkpoint retains replayable intent without snapshot upload");
        }
        editing.Close(session.SessionToken);
        using var reopened = new SharedEditingStore(files, Test.NewSync(files, remote));
        var recovered = await reopened.OpenAsync("test-1", initial.Path, files.Describe(initial.Path).Hash);
        assert(recovered.Checkpoint is { JournalGeneration: 2, Pending: true } &&
            TextPackStore.Markdown(files.Read(initial.Path)).Contains("Pending during checkpoint failure"),
            "fresh store replays interrupted checkpoint after storage becomes writable");
        assert(!File.Exists(Path.Combine(directory, "intent.json")), "recovery retires only the completed checkpoint intent");
    }
}
