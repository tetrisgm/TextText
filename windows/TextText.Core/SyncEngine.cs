using System.Text.Json;
using System.IO.Compression;
namespace TextText.Core;
public sealed record RemoteItem(string ItemId,string RelativePath,string Revision,bool Deleted=false,string? Lifecycle=null,string? RestoreFromRevision=null,bool? CanEditContent=null);
public sealed record RemotePack(byte[] Data,string RelativePath,string Revision);
public sealed record RemoteBinaryEntry(string Path,string Sha256,int Size);
public sealed record RemoteBinaryManifest(string Revision,RemoteBinaryEntry[] Entries);
public interface ISyncTransport
{
    ProtectedRenameScope? ProtectedRenameBinding => null;
    Task<ProtectedRenameReceipt> ProtectedRenameAsync(ProtectedRenameRequest request,CancellationToken cancellation=default)=>throw new NotSupportedException("Protected file move receipts are unavailable.");
    IReadOnlyList<string> Folders => [];
    IReadOnlyList<string>? AuthoritativeFolders => null;
    WorkspaceCapabilities? Capabilities => null;
    string? ManifestRevision => null;
    bool SupportsFolderCaseMoves => false;
    Task<FolderCaseRecoveryReply> RecoverFolderCaseAsync(FolderCaseMoveRequest command,bool cancel,string? inspection,CancellationToken cancellation=default)=>throw new NotSupportedException();
    Task<FolderCaseMoveReceipt> MoveFolderCaseAsync(FolderCaseMoveRequest request,CancellationToken cancellation=default)=>throw new NotSupportedException();
    Task<IReadOnlyList<RemoteItem>> ManifestAsync(CancellationToken cancellation=default);
    Task<RemotePack> DownloadAsync(string itemId,CancellationToken cancellation=default);
    Task<string> UploadAsync(string itemId,string path,byte[] data,string? baseRevision,string operationId,CancellationToken cancellation=default);
    Task<string> RenameAsync(string itemId,string from,string to,string baseRevision,string operationId,CancellationToken cancellation=default);
    Task DeleteAsync(string itemId,string path,string baseRevision,string operationId,CancellationToken cancellation=default);
    Task<RemoteBinaryManifest> BinaryManifestAsync(string itemId,CancellationToken cancellation=default) => throw new NotSupportedException();
    Task<byte[]> BinaryReadAsync(string itemId,string entryPath,CancellationToken cancellation=default) => throw new NotSupportedException();
    Task<string> BinaryPatchAsync(string itemId,string operationId,string entryPath,string? expectedHash,string? expectedLifecycle,byte[]? bytes,CancellationToken cancellation=default) => throw new NotSupportedException();
}
public sealed class SyncConflictException() : IOException("The remote file changed; both copies are preserved.");
public sealed record SyncStatus(bool Running,string? Error,int Pending);
public sealed partial class SyncEngine
{
    public sealed record Baseline(string Path,string Hash,string Revision,bool Refresh=false,string? Lifecycle=null);
    public sealed record Operation(string Id,string Kind,string ItemId,string Path,string? Destination,string? Revision,string Hash,string? Payload,bool Conflicted=false,string? Lifecycle=null);
    public sealed record Incoming(string ItemId,string Path,string? OldPath,string? ExpectedHash,string Revision,string Payload,string? Lifecycle=null);
    public sealed record BinaryPending(string Id,string ItemId,string EntryPath,string? ExpectedHash,string? Lifecycle,string? BytesBase64,string SourceHash,bool Conflicted=false,string? PayloadHash=null,string? SourcePath=null);
    public sealed class State { public string? AccountId {get;set;} [System.Text.Json.Serialization.JsonExtensionData] public Dictionary<string,JsonElement>? AdditionalData {get;set;} public WorkspaceCapabilities? Capabilities {get;set;} public List<string>? ManagedFolders {get;set;} public FolderSyncBaseline? FolderBaseline {get;set;} public FolderSyncCommand? FolderCommand {get;set;} public Incoming? PendingPull {get;set;} public int Version {get;set;}=1; public Dictionary<string,Baseline> Items {get;set;}=[]; public List<Operation> Outbox {get;set;}=[]; public Dictionary<string,Operation> SharedRenames {get;set;}=[]; [System.Text.Json.Serialization.JsonConverter(typeof(ProtectedSavedRename.MapConverter))] public Dictionary<string,ProtectedSavedRename.Record> ProtectedRenames {get;set;}=[]; public Dictionary<string,Dictionary<string,string>> BinaryBaselines {get;set;}=[]; public Dictionary<string,string> BinaryRevisions {get;set;}=[]; public List<BinaryPending> BinaryOutbox {get;set;}=[]; }
    readonly HashSet<string> collaborating=[];
    readonly WorkspaceWriterOwnership workspaceOwnership;
    readonly MirrorPolicy? mirrorPolicy;
    readonly TextPackStore store; readonly ISyncTransport transport; readonly SemaphoreSlim gate=new(1,1); readonly string statePath; readonly string? accountId;
    public bool HasEligiblePending {get;private set;}
    int remainingQueueBudget;
    readonly HashSet<string> deferredQueuedUploadPaths=new(StringComparer.Ordinal);
    public SyncStatus Status {get;private set;}=new(false,null,0);
    public event Action<SyncStatus>? StatusChanged;
    public event Action? DurabilityChanged;
    public event Action? CapabilitiesChanged;
    public SyncEngine(TextPackStore store,ISyncTransport transport,string? accountId=null,MirrorPolicy? mirrorPolicy=null) {
        if(accountId is not null && !System.Text.RegularExpressions.Regex.IsMatch(accountId,@"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\z"))throw new InvalidDataException("Invalid account identity.");
        this.store=store;this.transport=transport;this.accountId=accountId;this.mirrorPolicy=mirrorPolicy;statePath=Path.Combine(store.StateDirectory,"sync.json");
        workspaceOwnership=new(store.StateDirectory);
        // Fail before a worker or transport can replay someone else's outbox.
        if(accountId is not null)_=Load();
    }
    public async Task<IDisposable> AcquireCollaborationAsync(string itemId,CancellationToken ct=default) {
        // Keep adoption excluded for the entire editing lease, including writes
        // after the sync semaphore is released and acknowledgements during close.
        var adoptionFence=new FileStream(Path.Combine(store.StateDirectory,"account-adoption.lock"),FileMode.OpenOrCreate,FileAccess.ReadWrite,FileShare.ReadWrite);
        DocumentLease? documentLease=null;
        IDisposable? workspaceLease=null;
        var retained=false;
        try {
        documentLease=new DocumentLease(store.StateDirectory,itemId);
        await gate.WaitAsync(ct);try {workspaceLease=workspaceOwnership.Acquire();var state=Load();if(FolderSpellingChanged(state))throw new IOException("A folder move must finish before joining shared editing.");if(state.Outbox.Any(x=>x.ItemId==itemId)||state.PendingPull?.ItemId==itemId)throw new IOException("Pending file sync must finish before joining shared editing.");
            if(!state.BinaryBaselines.ContainsKey(itemId) && state.Items.TryGetValue(itemId,out var baseline)) {
                try {
                    var file=store.Describe(baseline.Path);
                    if(file.ItemId==itemId && file.Hash==baseline.Hash) {
                        state.BinaryBaselines[itemId]=BinaryEntryPacks.Assets(store.Read(file.Path)).ToDictionary(x=>x.Key,x=>x.Value.Sha256);
                        state.BinaryRevisions[itemId]=baseline.Revision;
                        Save(state);
                    }
                } catch(IOException) { /* An evicted or invalid file is handled by the existing open path. */ }
                  catch(UnauthorizedAccessException) { /* Keep the previous state; do not infer deletion. */ }
            }
            lock(collaborating)if(!collaborating.Add(itemId))throw new InvalidOperationException("An editor already owns this document.");retained=true;return new Fence(this,itemId,adoptionFence,documentLease,workspaceLease);
        }finally{gate.Release();}
        }finally{if(!retained){workspaceLease?.Dispose();documentLease?.Dispose();adoptionFence.Dispose();}}
    }
    sealed class Fence(SyncEngine owner,string id,IDisposable adoptionFence,IDisposable documentLease,IDisposable workspaceLease):IDisposable {bool disposed;public void Dispose(){lock(owner.collaborating){if(!disposed){owner.collaborating.Remove(id);documentLease.Dispose();workspaceLease.Dispose();adoptionFence.Dispose();disposed=true;}}}}
    bool IsEditing(string id){lock(collaborating)return collaborating.Contains(id)||SharedEditingStore.HasProtectedState(store.StateDirectory,id);}
    public async Task AcknowledgeCheckpointAsync(string itemId,string path,string hash,string revision,CancellationToken ct=default) {
        await gate.WaitAsync(ct);try { AcknowledgeCheckpointState(itemId,path,hash,revision); }
        finally{gate.Release();}
    }
    // A local checkpoint is already durable before this is called. If a remote
    // sync pass owns the gate, its acknowledge.json is replayed by SyncAsync;
    // the editor must not wait for a network request just to finish a save.
    public async Task<bool> TryAcknowledgeCheckpointAsync(string itemId,string path,string hash,string revision,CancellationToken ct=default) {
        if(!await gate.WaitAsync(0,ct))return false;
        try { AcknowledgeCheckpointState(itemId,path,hash,revision);return true; }
        finally{gate.Release();}
    }
    void AcknowledgeCheckpointState(string itemId,string path,string hash,string revision) {
            if(!collaborating.Contains(itemId))throw new InvalidOperationException("An active collaboration fence is required.");
            store.AssertReplacementReadable(itemId);
            var state=Load();
            if(FolderSpellingChanged(state))throw new IOException("A folder spelling move must receive its server receipt before checkpoint acknowledgement.");
            var candidates=new[]{state.Items.GetValueOrDefault(itemId)?.Path,path}.Where(value=>value!=null).Distinct().ToArray();
            PackFile? current=null;
            foreach(var candidate in candidates) {
                if(!File.Exists(store.Resolve(candidate!)))continue;
                var observed=store.Describe(candidate!);
                if(observed.ItemId==itemId&&observed.Hash==hash){current=observed;break;}
            }
            if(current==null)throw new FileChangedException();path=current.Path;
            if(state.Outbox.Any(x=>x.ItemId==itemId)||state.PendingPull?.ItemId==itemId)throw new IOException("Pending file changes must synchronize before joining collaboration.");
            var prior=state.Items.GetValueOrDefault(itemId);
            // A content acknowledgement does not attest a remote path change.
            var baselinePath=prior?.Path??path;
            state.Items[itemId]=new(baselinePath,hash,revision,Lifecycle:prior?.Lifecycle);Save(state);
    }
    public async Task ReconcileRestoredAsync(string itemId,string path,string lifecycle,CancellationToken ct=default) {
        await SyncAsync(ct);await gate.WaitAsync(ct);try {
            var state=Load();if(FolderSpellingChanged(state))throw new IOException("A folder move must finish before restoring a path baseline.");var baseline=state.Items.GetValueOrDefault(itemId);
            if(baseline==null||baseline.Path!=path||baseline.Lifecycle!=lifecycle||state.Outbox.Any(x=>x.ItemId==itemId)||IsEditing(itemId))throw new FileChangedException();
            var file=store.Describe(path);if(file.ItemId!=itemId||file.Hash!=baseline.Hash)throw new FileChangedException();
        }finally{gate.Release();}
    }
    public async Task<bool> IsReadyAsync(string itemId,CancellationToken ct=default) {
        await gate.WaitAsync(ct);try {var state=Load();if(FolderSpellingChanged(state))return false;if(state.Outbox.Any(x=>x.ItemId==itemId)||state.PendingPull?.ItemId==itemId)return false;if(SharedEditingStore.HasReadyCheckpoint(store,itemId))return true;if(SharedEditingStore.HasProtectedState(store.StateDirectory,itemId)||SavedRenameOwnsPath(state,itemId))return false;
            if(!state.Items.TryGetValue(itemId,out var baseline))return false;try{var file=store.Describe(baseline.Path);return file.ItemId==itemId&&file.Hash==baseline.Hash&&!baseline.Refresh;}catch(IOException){return false;}
        }finally{gate.Release();}
    }
    public async Task<string?> BaselineRevisionAsync(string itemId,CancellationToken ct=default) {await gate.WaitAsync(ct);try{return Load().Items.GetValueOrDefault(itemId)?.Revision;}finally{gate.Release();}}
    static bool Blocked(State state,string id)=>state.Outbox.Any(x=>x.ItemId==id);
    static bool SavedRenameOwnsPath(State state,string id)=>state.SharedRenames.ContainsKey(id)||state.ProtectedRenames.ContainsKey(id);
    State ReadState() {
        var bytes=RetainedFileReplacement.Read(statePath,90*1024*1024);
        ProtectedSavedRename.ValidateStateBytes(bytes);
        return JsonSerializer.Deserialize<State>(bytes)??throw new InvalidDataException("Invalid sync state.");
    }
    ProtectedSavedRename.Context? SavedRenameContext(bool requireFloor=false) {
        if(accountId is null)return null;
        var path=Path.Combine(store.StateDirectory,AccountRootOwnership.FileName);
        if(!File.Exists(path))return null;
        var owner=JsonSerializer.Deserialize<AccountRootOwnership.Owner>(RetainedFileReplacement.Read(path,4096))??throw new InvalidDataException("Invalid account ownership.");
        var expected=AccountRootOwnership.Expected(store,new Uri(owner.Origin),owner.WorkspaceId,accountId);
        AccountRootOwnership.Verify(path,expected);
        if(requireFloor) {
            var marker=JsonSerializer.Deserialize<RetainedReplacementProfile.Marker>(RetainedFileReplacement.Read(Path.Combine(store.StateDirectory,"retained-replacement-profile","profile.json"),8192))??throw new InvalidDataException("Invalid saved file move profile.");
            if(marker.Version!=5)throw new InvalidDataException("Saved file moves require their supported account profile.");
        }
        return new(expected.RootHash,new(expected.Origin,expected.WorkspaceId,expected.AccountId));
    }
    State Load() { store.ValidateReplacementRegistry(); AccountRootOwnership.RequireNoAdoption(store.StateDirectory); if(!File.Exists(statePath)) return new(){AccountId=accountId}; var result=ReadState(); if(result.Version!=1) throw new InvalidDataException("This workspace was used by a newer app. Update TextText."); if(result.AccountId!=accountId)throw new SharedAccountMismatchException();
        if(result.SharedRenames is null||result.ProtectedRenames is null||result.SharedRenames.Count+result.ProtectedRenames.Count>1000)throw new InvalidDataException("Too many saved file moves.");
        if(result.ProtectedRenames.Count>0) {
            var context=SavedRenameContext(requireFloor:true)??throw new LegacyAccountStateException();
            ProtectedSavedRename.ValidateMap(result.ProtectedRenames,context.RootHash,context.Scope);
            if(result.ProtectedRenames.Keys.Any(result.SharedRenames.ContainsKey))throw new InvalidDataException("A saved file move has two owners.");
        }
        foreach(var pair in result.SharedRenames) {
            var op=pair.Value;
            if(op is null||op.ItemId!=pair.Key||op.Kind!="rename"||op.Payload!=null||!Guid.TryParse(op.Id,out _)||op.Destination is null||op.Revision is null||
               !System.Text.RegularExpressions.Regex.IsMatch(op.Hash,@"^[0-9a-f]{64}$")||!System.Text.RegularExpressions.Regex.IsMatch(op.Revision,@"^[0-9a-f]{64}$"))throw new InvalidDataException("Invalid saved file move.");
            _=store.Resolve(op.Path);_=store.Resolve(op.Destination);
        }
        ValidateFolderState(result);
        return result; }
    void Save(State state) {
        if(state.AccountId!=accountId)throw new SharedAccountMismatchException();
        if(state.SharedRenames.Count+state.ProtectedRenames.Count>1000)throw new InvalidDataException("Too many saved file moves.");
        if(state.ProtectedRenames.Count>0) {
            var context=SavedRenameContext(requireFloor:true)??throw new LegacyAccountStateException();
            ProtectedSavedRename.ValidateMap(state.ProtectedRenames,context.RootHash,context.Scope);
            if(state.ProtectedRenames.Keys.Any(state.SharedRenames.ContainsKey))throw new InvalidDataException("A saved file move has two owners.");
        }
        // A late replacement conflict may arise while an RPC is in flight.
        // Unrelated items may advance, but every fenced item's durable work must
        // remain byte-for-byte equivalent to the previously saved substate.
        var blocked=store.ReplacementBlockedItems();
        if(blocked.Count>0) {
            var before=File.Exists(statePath)?ReadState():new State{AccountId=accountId};
            string Snapshot(State value,string id)=>JsonSerializer.Serialize(new {
                Item=value.Items.GetValueOrDefault(id),Outbox=value.Outbox.Where(op=>op.ItemId==id).ToArray(),
                Rename=value.SharedRenames.GetValueOrDefault(id),ProtectedRename=value.ProtectedRenames.TryGetValue(id,out var protectedRename)?Convert.ToBase64String(ProtectedSavedRename.ArchiveBytes(protectedRename)):null,Binary=value.BinaryOutbox.Where(op=>op.ItemId==id).ToArray(),
                Assets=value.BinaryBaselines.GetValueOrDefault(id),BinaryRevision=value.BinaryRevisions.GetValueOrDefault(id),
                Pull=value.PendingPull?.ItemId==id?value.PendingPull:null
            });
            foreach(var pair in blocked)if(Snapshot(before,pair.Key)!=Snapshot(state,pair.Key))throw new RetainedFileReplacement.RequiredException(pair.Value);
        }
        var bytes=JsonSerializer.SerializeToUtf8Bytes(state);
        if(File.Exists(statePath)&&File.ReadAllBytes(statePath).AsSpan().SequenceEqual(bytes))return;
        TextPackStore.AtomicWrite(statePath,bytes);DurabilityChanged?.Invoke();
    }
    async Task<MirrorSharedPathDecision> ProtectedPathDecision(State state,string id,Baseline baseline,PackFile? projection,RemoteItem? remote,CancellationToken ct) {
        if(mirrorPolicy is null)throw new MirrorPolicyUnavailableException("Protected path policy unavailable.");
        var ready=SharedEditingStore.HasReadyCheckpoint(store,id);var checkpoint=ready?SharedEditingStore.FollowLocalProjection(store,id):null;var editing=IsEditing(id);
        var announcement=state.SharedRenames.GetValueOrDefault(id);var protectedAnnouncement=state.ProtectedRenames.GetValueOrDefault(id);var pending=state.Outbox.ToArray();var pull=state.PendingPull;
        var capabilities=JsonSerializer.Serialize(state.Capabilities);var transportCapabilities=JsonSerializer.Serialize(transport.Capabilities);
        var matches=store.Scan().Where(file=>file.ItemId==id).ToArray();
        var permitted=state.Capabilities is not {} caps || caps.FullAccess&&caps.CanCreateContent&&caps.CanWrite(id,baseline.Path,true)&&projection is not null&&caps.CanCreate(projection.Path);
        void Current() {
            ct.ThrowIfCancellationRequested();var current=Load();
            var files=store.Scan().Where(file=>file.ItemId==id).ToArray();
            if(current.Items.GetValueOrDefault(id)!=baseline||current.SharedRenames.GetValueOrDefault(id)!=announcement||current.ProtectedRenames.GetValueOrDefault(id)!=protectedAnnouncement||!current.Outbox.SequenceEqual(pending)||current.PendingPull!=pull||
               JsonSerializer.Serialize(current.Capabilities)!=capabilities||JsonSerializer.Serialize(transport.Capabilities)!=transportCapabilities||IsEditing(id)!=editing||
               SharedEditingStore.HasReadyCheckpoint(store,id)!=ready||(ready&&SharedEditingStore.FollowLocalProjection(store,id)!=checkpoint)||files.Length!=matches.Length||
               files.Length==1&&(projection is null||files[0].Path!=projection.Path||files[0].Hash!=projection.Hash))throw new FileChangedException();
            store.AssertReplacementReadable(id);
        }
        var observation=new MirrorSharedPathObservation(editing||announcement is not null,baseline.Path,projection?.Path,remote?.RelativePath,checkpoint?.Path,
            ready,checkpoint?.RetiredReason is not null,matches.Length==1,remote?.Deleted??false,
            baseline.Lifecycle,remote?.Lifecycle,Blocked(state,id)||pull?.ItemId==id||store.ReplacementBlocked(id),permitted,
            announcement is null?"none":announcement.Conflicted?"review":"replay");
        var decision=await mirrorPolicy.SharedPathAsync(observation,ct);Current();
        if(decision.Action is not ("hold" or "unchanged")) {
            var fresh=(await transport.ManifestAsync(ct)).Where(item=>item.ItemId==id).ToArray();Current();
            if(fresh.Length!=1||fresh[0]!=remote)throw new FileChangedException();
        }
        return decision;
    }
    async Task<MirrorTombstoneDecision> TombstoneDecision(State state,string id,Baseline baseline,PackFile? projection,RemoteItem remote,CancellationToken ct) {
        if(mirrorPolicy is null)throw new MirrorPolicyUnavailableException("Tombstone policy unavailable.");
        var capturedState=JsonSerializer.Serialize(state);var intent=store.Intent(id);var editing=IsEditing(id);
        var protection=SharedEditingStore.ReadProtectionSnapshot(store,id,accountId);
        var matches=store.Scan().Where(file=>file.ItemId==id).ToArray();
        var transportCapabilities=JsonSerializer.Serialize(transport.Capabilities);
        void Current() {
            ct.ThrowIfCancellationRequested();var current=Load();
            var files=store.Scan().Where(file=>file.ItemId==id).ToArray();
            if(JsonSerializer.Serialize(current)!=capturedState||store.Intent(id)!=intent||IsEditing(id)!=editing||
               JsonSerializer.Serialize(transport.Capabilities)!=transportCapabilities||SharedEditingStore.ReadProtectionSnapshot(store,id,accountId)!=protection||files.Length!=matches.Length||
               files.Length==1&&(projection is null||files[0].Path!=projection.Path||files[0].Hash!=projection.Hash))throw new FileChangedException();
            store.AssertReplacementReadable(id);
        }
        var observed=new MirrorTombstoneObservation(true,remote.Deleted,true,editing||protection.Protected,intent is not null||SavedRenameOwnsPath(state,id)||Blocked(state,id)||state.Outbox.Any(op=>op.ItemId==id)||state.BinaryOutbox.Any(op=>op.ItemId==id)||state.PendingPull?.ItemId==id,
            projection is not null,matches.Length==1,projection?.ItemId==id,projection?.Hash,baseline.Hash,projection?.Path,baseline.Path,remote.RelativePath,
            baseline.Revision,remote.Revision,baseline.Lifecycle,remote.Lifecycle);
        var decision=await mirrorPolicy.TombstoneAsync(observed,ct);Current();
        if(decision.Action is "remove-local" or "retain-conflict") {
            var fresh=(await transport.ManifestAsync(ct)).Where(item=>item.ItemId==id).ToArray();Current();
            if(fresh.Length!=1||fresh[0]!=remote)throw new FileChangedException();
        }
        return decision;
    }
    bool SavedRenamePermitted(State state,string id,string source,string destination) {
        var caps=transport.Capabilities??state.Capabilities;
        return caps is not null&&caps.FullAccess&&caps.CanCreateContent&&caps.CanWrite(id,source,true)&&caps.CanCreate(destination);
    }
    void SaveProtectedRenameMap(State state,Dictionary<string,ProtectedSavedRename.Record> next,string? removeLegacy=null) {
        var prior=state.ProtectedRenames;var legacy=state.SharedRenames;
        state.ProtectedRenames=next;
        if(removeLegacy is not null){state.SharedRenames=new(legacy,StringComparer.Ordinal);state.SharedRenames.Remove(removeLegacy);}
        try{Save(state);}catch{state.ProtectedRenames=prior;state.SharedRenames=legacy;throw;}
    }
    ProtectedSavedRename.ArchiveProof ArchiveSavedRename(ProtectedSavedRename.Record record) {
        var bytes=ProtectedSavedRename.ArchiveBytes(record);
        var path=Path.Combine(store.GetRecoveryDirectory(),"saved-rename-"+record.Request.OperationId+".json");
        RetainedFileReplacement.CheckPath(path);
        if(File.Exists(path)) {
            if(!RetainedFileReplacement.Read(path,32768).SequenceEqual(bytes))throw new InvalidDataException("The preserved file move receipt changed. Review saved work.");
        } else RetainedFileReplacement.Create(path,bytes);
        return new(record.Request.OperationId,record.RootHash,record.Scope,TextPackStore.Hash(bytes),true);
    }
    sealed record SavedProtection(string Fingerprint,bool Available);
    SavedProtection ReadSavedProtection(string itemId) {
        var directory=Path.Combine(store.StateDirectory,"shared-editing",itemId);
        RetainedFileReplacement.CheckPath(directory);
        var path=Path.Combine(directory,"checkpoint.json");
        // A known outer checkpoint with missing journal fields is unavailable,
        // not permission to recover it. All other retained records still use
        // their strict validator, including account and filesystem failures.
        if(File.Exists(path)&&!new[]{"intent.json","move-intent.json","binary-intent.json","acknowledge.json"}.Any(name=>File.Exists(Path.Combine(directory,name)))) {
            var raw=RetainedFileReplacement.Read(path,90*1024*1024);
            RetainedFileReplacement.JsonFields(raw,["Version","ItemId","Path","ProjectedHash","AcknowledgedRevision","Epoch","Seq","JournalGeneration","Journal","Pending","RetiredReason"],["ItemId","Path","ProjectedHash","AcknowledgedRevision","Epoch","Seq","JournalGeneration","Journal","Pending"]);
            var checkpoint=JsonSerializer.Deserialize<SharedCheckpoint>(raw)??throw new InvalidDataException("Invalid checkpoint.");
            if(checkpoint.ItemId!=itemId)throw new SharedAccountMismatchException();
            _=store.Resolve(checkpoint.Path);
            using var journal=JsonDocument.Parse(checkpoint.Journal);
            if(journal.RootElement.ValueKind!=JsonValueKind.Object)throw new InvalidDataException("Invalid checkpoint journal.");
            var savedAccount=journal.RootElement.TryGetProperty("accountId",out var account)&&account.ValueKind!=JsonValueKind.Null?account.GetString():null;
            if(savedAccount!=accountId)throw new SharedAccountMismatchException();
            try{SharedEditingStore.Validate(store,checkpoint);}
            catch(KeyNotFoundException){return new(TextPackStore.Hash(raw),false);}
        }
        return new(SharedEditingStore.ReadProtectionSnapshot(store,itemId,accountId).Fingerprint,true);
    }
    // Returns true when a saved move owns this item's path disposition. The
    // packaged policy is the only admission owner; these checks attest its facts.
    async Task<bool> ReconcileSavedRename(State state,string id,Baseline? baseline,RemoteItem? remote,CancellationToken ct,Action? authorityCheck=null) {
        authorityCheck?.Invoke();
        if(mirrorPolicy is null)throw new MirrorPolicyUnavailableException("Saved file move policy unavailable.");
        var context=SavedRenameContext();
        if(state.SharedRenames.TryGetValue(id,out var old)&&!old.Conflicted&&old.Lifecycle is not null&&baseline?.Lifecycle==old.Lifecycle&&context is not null&&transport.ProtectedRenameBinding==context.Scope&&
           SavedRenamePermitted(state,id,old.Path,old.Destination??old.Path)) {
            RetainedReplacementProfile.PrepareSharedRename(store);
            if(SavedRenameContext(requireFloor:true)!=context)throw new SharedAccountMismatchException();
            var normalized=ProtectedSavedRename.NormalizeLegacy(old,baseline,context.RootHash,context.Scope,floor5Verified:true);
            if(normalized.Record is {} record) {
                var next=ProtectedSavedRename.Replace(context,state.ProtectedRenames,id,null,record);
                SaveProtectedRenameMap(state,next,id);
            }
        }
        var saved=state.ProtectedRenames.GetValueOrDefault(id);var legacy=state.SharedRenames.GetValueOrDefault(id);
        var owned=saved is not null||legacy is not null;
        var initialProtection=ReadSavedProtection(id);
        var ready=initialProtection.Available&&SharedEditingStore.HasReadyCheckpoint(store,id);
        var checkpoint=ready?SharedEditingStore.FollowLocalProjection(store,id):null;
        var protection=ReadSavedProtection(id);
        var editing=IsEditing(id);var intent=store.Intent(id);
        var files=store.Scan().Where(file=>file.ItemId==id).ToArray();var unique=files.Length==1&&store.LastScanErrors.Count==0;
        var projection=unique?files[0]:null;
        var stateBytes=JsonSerializer.Serialize(state);var binding=transport.ProtectedRenameBinding;
        var caps=JsonSerializer.Serialize(transport.Capabilities);
        var permitted=remote is not null&&projection is not null&&SavedRenamePermitted(state,id,remote.RelativePath,projection.Path);
        var phase=saved?.Phase switch{ProtectedSavedRename.Phase.Pending=>"pending",ProtectedSavedRename.Phase.TerminalRejected=>"terminal-rejected",ProtectedSavedRename.Phase.Stopped=>"stopped",_=>legacy is null?"none":"pending"};
        var resolution=saved?.Resolution;
        var blocked=!protection.Available||Blocked(state,id)||state.PendingPull?.ItemId==id||state.FolderCommand?.Request.Items.Any(item=>item.ItemId==id)==true||store.ReplacementBlocked(id)||legacy?.Conflicted==true||
            intent is not null&&(intent.Kind!="rename"||intent.Destination!=projection?.Path);
        var observation=new MirrorSavedRenameObservation(phase,saved?.Request.Source??legacy?.Path,saved?.Request.Destination??legacy?.Destination,saved?.Lifecycle??legacy?.Lifecycle,
            resolution?.LocalPath,resolution?.RemotePath,resolution?.LocalLifecycle,resolution?.RemoteLifecycle,projection?.Path,remote?.RelativePath,baseline?.Path,checkpoint?.Path,
            baseline?.Lifecycle,remote?.Lifecycle,remote?.Deleted??false,unique,ready,checkpoint?.RetiredReason is not null,
            context is not null&&binding==context.Scope,permitted,blocked,saved?.Receipt is not null,remote is not null);
        void Current(bool requireProjection=true) {
            ct.ThrowIfCancellationRequested();authorityCheck?.Invoke();var current=Load();
            if(JsonSerializer.Serialize(current)!=stateBytes||SavedRenameContext(saved is not null)!=context||transport.ProtectedRenameBinding!=binding||
               JsonSerializer.Serialize(transport.Capabilities)!=caps||store.Intent(id)!=intent||IsEditing(id)!=editing)throw new FileChangedException();
            if(requireProjection) {
                var fresh=store.Scan().Where(file=>file.ItemId==id).ToArray();
                if(fresh.Length!=files.Length||store.LastScanErrors.Count!=0||fresh.Length==1&&(projection is null||fresh[0].Path!=projection.Path||fresh[0].Hash!=projection.Hash)||
                   ReadSavedProtection(id)!=protection)throw new FileChangedException();
            }
            store.AssertReplacementReadable(id);
        }
        var decision=await mirrorPolicy.SavedRenameAsync(observation,ct);Current();
        if(decision.Action is not("stage-new" or "replay-saved"))return owned||blocked;
        var latest=(await transport.ManifestAsync(ct)).Where(item=>item.ItemId==id).ToArray();Current();
        if(latest.Length!=1||latest[0]!=remote||context is null||binding!=context.Scope||projection is null||checkpoint is null)throw new FileChangedException();
        if(decision.Action=="stage-new") {
            RetainedReplacementProfile.PrepareSharedRename(store);Current();
            var request=new ProtectedRenameRequest(Guid.NewGuid().ToString("D"),id,remote!.RelativePath,projection.Path,remote.Revision);
            var staged=ProtectedSavedRename.Pending(context.RootHash,request,context.Scope,baseline!.Hash,baseline.Lifecycle!);
            var freshFacts=new ProtectedSavedRename.Observation(context.RootHash,context.Scope,projection.Path,remote.RelativePath,baseline!.Lifecycle,remote.Lifecycle,remote.Revision,checkpoint.Path,ready,unique,permitted);
            var archive=saved is null?null:ArchiveSavedRename(saved);Current();
            var next=ProtectedSavedRename.Replace(context,state.ProtectedRenames,id,saved,staged,archive:archive,observed:freshFacts);
            SaveProtectedRenameMap(state,next);saved=staged;
        }
        if(saved is null||saved.Phase!=ProtectedSavedRename.Phase.Pending||transport.ProtectedRenameBinding!=context.Scope)throw new FileChangedException();
        // The request object is never rewritten after a transport failure. A
        // generic HTTP409/412 does not produce a terminal state transition.
        var beforeSend=JsonSerializer.Serialize(state);
        authorityCheck?.Invoke();
        var receipt=await transport.ProtectedRenameAsync(saved.Request,ct);
        ct.ThrowIfCancellationRequested();authorityCheck?.Invoke();
        var returned=Load();
        if(JsonSerializer.Serialize(returned)!=beforeSend||SavedRenameContext(requireFloor:true)!=context||transport.ProtectedRenameBinding!=context.Scope||
           receipt.Request!=saved.Request||receipt.Scope!=context.Scope||store.Intent(id)!=intent||
           !SavedRenamePermitted(state,id,saved.Request.Source,saved.Request.Destination))throw new FileChangedException();
        store.AssertReplacementReadable(id);
        var outcome=ProtectedSavedRename.Consume(saved,receipt);
        if(outcome.Rejected is {} rejected) {
            var next=ProtectedSavedRename.Replace(context,state.ProtectedRenames,id,saved,rejected);
            SaveProtectedRenameMap(state,next);return true;
        }
        var server=(await transport.ManifestAsync(ct)).Where(item=>item.ItemId==id).ToArray();
        ct.ThrowIfCancellationRequested();authorityCheck?.Invoke();
        var currentState=Load();
        if(JsonSerializer.Serialize(currentState)!=beforeSend||SavedRenameContext(requireFloor:true)!=context||transport.ProtectedRenameBinding!=context.Scope||
           server.Length!=1||server[0].Deleted||server[0].Lifecycle!=saved.Lifecycle||
           !SharedEditingStore.HasReadyCheckpoint(store,id)||store.Intent(id)!=intent||
           !SavedRenamePermitted(state,id,saved.Request.Source,saved.Request.Destination))return true;
        store.AssertReplacementReadable(id);
        var completed=ProtectedSavedRename.Replace(context,state.ProtectedRenames,id,saved,null,completion:receipt);
        var prior=state.Items[id];state.Items[id]=prior with{Path=saved.Request.Destination};
        try{SaveProtectedRenameMap(state,completed);}catch{state.Items[id]=prior;throw;}
        if(intent is not null&&intent.Kind=="rename"&&intent.Destination==saved.Request.Destination&&store.Intent(id)==intent)store.ClearIntent(id,intent);
        return true;
    }
    string BinaryPayloadPath(string operationId) {
        if(!Guid.TryParse(operationId,out _))throw new InvalidDataException("Invalid binary operation.");
        return Path.Combine(store.StateDirectory,"binary-outbox",operationId+".asset");
    }
    byte[]? BinaryPayload(BinaryPending pending) {
        if(pending.PayloadHash is null) {
            if(pending.BytesBase64 is null)return null;
            if(pending.BytesBase64.Length>((16*1024*1024+2)/3)*4)throw new InvalidDataException("Binary payload exceeds bounds.");
            var legacy=Convert.FromBase64String(pending.BytesBase64);
            if(legacy.Length>16*1024*1024)throw new InvalidDataException("Binary payload exceeds bounds.");
            return legacy;
        }
        var path=BinaryPayloadPath(pending.Id);
        using var input=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.Read);
        if(input.Length>16*1024*1024)throw new InvalidDataException("Binary payload exceeds bounds.");
        var bytes=new byte[checked((int)input.Length)];input.ReadExactly(bytes);
        if(input.ReadByte()!=-1)throw new InvalidDataException("Binary payload changed during recovery.");
        if(TextPackStore.Hash(bytes)!=pending.PayloadHash)throw new InvalidDataException("Binary payload changed during recovery.");
        return bytes;
    }
    void PreserveBinaryPayload(BinaryPending pending) {
        if(BinaryPayload(pending) is {} bytes)store.PreserveSubmittedAsset(bytes,pending);
    }
    void Report(bool running,string? error,int pending) { Status=new(running,error,pending);StatusChanged?.Invoke(Status); }
    public async Task SyncAsync(CancellationToken cancellation=default,bool localChangesOnly=false)
    {
        if(!await gate.WaitAsync(0,cancellation)) return;
        State? state=null;
        HasEligiblePending=false;remainingQueueBudget=128;deferredQueuedUploadPaths.Clear();
        try {
            // The existing sync lock also fences foreign active editors. This
            // engine may mirror assets/paths while retaining its own editors.
            using var fileLock=workspaceOwnership.Acquire();
            if(mirrorPolicy is null)throw new MirrorPolicyUnavailableException("The shared sync policy is unavailable. Reopen the workspace to retry.");
            await mirrorPolicy.ReadyAsync(cancellation);
            state=Load();
            if(!FolderSpellingChanged(state)){var earlyAcknowledged=SharedEditingStore.ReconcileAcknowledgements(store,state);if(earlyAcknowledged.Count>0){Save(state);foreach(var file in earlyAcknowledged)File.Delete(file);}}
            Report(true,null,state.Outbox.Count);
            var local=store.Scan().ToDictionary(x=>x.ItemId);
            if(localChangesOnly&&state.PendingPull==null&&state.FolderCommand==null&&!FolderSpellingChanged(state)&&!HasLocalWork(state,local)) {Report(false,StateError(state),state.Outbox.Count);return;}
            var remote=(await transport.ManifestAsync(cancellation)).ToDictionary(x=>x.ItemId);
            remote=await ReconcileFolderCase(state,local,remote,cancellation);
            var acknowledged=SharedEditingStore.ReconcileAcknowledgements(store,state);if(acknowledged.Count>0){Save(state);foreach(var file in acknowledged)File.Delete(file);}
            if(state.PendingPull is {} incoming && !store.ReplacementBlocked(incoming.ItemId) && remote.TryGetValue(incoming.ItemId,out var incomingRemote) && incomingRemote.Lifecycle!=null && incomingRemote.Lifecycle!=incoming.Lifecycle) {store.Preserve(Convert.FromBase64String(incoming.Payload),"previous-lifecycle");state.PendingPull=null;Save(state);}
            if(state.PendingPull!=null && !store.ReplacementBlocked(state.PendingPull.ItemId)) {if(IsEditing(state.PendingPull.ItemId)){Report(false,null,state.Outbox.Count);return;}ApplyPull(state);}
            local=store.Scan().ToDictionary(x=>x.ItemId);
            RememberCapabilities(state);
            await ReconcileLifecycles(state,local,remote,cancellation);
            RecoverMetadataAdoption(state,local,remote);
            await AdoptQueuedUploadPaths(state,remote,cancellation);
            RetrySupersededUploads(state,local,remote);
            local=store.Scan().ToDictionary(x=>x.ItemId);
            var hadPendingWrites=state.Outbox.Any(x=>!deferredQueuedUploadPaths.Contains(x.Id)&&!x.Conflicted&&!IsEditing(x.ItemId)&&!store.ReplacementBlocked(x.ItemId)&&Permitted(state,x));
            await Drain(state,cancellation);
            if(hadPendingWrites) {remote=(await transport.ManifestAsync(cancellation)).ToDictionary(x=>x.ItemId);RememberCapabilities(state);}
            if(transport.Folders.Count>20000)throw new IOException("Too many workspace folders.");
            store.ValidateFolderCatalog(transport.AuthoritativeFolders is {} combinedCatalog?transport.Folders.Concat(combinedCatalog).Distinct(StringComparer.Ordinal).ToArray():transport.Folders);
            if(transport.AuthoritativeFolders is {} catalog) {
                if(catalog.Count>20000)throw new IOException("Too many workspace folders.");
                store.ValidateFolderCatalog(catalog);
                var updated=(state.ManagedFolders??[]).Union(catalog,StringComparer.Ordinal).OrderBy(x=>x,StringComparer.Ordinal).ToList();
                if(updated.Count>40000)throw new IOException("Too many retained workspace folders.");
                if(state.ManagedFolders==null||!state.ManagedFolders.SequenceEqual(updated)){state.ManagedFolders=updated;Save(state);}
            }
            var folderError=false;
            foreach(var folder in transport.Folders)try{store.EnsureFolders([folder]);}catch(IOException){folderError=true;}catch(UnauthorizedAccessException){folderError=true;}
            local=store.Scan().ToDictionary(x=>x.ItemId);
            foreach(var id in state.Items.Keys.Union(state.ProtectedRenames.Keys,StringComparer.Ordinal).Union(state.SharedRenames.Keys,StringComparer.Ordinal).ToArray()) {
                cancellation.ThrowIfCancellationRequested();if(store.ReplacementBlocked(id))continue;
                if(!state.Items.TryGetValue(id,out var itemBaseline)) {await ReconcileSavedRename(state,id,null,remote.GetValueOrDefault(id),cancellation);continue;}
                var pair=new KeyValuePair<string,Baseline>(id,itemBaseline);
                if(remote.TryGetValue(id,out var tombstoneRemote)&&tombstoneRemote.Deleted) {
                    var tombstoneBaseline=pair.Value;var tombstoneFile=local.GetValueOrDefault(id);
                    var disposition=await TombstoneDecision(state,id,tombstoneBaseline,tombstoneFile,tombstoneRemote,cancellation);
                    if(disposition.Action is "defer" or "no-local")continue;
                    if(tombstoneFile is null)throw new FileChangedException();
                    if(disposition.Action=="retain-conflict") {store.Preserve(store.Read(tombstoneFile.Path),"conflict");Queue(state,new(Guid.NewGuid().ToString(),"conflict",id,tombstoneFile.Path,null,tombstoneBaseline.Revision,tombstoneFile.Hash,null,true));continue;}
                    store.RemoveRetaining(tombstoneFile.Path,tombstoneFile.Hash);state.Items.Remove(id);Save(state);store.ClearIntent(id);local.Remove(id);continue;
                }
                if(!IsEditing(id) && !SavedRenameOwnsPath(state,id) && state.BinaryOutbox.Any(x=>x.ItemId==id)) {
                    if(remote.TryGetValue(id,out var binaryRemote) && !binaryRemote.Deleted)
                        await SyncOpenBinary(state,local.GetValueOrDefault(id),pair.Value,binaryRemote,cancellation);
                    continue;
                }
                if(IsEditing(id)||SavedRenameOwnsPath(state,id)) {
                    var pathOwned=await ReconcileSavedRename(state,id,pair.Value,remote.GetValueOrDefault(id),cancellation);
                    local=store.Scan().ToDictionary(x=>x.ItemId);
                    if(!pathOwned) {
                        var pathDecision=await ProtectedPathDecision(state,id,pair.Value,local.GetValueOrDefault(id),remote.GetValueOrDefault(id),cancellation);
                        if(!Blocked(state,id)&&state.PendingPull?.ItemId!=id&&remote.TryGetValue(id,out var relocated)&&!relocated.Deleted&&
                           local.TryGetValue(id,out var projection)&&SharedEditingStore.HasReadyCheckpoint(store,id)) {
                            if(pathDecision.Action=="follow-remote") {
                                var moved=SharedEditingStore.RebaseProjection(store,id,relocated.RelativePath);
                                state.Items[id]=pair.Value with{Path=moved.Path};Save(state);store.ClearIntent(id);
                                local[id]=store.Describe(moved.Path);
                            } else if(pathDecision.Action=="adopt-path") {
                                state.Items[id]=pair.Value with{Path=projection.Path};Save(state);
                            }
                        }
                    }
                    if(!Blocked(state,id)&&state.PendingPull?.ItemId!=id && remote.TryGetValue(id,out var binaryRemote) && !binaryRemote.Deleted &&
                       state.Items.TryGetValue(id,out var binaryBase)&&local.TryGetValue(id,out var binaryProjection)&&binaryProjection.Path==binaryBase.Path) {
                        await SyncRemoteBinary(state,local.GetValueOrDefault(id),binaryBase,binaryRemote,cancellation);
                        if(File.Exists(store.Resolve(state.Items[id].Path)))local[id]=store.Describe(state.Items[id].Path);
                        else local.Remove(id);
                        await SyncOpenBinary(state,local.GetValueOrDefault(id),state.Items[id],binaryRemote,cancellation);
                    }
                    continue;
                }
                if(Blocked(state,id))continue;var baseline=pair.Value;var intent=store.Intent(id);
                local.TryGetValue(id,out var file); remote.TryGetValue(id,out var server);
                if(intent?.Kind=="delete" && file==null) {
                    if(File.Exists(store.Resolve(intent.Path)))continue;
                    if(server is { Deleted:false }) { Queue(state,new(Guid.NewGuid().ToString(),"delete",id,baseline.Path,null,baseline.Revision,baseline.Hash,null)); await Drain(state,cancellation); }
                    else if(server is { Deleted:true }) { state.Items.Remove(id);Save(state);store.ClearIntent(id); } continue;
                }
                // Provider-evicted or transiently absent files are never inferred to be deletions.
                if(file==null) continue;

                if(server==null) continue; // Missing visibility is not authority to delete or recreate.
                if(file.Path!=baseline.Path) {
                    if(server.RelativePath==file.Path) {
                        // A prior pass may have adopted the remote path before
                        // its baseline save. Keep local content and finish that
                        // adoption rather than issuing another remote rename.
                        baseline=baseline with{Path=file.Path};state.Items[id]=baseline;Save(state);store.ClearIntent(id);
                    } else {
                        Queue(state,new(Guid.NewGuid().ToString(),"rename",id,baseline.Path,file.Path,baseline.Revision,baseline.Hash,null));await Drain(state,cancellation);if(Blocked(state,id))continue;baseline=state.Items[id];
                    }
                } else if(server.RelativePath!=baseline.Path) {
                    // Folder moves preserve the remote revision. Rebase the
                    // current local bytes first, including offline agent edits,
                    // then upload against the unchanged content baseline.
                    store.Rename(file.Path,server.RelativePath,file.Hash);
                    file=store.Describe(server.RelativePath);local[id]=file;
                    baseline=baseline with{Path=file.Path};state.Items[id]=baseline;Save(state);store.ClearIntent(id);
                }
                // A prior collaboration checkpoint can move the document cursor
                // to this revision while its asset cursor is still behind. A
                // closed editor must finish that binary receive as well.
                if(file.Hash==baseline.Hash && server.Revision==baseline.Revision &&
                   state.BinaryBaselines.ContainsKey(id) &&
                   state.BinaryRevisions.GetValueOrDefault(id)!=server.Revision) {
                    await SyncRemoteBinary(state,file,baseline,server,cancellation);
                    file=store.Describe(file.Path);
                    local[id]=file;
                    baseline=state.Items[id];
                }
                // The writer lease survives the page RPC. QueueUpload and
                // Pull retain the captured hash as their file CAS boundary.
                var action=await mirrorPolicy.DecideAsync(new(file.Hash,baseline.Hash,server.Revision,baseline.Revision,baseline.Refresh || server.RelativePath!=file.Path),cancellation);
                if(action==MirrorDisposition.Upload){QueueUpload(state,file,baseline.Revision);await Drain(state,cancellation);}
                else if(action==MirrorDisposition.Pull)await Pull(state,id,file,cancellation,server.Lifecycle,server.Revision);
            }
            foreach(var file in local.Values.Where(x=>!state.Items.ContainsKey(x.ItemId))) {
                if(IsEditing(file.ItemId)||SavedRenameOwnsPath(state,file.ItemId)||Blocked(state,file.ItemId))continue;
                if(remote.TryGetValue(file.ItemId,out var server)) {
                    if(server.Deleted) { store.Preserve(store.Read(file.Path),"conflict");Queue(state,new(Guid.NewGuid().ToString(),"conflict",file.ItemId,file.Path,null,server.Revision,file.Hash,null,true));continue; }
                    var pack=await transport.DownloadAsync(file.ItemId,cancellation);
                    var localBytes=store.Read(file.Path);
                    if(!TextPackStore.Equivalent(pack.Data,localBytes)) {
                        if(pack.RelativePath==file.Path && TextPackStore.ExtendsMetadata(localBytes,pack.Data)) {
                            if(TextPackStore.Hash(localBytes)!=file.Hash||store.Describe(file.Path).Hash!=file.Hash)throw new FileChangedException();
                            // Persist the observed server base before queueing.
                            // A crash here resumes as a normal local change.
                            state.Items[file.ItemId]=new(file.Path,TextPackStore.Hash(pack.Data),pack.Revision,Lifecycle:ReadLifecycle(pack.Data)??(pack.Revision==server.Revision?server.Lifecycle:throw new FileChangedException()));Save(state);
                            QueueUpload(state,file,pack.Revision);await Drain(state,cancellation);continue;
                        }
                        store.Preserve(pack.Data,"remote-conflict");store.Preserve(localBytes,"conflict");Queue(state,new(Guid.NewGuid().ToString(),"conflict",file.ItemId,file.Path,null,server.Revision,file.Hash,null,true));continue;
                    }
                    state.Items[file.ItemId]=new(file.Path,file.Hash,pack.Revision,Lifecycle:ReadLifecycle(pack.Data)??(pack.Revision==server.Revision?server.Lifecycle:throw new FileChangedException()));Save(state);
                } else { QueueUpload(state,file,null);await Drain(state,cancellation); }
            }
            foreach(var item in remote.Values.Where(x=>!store.ReplacementBlocked(x.ItemId)&&!store.LastScanErrors.Any(e=>e.ItemId==x.ItemId||e.Path=="."||e.Path==x.RelativePath||x.RelativePath.StartsWith(e.Path+"/",StringComparison.OrdinalIgnoreCase)) && !IsEditing(x.ItemId) && !SavedRenameOwnsPath(state,x.ItemId) && !Blocked(state,x.ItemId) && !x.Deleted && !local.ContainsKey(x.ItemId) && !state.Items.ContainsKey(x.ItemId))) await Pull(state,item.ItemId,null,cancellation,item.Lifecycle,item.Revision);
            foreach(var pending in state.Items.Where(x=>x.Value.Refresh).ToArray()) { if(IsEditing(pending.Key)||SavedRenameOwnsPath(state,pending.Key)||Blocked(state,pending.Key)||store.ReplacementBlocked(pending.Key))continue;var current=store.Describe(pending.Value.Path); if(current.Hash==pending.Value.Hash) await Pull(state,pending.Key,current,cancellation,remote.GetValueOrDefault(pending.Key)?.Lifecycle,remote.GetValueOrDefault(pending.Key)?.Revision); }
            if(transport.AuthoritativeFolders is {} currentCatalog) {
                var retained=new HashSet<string>(currentCatalog,StringComparer.Ordinal);
                foreach(var folder in (state.ManagedFolders??[]).Where(x=>!retained.Contains(x)).OrderByDescending(x=>x.Length).ToArray()) {
                    try {if(!store.RemoveEmptyManagedFolder(folder))retained.Add(folder);}catch(IOException){retained.Add(folder);}catch(UnauthorizedAccessException){retained.Add(folder);}
                }
                var updated=retained.OrderBy(x=>x,StringComparer.Ordinal).ToList();
                if(state.ManagedFolders==null||!state.ManagedFolders.SequenceEqual(updated)){state.ManagedFolders=updated;Save(state);}
            }
            CaptureFolderBaseline(state,remote);
            Report(false,StateError(state)??(folderError?"A workspace folder could not be opened. Other files continue syncing.":null),state.Outbox.Count);
        } catch(Exception error) { Report(false,error.Message,state?.Outbox.Count??0);throw; } finally {gate.Release();}
    }
    async Task AdoptQueuedUploadPaths(State state,Dictionary<string,RemoteItem> remote,CancellationToken ct) {
        foreach(var op in state.Outbox.ToArray()) {
            // This phase owns only adoption of an already queued upload's path.
            // Ordinary queue/CAS admission still owns every eventual send.
            if(op.Kind!="upload"||op.Revision is null||!remote.TryGetValue(op.ItemId,out var server)||server.RelativePath==op.Path)continue;
            deferredQueuedUploadPaths.Add(op.Id);
            if(mirrorPolicy is null)throw new MirrorPolicyUnavailableException("Queued file path policy unavailable.");
            var baseline=state.Items.GetValueOrDefault(op.ItemId);
            var files=store.Scan().Where(file=>file.ItemId==op.ItemId).ToArray();
            var unique=files.Length==1&&store.LastScanErrors.Count==0;var file=unique?files[0]:null;
            var protection=SharedEditingStore.ReadProtectionSnapshot(store,op.ItemId,accountId);
            var intent=store.Intent(op.ItemId);var editing=IsEditing(op.ItemId);
            var stateProof=JsonSerializer.Serialize(state);var context=SavedRenameContext();var binding=transport.ProtectedRenameBinding;
            var capabilities=JsonSerializer.Serialize(transport.Capabilities);var permitted=Allowed();
            byte[]? payload=null;var staged=false;var identity=false;
            try {
                if(op.Payload is not null&&op.Payload.Length<=90*1024*1024) {
                    payload=Convert.FromBase64String(op.Payload);
                    staged=payload.Length<=64*1024*1024&&TextPackStore.Hash(payload)==op.Hash&&TextPackStore.Identity(payload)==op.ItemId;
                }
                if(file is not null) {var bytes=store.Read(file.Path);identity=TextPackStore.Hash(bytes)==file.Hash&&TextPackStore.Identity(bytes)==op.ItemId;}
            }catch(Exception error)when(error is IOException or InvalidDataException or FormatException or UnauthorizedAccessException){ }
            var proposed=op with{Path=server.RelativePath};
            bool Allowed() {
                var current=transport.Capabilities;
                return context is not null&&binding==context.Scope&&current is not null&&server.CanEditContent!=false&&current.CanWrite(op.ItemId,server.RelativePath,true);
            }
            var recovery=context is null||binding!=context.Scope||store.ReplacementBlocked(op.ItemId)||protection.Protected||SavedRenameOwnsPath(state,op.ItemId)||
                state.PendingPull?.ItemId==op.ItemId||state.BinaryOutbox.Any(value=>value.ItemId==op.ItemId)||
                state.FolderCommand?.Request.Items.Any(value=>value.ItemId==op.ItemId)==true;
            var observed=new MirrorQueuedUploadPathObservation(op.Kind,op.Conflicted,state.Outbox.Count(value=>value.ItemId==op.ItemId)==1,
                op.Path,op.Revision,op.Lifecycle,baseline?.Path,baseline?.Revision,baseline?.Lifecycle,server.RelativePath,server.Revision,server.Lifecycle,
                server.Deleted,true,file?.Path,unique,identity,staged,editing,recovery,permitted,intent?.Kind switch{null=>"none","rename"=>"rename","delete"=>"delete",_=>"other"},intent?.Path,intent?.Destination);
            void Current() {
                ct.ThrowIfCancellationRequested();
                if(JsonSerializer.Serialize(Load())!=stateProof||SavedRenameContext()!=context||transport.ProtectedRenameBinding!=binding||
                    JsonSerializer.Serialize(transport.Capabilities)!=capabilities||IsEditing(op.ItemId)!=editing||store.Intent(op.ItemId)!=intent||
                    SharedEditingStore.ReadProtectionSnapshot(store,op.ItemId,accountId)!=protection||!state.Outbox.Contains(op)||Allowed()!=permitted)throw new FileChangedException();
                var current=store.Scan().Where(value=>value.ItemId==op.ItemId).ToArray();
                if(store.LastScanErrors.Count!=0||!current.SequenceEqual(files))throw new FileChangedException();
                if(payload is not null&&(op.Payload is null||!Convert.FromBase64String(op.Payload).SequenceEqual(payload)))throw new FileChangedException();
                store.AssertReplacementReadable(op.ItemId);
            }
            var decision=await mirrorPolicy.QueuedUploadPathAsync(observed,ct);Current();
            if(decision.Action!="reissue-at-remote-path")continue;
            var latest=(await transport.ManifestAsync(ct)).Where(value=>value.ItemId==op.ItemId).ToArray();Current();
            if(latest.Length!=1||latest[0]!=server||file is null||baseline is null||payload is null||!staged||!identity)throw new FileChangedException();
            if(file.Path!=server.RelativePath)store.Rename(file.Path,server.RelativePath,file.Hash);
            // Existing owner atomically stores the new command with identical
            // payload/base/generation. No await follows the last native checks.
            var replacement=proposed with{Id=Guid.NewGuid().ToString("D")};
            state.Outbox[state.Outbox.IndexOf(op)]=replacement;state.Items[op.ItemId]=baseline with{Path=server.RelativePath};Save(state);
            var movedIntent=store.Intent(op.ItemId);
            if(movedIntent is not null&&movedIntent.Kind=="rename"&&movedIntent.Path==op.Path&&movedIntent.Destination==server.RelativePath)store.ClearIntent(op.ItemId,movedIntent);
            deferredQueuedUploadPaths.Remove(op.Id);
        }
    }
    void RetrySupersededUploads(State state,Dictionary<string,PackFile> local,Dictionary<string,RemoteItem> remote) {
        foreach(var op in state.Outbox.ToArray()) {
            // A fenced upload is final only for the bytes it carried. A later
            // local save supersedes those bytes, so the current file is queued
            // against the same attested base and the server's compare-and-swap
            // decides whether the change still competes. The superseded payload
            // stays preserved, the base is never moved, and the receipt identity
            // changes because the replacement is a new command.
            if(op.Kind!="upload"||!op.Conflicted||op.Revision==null||op.Payload==null||IsEditing(op.ItemId)
                ||state.Outbox.Count(x=>x.ItemId==op.ItemId)!=1||store.Intent(op.ItemId)!=null
                ||!state.Items.TryGetValue(op.ItemId,out var baseline)||baseline.Revision!=op.Revision||baseline.Path!=op.Path||baseline.Lifecycle!=op.Lifecycle
                ||!local.TryGetValue(op.ItemId,out var file)||file.Path!=op.Path||file.Hash==op.Hash||file.Hash==baseline.Hash
                ||!remote.TryGetValue(op.ItemId,out var server)||server.Deleted||server.RelativePath!=op.Path||server.Lifecycle!=op.Lifecycle)continue;
            byte[] bytes;
            try {bytes=store.Read(file.Path);if(TextPackStore.Hash(bytes)!=file.Hash||TextPackStore.Identity(bytes)!=op.ItemId)continue;}
            catch(IOException){continue;}catch(InvalidDataException){continue;}catch(UnauthorizedAccessException){continue;}
            var replacement=new Operation(Guid.NewGuid().ToString(),"upload",op.ItemId,op.Path,null,op.Revision,file.Hash,Convert.ToBase64String(bytes),false,op.Lifecycle);
            if(!Permitted(state,replacement))continue;
            store.Preserve(Convert.FromBase64String(op.Payload),"conflict");
            state.Outbox[state.Outbox.IndexOf(op)]=replacement;Save(state);
        }
    }
    sealed record LifecyclePlan(RemoteItem Remote,Baseline? Baseline,Operation? Operation,FileIntent? Intent,MirrorLifecycleDecision Decision);
    async Task ReconcileLifecycles(State state,Dictionary<string,PackFile> local,Dictionary<string,RemoteItem> remote,CancellationToken ct) {
        if(mirrorPolicy is null)throw new MirrorPolicyUnavailableException("Mirror policy is unavailable.");
        var plans=new List<LifecyclePlan>();
        var capturedOutbox=state.Outbox.ToArray();
        foreach(var item in remote.Values.Where(x=>!x.Deleted&&x.Lifecycle!=null&&!store.ReplacementBlocked(x.ItemId))) {
            if(IsEditing(item.ItemId)||SavedRenameOwnsPath(state,item.ItemId))continue;
            var baseline=state.Items.GetValueOrDefault(item.ItemId);var intent=store.Intent(item.ItemId);
            // Preserve FIFO order and classify each durable operation independently.
            var operations=capturedOutbox.Where(x=>x.ItemId==item.ItemId).Cast<Operation?>().ToArray();
            if(operations.Length==0)operations=[null];
            foreach(var op in operations) {
                var decision=await mirrorPolicy.LifecycleAsync(new(true,false,item.Lifecycle,item.Revision,false,
                    baseline?.Lifecycle,baseline?.Revision,op?.Kind,op?.Lifecycle,op?.Revision,op?.Conflicted??false),ct);
                ct.ThrowIfCancellationRequested();
                if(IsEditing(item.ItemId)||state.Items.GetValueOrDefault(item.ItemId)!=baseline||!state.Outbox.SequenceEqual(capturedOutbox)||store.Intent(item.ItemId)!=intent)throw new FileChangedException();
                if(decision.Pending=="fence-edit" && op is not null) {
                    if(op.Kind=="upload"&&op.Payload is null)throw new InvalidDataException("Staged lifecycle recovery payload is missing.");
                    if(op.Payload is not null) {
                        var payload=Convert.FromBase64String(op.Payload);
                        if(TextPackStore.Hash(payload)!=op.Hash||TextPackStore.Identity(payload)!=op.ItemId)throw new InvalidDataException("Staged lifecycle recovery payload changed.");
                    }
                }
                plans.Add(new(item,baseline,op,intent,decision));
            }
        }
        var needsRefresh=plans.Any(p=>p.Decision.Baseline=="adopt"||p.Decision.Pending is "adopt" or "retire-delete" or "fence-edit"||
            p.Baseline is not null && p.Baseline.Lifecycle!=p.Remote.Lifecycle&&!local.ContainsKey(p.Remote.ItemId)&&!capturedOutbox.Any(x=>x.ItemId==p.Remote.ItemId));
        if(!needsRefresh)return;
        var refreshed=(await transport.ManifestAsync(ct)).ToDictionary(x=>x.ItemId,StringComparer.Ordinal);
        await mirrorPolicy.ReadyAsync(ct);ct.ThrowIfCancellationRequested();
        foreach(var plan in plans) {
            if(!refreshed.TryGetValue(plan.Remote.ItemId,out var current)||current.Revision!=plan.Remote.Revision||current.Lifecycle!=plan.Remote.Lifecycle||
               current.RelativePath!=plan.Remote.RelativePath||current.Deleted!=plan.Remote.Deleted||IsEditing(plan.Remote.ItemId)||
               state.Items.GetValueOrDefault(plan.Remote.ItemId)!=plan.Baseline||!state.Outbox.SequenceEqual(capturedOutbox)||store.Intent(plan.Remote.ItemId)!=plan.Intent)throw new FileChangedException();
        }
        // No await after the last ownership/intent comparison through journal mutations.
        foreach(var plan in plans) {
            var item=plan.Remote;var op=plan.Operation;
            if(plan.Decision.Baseline=="adopt"&&plan.Baseline is {} baseline)state.Items[item.ItemId]=baseline with{Lifecycle=item.Lifecycle};
            if(op is not null) {
                switch(plan.Decision.Pending) {
                case "adopt": state.Outbox[state.Outbox.IndexOf(op)]=op with{Lifecycle=item.Lifecycle};break;
                case "retire-delete": state.Outbox.Remove(op);break;
                case "fence-edit":
                    if(op.Payload is not null)store.Preserve(Convert.FromBase64String(op.Payload),"previous-lifecycle");
                    state.Outbox[state.Outbox.IndexOf(op)]=op with{Conflicted=true};break;
                }
            }
            Save(state);
            if(plan.Decision.Pending=="retire-delete"&&plan.Intent is {Kind:"delete"} intent&&op is not null&&intent.Path==op.Path&&intent.Hash==op.Hash&&store.Intent(item.ItemId)==intent)
                store.ClearIntent(item.ItemId,intent);
        }
        foreach(var plan in plans.DistinctBy(p=>p.Remote.ItemId)) {
            var item=plan.Remote;
            // The initial enumeration predates the RPC. Scan again before treating a file as absent.
            if(state.Items.TryGetValue(item.ItemId,out var baseline)&&baseline.Lifecycle!=item.Lifecycle&&!state.Outbox.Any(x=>x.ItemId==item.ItemId)&&
               !store.Scan().Any(x=>x.ItemId==item.ItemId)&&!store.LastScanErrors.Any(x=>x.ItemId==item.ItemId||x.ItemId is null)) {
                var intent=store.Intent(item.ItemId);
                if(intent!=null&&(intent.Kind!="delete"||intent.Path!=baseline.Path||intent.Hash!=baseline.Hash))continue;
                state.Items.Remove(item.ItemId);Save(state);
                if(intent!=null)store.ClearIntent(item.ItemId,intent);
            }
        }
    }
    void RecoverMetadataAdoption(State state,Dictionary<string,PackFile> local,Dictionary<string,RemoteItem> remote) {
        foreach(var op in state.Outbox.Where(x=>x.Kind=="conflict"&&x.Conflicted&&x.Revision!=null).ToArray()) {
            if(state.Items.ContainsKey(op.ItemId)||IsEditing(op.ItemId)||!Permitted(state,op)||
                state.Outbox.Count(x=>x.ItemId==op.ItemId)!=1||!local.TryGetValue(op.ItemId,out var file)||file.Path!=op.Path||
                !remote.TryGetValue(op.ItemId,out var server)||server.Deleted||server.RelativePath!=op.Path||server.Lifecycle!=op.Lifecycle)continue;
            // Old versions preserved both archives before recording an unbased
            // conflict. Their content hashes attest the original comparison;
            // never infer a base from today's file or clear arbitrary conflicts.
            if(!System.Text.RegularExpressions.Regex.IsMatch(op.Hash,@"\A[0-9a-f]{64}\z")||!System.Text.RegularExpressions.Regex.IsMatch(op.Revision!,@"\A[0-9a-f]{64}\z"))continue;
            bool equivalent;
            try {
                var recovery=store.GetRecoveryDirectory();
                var localPath=Path.Combine(recovery,"conflict-"+op.Hash+".textpack");
                var remotePath=Path.Combine(recovery,"remote-conflict-"+op.Revision+".textpack");
                if(!File.Exists(localPath)||!File.Exists(remotePath))continue;
                var original=File.ReadAllBytes(localPath);var basis=File.ReadAllBytes(remotePath);
                if(TextPackStore.Hash(original)!=op.Hash||TextPackStore.Hash(basis)!=op.Revision||TextPackStore.Identity(original)!=op.ItemId||TextPackStore.Identity(basis)!=op.ItemId)continue;
                equivalent=TextPackStore.Equivalent(original,basis);
                if(!equivalent&&!TextPackStore.ExtendsMetadata(original,basis))continue;
            } catch(IOException) {continue;} catch(InvalidDataException) {continue;} catch(UnauthorizedAccessException) {continue;}
            state.Items[op.ItemId]=new(op.Path,equivalent?op.Hash:op.Revision!,op.Revision!,Lifecycle:op.Lifecycle);
            state.Outbox.Remove(op);Save(state);
        }
    }
    static Baseline MaterializedBinaryBaseline(Baseline baseline,string beforeHash,string afterHash,string authoritativeRevision) =>
        afterHash==authoritativeRevision?baseline with{Hash=afterHash,Revision=authoritativeRevision}:
        beforeHash==baseline.Hash?baseline with{Hash=afterHash}:baseline;
    SharedCheckpoint? CleanBinaryCheckpoint(string itemId,PackFile? file,Baseline baseline) {
        if(file is null||!ReadSavedProtection(itemId).Available)return null;
        var path=Path.Combine(store.StateDirectory,"shared-editing",itemId,"checkpoint.json");
        if(!File.Exists(path))return null;
        var checkpoint=JsonSerializer.Deserialize<SharedCheckpoint>(RetainedFileReplacement.Read(path,90*1024*1024));
        return checkpoint is {Pending:false,RetiredReason:null}&&checkpoint.Path==file.Path&&checkpoint.ProjectedHash==file.Hash&&
            checkpoint.AcknowledgedRevision==baseline.Revision?checkpoint:null;
    }
    async Task SyncOpenBinary(State state,PackFile? local,Baseline baseline,RemoteItem remote,CancellationToken ct) {
        var pending=state.BinaryOutbox.FirstOrDefault(x=>x.ItemId==remote.ItemId);
        if(pending is {Conflicted:true})return;
        if(baseline.Lifecycle!=remote.Lifecycle) {
            if(pending is not null && local is not null) {
                var localPack=store.Read(local.Path);
                if(TextPackStore.Hash(localPack)!=local.Hash)throw new InvalidDataException("Local conflict pack changed during read.");
                var remotePack=await transport.DownloadAsync(remote.ItemId,ct);
                if(TextPackStore.Hash(remotePack.Data)!=remotePack.Revision)throw new InvalidDataException("Remote conflict pack changed during download.");
                PreserveBinaryPayload(pending);
                store.Preserve(localPack,"binary-conflict-local");
                store.Preserve(remotePack.Data,"binary-conflict-remote");
                state.BinaryOutbox[state.BinaryOutbox.IndexOf(pending)]=pending with{Conflicted=true};Save(state);
            }
            return;
        }
        if(state.Capabilities?.CanWrite(remote.ItemId,baseline.Path,true)==false)return;
        if(pending is null) {
            if(local is null || local.Path!=baseline.Path)return; // Missing provider file is never an asset deletion.
            if(!state.BinaryBaselines.TryGetValue(remote.ItemId,out var hashes)) {
                if(local.Hash!=baseline.Hash)return; // Do not invent a base after an unknown edit.
                state.BinaryBaselines[remote.ItemId]=BinaryEntryPacks.Assets(store.Read(local.Path)).ToDictionary(x=>x.Key,x=>x.Value.Sha256);
                state.BinaryRevisions[remote.ItemId]=baseline.Revision;
                Save(state);return;
            }
            if(local.Hash==baseline.Hash)return;
            var bytes=store.Read(local.Path);
            if(TextPackStore.Hash(bytes)!=local.Hash)return;
            var assets=BinaryEntryPacks.Assets(bytes);
            var changed=hashes.Keys.Union(assets.Keys,StringComparer.Ordinal).OrderBy(x=>x,StringComparer.Ordinal)
                .FirstOrDefault(path=>hashes.GetValueOrDefault(path)!=assets.GetValueOrDefault(path)?.Sha256);
            if(changed is null)return;
            hashes.TryGetValue(changed,out var prior);
            var operationId=Guid.NewGuid().ToString();
            var payload=assets.GetValueOrDefault(changed)?.Bytes;
            if(payload is not null)TextPackStore.AtomicWrite(BinaryPayloadPath(operationId),payload);
            pending=new(operationId,remote.ItemId,changed,prior,baseline.Lifecycle,null,local.Hash,
                PayloadHash:payload is null?null:TextPackStore.Hash(payload),SourcePath:local.Path);
            state.BinaryOutbox.Add(pending);Save(state); // Exact bytes and operation ID are durable before network I/O.
        }
        // Asset CAS already coexists with the text lease. The explicit lane
        // keeps actual editor ownership visible to the shared policy.
        var selection=await mirrorPolicy!.QueueAsync(new([new(pending.Id,pending.Conflicted,IsEditing(pending.ItemId),
            store.ReplacementBlocked(pending.ItemId),state.Capabilities?.CanWrite(pending.ItemId,baseline.Path,true)!=false)],1,"binary"),ct);
        RememberCapabilities(state);
        ct.ThrowIfCancellationRequested();
        if(!selection.OperationIds.SequenceEqual(new[]{pending.Id}) || !state.BinaryOutbox.Contains(pending) ||
           state.Items.GetValueOrDefault(pending.ItemId)!=baseline || baseline.Lifecycle!=remote.Lifecycle ||
           state.Capabilities?.CanWrite(pending.ItemId,baseline.Path,true)==false)return;
        var textProof=CleanBinaryCheckpoint(pending.ItemId,local,baseline);
        try {
            var bytes=BinaryPayload(pending);
            store.AssertReplacementReadable(pending.ItemId);
            var revision=await transport.BinaryPatchAsync(pending.ItemId,pending.Id,pending.EntryPath,pending.ExpectedHash,pending.Lifecycle,
                bytes,ct);
            store.AssertReplacementReadable(pending.ItemId);
            ct.ThrowIfCancellationRequested();
            if(!state.BinaryOutbox.Contains(pending)||state.Items.GetValueOrDefault(pending.ItemId)!=baseline)return;
            if(!state.BinaryBaselines.TryGetValue(pending.ItemId,out var hashes))throw new InvalidDataException("Binary baseline is missing.");
            if(bytes is null)hashes.Remove(pending.EntryPath);
            else hashes[pending.EntryPath]=TextPackStore.Hash(bytes);
            var latest=local is null?null:store.Describe(local.Path);
            var latestAssets=latest?.ItemId==pending.ItemId?BinaryEntryPacks.Assets(store.Read(latest.Path)):null;
            var locallyCurrent=latestAssets is not null && latestAssets.Count==hashes.Count &&
                latestAssets.All(x=>hashes.GetValueOrDefault(x.Key)==x.Value.Sha256);
            // One asset receipt does not attest text or unrelated assets.
            // Exact whole-pack equality is the sole full revision proof here.
            var complete=latest?.Hash==revision;
            var cleanText=textProof is not null&&latest is not null&&CleanBinaryCheckpoint(pending.ItemId,latest,baseline)==textProof;
            state.Items[pending.ItemId]=complete?baseline with{Revision=revision,Hash=latest!.Hash}:
                baseline with{Hash=locallyCurrent&&cleanText?latest!.Hash:baseline.Hash};
            if(complete)state.BinaryRevisions[pending.ItemId]=revision;
            else state.BinaryRevisions.Remove(pending.ItemId);
            state.BinaryOutbox.Remove(pending);Save(state);
            if(pending.PayloadHash is not null)try{File.Delete(BinaryPayloadPath(pending.Id));}catch(IOException){}
        } catch(SyncConflictException) {
            var remotePack=await transport.DownloadAsync(pending.ItemId,ct);
            if(TextPackStore.Hash(remotePack.Data)!=remotePack.Revision)throw new InvalidDataException("Remote conflict pack changed during download.");
            PreserveBinaryPayload(pending);
            ResolveBinaryConflict(state,local,baseline,pending.EntryPath,remote,remotePack);
            state.BinaryOutbox.Remove(pending);Save(state);
            if(pending.PayloadHash is not null)try{File.Delete(BinaryPayloadPath(pending.Id));}catch(IOException){}
        }
    }
    void ResolveBinaryConflict(State state,PackFile? local,Baseline baseline,string entryPath,
        RemoteItem remote,RemotePack remotePack) {
        if(local is null||local.Path!=baseline.Path)
            throw new InvalidDataException("Local conflict pack is temporarily unavailable.");
        var localPack=store.Read(local.Path);
        if(TextPackStore.Identity(localPack)!=remote.ItemId||TextPackStore.Hash(localPack)!=store.Describe(local.Path).Hash)
            throw new InvalidDataException("Local conflict pack changed during read.");
        store.Preserve(localPack,"binary-conflict-local");
        store.Preserve(remotePack.Data,"binary-conflict-remote");
        var localAsset=BinaryEntryPacks.Assets(localPack).GetValueOrDefault(entryPath);
        var remoteAsset=BinaryEntryPacks.Assets(remotePack.Data).GetValueOrDefault(entryPath);
        var updated=SharedEditingStore.ApplyRemoteBinary(store,remote.ItemId,local.Path,TextPackStore.Hash(localPack),
            entryPath,localAsset?.Sha256,remoteAsset?.Bytes);
        if(!state.BinaryBaselines.TryGetValue(remote.ItemId,out var known))throw new InvalidDataException("Binary baseline is missing.");
        if(remoteAsset is null)known.Remove(entryPath);else known[entryPath]=remoteAsset.Sha256;
        // Other entries may have changed in the same remote pack. Recheck
        // their hashes next cycle rather than claiming the whole pack is read.
        state.BinaryRevisions.Remove(remote.ItemId);
        state.Items[remote.ItemId]=MaterializedBinaryBaseline(baseline,TextPackStore.Hash(localPack),updated.Hash,remotePack.Revision);
        Save(state);
    }
    async Task SyncRemoteBinary(State state,PackFile? local,Baseline baseline,RemoteItem remote,CancellationToken ct) {
        // Collaboration checkpoints can advance the document revision before this
        // device has fetched its assets. Track the asset revision independently.
        if(local is null||local.Path!=baseline.Path||state.BinaryRevisions.GetValueOrDefault(remote.ItemId)==remote.Revision||
           baseline.Lifecycle!=remote.Lifecycle||state.BinaryOutbox.Any(x=>x.ItemId==remote.ItemId)||
           !state.BinaryBaselines.TryGetValue(remote.ItemId,out var known))return;
        SharedEditingStore.RecoverPendingBinaryProjection(store,remote.ItemId);
        local=store.Describe(baseline.Path);
        var manifest=await transport.BinaryManifestAsync(remote.ItemId,ct);
        if(manifest.Revision!=remote.Revision||manifest.Entries.Length>10000||manifest.Entries.Any(x=>x.Size<0||x.Size>16*1024*1024||
           !System.Text.RegularExpressions.Regex.IsMatch(x.Sha256,@"^[0-9a-f]{64}$")))return;
        var remoteHashes=manifest.Entries.ToDictionary(x=>x.Path,x=>x.Sha256,StringComparer.Ordinal);
        foreach(var entryPath in known.Keys.Union(remoteHashes.Keys,StringComparer.Ordinal).OrderBy(x=>x,StringComparer.Ordinal)) {
            known.TryGetValue(entryPath,out var prior);remoteHashes.TryGetValue(entryPath,out var target);
            if(prior==target)continue;
            var current=BinaryEntryPacks.Assets(store.Read(local.Path));
            var localHash=current.GetValueOrDefault(entryPath)?.Sha256;
            if(localHash!=prior&&localHash!=target) {
                var remotePack=await transport.DownloadAsync(remote.ItemId,ct);
                if(TextPackStore.Hash(remotePack.Data)!=remotePack.Revision)throw new InvalidDataException("Remote conflict pack changed during download.");
                ResolveBinaryConflict(state,local,baseline,entryPath,remote,remotePack);
                return;
            }
            var beforeHash=local.Hash;var materialized=false;
            if(localHash!=target) {
                var bytes=target is null?null:await transport.BinaryReadAsync(remote.ItemId,entryPath,ct);
                if(bytes is not null&&(bytes.Length>16*1024*1024||TextPackStore.Hash(bytes)!=target))throw new InvalidDataException("Remote binary entry changed during download.");
                local=SharedEditingStore.ApplyRemoteBinary(store,remote.ItemId,local.Path,local.Hash,entryPath,prior,bytes);materialized=true;
            }
            if(target is null)known.Remove(entryPath);else known[entryPath]=target;
            var incorporated=state.Items[remote.ItemId];
            if(materialized)state.Items[remote.ItemId]=MaterializedBinaryBaseline(incorporated,beforeHash,local.Hash,remote.Revision);
            Save(state);
        }
        state.BinaryRevisions[remote.ItemId]=remote.Revision;Save(state);
    }
    string? StateError(State state)=>state.Outbox.Any(op=>deferredQueuedUploadPaths.Contains(op.Id))?"A queued file update needs review before its path can change. Your file is kept on this device.":state.ProtectedRenames.Values.Any(op=>op.Phase==ProtectedSavedRename.Phase.TerminalRejected)?"A saved file move needs review. Its local file and server result are retained.":state.ProtectedRenames.Values.Any(op=>op.Phase==ProtectedSavedRename.Phase.Pending)?"A saved file move is waiting for its server receipt. Your file is kept on this device.":state.SharedRenames.Count>0?"A saved file move needs review. Its original command and local file are retained.":state.BinaryOutbox.Any(x=>x.Conflicted)?"An attachment changed on another device. The local file is kept for resolution.":state.Outbox.Any(x=>x.Conflicted)?"Some documents have conflicting changes. Both copies are retained.":store.LastScanErrors.Count>0?"Some files are temporarily unavailable or invalid. Other files continue syncing.":null;
    bool HasLocalWork(State state,Dictionary<string,PackFile> local) {
        if(state.ProtectedRenames.Values.Any(op=>op.Phase==ProtectedSavedRename.Phase.Pending))return true;
        if(state.SharedRenames.Values.Any(op=>!op.Conflicted&&Permitted(state,op)))return true;
        if(state.BinaryOutbox.Any(x=>!x.Conflicted && state.Capabilities?.CanWrite(x.ItemId,state.Items.GetValueOrDefault(x.ItemId)?.Path??"",true)!=false))return true;
        if(state.Outbox.Any(op=>!op.Conflicted&&!IsEditing(op.ItemId)))return true;
        foreach(var file in local.Values) {
            if(state.ProtectedRenames.TryGetValue(file.ItemId,out var retained)&&retained.Phase!=ProtectedSavedRename.Phase.Pending) {
                if(retained.Phase==ProtectedSavedRename.Phase.Stopped&&retained.Resolution?.LocalPath!=file.Path)return true;
                continue;
            }
            if(state.SharedRenames.ContainsKey(file.ItemId))continue;
            if(IsEditing(file.ItemId)) {
                if(state.Items.TryGetValue(file.ItemId,out var pathBase)&&file.Path!=pathBase.Path&&
                   !(state.SharedRenames.TryGetValue(file.ItemId,out var fencedRename)&&fencedRename.Conflicted))return true;
                if(state.BinaryBaselines.TryGetValue(file.ItemId,out var entryHashes) && state.Items.TryGetValue(file.ItemId,out var openBase) && file.Hash!=openBase.Hash) {
                    try {
                        var entries=BinaryEntryPacks.Assets(store.Read(file.Path));
                        if(entries.Count!=entryHashes.Count || entries.Any(x=>entryHashes.GetValueOrDefault(x.Key)!=x.Value.Sha256))return true;
                    } catch(IOException) { continue; } catch(UnauthorizedAccessException) { continue; }
                }
                continue;
            }
            if(Blocked(state,file.ItemId))continue;
            if(!state.Items.TryGetValue(file.ItemId,out var baseline)||baseline.Refresh||baseline.Hash!=file.Hash||baseline.Path!=file.Path)return true;
        }
        foreach(var item in state.Items)if(!local.ContainsKey(item.Key)&&!IsEditing(item.Key)&&!Blocked(state,item.Key)&&store.Intent(item.Key)?.Kind=="delete")return true;
        return false;
    }
    public async Task<WorkspaceCapabilities?> CapabilitiesAsync(CancellationToken ct=default) {await gate.WaitAsync(ct);try{return Load().Capabilities;}finally{gate.Release();}}
    public async Task<IReadOnlyDictionary<string,bool>> FilePermissionsAsync(IEnumerable<PackFile> files,bool ownerFallback=false,CancellationToken ct=default)
    {
        await gate.WaitAsync(ct);
        try {
            var state=Load();
            return files.ToDictionary(file=>file.ItemId,file=>state.Capabilities?.CanWrite(file.ItemId,file.Path,
                state.Items.ContainsKey(file.ItemId)||state.Outbox.Any(op=>op.ItemId==file.ItemId&&op.Revision is not null)) ?? ownerFallback);
        } finally {gate.Release();}
    }
    void RememberCapabilities(State state) {if(transport.Capabilities is {} current && JsonSerializer.Serialize(state.Capabilities)!=JsonSerializer.Serialize(current)){state.Capabilities=current;Save(state);CapabilitiesChanged?.Invoke();}}
    static bool Permitted(State state,Operation op) => state.Capabilities is null || state.Capabilities.CanWrite(op.ItemId,op.Path,op.Revision is not null) && (op.Kind is not ("rename" or "delete") || state.Capabilities.FullAccess && state.Capabilities.CanCreateContent) && (op.Kind!="rename" || state.Capabilities.CanCreate(op.Destination!));
    void QueueUpload(State state,PackFile file,string? revision) {
        var bytes=store.Read(file.Path);if(TextPackStore.Hash(bytes)!=file.Hash) throw new FileChangedException();
        Queue(state,new(Guid.NewGuid().ToString(),"upload",file.ItemId,file.Path,null,revision,file.Hash,Convert.ToBase64String(bytes)));
    }
    void Queue(State state,Operation operation) {state.Outbox.Add(operation with {Lifecycle=state.Items.GetValueOrDefault(operation.ItemId)?.Lifecycle});Save(state);}
    async Task Drain(State state,CancellationToken ct) {
        var captured=state.Outbox.Where(op=>!deferredQueuedUploadPaths.Contains(op.Id)).ToArray();
        var candidates=captured.Select(op=>new MirrorQueueCandidate(op.Id,op.Conflicted,IsEditing(op.ItemId),store.ReplacementBlocked(op.ItemId)||SavedRenameOwnsPath(state,op.ItemId),Permitted(state,op))).ToArray();
        var selection=await mirrorPolicy!.QueueAsync(new(candidates,remainingQueueBudget),ct);
        // Capabilities can change while the page evaluates the captured queue.
        // Publish the current snapshot before any selected operation is sent.
        RememberCapabilities(state);
        HasEligiblePending=HasEligiblePending||selection.HasMore;
        var selected=selection.OperationIds.ToHashSet(StringComparer.Ordinal);
        foreach(var op in captured.Where(op=>selected.Contains(op.Id))) {
            // Keep the captured durable operation unchanged. A reply cannot
            // authorize a replaced journal, editor lease or permission grant.
            ct.ThrowIfCancellationRequested();
            if(deferredQueuedUploadPaths.Contains(op.Id)||!state.Outbox.Contains(op)||op.Conflicted||IsEditing(op.ItemId)||SavedRenameOwnsPath(state,op.ItemId)||store.ReplacementBlocked(op.ItemId)||!Permitted(state,op))continue;
            remainingQueueBudget--;string? revision=null;
            try {
                store.AssertReplacementReadable(op.ItemId);
                if(op.Kind=="upload") revision=await transport.UploadAsync(op.ItemId,op.Path,Convert.FromBase64String(op.Payload!),op.Revision,op.Id,ct);
                else if(op.Kind=="rename") revision=await transport.RenameAsync(op.ItemId,op.Path,op.Destination!,op.Revision!,op.Id,ct);
                else if(op.Kind=="delete") await transport.DeleteAsync(op.ItemId,op.Path,op.Revision!,op.Id,ct);
                else throw new InvalidDataException("Unknown durable sync operation.");
                store.AssertReplacementReadable(op.ItemId);
            } catch(SyncConflictException) {
                if(op.Payload!=null)store.Preserve(Convert.FromBase64String(op.Payload),"conflict");
                state.Outbox[state.Outbox.IndexOf(op)]=op with{Conflicted=true};Save(state);
                try {var remote=await transport.DownloadAsync(op.ItemId,ct);store.Preserve(remote.Data,"remote-conflict");}
                catch(HttpRequestException error)when(error.StatusCode is System.Net.HttpStatusCode.NotFound or System.Net.HttpStatusCode.Forbidden) { /* A tombstone or revoked item cannot provide remote bytes. Keep the local recovery and fence. */ }
                continue;
            }
            if(op.Kind=="delete") state.Items.Remove(op.ItemId);
            else state.Items[op.ItemId]=new(op.Destination??op.Path,op.Hash,revision!,op.Kind=="upload",op.Lifecycle);
            state.Outbox.Remove(op);Save(state);if(op.Kind!="upload")store.ClearIntent(op.ItemId);
        }
    }
    static string? ReadLifecycle(byte[] bytes) {
        using var archive=new ZipArchive(new MemoryStream(bytes),ZipArchiveMode.Read);
        var entry=archive.GetEntry("texttext-lifecycle.json");if(entry==null)return null;
        if(entry.Length>4096)throw new InvalidDataException("Invalid lifecycle marker.");
        using var stream=entry.Open();using var document=JsonDocument.Parse(stream);
        var value=document.RootElement;
        if(value.GetProperty("version").GetInt32()!=1)throw new InvalidDataException("Invalid lifecycle version.");
        var generation=value.GetProperty("generation").GetString();if(string.IsNullOrEmpty(generation))throw new InvalidDataException("Invalid lifecycle marker.");return generation;
    }
    async Task Pull(State state,string id,PackFile? local,CancellationToken ct,string? lifecycle=null,string? expectedRevision=null) {
        store.AssertReplacementReadable(id);
        var pack=await transport.DownloadAsync(id,ct);if(TextPackStore.Identity(pack.Data)!=id) throw new InvalidDataException("Remote identity mismatch.");
        var packedLifecycle=ReadLifecycle(pack.Data);if(packedLifecycle!=null)lifecycle=packedLifecycle;
        else if(lifecycle!=null&&pack.Revision!=expectedRevision) {var latest=(await transport.ManifestAsync(ct)).SingleOrDefault(x=>x.ItemId==id&&!x.Deleted);if(latest==null||latest.Revision!=pack.Revision||latest.RelativePath!=pack.RelativePath)throw new FileChangedException();lifecycle=latest.Lifecycle;}
        store.AssertReplacementReadable(id);
        state.PendingPull=new(id,pack.RelativePath,local?.Path,local?.Hash,pack.Revision,Convert.ToBase64String(pack.Data),lifecycle??state.Items.GetValueOrDefault(id)?.Lifecycle);Save(state);ApplyPull(state);
    }
    void ApplyPull(State state) {
        var pending=state.PendingPull!;store.AssertReplacementReadable(pending.ItemId);var bytes=Convert.FromBase64String(pending.Payload);var hash=TextPackStore.Hash(bytes);
        var target=store.Resolve(pending.Path);
        try {
            if(!File.Exists(target) || TextPackStore.Hash(store.Read(pending.Path))!=hash) {
                if(pending.OldPath!=null && pending.OldPath!=pending.Path && File.Exists(store.Resolve(pending.OldPath))) {
                    if(File.Exists(target))throw new FileChangedException();
                    store.Rename(pending.OldPath,pending.Path,pending.ExpectedHash!);
                }
                store.Write(pending.Path,bytes,pending.ExpectedHash);
            }
        }catch(FileChangedException) {
            store.Preserve(bytes,"remote-conflict");
            if(File.Exists(target))store.Preserve(store.Read(pending.Path),"conflict");
            if(pending.OldPath!=null&&pending.OldPath!=pending.Path&&File.Exists(store.Resolve(pending.OldPath)))store.Preserve(store.Read(pending.OldPath),"conflict");
            state.Outbox.Add(new(Guid.NewGuid().ToString(),"conflict",pending.ItemId,pending.Path,null,pending.Revision,hash,pending.Payload,true));state.PendingPull=null;Save(state);return;
        }
        state.Items[pending.ItemId]=new(pending.Path,hash,pending.Revision,Lifecycle:pending.Lifecycle);state.PendingPull=null;Save(state);store.ClearIntent(pending.ItemId);
    }
}
