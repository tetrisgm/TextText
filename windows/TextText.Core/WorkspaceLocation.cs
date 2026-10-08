using System.Text.Json;
namespace TextText.Core;

/// A folder binding is portable; device journals remain outside the folder.
public static class WorkspaceLocation
{
    public sealed record Binding(int Version, string Origin, string WorkspaceId);
    public static string Validate(string root, string origin, string workspaceId)
    {
        if (!Path.IsPathFullyQualified(root) || !Directory.Exists(root)) throw new IOException("Choose an existing folder.");
        var store = new TextPackStore(root);
        var path = store.Resolve(".texttext/workspace-binding.json");
        if (File.Exists(path))
        {
            Binding? saved;
            try { saved = JsonSerializer.Deserialize<Binding>(File.ReadAllBytes(path)); }
            catch (JsonException) { throw new IOException("This folder's workspace settings could not be read."); }
            if (saved is null || saved.Version != 1 || saved.Origin != origin || saved.WorkspaceId != workspaceId)
                throw new IOException("Choose a folder for the current workspace.");
        }
        return store.Root;
    }
    public static void Bind(string root, string origin, string workspaceId)
    {
        root = Validate(root, origin, workspaceId);
        var store = new TextPackStore(root);
        var path = store.Resolve(".texttext/workspace-binding.json");
        if (File.Exists(path)) return;
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        // CreateNew never overwrites a concurrently established binding.
        using var file = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None);
        JsonSerializer.Serialize(file, new Binding(1, origin, workspaceId)); file.Flush(true);
    }
}
