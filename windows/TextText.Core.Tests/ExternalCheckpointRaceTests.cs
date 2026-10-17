using System.IO.Compression;
using System.Text.Json;
using TextText.Core;

static class ExternalCheckpointRaceTests
{
    static byte[] Pack(string body)
    {
        using var output = new MemoryStream();
        using (var zip = new ZipArchive(output, ZipArchiveMode.Create, true))
        using (var writer = new StreamWriter(zip.CreateEntry("text.md").Open()))
            writer.Write("---\ntextTextId: \"external-race\"\n---\n" + body);
        return output.ToArray();
    }

    public static async Task Run(string temp, Action<bool, string> assert)
    {
        var files = new TextPackStore(Path.Combine(temp, "external-checkpoint-race"), Path.Combine(temp, "external-checkpoint-race-state"));
        var initial = files.Write("Notes/Race.textpack", Pack("Existing fixture text."));
        var sync = Test.NewSync(files, new Test.Fake());
        await sync.SyncAsync();
        using var editing = new SharedEditingStore(files, sync);
        var session = await editing.OpenAsync("external-race", initial.Path, initial.Hash);
        var projected = Pack("[human]");
        var revision = initial.Hash;
        var journal = JsonSerializer.Serialize(new { version = 1, epoch = 1, seq = 0, journalGeneration = 1,
            revision, relativePath = initial.Path, update = "AAA=", pending = new[] { "AAA=" } });
        var checkpoint = new SharedCheckpoint("external-race", initial.Path, TextPackStore.Hash(projected), revision, 1, 0, 1, journal, true);
        var saved = await editing.CheckpointAsync(session.SessionToken, initial.Hash, projected, checkpoint);
        var outside = files.UpdateMarkdown(initial.Path, TextPackStore.Markdown(files.Read(initial.Path)).Replace("[human]", "[agent]"), saved.Hash);
        try
        {
            await editing.CheckpointAsync(session.SessionToken, saved.Hash, projected, checkpoint);
            throw new Exception("same-generation retry overwrote external file");
        }
        catch (FileChangedException) { }
        assert(files.Describe(initial.Path).Hash == outside.Hash && TextPackStore.Markdown(files.Read(initial.Path)).Contains("[agent]"),
            "same-generation checkpoint retry reports external file change without overwriting it");
        var retained = JsonSerializer.Deserialize<SharedCheckpoint>(File.ReadAllText(Path.Combine(files.StateDirectory, "shared-editing", "external-race", "checkpoint.json")))!;
        assert(retained.Journal == journal && retained.ProjectedHash == saved.Hash && retained.RetiredReason == null,
            "external file change preserves the original recoverable checkpoint");
    }
}
