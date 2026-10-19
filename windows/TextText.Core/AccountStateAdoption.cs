using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
namespace TextText.Core;

/// Call only after explicit review and retirement of this root's writers.
/// Original bytes and replacement bytes are durable before the active intent;
/// ordinary sync remains blocked until the whole transaction verifies.
public static class AccountStateAdoption
{
    public sealed record Result(bool AlreadyBound,string? RecoveryDirectory);
    public sealed record Entry(string Path,string BeforeHash,string AfterHash);
    public sealed record Intent(int Version,AccountRootOwnership.Owner Owner,string Directory,List<Entry> Entries);
    const int Limit=90*1024*1024;
    static readonly HashSet<string> Active=["checkpoint.json","acknowledge.json","intent.json","move-intent.json","binary-intent.json"];
    static bool Hash(string? value)=>value is not null&&Regex.IsMatch(value,@"^[a-f0-9]{64}\z");
    static string Safe(string directory,string relative) {
        if(Path.IsPathFullyQualified(relative)||relative.Contains('\\')||relative.Contains(':')||relative.Split('/').Any(part=>part is "" or "." or ".."))throw new InvalidDataException("Invalid adoption path.");
        var path=Path.GetFullPath(Path.Combine(directory,relative));
        if(!path.StartsWith(Path.GetFullPath(directory).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("Adoption path leaves its directory.");
        for(var current=path;!string.IsNullOrEmpty(current);current=Path.GetDirectoryName(current))
            if((File.Exists(current)||Directory.Exists(current))&&(File.GetAttributes(current)&FileAttributes.ReparsePoint)!=0)throw new InvalidDataException("Linked adoption state is unsupported.");
        return path;
    }
    static byte[] Read(string path,int limit=Limit) {
        if(new FileInfo(path).Length>limit)throw new InvalidDataException("Adoption state exceeds its limit.");
        var bytes=File.ReadAllBytes(path);if(bytes.Length>limit)throw new InvalidDataException("Adoption state exceeds its limit.");return bytes;
    }
    static bool Allowed(string path) {
        var parts=path.Split('/');return path=="sync.json"||parts.Length==2&&parts[0]=="replacement-index"&&Guid.TryParseExact(Path.GetFileNameWithoutExtension(parts[1]),"D",out _)&&parts[1].EndsWith(".json",StringComparison.Ordinal)||parts.Length==3&&parts[0]=="shared-editing"&&Regex.IsMatch(parts[1],@"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\z")&&Active.Contains(parts[2]);
    }
    static string Key(JsonObject value,string name,bool required=false) {
        var keys=value.Select(pair=>pair.Key).Where(key=>key.Equals(name,StringComparison.OrdinalIgnoreCase)).ToArray();
        if(keys.Length>1||keys.Length==0&&required)throw new InvalidDataException("Ambiguous adoption record.");
        return keys.Length==0?name:keys[0];
    }
    static void Version(JsonObject value,bool implicitVersion=false) {
        var key=Key(value,"Version");
        if(!value.ContainsKey(key)&&implicitVersion)return;
        if(value[key]?.GetValue<int>()!=1)throw new InvalidDataException("Update TextText to recover this state format.");
    }
    static bool Owner(JsonObject value,string name,string account) {
        var key=Key(value,name);
        if(key!=name)throw new InvalidDataException("Unsupported account field casing.");
        var saved=value[key]?.GetValue<string>();
        if(saved is not null&&saved!=account)throw new SharedAccountMismatchException();
        return saved is null;
    }
    static (byte[] Bytes,bool NeedsAdoption) Bind(TextPackStore store,string path,byte[] original,AccountRootOwnership.Owner owner) {
        if(path.StartsWith("replacement-index/",StringComparison.Ordinal))return new ReplacementRecoveryRegistry(store.Root,store.StateDirectory).BindForAdoption(original,Path.GetFileName(path),owner);
        var account=owner.AccountId;
        if(path=="sync.json")ProtectedSavedRename.ValidateStateBytes(original);
        var value=JsonNode.Parse(original) as JsonObject??throw new InvalidDataException("Invalid adoption record.");
        bool changed;
        if(path=="sync.json") {
            Version(value,true);
            foreach(var key in new[]{"Version","AccountId","Items","Outbox","BinaryOutbox","PendingPull","Capabilities"})
                if(Key(value,key)!=key)throw new InvalidDataException("Unsupported sync state field casing.");
            var state=JsonSerializer.Deserialize<SyncEngine.State>(original)??throw new InvalidDataException("Invalid sync state.");
            if(state.Version!=1)throw new InvalidDataException("Unsupported sync state.");
            if(state.ProtectedRenames is null)throw new InvalidDataException("Invalid saved file move map.");
            if(state.ProtectedRenames.Count>0) {
                var marker=Safe(store.StateDirectory,AccountRootOwnership.FileName);
                if(!File.Exists(marker)||state.AccountId!=owner.AccountId)throw new LegacyAccountStateException();
                AccountRootOwnership.Verify(marker,owner);
                var profile=JsonSerializer.Deserialize<RetainedReplacementProfile.Marker>(Read(Safe(store.StateDirectory,"retained-replacement-profile/profile.json"),8192))??throw new InvalidDataException("Invalid saved file move profile.");
                if(profile.Version!=5)throw new InvalidDataException("Saved file moves need their original supported profile.");
                ProtectedSavedRename.ValidateMap(state.ProtectedRenames,owner.RootHash,new(owner.Origin,owner.WorkspaceId,owner.AccountId));
                return(original,false);
            }
            changed=Owner(value,"AccountId",account);value["AccountId"]=account;
            // A verified fresh manifest must replace old cached write grants.
            value["Capabilities"]=JsonSerializer.SerializeToNode(new WorkspaceCapabilities(false,false,[],[]));
        } else {
            var file=Path.GetFileName(path);Version(value);
            if(file=="binary-intent.json")return(original,false);
            var checkpoint=file is "intent.json" or "move-intent.json"
                ? value[Key(value,"Checkpoint",true)] as JsonObject??throw new InvalidDataException("Invalid checkpoint intent.") : value;
            var cp=JsonSerializer.Deserialize<SharedCheckpoint>(checkpoint.ToJsonString())??throw new InvalidDataException("Invalid checkpoint.");
            SharedEditingStore.Validate(store,cp);
            if(cp.ItemId!=path.Split('/')[1])throw new InvalidDataException("Checkpoint directory identity changed.");
            var journal=JsonNode.Parse(cp.Journal) as JsonObject??throw new InvalidDataException("Invalid retained journal.");
            changed=Owner(journal,"accountId",account);journal["accountId"]=account;checkpoint["Journal"]=journal.ToJsonString();
        }
        return(JsonSerializer.SerializeToUtf8Bytes(value),changed);
    }
    static List<string> Paths(TextPackStore store) {
        var paths=new List<string>();if(File.Exists(Safe(store.StateDirectory,"sync.json")))paths.Add("sync.json");
        var replacements=Safe(store.StateDirectory,"replacement-index");
        if(Directory.Exists(replacements))foreach(var file in Directory.EnumerateFileSystemEntries(replacements)) {
            if(Path.GetFileName(file).StartsWith('.'))continue;
            var relative=Path.GetRelativePath(store.StateDirectory,file).Replace('\\','/');
            if((File.GetAttributes(file)&FileAttributes.ReparsePoint)!=0||Directory.Exists(file)||!Allowed(relative))throw new InvalidDataException("Unsupported retained replacement entry.");
            paths.Add(relative);if(paths.Count>2048)throw new InvalidDataException("Too many records for one adoption.");
        }
        var shared=Safe(store.StateDirectory,"shared-editing");
        if(Directory.Exists(shared))foreach(var item in Directory.EnumerateFileSystemEntries(shared)) {
            if((File.GetAttributes(item)&FileAttributes.ReparsePoint)!=0||!Directory.Exists(item))throw new InvalidDataException("Unsupported retained state directory.");
            foreach(var file in Directory.EnumerateFileSystemEntries(item)) {
                if((File.GetAttributes(file)&FileAttributes.ReparsePoint)!=0||Directory.Exists(file))throw new InvalidDataException("Unsupported retained state entry.");
                if(!Path.GetExtension(file).Equals(".json",StringComparison.OrdinalIgnoreCase)||Path.GetFileName(file).StartsWith("archived-",StringComparison.Ordinal))continue;
                var relative=Path.GetRelativePath(store.StateDirectory,file).Replace('\\','/');
                if(!Allowed(relative))throw new InvalidDataException("An unsupported retained record needs manual recovery.");
                paths.Add(relative);if(paths.Count>2048)throw new InvalidDataException("Too many records for one adoption.");
            }
        }
        if(paths.Count>2048)throw new InvalidDataException("Too many records for one adoption.");return paths.Order(StringComparer.Ordinal).ToList();
    }
    static Intent Prepare(TextPackStore store,AccountRootOwnership.Owner owner,Action<string>? barrier) {
        var changes=new List<(string Path,byte[] Before,byte[] After)>();long total=0;var needs=false;
        foreach(var path in Paths(store)) {
            var before=Read(Safe(store.StateDirectory,path));var update=Bind(store,path,before,owner);
            total+=before.Length+update.Bytes.Length;if(total>256L*1024*1024)throw new InvalidDataException("Saved state needs individual recovery before adoption.");
            needs|=update.NeedsAdoption;changes.Add((path,before,update.Bytes));
        }
        if(!needs)return new(1,owner,"",[]);
        var folder=".account-adoption-"+Guid.NewGuid().ToString("N");var transaction=Safe(store.StateDirectory,folder);
        var entries=new List<Entry>();
        foreach(var change in changes) {
            TextPackStore.AtomicWrite(Safe(transaction,"before/"+change.Path),change.Before,false);
            TextPackStore.AtomicWrite(Safe(transaction,"after/"+change.Path),change.After,false);
            entries.Add(new(change.Path,TextPackStore.Hash(change.Before),TextPackStore.Hash(change.After)));
            barrier?.Invoke("prepared:"+change.Path);
        }
        var intent=new Intent(1,owner,folder,entries);
        TextPackStore.AtomicWrite(Safe(store.StateDirectory,AccountRootOwnership.PendingAdoption),JsonSerializer.SerializeToUtf8Bytes(intent),false);
        barrier?.Invoke("intent");return intent;
    }
    static void Validate(TextPackStore store,Intent intent,AccountRootOwnership.Owner expected) {
        if(intent.Version!=1||intent.Owner!=expected||string.IsNullOrEmpty(intent.Directory)||!Regex.IsMatch(intent.Directory,@"^\.account-adoption-[a-f0-9]{32}\z")||intent.Entries.Count is <1 or >2048)throw new InvalidDataException("Adoption intent does not match this verified account and root.");
        var seen=new HashSet<string>(StringComparer.OrdinalIgnoreCase);long total=0;
        var transaction=Safe(store.StateDirectory,intent.Directory);
        foreach(var entry in intent.Entries) {
            if(entry is null||entry.Path is null||!Allowed(entry.Path)||!seen.Add(entry.Path)||!Hash(entry.BeforeHash)||!Hash(entry.AfterHash))throw new InvalidDataException("Invalid adoption entry.");
            var before=Read(Safe(transaction,"before/"+entry.Path));var after=Read(Safe(transaction,"after/"+entry.Path));
            total+=before.Length+after.Length;
            if(total>256L*1024*1024||TextPackStore.Hash(before)!=entry.BeforeHash||TextPackStore.Hash(after)!=entry.AfterHash)throw new InvalidDataException("Recovery copies changed. Original state remains protected.");
            var replacement=Bind(store,entry.Path,before,expected);
            if(TextPackStore.Hash(replacement.Bytes)!=entry.AfterHash)throw new InvalidDataException("Adoption replacement differs from its recorded original.");
            _ = Bind(store,entry.Path,after,expected);
            var current=TextPackStore.Hash(Read(Safe(store.StateDirectory,entry.Path)));
            if(current!=entry.BeforeHash&&current!=entry.AfterHash)throw new FileChangedException();
        }
    }
    public static Result AdoptAfterExplicitReview(TextPackStore store,Uri origin,string workspaceId,string accountId,Action<string>? barrier=null) {
        var expected=AccountRootOwnership.Expected(store,origin,workspaceId,accountId);
        using var migrationLock=new FileStream(Safe(store.StateDirectory,"account-adoption.lock"),FileMode.OpenOrCreate,FileAccess.ReadWrite,FileShare.None);
        using var syncLock=new FileStream(Safe(store.StateDirectory,"sync.lock"),FileMode.OpenOrCreate,FileAccess.ReadWrite,FileShare.None);
        var marker=Safe(store.StateDirectory,AccountRootOwnership.FileName);
        if(File.Exists(marker))AccountRootOwnership.Verify(marker,expected);
        var pending=Safe(store.StateDirectory,AccountRootOwnership.PendingAdoption);
        var resuming=File.Exists(pending);
        var intent=resuming?JsonSerializer.Deserialize<Intent>(Read(pending,1024*1024))??throw new InvalidDataException("Invalid adoption intent."):Prepare(store,expected,barrier);
        if(intent.Version!=1||intent.Owner is null||intent.Entries is null)throw new InvalidDataException("Invalid adoption intent.");
        if(intent.Owner.AccountId!=expected.AccountId)throw new SharedAccountMismatchException();
        if(intent.Entries.Count==0 && (resuming||intent.Owner!=expected||intent.Directory!=""))throw new InvalidDataException("Invalid empty adoption intent.");
        if(intent.Entries.Count==0) {AccountRootOwnership.Open(store,origin,workspaceId,accountId);return new(true,null);}
        Validate(store,intent,expected);
        var transaction=Safe(store.StateDirectory,intent.Directory);
        foreach(var entry in intent.Entries) {
            var path=Safe(store.StateDirectory,entry.Path);
            var current=TextPackStore.Hash(Read(path));
            if(current!=entry.BeforeHash&&current!=entry.AfterHash)throw new FileChangedException();
            if(current!=entry.AfterHash)TextPackStore.AtomicWrite(path,Read(Safe(transaction,"after/"+entry.Path)));
            barrier?.Invoke("applied:"+entry.Path);
        }
        Validate(store,intent,expected);
        AccountRootOwnership.Publish(store,expected);barrier?.Invoke("owner");
        TextPackStore.AtomicWrite(Safe(transaction,"completed.json"),JsonSerializer.SerializeToUtf8Bytes(intent));
        File.Delete(pending);barrier?.Invoke("complete");
        return new(false,transaction);
    }
}
