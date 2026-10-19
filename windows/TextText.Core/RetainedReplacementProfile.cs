using System.Text.Json;

namespace TextText.Core;

/// Supported older account factories reject owner version two. Unbound local
/// folders have no principal to migrate; old raw readers remain external writers.
public static class RetainedReplacementProfile
{
    public sealed class PreparationBusyException(Exception inner) : IOException("This workspace's account setup is finishing. Try again.",inner);
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
    static IDisposable MigrationLease(string state,bool shared=false)
    {
        if(!Directory.Exists(state))throw new InvalidDataException("Workspace account state is missing.");
        try{return RetainedFileReplacement.AcquireLease(Path.Combine(state,"retained-replacement-profile.lock"),shared);}
        catch(RetainedFileReplacement.LeaseBusyException error){throw new PreparationBusyException(error);}
    }
    public static void Verify(string state, AccountRootOwnership.Owner owner, string rootHash)
    {
        VerifyObserved(state,owner,rootHash,null);
    }
    // Read-only attestation may overlap other readers; publication remains exclusive.
    static void VerifyObserved(string state,AccountRootOwnership.Owner owner,string rootHash,Action? observed)
    {
        using var migration=MigrationLease(state,shared:true);
        VerifyUnlocked(state,owner,rootHash);
        observed?.Invoke();
    }
    // Synchronous inventory only: publication stays excluded, and every scan
    // verifies the actual owner/profile again before returning any inventory.
    internal sealed class InventoryVerification : IDisposable
    {
        readonly string state, rootHash;
        readonly byte[] ownerBytes;
        readonly AccountRootOwnership.Owner owner;
        readonly IDisposable lease;
        internal InventoryVerification(string state, string rootHash)
        {
            this.state=state;this.rootHash=rootHash;
            lease=MigrationLease(state,shared:true);
            try {
                AccountRootOwnership.RequireNoAdoption(state);
                ownerBytes=RetainedFileReplacement.Read(Path.Combine(state,AccountRootOwnership.FileName),8192);
                owner=JsonSerializer.Deserialize<AccountRootOwnership.Owner>(ownerBytes)??throw new InvalidDataException("Invalid inventory owner.");
                VerifyUnlocked(state,owner,rootHash);
            } catch {lease.Dispose();throw;}
        }
        internal void Verify(AccountRootOwnership.Owner actual,string actualRootHash)
        {
            if(actual!=owner||actualRootHash!=rootHash)throw new InvalidDataException("Inventory ownership changed.");
        }
        public void Dispose()
        {
            try {
                AccountRootOwnership.RequireNoAdoption(state);
                if(!ownerBytes.SequenceEqual(RetainedFileReplacement.Read(Path.Combine(state,AccountRootOwnership.FileName),8192)))throw new InvalidDataException("Inventory ownership changed.");
                VerifyUnlocked(state,owner,rootHash);
            } finally {lease.Dispose();}
        }
    }
    internal static void VerifyUnlocked(string state, AccountRootOwnership.Owner owner, string rootHash)
    {
        var directory = DirectoryFor(state); RetainedFileReplacement.CheckPath(directory);
        var bytes = RetainedFileReplacement.Read(Path.Combine(directory, "profile.json"), 8192);
        RetainedFileReplacement.JsonFields(bytes,["Version","OwnerVersion","PrincipalHash","OriginalOwnerHash"],["Version","OwnerVersion","PrincipalHash","OriginalOwnerHash"]);
        var marker = JsonSerializer.Deserialize<Marker>(bytes) ?? throw new InvalidDataException("Invalid replacement profile.");
        var original = RetainedFileReplacement.Read(Path.Combine(directory, "owner-v1.json"), 8192);
        RetainedFileReplacement.JsonFields(original,["Version","Origin","WorkspaceId","AccountId","RootHash"],["Version","Origin","WorkspaceId","AccountId","RootHash"]);
        var before = JsonSerializer.Deserialize<AccountRootOwnership.Owner>(original) ?? throw new InvalidDataException("Invalid original owner.");
        if (marker.Version is not (1 or 2 or 3 or 4 or 5 or 6) || marker.OwnerVersion != 2 || before.Version != 1 || owner.RootHash != rootHash || before.RootHash != rootHash ||
            marker.OriginalOwnerHash != TextPackStore.Hash(original) || marker.PrincipalHash != PrincipalHash(owner) || marker.PrincipalHash != PrincipalHash(before))
            throw new InvalidDataException("Replacement profile scope cannot be verified.");
        if(marker.Version>=2) {
            var prior=RetainedFileReplacement.Read(Path.Combine(directory,"profile-v1.json"),8192);
            RetainedFileReplacement.JsonFields(prior,["Version","OwnerVersion","PrincipalHash","OriginalOwnerHash"],["Version","OwnerVersion","PrincipalHash","OriginalOwnerHash"]);
            var old=JsonSerializer.Deserialize<Marker>(prior)??throw new InvalidDataException("Invalid prior replacement profile.");
            if(old.Version!=1||old!=(marker with{Version=1})||!RetainedFileReplacement.Read(Path.Combine(directory,"profile-v1-displaced.json"),8192).SequenceEqual(prior))throw new InvalidDataException("Folder compatibility publication requires review. Both profiles remain retained.");
        }
        if(marker.Version>=3) {
            var prior=RetainedFileReplacement.Read(Path.Combine(directory,"profile-v2.json"),8192);
            RetainedFileReplacement.JsonFields(prior,["Version","OwnerVersion","PrincipalHash","OriginalOwnerHash"],["Version","OwnerVersion","PrincipalHash","OriginalOwnerHash"]);
            var old=JsonSerializer.Deserialize<Marker>(prior)??throw new InvalidDataException("Invalid prior folder sync profile.");
            if(old.Version!=2||old!=(marker with{Version=2})||!RetainedFileReplacement.Read(Path.Combine(directory,"profile-v2-displaced.json"),8192).SequenceEqual(prior))throw new InvalidDataException("Folder sync compatibility publication requires review. Both profiles remain retained.");
        }
        if(marker.Version>=4) {
            var prior=RetainedFileReplacement.Read(Path.Combine(directory,"profile-v3.json"),8192);
            RetainedFileReplacement.JsonFields(prior,["Version","OwnerVersion","PrincipalHash","OriginalOwnerHash"],["Version","OwnerVersion","PrincipalHash","OriginalOwnerHash"]);
            var old=JsonSerializer.Deserialize<Marker>(prior)??throw new InvalidDataException("Invalid prior local handoff profile.");
            if(old.Version!=3||old!=(marker with{Version=3})||!RetainedFileReplacement.Read(Path.Combine(directory,"profile-v3-displaced.json"),8192).SequenceEqual(prior))throw new InvalidDataException("Local handoff publication requires review. Both profiles remain retained.");
        }
        if(marker.Version>=5) {
            var prior=RetainedFileReplacement.Read(Path.Combine(directory,"profile-v4.json"),8192);
            RetainedFileReplacement.JsonFields(prior,["Version","OwnerVersion","PrincipalHash","OriginalOwnerHash"],["Version","OwnerVersion","PrincipalHash","OriginalOwnerHash"]);
            var old=JsonSerializer.Deserialize<Marker>(prior)??throw new InvalidDataException("Invalid prior shared rename profile.");
            if(old.Version!=4||old!=(marker with{Version=4})||!RetainedFileReplacement.Read(Path.Combine(directory,"profile-v4-displaced.json"),8192).SequenceEqual(prior))throw new InvalidDataException("Saved file move compatibility publication requires review. Both profiles remain retained.");
        }
        if(marker.Version>=6) {
            var prior=RetainedFileReplacement.Read(Path.Combine(directory,"profile-v5.json"),8192);
            RetainedFileReplacement.JsonFields(prior,["Version","OwnerVersion","PrincipalHash","OriginalOwnerHash"],["Version","OwnerVersion","PrincipalHash","OriginalOwnerHash"]);
            var old=JsonSerializer.Deserialize<Marker>(prior)??throw new InvalidDataException("Invalid prior generation-aware rename profile.");
            if(old.Version!=5||old!=(marker with{Version=5})||!RetainedFileReplacement.Read(Path.Combine(directory,"profile-v5-displaced.json"),8192).SequenceEqual(prior))
                throw new InvalidDataException("Generation-aware move publication requires review. Both profiles remain retained.");
        }
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
        var path=Path.Combine(store.StateDirectory,AccountRootOwnership.FileName);
        if(File.Exists(path)) {
            var owner=JsonSerializer.Deserialize<AccountRootOwnership.Owner>(RetainedFileReplacement.Read(path,8192))??throw new InvalidDataException("Invalid replacement owner.");
            if(owner.Version==2) {Verify(store.StateDirectory,owner,TextPackStore.Hash(System.Text.Encoding.UTF8.GetBytes(store.Root)));return;}
        }
        using var migration=MigrationLease(store.StateDirectory);
        PrepareUnlocked(store,observe);
    }
    static void PrepareUnlocked(TextPackStore store,Action<string>? observe)
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
        if (owner.Version == 2) { VerifyUnlocked(store.StateDirectory, owner, rootHash); return; }
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
        observe?.Invoke("ownerPublished"); VerifyUnlocked(store.StateDirectory, owner with { Version = 2 }, rootHash);
    }
    internal static void PrepareFolderCase(TextPackStore store,Action<string>? observe=null)
    {
        Prepare(store);
        using var migration=MigrationLease(store.StateDirectory);
        var ownerPath=Path.Combine(store.StateDirectory,AccountRootOwnership.FileName);
        if(!File.Exists(ownerPath))throw new LegacyAccountStateException();
        var owner=JsonSerializer.Deserialize<AccountRootOwnership.Owner>(RetainedFileReplacement.Read(ownerPath,8192))??throw new InvalidDataException("Invalid folder account owner.");
        var rootHash=TextPackStore.Hash(System.Text.Encoding.UTF8.GetBytes(store.Root));VerifyUnlocked(store.StateDirectory,owner,rootHash);
        var directory=DirectoryFor(store.StateDirectory);var path=Path.Combine(directory,"profile.json");var original=RetainedFileReplacement.Read(path,8192);
        var marker=JsonSerializer.Deserialize<Marker>(original)!;if(marker.Version>=2)return;
        Publish(Path.Combine(directory,"profile-v1.json"),original);observe?.Invoke("folderProfilePreserved");
        var staged=Path.Combine(directory,".profile-v2-"+Guid.NewGuid().ToString("N"));RetainedFileReplacement.Create(staged,JsonSerializer.SerializeToUtf8Bytes(marker with{Version=2}));observe?.Invoke("folderProfileStaged");
        if(!RetainedFileReplacement.Read(path,8192).SequenceEqual(original))throw new FileChangedException();
        var displaced=Path.Combine(directory,"profile-v1-displaced.json");if(File.Exists(displaced))throw new InvalidDataException("A prior folder profile publication requires review.");
        observe?.Invoke("beforeFolderProfilePublication");File.Replace(staged,path,displaced,ignoreMetadataErrors:false);observe?.Invoke("folderProfilePublished");VerifyUnlocked(store.StateDirectory,owner,rootHash);
    }
    internal static void PrepareFolderSync(TextPackStore store,Action<string>? observe=null)
    {
        PrepareFolderCase(store);
        using var migration=MigrationLease(store.StateDirectory);
        var owner=JsonSerializer.Deserialize<AccountRootOwnership.Owner>(RetainedFileReplacement.Read(Path.Combine(store.StateDirectory,AccountRootOwnership.FileName),8192))??throw new InvalidDataException("Invalid folder sync owner.");
        var rootHash=TextPackStore.Hash(System.Text.Encoding.UTF8.GetBytes(store.Root));VerifyUnlocked(store.StateDirectory,owner,rootHash);
        var directory=DirectoryFor(store.StateDirectory);var path=Path.Combine(directory,"profile.json");var original=RetainedFileReplacement.Read(path,8192);var marker=JsonSerializer.Deserialize<Marker>(original)!;
        if(marker.Version>=3)return;
        Publish(Path.Combine(directory,"profile-v2.json"),original);observe?.Invoke("folderSyncProfilePreserved");
        var staged=Path.Combine(directory,".profile-v3-"+Guid.NewGuid().ToString("N"));RetainedFileReplacement.Create(staged,JsonSerializer.SerializeToUtf8Bytes(marker with{Version=3}));observe?.Invoke("folderSyncProfileStaged");
        if(!RetainedFileReplacement.Read(path,8192).SequenceEqual(original))throw new FileChangedException();
        var displaced=Path.Combine(directory,"profile-v2-displaced.json");if(File.Exists(displaced))throw new InvalidDataException("A prior folder sync profile publication requires review.");
        observe?.Invoke("beforeFolderSyncProfilePublication");File.Replace(staged,path,displaced,ignoreMetadataErrors:false);observe?.Invoke("folderSyncProfilePublished");VerifyUnlocked(store.StateDirectory,owner,rootHash);
    }

    public static bool SupportsLocalHandoff(TextPackStore store)
    {
        var root=Path.GetFullPath(store.Root).TrimEnd(Path.DirectorySeparatorChar);
        var state=Path.GetFullPath(store.StateDirectory);
        if(state.Equals(root,StringComparison.OrdinalIgnoreCase)||state.StartsWith(root+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase))return false;
        var path=Path.Combine(state,AccountRootOwnership.FileName);if(!File.Exists(path))return false;
        var owner=JsonSerializer.Deserialize<AccountRootOwnership.Owner>(RetainedFileReplacement.Read(path,8192))??throw new InvalidDataException("Invalid local handoff owner.");
        var hash=TextPackStore.Hash(System.Text.Encoding.UTF8.GetBytes(store.Root));
        if(owner.RootHash!=hash||owner.Version is not(1 or 2))throw new InvalidDataException("Local handoff owner changed.");
        AccountRootOwnership.Open(store,new Uri(owner.Origin),owner.WorkspaceId,owner.AccountId);
        return true;
    }
    /// Recheck the existing private principal without claiming profile migration completed.
    public static void RequireLocalHandoffPrincipal(TextPackStore store,Uri origin,string workspaceId,string accountId)
    {
        var root=Path.GetFullPath(store.Root).TrimEnd(Path.DirectorySeparatorChar);var state=Path.GetFullPath(store.StateDirectory);
        if(state.Equals(root,StringComparison.OrdinalIgnoreCase)||state.StartsWith(root+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("Local handoff requires private device state.");
        AccountRootOwnership.RequireNoAdoption(state);
        var actual=JsonSerializer.Deserialize<AccountRootOwnership.Owner>(RetainedFileReplacement.Read(Path.Combine(state,AccountRootOwnership.FileName),8192))??throw new InvalidDataException("Invalid local handoff principal.");
        if(actual.Version is not(1 or 2))throw new InvalidDataException("Unsupported local handoff principal.");
        if((actual with{Version=1})!=AccountRootOwnership.Expected(store,origin,workspaceId,accountId))throw new SharedAccountMismatchException();
    }
    public static void PrepareLocalHandoff(TextPackStore store,Action<string>? observe=null)
    {
        if(!SupportsLocalHandoff(store))throw new InvalidDataException("Local handoff requires owned private device state.");
        var ready=false;
        var current=JsonSerializer.Deserialize<AccountRootOwnership.Owner>(RetainedFileReplacement.Read(Path.Combine(store.StateDirectory,AccountRootOwnership.FileName),8192))!;
        if(current.Version==2)VerifyObserved(store.StateDirectory,current,TextPackStore.Hash(System.Text.Encoding.UTF8.GetBytes(store.Root)),()=> {
            ready=JsonSerializer.Deserialize<Marker>(RetainedFileReplacement.Read(Path.Combine(DirectoryFor(store.StateDirectory),"profile.json"),8192))!.Version>=4;
        });
        if(ready)return;
        PrepareFolderSync(store);
        using var migration=MigrationLease(store.StateDirectory);
        var owner=JsonSerializer.Deserialize<AccountRootOwnership.Owner>(RetainedFileReplacement.Read(Path.Combine(store.StateDirectory,AccountRootOwnership.FileName),8192))!;
        var rootHash=TextPackStore.Hash(System.Text.Encoding.UTF8.GetBytes(store.Root));VerifyUnlocked(store.StateDirectory,owner,rootHash);
        var directory=DirectoryFor(store.StateDirectory);var path=Path.Combine(directory,"profile.json");var original=RetainedFileReplacement.Read(path,8192);var marker=JsonSerializer.Deserialize<Marker>(original)!;
        if(marker.Version>=4)return;
        if(marker.Version!=3)throw new InvalidDataException("Invalid local handoff prior profile.");
        Publish(Path.Combine(directory,"profile-v3.json"),original);observe?.Invoke("localHandoffProfilePreserved");
        var staged=Path.Combine(directory,".profile-v4-"+Guid.NewGuid().ToString("N"));RetainedFileReplacement.Create(staged,JsonSerializer.SerializeToUtf8Bytes(marker with{Version=4}));observe?.Invoke("localHandoffProfileStaged");
        if(!RetainedFileReplacement.Read(path,8192).SequenceEqual(original))throw new FileChangedException();
        var displaced=Path.Combine(directory,"profile-v3-displaced.json");if(File.Exists(displaced))throw new InvalidDataException("A prior local handoff publication requires review.");
        observe?.Invoke("beforeLocalHandoffProfilePublication");File.Replace(staged,path,displaced,ignoreMetadataErrors:false);observe?.Invoke("localHandoffProfilePublished");VerifyUnlocked(store.StateDirectory,owner,rootHash);
    }

    /// Fence supported older account factories before new saved-move state is
    /// persisted. No portable binding, owner identity, or sync journal changes.
    public static void PrepareSharedRename(TextPackStore store,Action<string>? observe=null)
    {
        if(!SupportsLocalHandoff(store))throw new InvalidDataException("Saved file moves require owned private device state.");
        PrepareLocalHandoff(store);
        var current=JsonSerializer.Deserialize<AccountRootOwnership.Owner>(RetainedFileReplacement.Read(Path.Combine(store.StateDirectory,AccountRootOwnership.FileName),8192))!;
        var ready=false;
        VerifyObserved(store.StateDirectory,current,TextPackStore.Hash(System.Text.Encoding.UTF8.GetBytes(store.Root)),()=> {
            ready=JsonSerializer.Deserialize<Marker>(RetainedFileReplacement.Read(Path.Combine(DirectoryFor(store.StateDirectory),"profile.json"),8192))!.Version>=5;
        });
        if(ready)return;
        using var migration=MigrationLease(store.StateDirectory);
        var owner=JsonSerializer.Deserialize<AccountRootOwnership.Owner>(RetainedFileReplacement.Read(Path.Combine(store.StateDirectory,AccountRootOwnership.FileName),8192))!;
        var rootHash=TextPackStore.Hash(System.Text.Encoding.UTF8.GetBytes(store.Root));VerifyUnlocked(store.StateDirectory,owner,rootHash);
        var directory=DirectoryFor(store.StateDirectory);var path=Path.Combine(directory,"profile.json");var original=RetainedFileReplacement.Read(path,8192);var marker=JsonSerializer.Deserialize<Marker>(original)!;
        if(marker.Version>=5)return;
        if(marker.Version!=4)throw new InvalidDataException("Invalid saved file move prior profile.");
        Publish(Path.Combine(directory,"profile-v4.json"),original);observe?.Invoke("sharedRenameProfilePreserved");
        var staged=Path.Combine(directory,".profile-v5-"+Guid.NewGuid().ToString("N"));RetainedFileReplacement.Create(staged,JsonSerializer.SerializeToUtf8Bytes(marker with{Version=5}));observe?.Invoke("sharedRenameProfileStaged");
        if(!RetainedFileReplacement.Read(path,8192).SequenceEqual(original))throw new FileChangedException();
        var displaced=Path.Combine(directory,"profile-v4-displaced.json");if(File.Exists(displaced))throw new InvalidDataException("A prior saved file move publication requires review.");
        observe?.Invoke("beforeSharedRenameProfilePublication");File.Replace(staged,path,displaced,ignoreMetadataErrors:false);observe?.Invoke("sharedRenameProfilePublished");VerifyUnlocked(store.StateDirectory,owner,rootHash);
    }

    // The current exclusive workspace writer calls this immediately before its
    // first incompatible v2 record. This method never persists sync work.
    public static void PrepareObservedAbsenceRename(TextPackStore store,Action<string>? observe=null)
    {
        PrepareSharedRename(store);
        using var migration=MigrationLease(store.StateDirectory);
        var owner=JsonSerializer.Deserialize<AccountRootOwnership.Owner>(RetainedFileReplacement.Read(Path.Combine(store.StateDirectory,AccountRootOwnership.FileName),8192))!;
        var rootHash=TextPackStore.Hash(System.Text.Encoding.UTF8.GetBytes(store.Root));VerifyUnlocked(store.StateDirectory,owner,rootHash);
        var directory=DirectoryFor(store.StateDirectory);var path=Path.Combine(directory,"profile.json");
        var original=RetainedFileReplacement.Read(path,8192);var marker=JsonSerializer.Deserialize<Marker>(original)!;
        if(marker.Version==6)return;
        if(marker.Version!=5)throw new InvalidDataException("Invalid generation-aware move prior profile.");
        Publish(Path.Combine(directory,"profile-v5.json"),original);observe?.Invoke("observedAbsenceProfilePreserved");
        var staged=Path.Combine(directory,".profile-v6-"+Guid.NewGuid().ToString("N"));
        RetainedFileReplacement.Create(staged,JsonSerializer.SerializeToUtf8Bytes(marker with{Version=6}));observe?.Invoke("observedAbsenceProfileStaged");
        if(!RetainedFileReplacement.Read(path,8192).SequenceEqual(original))throw new FileChangedException();
        var displaced=Path.Combine(directory,"profile-v5-displaced.json");
        if(File.Exists(displaced))throw new InvalidDataException("A prior generation-aware move publication requires review.");
        observe?.Invoke("beforeObservedAbsenceProfilePublication");File.Replace(staged,path,displaced,ignoreMetadataErrors:false);
        observe?.Invoke("observedAbsenceProfilePublished");VerifyUnlocked(store.StateDirectory,owner,rootHash);
    }

}
