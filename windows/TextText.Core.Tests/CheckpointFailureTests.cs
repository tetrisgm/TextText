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

    public static async Task Run(string temp, Action<bool, string> assert)
    {
        var files = new TextPackStore(Path.Combine(temp, "checkpoint-io"), Path.Combine(temp, "checkpoint-io-state"));
        var initial = files.Write("Notes/Checkpoint.textpack", Pack("Original"));
        var remote = new Test.Fake();
        var sync = new SyncEngine(files, remote);
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
        using var reopened = new SharedEditingStore(files, new SyncEngine(files, remote));
        var recovered = await reopened.OpenAsync("test-1", initial.Path, files.Describe(initial.Path).Hash);
        assert(recovered.Checkpoint is { JournalGeneration: 2, Pending: true } &&
            TextPackStore.Markdown(files.Read(initial.Path)).Contains("Pending during checkpoint failure"),
            "fresh store replays interrupted checkpoint after storage becomes writable");
        assert(!File.Exists(Path.Combine(directory, "intent.json")), "recovery retires only the completed checkpoint intent");
    }
}
