using System.Text.Json;
using System.Text.RegularExpressions;
namespace TextText.Core;
public sealed record SharedCheckpoint(string ItemId,string Path,string ProjectedHash,string AcknowledgedRevision,long Epoch,long Seq,long JournalGeneration,string Journal,bool Pending,int Version=1,string? RetiredReason=null);
public sealed record SharedSession(string SessionToken,PackFile Document,SharedCheckpoint? Checkpoint);
public sealed class SharedSessionClosedException() : InvalidOperationException("This editing session is no longer active.");
public sealed class SharedAccountMismatchException() : InvalidOperationException("Saved edits need their original account or explicit recovery. They remain on this device.");
public sealed class SharedEditingStore(TextPackStore store,SyncEngine sync,string? accountId=null) : IDisposable
{
    readonly string? principalAccountId = accountId is null || Regex.IsMatch(accountId,@"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\z")
        ? accountId : throw new InvalidDataException("Invalid account identity.");
    static string? JournalAccount(SharedCheckpoint checkpoint) {
        using var document=JsonDocument.Parse(checkpoint.Journal);
        if(!document.RootElement.TryGetProperty("accountId",out var owner)||owner.ValueKind==JsonValueKind.Null)return null;
        if(owner.ValueKind!=JsonValueKind.String||!Regex.IsMatch(owner.GetString()!,@"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\z"))throw new InvalidDataException("Invalid journal account identity.");
        return owner.GetString();
    }
    void RequireAccount(SharedCheckpoint checkpoint) { if(JournalAccount(checkpoint)!=principalAccountId)throw new SharedAccountMismatchException(); }
    void PrepareAccount(string itemId,string path,string expectedHash) {
        var directory=DirectoryFor(itemId);
        var intent=Read<Intent>(System.IO.Path.Combine(directory,"intent.json"));if(intent!=null)RequireAccount(intent.Checkpoint);
        var move=ReadMoveIntent(System.IO.Path.Combine(directory,"move-intent.json"));if(move!=null)RequireAccount(move.Checkpoint);
        var acknowledgement=Read<SharedCheckpoint>(System.IO.Path.Combine(directory,"acknowledge.json"));if(acknowledgement!=null)RequireAccount(acknowledgement);
        var file=System.IO.Path.Combine(directory,"checkpoint.json");var checkpoint=Read<SharedCheckpoint>(file);if(checkpoint==null)return;
        Validate(store,checkpoint);if(JournalAccount(checkpoint)==principalAccountId)return;
        using var journal=JsonDocument.Parse(checkpoint.Journal);
        if(principalAccountId==null||checkpoint.Pending||checkpoint.RetiredReason!=null||
            journal.RootElement.TryGetProperty("retired",out var retired)&&retired.ValueKind!=JsonValueKind.Null||
            journal.RootElement.TryGetProperty("recovery",out var recovery)&&recovery.ValueKind!=JsonValueKind.Null||
            File.Exists(System.IO.Path.Combine(directory,"binary-intent.json")))throw new SharedAccountMismatchException();
        // Only a clean acknowledged baseline may change account. Keep its bytes
        // before opening a fresh generation stream for the verified principal.
        var current=store.Describe(path);if(current.ItemId!=itemId||(current.Hash!=expectedHash&&current.Hash!=checkpoint.ProjectedHash))throw new FileChangedException();
        TextPackStore.AtomicWrite(System.IO.Path.Combine(directory,"archived-account-"+Guid.NewGuid().ToString("N")+".json"),File.ReadAllBytes(file));
        File.Delete(file);
    }
    sealed record MoveIntent(int Version,string SourcePath,SharedCheckpoint Checkpoint,bool AdoptsExternalChange=false,bool? CaseOnly=null);
    static MoveIntent? ReadMoveIntent(string path)
    {
        if(!File.Exists(path))return null;
        var bytes=RetainedFileReplacement.Read(path,90*1024*1024);
        RetainedFileReplacement.JsonFields(bytes,["Version","SourcePath","Checkpoint","AdoptsExternalChange","CaseOnly"],["Version","SourcePath","Checkpoint"]);
        var intent=JsonSerializer.Deserialize<MoveIntent>(bytes)??throw new InvalidDataException("Invalid shared move intent.");
        if(intent.Version!=1||string.IsNullOrEmpty(intent.SourcePath)||intent.Checkpoint is null||intent.SourcePath==intent.Checkpoint.Path||intent.CaseOnly is not null&&(intent.CaseOnly!=true||!(intent.SourcePath!=intent.Checkpoint.Path&&string.Equals(intent.SourcePath,intent.Checkpoint.Path,StringComparison.OrdinalIgnoreCase))))throw new InvalidDataException("Unsupported shared move intent.");
        return intent;
    }
    sealed record Intent(int Version,string BeforeHash,string Payload,SharedCheckpoint Checkpoint);
    sealed record BinaryIntent(int Version,string ItemId,string Path,string BeforeHash,string AfterHash);
    sealed record Active(string ItemId,string Path,IDisposable Lease);
    readonly Dictionary<string,Active> sessions=[];readonly SemaphoreSlim gate=new(1,1);bool disposed;
    /// Announced by collaboration.open. "epoch-adoption": a pending journal may move to a newer epoch through an authorized, archived recovery intent.
    public static readonly string[] Capabilities=["epoch-adoption"];
    string DirectoryFor(string id) {AccountRootOwnership.RequireNoAdoption(store.StateDirectory);if(!Regex.IsMatch(id,@"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\z"))throw new InvalidDataException("Invalid identity.");var path=System.IO.Path.Combine(store.StateDirectory,"shared-editing",id);Directory.CreateDirectory(path);return path;}
    static T? Read<T>(string path) {if(!File.Exists(path))return default;if(new FileInfo(path).Length>90*1024*1024)throw new InvalidDataException("Shared state exceeds bounds.");return JsonSerializer.Deserialize<T>(File.ReadAllBytes(path))??throw new InvalidDataException("Invalid shared state.");}
    static void Save<T>(string path,T value)=>TextPackStore.AtomicWrite(path,JsonSerializer.SerializeToUtf8Bytes(value));
    static bool ValidHash(string hash)=>Regex.IsMatch(hash,@"^[0-9a-f]{64}$");
    internal static void Validate(TextPackStore store,SharedCheckpoint cp) {
        if(!Regex.IsMatch(cp.ItemId,@"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\z"))throw new InvalidDataException("Invalid identity.");_=store.Resolve(cp.Path);
        if(cp.Version!=1 || !ValidHash(cp.ProjectedHash)||!ValidHash(cp.AcknowledgedRevision)||cp.Epoch<1||cp.Seq<0||cp.JournalGeneration<1||cp.Epoch>9007199254740991||cp.Seq>9007199254740991||cp.JournalGeneration>9007199254740991||cp.Journal.Length>4*1024*1024)throw new InvalidDataException("Unsupported shared checkpoint. Retained edits are unchanged.");
        using var doc=JsonDocument.Parse(cp.Journal);var j=doc.RootElement;
        if(j.GetProperty("version").GetInt32()!=1||j.GetProperty("epoch").GetInt64()!=cp.Epoch||j.GetProperty("seq").GetInt64()!=cp.Seq||j.GetProperty("journalGeneration").GetInt64()!=cp.JournalGeneration||j.GetProperty("revision").GetString()!=cp.AcknowledgedRevision||j.GetProperty("relativePath").GetString()!=cp.Path)throw new InvalidDataException("Journal metadata mismatch.");
        if(Convert.FromBase64String(j.GetProperty("update").GetString()!).Length==0)throw new InvalidDataException("Empty journal update.");
        var pending=j.GetProperty("pending");if(pending.GetArrayLength()>1024)throw new InvalidDataException("Too many pending updates.");
        foreach(var update in pending.EnumerateArray()){if(update.GetString()!.Length>700000)throw new InvalidDataException("Pending update too large.");_=Convert.FromBase64String(update.GetString()!);}
        if(!cp.Pending && (pending.GetArrayLength()>0 || (j.TryGetProperty("batch",out var batch)&&batch.ValueKind!=JsonValueKind.Null) || (j.TryGetProperty("unqueuedDirty",out var dirty)&&dirty.ValueKind==JsonValueKind.True)))throw new InvalidDataException("Unacknowledged updates marked saved.");
        if(j.TryGetProperty("recovery",out var recovery)&&recovery.ValueKind!=JsonValueKind.Null){var intent=RecoveryIntent.Parse(recovery);if(intent==null||intent.Epoch>cp.Epoch)throw new InvalidDataException("Invalid saved recovery intent. Retained edits are unchanged.");}
    }
    /// The client's durable epoch-recovery intent: the exact bytes it sent to the server for the old epoch, plus whether the replacement epoch is adopted.
    internal sealed record RecoveryIntent(string OperationId,long Epoch,string Update,bool Adopted) {
        public static RecoveryIntent? Parse(JsonElement raw) {
            if(raw.ValueKind!=JsonValueKind.Object)return null;
            foreach(var property in raw.EnumerateObject())if(property.Name is not ("operationId" or "epoch" or "update" or "adopted"))return null;
            if(!raw.TryGetProperty("operationId",out var id)||id.ValueKind!=JsonValueKind.String||!Regex.IsMatch(id.GetString()!,@"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\z"))return null;
            if(!raw.TryGetProperty("epoch",out var epoch)||epoch.ValueKind!=JsonValueKind.Number||!epoch.TryGetInt64(out var epochValue)||epochValue<1||epochValue>9007199254740991)return null;
            if(!raw.TryGetProperty("update",out var update)||update.ValueKind!=JsonValueKind.String||update.GetString()!.Length==0||update.GetString()!.Length>6*1024*1024)return null;
            try{if(Convert.FromBase64String(update.GetString()!).Length==0)return null;}catch(FormatException){return null;}
            var adopted=false;
            if(raw.TryGetProperty("adopted",out var flag)){if(flag.ValueKind==JsonValueKind.True)adopted=true;else if(flag.ValueKind!=JsonValueKind.False)return null;}
            return new RecoveryIntent(id.GetString()!,epochValue,update.GetString()!,adopted);
        }
        public static RecoveryIntent? Of(SharedCheckpoint cp) {
            using var doc=JsonDocument.Parse(cp.Journal);
            return doc.RootElement.TryGetProperty("recovery",out var raw)&&raw.ValueKind!=JsonValueKind.Null?Parse(raw):null;
        }
    }
    /// A retirement that only repeats the retained journal's own "retired" text was written by the browser client, not found by this store.
    /// The reopened editor may revive that journal (the server still decides access); a newer unretired checkpoint of the same epoch and
    /// path lifts it. Retirements this store or the sync engine recorded carry other text and stay fenced.
    static bool LiftsMirroredRetirement(SharedCheckpoint prior,SharedCheckpoint incoming) {
        if(prior.RetiredReason==null||incoming.RetiredReason!=null)return false;
        try {
            using var doc=JsonDocument.Parse(prior.Journal);
            if(!doc.RootElement.TryGetProperty("retired",out var retired)||retired.ValueKind!=JsonValueKind.String||retired.GetString()!=prior.RetiredReason)return false;
        }catch(JsonException){return false;}
        return incoming.Epoch==prior.Epoch&&incoming.Path==prior.Path&&incoming.ItemId==prior.ItemId&&incoming.JournalGeneration>prior.JournalGeneration;
    }
    /// A pending journal may only move to a newer epoch when the incoming checkpoint proves the client adopted the epoch produced
    /// by the recovery intent this store already holds. Server acknowledgement alone never qualifies: the intent must have been checkpointed here before the send.
    static RecoveryIntent? AuthorizedAdoption(SharedCheckpoint prior,SharedCheckpoint incoming,PackFile current) {
        if(!prior.Pending||prior.RetiredReason!=null||incoming.Epoch<=prior.Epoch||incoming.ItemId!=prior.ItemId||incoming.Path!=prior.Path||current.Path!=prior.Path||current.Hash!=prior.ProjectedHash||incoming.JournalGeneration<=prior.JournalGeneration)return null;
        var retained=RecoveryIntent.Of(prior);var adopted=RecoveryIntent.Of(incoming);
        if(retained==null||retained.Adopted||retained.Epoch!=prior.Epoch||adopted==null||!adopted.Adopted)return null;
        if(adopted.OperationId!=retained.OperationId||adopted.Epoch!=retained.Epoch||adopted.Update!=retained.Update)return null;
        return adopted;
    }
    public static bool HasProtectedState(string stateDirectory,string itemId) {
        if(!Regex.IsMatch(itemId,@"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\z"))throw new InvalidDataException("Invalid remote identity.");
        var directory=System.IO.Path.Combine(stateDirectory,"shared-editing",itemId);
        if(File.Exists(System.IO.Path.Combine(directory,"move-intent.json"))||File.Exists(System.IO.Path.Combine(directory,"intent.json"))||File.Exists(System.IO.Path.Combine(directory,"binary-intent.json"))||File.Exists(System.IO.Path.Combine(directory,"acknowledge.json")))return true;
        var cp=Read<SharedCheckpoint>(System.IO.Path.Combine(directory,"checkpoint.json"));
        return cp!=null&&(cp.Version!=1||cp.Pending||cp.RetiredReason!=null);
    }
    static PackFile UniqueProjection(TextPackStore store,string itemId) {
        var matches=store.Scan().Where(file=>file.ItemId==itemId).ToArray();
        // An unreadable subtree can hide a second copy. Never choose a path
        // while the inventory cannot prove that this identity is unique.
        if(matches.Length==0&&store.LastScanErrors.Count==0)throw new FileNotFoundException("The shared projection is temporarily unavailable.");
        if(matches.Length!=1||store.LastScanErrors.Count!=0)throw new FileChangedException();
        var current=store.Describe(matches[0].Path);
        if(current.ItemId!=itemId||current.Hash!=matches[0].Hash)throw new FileChangedException();
        return current;
    }
    internal static SharedCheckpoint? FollowLocalProjection(TextPackStore store,string itemId) => store.WithExclusiveMutation(() => {
        if(!Regex.IsMatch(itemId,@"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\z"))throw new InvalidDataException("Invalid identity.");
        var directory=System.IO.Path.Combine(store.StateDirectory,"shared-editing",itemId);
        var cp=Read<SharedCheckpoint>(System.IO.Path.Combine(directory,"checkpoint.json"));
        if(cp==null)return null;
        Validate(store,cp);if(cp.ItemId!=itemId)throw new InvalidDataException("Shared identity mismatch.");
        if(cp.RetiredReason!=null||FolderCaseRename.ExactPathExists(store.Root,store.Resolve(cp.Path)))return cp;
        var target=UniqueProjection(store,itemId);
        return RebaseProjection(store,itemId,target.Path,adoptingExternalChange:true);
    });
    internal sealed record ProtectionSnapshot(string Fingerprint,bool Protected);
    // Read fixed retained files only. Never Recover/Follow/Save or create a directory.
    internal static ProtectionSnapshot ReadProtectionSnapshot(TextPackStore store,string itemId,string? accountId) {
        if(!Regex.IsMatch(itemId,@"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\z"))throw new InvalidDataException("Invalid identity.");
        var directory=System.IO.Path.Combine(store.StateDirectory,"shared-editing",itemId);
        RetainedFileReplacement.CheckPath(directory);var hashes=new SortedDictionary<string,string>(StringComparer.Ordinal);var blocked=false;
        foreach(var name in new[]{"checkpoint.json","intent.json","move-intent.json","binary-intent.json","acknowledge.json"}) {
            var path=System.IO.Path.Combine(directory,name);RetainedFileReplacement.CheckPath(path);if(!File.Exists(path))continue;
            var bytes=RetainedFileReplacement.Read(path,90*1024*1024);using var json=JsonDocument.Parse(bytes);var value=json.RootElement;
            if(value.ValueKind!=JsonValueKind.Object||value.TryGetProperty("Version",out var version)&&(!version.TryGetInt32(out var number)||number!=1))throw new InvalidDataException("Unknown shared protection state.");
            if(name is "checkpoint.json" or "acknowledge.json") {
                RetainedFileReplacement.JsonFields(bytes,["Version","ItemId","Path","ProjectedHash","AcknowledgedRevision","Epoch","Seq","JournalGeneration","Journal","Pending","RetiredReason"],["ItemId","Path","ProjectedHash","AcknowledgedRevision","Epoch","Seq","JournalGeneration","Journal","Pending"]);
                var cp=JsonSerializer.Deserialize<SharedCheckpoint>(bytes)??throw new InvalidDataException("Invalid checkpoint.");Validate(store,cp);
                if(cp.ItemId!=itemId||JournalAccount(cp)!=accountId)throw new SharedAccountMismatchException();blocked|=cp.Pending||cp.RetiredReason is not null||name=="acknowledge.json";
            } else {
                if(name=="intent.json"){RetainedFileReplacement.JsonFields(bytes,["Version","BeforeHash","Payload","Checkpoint"],["Version","BeforeHash","Payload","Checkpoint"]);var intent=JsonSerializer.Deserialize<Intent>(bytes)??throw new InvalidDataException("Invalid intent.");Validate(store,intent.Checkpoint);if(intent.Checkpoint.ItemId!=itemId||JournalAccount(intent.Checkpoint)!=accountId)throw new SharedAccountMismatchException();}
                if(name=="move-intent.json"){var intent=ReadMoveIntent(path)??throw new InvalidDataException("Invalid move intent.");Validate(store,intent.Checkpoint);if(intent.Checkpoint.ItemId!=itemId||JournalAccount(intent.Checkpoint)!=accountId)throw new SharedAccountMismatchException();}
                if(name=="binary-intent.json"){RetainedFileReplacement.JsonFields(bytes,["Version","ItemId","Path","BeforeHash","AfterHash"],["Version","ItemId","Path","BeforeHash","AfterHash"]);var intent=JsonSerializer.Deserialize<BinaryIntent>(bytes)??throw new InvalidDataException("Invalid binary intent.");if(intent.ItemId!=itemId)throw new InvalidDataException("Invalid binary identity.");}
                blocked=true;
            }
            hashes[name]=TextPackStore.Hash(bytes);
        }
        return new(JsonSerializer.Serialize(hashes),blocked);
    }
    internal static bool HasReadyCheckpoint(TextPackStore store,string itemId) {
        if(!Regex.IsMatch(itemId,@"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\z"))return false;
        var directory=System.IO.Path.Combine(store.StateDirectory,"shared-editing",itemId);
        if(File.Exists(System.IO.Path.Combine(directory,"intent.json"))||File.Exists(System.IO.Path.Combine(directory,"move-intent.json"))||File.Exists(System.IO.Path.Combine(directory,"binary-intent.json")))return false;
        try {
            var cp=FollowLocalProjection(store,itemId);
            if(cp==null||cp.ItemId!=itemId||cp.RetiredReason!=null)return false;
            Validate(store,cp);var file=store.Describe(cp.Path);
            return file.ItemId==itemId&&file.Path==cp.Path&&(file.Hash==cp.ProjectedHash||cp.Pending);
        }catch(Exception error)when(error is IOException or InvalidDataException or JsonException or InvalidOperationException or KeyNotFoundException or FormatException or ArgumentException or UnauthorizedAccessException){return false;}
    }
    internal static List<string> ReconcileAcknowledgements(TextPackStore store,SyncEngine.State state,IReadOnlySet<string>? inspectOnlyItems=null) {
        var completed=new List<string>();var root=System.IO.Path.Combine(store.StateDirectory,"shared-editing");if(!System.IO.Directory.Exists(root))return completed;
        foreach(var file in System.IO.Directory.EnumerateFiles(root,"acknowledge.json",SearchOption.AllDirectories)) {
            var cp=Read<SharedCheckpoint>(file)!;if(inspectOnlyItems?.Contains(cp.ItemId)==true)continue;if(cp.Version!=1||cp.Pending||!ValidHash(cp.ProjectedHash)||!ValidHash(cp.AcknowledgedRevision))throw new InvalidDataException("Invalid checkpoint acknowledgement.");
            if(File.Exists(System.IO.Path.Combine(System.IO.Path.GetDirectoryName(file)!,"intent.json")))continue;
            var projection=FollowLocalProjection(store,cp.ItemId);
            if(projection!=null&&projection.Path!=cp.Path) {
                // A path-only rebase may finish while this clean acknowledgement
                // waits for the sync gate. Require every other checkpoint field
                // and journal value to match; never borrow a newer generation.
                var journal=System.Text.Json.Nodes.JsonNode.Parse(cp.Journal)!;journal["relativePath"]=projection.Path;
                if(cp with{Path=projection.Path,Journal=projection.Journal}!=projection||
                   !System.Text.Json.Nodes.JsonNode.DeepEquals(journal,System.Text.Json.Nodes.JsonNode.Parse(projection.Journal)))continue;
                cp=projection;
            }
            if(store.ReplacementBlocked(cp.ItemId))continue;
            var current=store.Describe(cp.Path);if(current.ItemId!=cp.ItemId||current.Hash!=cp.ProjectedHash)continue;
            if(state.Outbox.Any(x=>x.ItemId==cp.ItemId)||state.PendingPull?.ItemId==cp.ItemId)continue;
            var prior=state.Items.GetValueOrDefault(cp.ItemId);
            var path=prior?.Path??cp.Path;
            state.Items[cp.ItemId]=new(path,cp.ProjectedHash,cp.AcknowledgedRevision,Lifecycle:prior?.Lifecycle);completed.Add(file);
        }return completed;
    }
    public static SharedCheckpoint RebaseProjection(TextPackStore store,string itemId,string newPath,
        bool interruptAfterIntent=false,bool interruptAfterMove=false,bool adoptingExternalChange=false) => store.WithExclusiveMutation(() => {
        if(!Regex.IsMatch(itemId,@"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\z"))throw new InvalidDataException("Invalid identity.");
        var directory=System.IO.Path.Combine(store.StateDirectory,"shared-editing",itemId);
        RecoverMove(store,directory,itemId);
        if(File.Exists(System.IO.Path.Combine(directory,"intent.json"))||File.Exists(System.IO.Path.Combine(directory,"binary-intent.json")))throw new IOException("A shared checkpoint is still being recovered.");
        var cp=Read<SharedCheckpoint>(System.IO.Path.Combine(directory,"checkpoint.json"))??throw new InvalidOperationException("No shared projection is available.");
        Validate(store,cp);if(cp.ItemId!=itemId||cp.RetiredReason!=null)throw new InvalidDataException("Shared identity mismatch.");
        if(cp.Path==newPath)return cp;
        var sourcePath=store.Resolve(cp.Path);var destinationPath=store.Resolve(newPath);
        var parentAlreadyMoved=FolderCaseRename.AlreadyMovedAlias(store.Root,sourcePath,destinationPath);
        if(parentAlreadyMoved)RetainedReplacementProfile.PrepareFolderCase(store);
        var caseOnly=RetainedFileMove.IsCaseOnlyAlias(sourcePath,destinationPath)||adoptingExternalChange&&RetainedFileMove.IsCaseOnlyAlias(destinationPath,sourcePath)||parentAlreadyMoved;
        if(caseOnly?FolderCaseRename.ExactPathExists(store.Root,sourcePath):File.Exists(sourcePath)) {
            var source=store.Describe(cp.Path);
            if(source.ItemId!=itemId||source.Hash!=cp.ProjectedHash||!caseOnly&&File.Exists(destinationPath))throw new FileChangedException();
        } else {
            var observed=UniqueProjection(store,itemId);
            if(observed.Path!=newPath||(!adoptingExternalChange&&observed.Hash!=cp.ProjectedHash))throw new FileChangedException();
        }
        var journal=System.Text.Json.Nodes.JsonNode.Parse(cp.Journal)!;journal["relativePath"]=newPath;
        var target=cp with{Path=newPath,Journal=journal.ToJsonString()};Validate(store,target);
        var intent=new MoveIntent(1,cp.Path,target,adoptingExternalChange,CaseOnly:caseOnly?true:null);Save(System.IO.Path.Combine(directory,"move-intent.json"),intent);
        if(interruptAfterIntent)throw new IOException("Interrupted before shared move.");
        return FinishMove(store,directory,intent,interruptAfterMove);
    });
    static void RecoverMove(TextPackStore store,string directory,string itemId) {
        var intent=ReadMoveIntent(System.IO.Path.Combine(directory,"move-intent.json"));
        if(intent!=null){if(intent.Checkpoint.ItemId!=itemId)throw new InvalidDataException("Shared identity mismatch.");FinishMove(store,directory,intent);}
    }
    static SharedCheckpoint FinishMove(TextPackStore store,string directory,MoveIntent intent,bool interruptAfterMove=false) {
        var cp=intent.Checkpoint;Validate(store,cp);
        if(intent.Version!=1||intent.SourcePath==cp.Path)throw new InvalidDataException("Invalid shared move.");
        if(intent.CaseOnly==true?FolderCaseRename.ExactPathExists(store.Root,store.Resolve(intent.SourcePath)):File.Exists(store.Resolve(intent.SourcePath))) {
            var current=store.Describe(intent.SourcePath);if(current.ItemId!=cp.ItemId||current.Hash!=cp.ProjectedHash)throw new FileChangedException();
            store.Rename(intent.SourcePath,cp.Path,current.Hash);
            if(interruptAfterMove)throw new IOException("Interrupted after shared move.");
        }
        if(intent.CaseOnly==true&&!FolderCaseRename.ExactPathExists(store.Root,store.Resolve(cp.Path)))throw new FileChangedException();
        var moved=intent.AdoptsExternalChange?UniqueProjection(store,cp.ItemId):store.Describe(cp.Path);
        if(moved.Path!=cp.Path||moved.ItemId!=cp.ItemId||(!intent.AdoptsExternalChange&&moved.Hash!=cp.ProjectedHash))throw new FileChangedException();
        Save(System.IO.Path.Combine(directory,"checkpoint.json"),cp);File.Delete(System.IO.Path.Combine(directory,"move-intent.json"));return cp;
    }
    SharedCheckpoint? Recover(string itemId) => store.WithExclusiveMutation(() => {
        store.AssertReplacementReadable(itemId);
        var directory=DirectoryFor(itemId);
        var move=ReadMoveIntent(System.IO.Path.Combine(directory,"move-intent.json"));if(move!=null)RequireAccount(move.Checkpoint);
        RecoverMove(store,directory,itemId);var intent=Read<Intent>(System.IO.Path.Combine(directory,"intent.json"));
        if(intent!=null) {RequireAccount(intent.Checkpoint);if(intent.Version!=1)throw new InvalidDataException("Unsupported shared intent.");Finish(intent,directory);}
        var prior=Read<SharedCheckpoint>(System.IO.Path.Combine(directory,"checkpoint.json"));if(prior!=null){Validate(store,prior);RequireAccount(prior);}
        RecoverBinary(store,directory,itemId);
        var cp=Read<SharedCheckpoint>(System.IO.Path.Combine(directory,"checkpoint.json"));if(cp!=null){Validate(store,cp);RequireAccount(cp);if(cp.ItemId!=itemId)throw new InvalidDataException("Shared identity mismatch.");}return cp;
    });
    PackFile Finish(Intent intent,string directory) {
        store.AssertReplacementReadable(intent.Checkpoint.ItemId);
        Validate(store,intent.Checkpoint);var bytes=Convert.FromBase64String(intent.Payload);if(TextPackStore.Identity(bytes)!=intent.Checkpoint.ItemId||TextPackStore.Hash(bytes)!=intent.Checkpoint.ProjectedHash)throw new InvalidDataException("Invalid shared projection.");
        var current=store.Describe(intent.Checkpoint.Path);
        if(current.Hash==intent.BeforeHash)current=store.Write(current.Path,bytes,current.Hash);
        else if(current.Hash!=intent.Checkpoint.ProjectedHash){Save(System.IO.Path.Combine(directory,"checkpoint.json"),intent.Checkpoint with{RetiredReason="The file changed outside this editing session. Its shared edits are retained."});store.Preserve(bytes,"shared-conflict");File.Delete(System.IO.Path.Combine(directory,"intent.json"));throw new FileChangedException();}
        store.AssertReplacementReadable(intent.Checkpoint.ItemId);
        Save(System.IO.Path.Combine(directory,"checkpoint.json"),intent.Checkpoint);File.Delete(System.IO.Path.Combine(directory,"intent.json"));return current;
    }
    static void RecoverBinary(TextPackStore store,string directory,string itemId) {
        var intent=Read<BinaryIntent>(System.IO.Path.Combine(directory,"binary-intent.json"));
        if(intent!=null){if(intent.Version!=1||intent.ItemId!=itemId)throw new InvalidDataException("Invalid binary projection intent.");FinishBinary(store,directory,intent);}
    }
    public static void RecoverPendingBinaryProjection(TextPackStore store,string itemId) => store.WithExclusiveMutation(() => {
        if(!Regex.IsMatch(itemId,@"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\z"))throw new InvalidDataException("Invalid identity.");
        var directory=System.IO.Path.Combine(store.StateDirectory,"shared-editing",itemId);
        if(File.Exists(System.IO.Path.Combine(directory,"intent.json"))||File.Exists(System.IO.Path.Combine(directory,"move-intent.json")))return true;
        RecoverBinary(store,directory,itemId);
        return true;
    });
    static PackFile FinishBinary(TextPackStore store,string directory,BinaryIntent intent,bool interruptAfterWrite=false) {
        store.AssertReplacementReadable(intent.ItemId);
        var target=System.IO.Path.Combine(directory,"binary-next.textpack");
        if(!File.Exists(target)||new FileInfo(target).Length>64*1024*1024)throw new InvalidDataException("Binary projection is missing or oversized.");
        var bytes=File.ReadAllBytes(target);
        if(TextPackStore.Hash(bytes)!=intent.AfterHash||TextPackStore.Identity(bytes)!=intent.ItemId)throw new InvalidDataException("Binary projection changed.");
        var checkpoint=Read<SharedCheckpoint>(System.IO.Path.Combine(directory,"checkpoint.json"));
        if(checkpoint!=null){Validate(store,checkpoint);if(checkpoint.ItemId!=intent.ItemId||checkpoint.Path!=intent.Path||checkpoint.RetiredReason!=null||
            (checkpoint.ProjectedHash!=intent.BeforeHash&&checkpoint.ProjectedHash!=intent.AfterHash))throw new FileChangedException();}
        var current=store.Describe(intent.Path);
        if(current.ItemId!=intent.ItemId)throw new FileChangedException();
        if(current.Hash==intent.BeforeHash)current=store.Write(intent.Path,bytes,intent.BeforeHash);
        else if(current.Hash!=intent.AfterHash)throw new FileChangedException();
        if(interruptAfterWrite)throw new IOException("Interrupted after binary file write.");
        if(checkpoint!=null&&checkpoint.ProjectedHash!=intent.AfterHash)
            Save(System.IO.Path.Combine(directory,"checkpoint.json"),checkpoint with{ProjectedHash=intent.AfterHash});
        File.Delete(System.IO.Path.Combine(directory,"binary-intent.json"));File.Delete(target);
        return current;
    }
    /// The binary projection shares the document's file fence and updates the
    /// retained checkpoint without touching its Yjs journal or pending edits.
    public static PackFile ApplyRemoteBinary(TextPackStore store,string itemId,string path,string beforeHash,
        string entryPath,string? expectedEntryHash,byte[]? replacement,
        bool interruptAfterIntent=false,bool interruptAfterWrite=false) => store.WithExclusiveMutation(() => {
        if(!Regex.IsMatch(itemId,@"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\z")||!ValidHash(beforeHash))throw new InvalidDataException("Invalid binary projection identity.");
        var directory=System.IO.Path.Combine(store.StateDirectory,"shared-editing",itemId);Directory.CreateDirectory(directory);
        RecoverBinary(store,directory,itemId);
        if(File.Exists(System.IO.Path.Combine(directory,"intent.json"))||File.Exists(System.IO.Path.Combine(directory,"move-intent.json")))throw new IOException("A shared checkpoint is still being recovered.");
        var current=store.Describe(path);
        if(current.ItemId!=itemId||current.Hash!=beforeHash)throw new FileChangedException();
        var checkpoint=Read<SharedCheckpoint>(System.IO.Path.Combine(directory,"checkpoint.json"));
        if(checkpoint!=null){Validate(store,checkpoint);if(checkpoint.ItemId!=itemId||checkpoint.Path!=path||checkpoint.ProjectedHash!=beforeHash||checkpoint.RetiredReason!=null)throw new FileChangedException();}
        var changed=BinaryEntryPacks.Patch(store.Read(path),entryPath,expectedEntryHash,replacement);
        var intent=new BinaryIntent(1,itemId,path,beforeHash,TextPackStore.Hash(changed));
        TextPackStore.AtomicWrite(System.IO.Path.Combine(directory,"binary-next.textpack"),changed);
        Save(System.IO.Path.Combine(directory,"binary-intent.json"),intent);
        if(interruptAfterIntent)throw new IOException("Interrupted after binary intent.");
        return FinishBinary(store,directory,intent,interruptAfterWrite);
    });
    public async Task<SharedSession> OpenAsync(string itemId,string path,string expectedHash,CancellationToken ct=default) {
        await gate.WaitAsync(ct);try {
            ObjectDisposedException.ThrowIf(disposed,this);
            if(sessions.Values.Any(session=>session.ItemId==itemId))throw new IOException("This document is already open in another editor. Close that editor before reopening it.");
            var lease=await sync.AcquireCollaborationAsync(itemId,ct);
            try {return store.WithExclusiveMutation(() => {
                // A retained intent/checkpoint may attest its own old path.
                // Never substitute another checkpoint for an unrelated missing path.
                PrepareAccount(itemId,path,expectedHash);
                var move=ReadMoveIntent(System.IO.Path.Combine(DirectoryFor(itemId),"move-intent.json"));
                var cp=Recover(itemId);
                if(move!=null&&move.SourcePath==path&&move.Checkpoint.ItemId==itemId&&cp?.Path==move.Checkpoint.Path&&expectedHash==move.Checkpoint.ProjectedHash)path=cp.Path;
                var retainedPath=cp?.Path;
                cp=FollowLocalProjection(store,itemId);
                if(cp!=null&&retainedPath!=cp.Path&&path==retainedPath&&expectedHash==cp.ProjectedHash)path=cp.Path;
                var file=store.Describe(path);if(file.ItemId!=itemId || (file.Hash!=expectedHash && file.Hash!=cp?.ProjectedHash))throw new FileChangedException();
                if(cp!=null&&file.Hash!=cp.ProjectedHash){var directory=DirectoryFor(itemId);if(!cp.Pending&&cp.RetiredReason==null){Save(System.IO.Path.Combine(directory,"archived-"+Guid.NewGuid().ToString("N")+".json"),cp);File.Delete(System.IO.Path.Combine(directory,"checkpoint.json"));cp=null;}}
                var token=Guid.NewGuid().ToString();sessions[token]=new(itemId,path,lease);return new SharedSession(token,file,cp);
            });}catch{lease.Dispose();throw;}
        }finally{gate.Release();}
    }
    void ValidateRequestedProjection(string itemId,string path,string expectedHash) {
        var ownerPath=System.IO.Path.Combine(store.StateDirectory,AccountRootOwnership.FileName);
        var ownerBytes=RetainedFileReplacement.Read(ownerPath,8192);
        RetainedFileReplacement.JsonFields(ownerBytes,["Version","Origin","WorkspaceId","AccountId","RootHash"],["Version","Origin","WorkspaceId","AccountId","RootHash"]);
        var owner=JsonSerializer.Deserialize<AccountRootOwnership.Owner>(ownerBytes)??throw new SharedAccountMismatchException();
        if(principalAccountId is null||owner.AccountId!=principalAccountId)throw new SharedAccountMismatchException();
        var scope=new ProtectedRenameScope(owner.Origin,owner.WorkspaceId,owner.AccountId);
        var proof=store.GenerationProtectionSnapshot(itemId,scope);
        var inventory=store.InspectGenerationInventory();var found=inventory.Files.Where(file=>file.ItemId==itemId).ToArray();
        if(inventory.Errors.Count!=0||found.Length!=1||found[0].Path!=path||found[0].Hash!=expectedHash)throw new FileChangedException();
        if(TextPackStore.Hash(store.ReadGenerationProjection(path,itemId,scope))!=expectedHash||store.GenerationProtectionSnapshot(itemId,scope)!=proof)throw new FileChangedException();
    }
    public async Task<PackFile> CheckpointAsync(string sessionToken,string expectedHash,byte[] textPack,SharedCheckpoint checkpoint,CancellationToken ct=default) {
        await gate.WaitAsync(ct);try {
            ObjectDisposedException.ThrowIf(disposed,this);
            if(!sessions.TryGetValue(sessionToken,out var session))throw new SharedSessionClosedException();
            string? acknowledgedDirectory=null;
            var result=store.WithExclusiveMutation(() => {
                var prior=Recover(session.ItemId);
                if(checkpoint.Path!=session.Path&&checkpoint.Path!=prior?.Path) {
                    Validate(store,checkpoint);RequireAccount(checkpoint);
                    if(checkpoint.ItemId!=session.ItemId||TextPackStore.Identity(textPack)!=session.ItemId||TextPackStore.Hash(textPack)!=checkpoint.ProjectedHash)throw new InvalidDataException("Checkpoint identity mismatch.");
                    if(prior is not null) {
                        Validate(store,prior);RequireAccount(prior);
                        if(prior.ItemId!=session.ItemId||prior.RetiredReason is not null||checkpoint.JournalGeneration<=prior.JournalGeneration)throw new InvalidOperationException("Newer or protected shared edits are retained.");
                    }
                    // This native editor request may follow an actual same-item raw
                    // move. It grants neither a server name change nor generation evidence.
                    ValidateRequestedProjection(session.ItemId,checkpoint.Path,expectedHash);
                }
                prior=FollowLocalProjection(store,session.ItemId);
                if(prior==null&&!File.Exists(store.Resolve(session.Path))) {
                    var moved=UniqueProjection(store,session.ItemId);
                    if(moved.Hash!=expectedHash)throw new FileChangedException();
                    session=session with{Path=moved.Path};sessions[sessionToken]=session;
                }
                // A sync pass may relocate the durable projection while this
                // browser request is still prepared against the old path.
                if(prior is {RetiredReason:null} && prior.Path!=session.Path) {
                    if(checkpoint.Path!=session.Path&&checkpoint.Path!=prior.Path)throw new InvalidDataException("Checkpoint identity mismatch.");
                    session=session with{Path=prior.Path};sessions[sessionToken]=session;
                }
                if(checkpoint.Path!=session.Path) {
                    var journal=System.Text.Json.Nodes.JsonNode.Parse(checkpoint.Journal)!;journal["relativePath"]=session.Path;
                    checkpoint=checkpoint with{Path=session.Path,Journal=journal.ToJsonString()};
                }
                Validate(store,checkpoint);RequireAccount(checkpoint);if(checkpoint.ItemId!=session.ItemId||TextPackStore.Identity(textPack)!=session.ItemId||TextPackStore.Hash(textPack)!=checkpoint.ProjectedHash)throw new InvalidDataException("Checkpoint identity mismatch.");
                var current=store.Describe(session.Path);
                if(prior!=null) {
                    if((prior.RetiredReason!=null&&!LiftsMirroredRetirement(prior,checkpoint))||checkpoint.JournalGeneration<prior.JournalGeneration)throw new InvalidOperationException("Newer or protected shared edits are retained.");
                    if(checkpoint.JournalGeneration==prior.JournalGeneration){
                        if(checkpoint with{Journal=prior.Journal}!=prior||!System.Text.Json.Nodes.JsonNode.DeepEquals(System.Text.Json.Nodes.JsonNode.Parse(checkpoint.Journal),System.Text.Json.Nodes.JsonNode.Parse(prior.Journal)))throw new InvalidOperationException("Conflicting checkpoint generation.");
                        // A direct file edit can land between a successful checkpoint and
                        // its idempotent retry. Treat that as a changed file so the live
                        // client can reconcile it; the journal itself is still intact.
                        if(current.Hash!=prior.ProjectedHash)throw new FileChangedException();
                        return current;
                    }
                }
                if(prior!=null&&prior.Pending&&checkpoint.Epoch!=prior.Epoch) {
                    var adoption=AuthorizedAdoption(prior,checkpoint,current);
                    if(adoption==null||current.Hash!=expectedHash)throw new InvalidOperationException("Newer or protected shared edits are retained.");
                    // The replaced epoch's journal stays recoverable on disk before anything about it is rewritten. A retry of the same operation rewrites the identical archive.
                    Save(System.IO.Path.Combine(DirectoryFor(session.ItemId),"recovery-"+adoption.OperationId+".json"),prior);
                }
                if(current.Hash!=expectedHash)throw new FileChangedException();
                var directory=DirectoryFor(session.ItemId);var intent=new Intent(1,expectedHash,Convert.ToBase64String(textPack),checkpoint);
                if(!checkpoint.Pending){Save(System.IO.Path.Combine(directory,"acknowledge.json"),checkpoint);acknowledgedDirectory=directory;}
                Save(System.IO.Path.Combine(directory,"intent.json"),intent);return Finish(intent,directory);
            });
            // Never wait for the sync gate while holding the filesystem lock.
            if(acknowledgedDirectory!=null&&await sync.TryAcknowledgeCheckpointAsync(session.ItemId,session.Path,result.Hash,checkpoint.AcknowledgedRevision,ct))
                File.Delete(System.IO.Path.Combine(acknowledgedDirectory,"acknowledge.json"));
            return result;
        }finally{gate.Release();}
    }
    public async Task RecoverAsync(string sessionToken,string recoveryPath,string recoveryHash,CancellationToken ct=default) {
        await gate.WaitAsync(ct);try {
            ObjectDisposedException.ThrowIf(disposed,this);
            if(!sessions.TryGetValue(sessionToken,out var session))throw new InvalidOperationException("This editing session is no longer active.");
            store.WithExclusiveMutation(()=>{
            var recovery=store.Describe(recoveryPath);if(recovery.Hash!=recoveryHash||recovery.ItemId==session.ItemId||recoveryPath==session.Path)throw new InvalidDataException("Save a distinct recovery document first.");
            var directory=DirectoryFor(session.ItemId);var archive=System.IO.Path.Combine(directory,"archive-"+Guid.NewGuid().ToString("N"));System.IO.Directory.CreateDirectory(archive);
            // Remove replayable intents before the checkpoint. An interruption
            // must not leave a move able to revive an already released journal.
            var retainedFiles=new[]{"move-intent.json","intent.json","acknowledge.json","checkpoint.json"};
            foreach(var name in retainedFiles){var source=System.IO.Path.Combine(directory,name);if(File.Exists(source))TextPackStore.AtomicWrite(System.IO.Path.Combine(archive,name),File.ReadAllBytes(source));}
            Save(System.IO.Path.Combine(archive,"recovered.json"),new{Version=1,recovery.ItemId,recovery.Path,recovery.Hash});
            // Recheck the explicitly saved copy before releasing protected state.
            if(store.Describe(recoveryPath).Hash!=recoveryHash)throw new FileChangedException();
            foreach(var name in retainedFiles)File.Delete(System.IO.Path.Combine(directory,name));
            return true;
            });
            CloseInternal(sessionToken);
        }finally{gate.Release();}
    }
    void CloseInternal(string token){if(sessions.Remove(token,out var active))active.Lease.Dispose();}
    public void Close(string sessionToken){gate.Wait();try{CloseInternal(sessionToken);}finally{gate.Release();}}
    public void Dispose(){gate.Wait();try{disposed=true;foreach(var token in sessions.Keys.ToArray())CloseInternal(token);}finally{gate.Release();}}
}
