using System.Text.Json;
namespace TextText.Core;

/// Small portable identity metadata; no foreign device journal is ever resumed.
public static class WorkspaceLocation
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive = true };
    private static string CanonicalOrigin(string origin)
    {
        if (!Uri.TryCreate(origin, UriKind.Absolute, out var uri) || !(uri.Scheme == "https" || (uri.Scheme == "http" && uri.IsLoopback)) || uri.UserInfo.Length != 0 || uri.AbsolutePath != "/" || uri.Query.Length != 0 || uri.Fragment.Length != 0)
            throw new IOException("Invalid workspace server.");
        return uri.GetLeftPart(UriPartial.Authority).ToLowerInvariant();
    }
    public static bool HasBinding(string root) => File.Exists(Path.Combine(root,".texttext","workspace-binding.json")) || File.Exists(Path.Combine(root,".texttext","sync","state.json"));
    public sealed record Binding(int Version, string Origin, string WorkspaceId);
    public static string Validate(string root, string origin, string workspaceId)
    {
        if (!Path.IsPathFullyQualified(root) || !Directory.Exists(root)) throw new IOException("Choose an existing folder.");
        origin = CanonicalOrigin(origin);
        var store = new TextPackStore(root);
        var path = store.Resolve(".texttext/workspace-binding.json");
        if (File.Exists(store.Resolve(".texttext/.workspace-binding.json.icloud"))) throw new IOException("Wait for workspace settings to download.");
        if (File.Exists(path))
        {
            if (new FileInfo(path).Length > 65536) throw new IOException("Workspace settings exceed the supported size.");
            Binding? saved;
            try { saved = JsonSerializer.Deserialize<Binding>(File.ReadAllBytes(path), JsonOptions); }
            catch (JsonException) { throw new IOException("This folder's workspace settings could not be read."); }
            if (saved is null || saved.Version != 1 || CanonicalOrigin(saved.Origin) != origin || saved.WorkspaceId != workspaceId)
                throw new IOException("Choose a folder for the current workspace.");
        }
        // Old Mac versions stored their journal inside the folder. Read only
        // identity to prevent cross-account mixing; never reuse cursor/outbox.
        var legacy = store.Resolve(".texttext/sync/state.json");
        if (File.Exists(legacy))
        {
            if (new FileInfo(legacy).Length > 16 * 1024 * 1024) throw new IOException("Workspace settings exceed the supported size.");
            try
            {
                using var state = JsonDocument.Parse(File.ReadAllBytes(legacy));
                var binding = state.RootElement.GetProperty("binding");
                if (CanonicalOrigin(binding.GetProperty("origin").GetString()!) != origin || binding.GetProperty("workspaceId").GetString() != workspaceId)
                    throw new IOException("Choose a folder for the current workspace.");
            }
            catch (Exception error) when (error is JsonException or KeyNotFoundException or InvalidOperationException or ArgumentNullException)
            { throw new IOException("This folder's workspace settings could not be read."); }
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
        JsonSerializer.Serialize(file, new Binding(1, CanonicalOrigin(origin), workspaceId), JsonOptions); file.Flush(true);
    }
}
