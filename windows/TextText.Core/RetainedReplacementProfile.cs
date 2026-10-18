using System.Text.Json;

namespace TextText.Core;

/// Supported older account factories reject owner version two. Unbound local
/// folders have no principal to migrate; old raw readers remain external writers.
public static class RetainedReplacementProfile
{
    public sealed record Marker(int Version, int OwnerVersion, string PrincipalHash, string OriginalOwnerHash);
    static string DirectoryFor(string state) => Path.Combine(state, "retained-replacement-profile");
    public static bool Exists(string state) => Directory.Exists(DirectoryFor(state));
    public static bool HasPublishedMarker(string state)
    {
        try{_=File.GetAttributes(Path.Combine(DirectoryFor(state),"profile.json"));return true;}
        catch(FileNotFoundException){return false;}
        catch(DirectoryNotFoundException){return false;}
    }
    public static string PrincipalHash(AccountRootOwnership.Owner owner)
    {
        if (owner.Version is not (1 or 2)) throw new InvalidDataException("Unsupported replacement owner.");
        return TextPackStore.Hash(JsonSerializer.SerializeToUtf8Bytes(owner with { Version = 1 }));
    }
    public static void Verify(string state, AccountRootOwnership.Owner owner, string rootHash)
    {
        var directory = DirectoryFor(state); RetainedFileReplacement.CheckPath(directory);
        var bytes = RetainedFileReplacement.Read(Path.Combine(directory, "profile.json"), 8192);
        using var fields = JsonDocument.Parse(bytes);
        if (!fields.RootElement.EnumerateObject().Select(field => field.Name).Order().SequenceEqual(new[] { "OriginalOwnerHash", "OwnerVersion", "PrincipalHash", "Version" })) throw new InvalidDataException("Invalid replacement profile fields.");
        var marker = JsonSerializer.Deserialize<Marker>(bytes) ?? throw new InvalidDataException("Invalid replacement profile.");
        var original = RetainedFileReplacement.Read(Path.Combine(directory, "owner-v1.json"), 8192);
        var before = JsonSerializer.Deserialize<AccountRootOwnership.Owner>(original) ?? throw new InvalidDataException("Invalid original owner.");
        if (marker.Version != 1 || marker.OwnerVersion != 2 || before.Version != 1 || owner.RootHash != rootHash || before.RootHash != rootHash ||
            marker.OriginalOwnerHash != TextPackStore.Hash(original) || marker.PrincipalHash != PrincipalHash(owner) || marker.PrincipalHash != PrincipalHash(before))
            throw new InvalidDataException("Replacement profile scope cannot be verified.");
        if(owner.Version==2 && !RetainedFileReplacement.Read(Path.Combine(directory,"owner-displaced.json"),8192).SequenceEqual(original))
            throw new InvalidDataException("Ownership changed during replacement profile publication. Both ownership versions are retained for review.");
    }
    static void Publish(string path, byte[] bytes)
    {
        if (File.Exists(path)) {
            if (!RetainedFileReplacement.Read(path, 8192).SequenceEqual(bytes)) throw new InvalidDataException("Existing replacement profile changed.");
        } else RetainedFileReplacement.Create(path, bytes);
    }
    public static void Prepare(TextPackStore store, Action<string>? observe = null)
    {
        AccountRootOwnership.RequireNoAdoption(store.StateDirectory);
        var path = Path.Combine(store.StateDirectory, AccountRootOwnership.FileName);
        if (!File.Exists(path)) {
            if (Exists(store.StateDirectory)) throw new InvalidDataException("Replacement owner is missing. Restore the retained ownership record before saving.");
            return;
        }
        var original = RetainedFileReplacement.Read(path, 8192);
        var owner = JsonSerializer.Deserialize<AccountRootOwnership.Owner>(original) ?? throw new InvalidDataException("Invalid replacement owner.");
        var rootHash = TextPackStore.Hash(System.Text.Encoding.UTF8.GetBytes(store.Root));
        if (owner.RootHash != rootHash) throw new InvalidDataException("Replacement owner root changed.");
        if (owner.Version == 2) { Verify(store.StateDirectory, owner, rootHash); return; }
        if (owner.Version != 1) throw new InvalidDataException("Update TextText to save this workspace.");
        var directory = DirectoryFor(store.StateDirectory); RetainedFileReplacement.CheckPath(directory); Directory.CreateDirectory(directory); RetainedFileReplacement.CheckPath(directory);
        Publish(Path.Combine(directory, "owner-v1.json"), original); observe?.Invoke("ownerPreserved");
        Publish(Path.Combine(directory, "profile.json"), JsonSerializer.SerializeToUtf8Bytes(new Marker(1, 2, PrincipalHash(owner), TextPackStore.Hash(original))));
        observe?.Invoke("profilePrepared");
        if (!RetainedFileReplacement.Read(path, 8192).SequenceEqual(original)) throw new FileChangedException();
        var temporary = Path.Combine(store.StateDirectory, ".owner-v2-" + Guid.NewGuid().ToString("N"));
        RetainedFileReplacement.Create(temporary, JsonSerializer.SerializeToUtf8Bytes(owner with { Version = 2 })); observe?.Invoke("ownerStaged");
        if (!RetainedFileReplacement.Read(path, 8192).SequenceEqual(original)) throw new FileChangedException();
        observe?.Invoke("beforeOwnerPublication");
        var backup=Path.Combine(directory,"owner-displaced.json");
        if(File.Exists(backup))throw new InvalidDataException("A previous ownership publication requires recovery review.");
        // Retain the actual owner displaced by publication. A final-check race
        // cannot silently destroy a newer principal record and is never rolled back.
        try {File.Replace(temporary,path,backup,ignoreMetadataErrors:false);}
        catch(Exception error)when(error is IOException or UnauthorizedAccessException) {
            throw new IOException("Ownership publication was interrupted. Its staged and displaced records remain available for review.",error);
        }
        observe?.Invoke("ownerPublished"); Verify(store.StateDirectory, owner with { Version = 2 }, rootHash);
    }
}
