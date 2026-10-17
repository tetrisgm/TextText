using System.Text.Json;
using System.IO.Compression;
namespace TextText.Core;
public sealed record RemoteItem(string ItemId,string RelativePath,string Revision,bool Deleted=false,string? Lifecycle=null,string? RestoreFromRevision=null,bool? CanEditContent=null);
public sealed record RemotePack(byte[] Data,string RelativePath,string Revision);
public sealed record RemoteBinaryEntry(string Path,string Sha256,int Size);
public sealed record RemoteBinaryManifest(string Revision,RemoteBinaryEntry[] Entries);
public interface ISyncTransport
{
    IReadOnlyList<string> Folders => [];
    IReadOnlyList<string>? AuthoritativeFolders => null;
    WorkspaceCapabilities? Capabilities => null;
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
public sealed class SyncEngine
{
    public sealed record Baseline(string Path,string Hash,string Revision,bool Refresh=false,string? Lifecycle=null);
    public sealed record Operation(string Id,string Kind,string ItemId,string Path,string? Destination,string? Revision,string Hash,string? Payload,bool Conflicted=false,string? Lifecycle=null);
    public sealed record Incoming(string ItemId,string Path,string? OldPath,string? ExpectedHash,string Revision,string Payload,string? Lifecycle=null);
    public sealed record BinaryPending(string Id,string ItemId,string EntryPath,string? ExpectedHash,string? Lifecycle,string? BytesBase64,string SourceHash,bool Conflicted=false,string? PayloadHash=null);
    public sealed class State { public string? AccountId {get;set;} [System.Text.Json.Serialization.JsonExtensionData] public Dictionary<string,JsonElement>? AdditionalData {get;set;} public WorkspaceCapabilities? Capabilities {get;set;} public List<string>? ManagedFolders {get;set;} public Incoming? PendingPull {get;set;} public int Version {get;set;}=1; public Dictionary<string,Baseline> Items {get;set;}=[]; public List<Operation> Outbox {get;set;}=[]; public Dictionary<string,Dictionary<string,string>> BinaryBaselines {get;set;}=[]; public Dictionary<string,string> BinaryRevisions {get;set;}=[]; public List<BinaryPending> BinaryOutbox {get;set;}=[]; }
    readonly HashSet<string> collaborating=[];
    readonly WorkspaceWriterOwnership workspaceOwnership;
    readonly TextPackStore store; readonly ISyncTransport transport; readonly SemaphoreSlim gate=new(1,1); readonly string statePath; readonly string? accountId;
    public SyncStatus Status {get;private set;}=new(false,null,0);
    public event Action<SyncStatus>? StatusChanged;
    public event Action? DurabilityChanged;
    public event Action? CapabilitiesChanged;
    public SyncEngine(TextPackStore store,ISyncTransport transport,string? accountId=null) {
        if(accountId is not null && !System.Text.RegularExpressions.Regex.IsMatch(accountId,@"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\z"))throw new InvalidDataException("Invalid account identity.");
        this.store=store;this.transport=transport;this.accountId=accountId;statePath=Path.Combine(store.StateDirectory,"sync.json");
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
        await gate.WaitAsync(ct);try {workspaceLease=workspaceOwnership.Acquire();var state=Load();if(state.Outbox.Any(x=>x.ItemId==itemId)||state.PendingPull?.ItemId==itemId)throw new IOException("Pending file sync must finish before joining shared editing.");
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
            var state=Load();
            var candidates=new[]{state.Items.GetValueOrDefault(itemId)?.Path,path}.Where(value=>value!=null).Distinct().ToArray();
            PackFile? current=null;
            foreach(var candidate in candidates) {
                if(!File.Exists(store.Resolve(candidate!)))continue;
                var observed=store.Describe(candidate!);
                if(observed.ItemId==itemId&&observed.Hash==hash){current=observed;break;}
            }
            if(current==null)throw new FileChangedException();path=current.Path;
            if(state.Outbox.Any(x=>x.ItemId==itemId)||state.PendingPull?.ItemId==itemId)throw new IOException("Pending file changes must synchronize before joining collaboration.");
            state.Items[itemId]=new(path,hash,revision,Lifecycle:state.Items.GetValueOrDefault(itemId)?.Lifecycle);Save(state);
    }
    public async Task ReconcileRestoredAsync(string itemId,string path,string lifecycle,CancellationToken ct=default) {
        await SyncAsync(ct);await gate.WaitAsync(ct);try {
            var state=Load();var baseline=state.Items.GetValueOrDefault(itemId);
            if(baseline==null||baseline.Path!=path||baseline.Lifecycle!=lifecycle||state.Outbox.Any(x=>x.ItemId==itemId)||IsEditing(itemId))throw new FileChangedException();
            var file=store.Describe(path);if(file.ItemId!=itemId||file.Hash!=baseline.Hash)throw new FileChangedException();
        }finally{gate.Release();}
    }
    public async Task<bool> IsReadyAsync(string itemId,CancellationToken ct=default) {
        await gate.WaitAsync(ct);try {var state=Load();if(state.Outbox.Any(x=>x.ItemId==itemId)||state.PendingPull?.ItemId==itemId)return false;if(SharedEditingStore.HasReadyCheckpoint(store,itemId))return true;if(SharedEditingStore.HasProtectedState(store.StateDirectory,itemId))return false;
            if(!state.Items.TryGetValue(itemId,out var baseline))return false;try{var file=store.Describe(baseline.Path);return file.ItemId==itemId&&file.Hash==baseline.Hash&&!baseline.Refresh;}catch(IOException){return false;}
        }finally{gate.Release();}
    }
    public async Task<string?> BaselineRevisionAsync(string itemId,CancellationToken ct=default) {await gate.WaitAsync(ct);try{return Load().Items.GetValueOrDefault(itemId)?.Revision;}finally{gate.Release();}}
    static bool Blocked(State state,string id)=>state.Outbox.Any(x=>x.ItemId==id);
    State Load() { AccountRootOwnership.RequireNoAdoption(store.StateDirectory); if(!File.Exists(statePath)) return new(){AccountId=accountId}; var result=JsonSerializer.Deserialize<State>(File.ReadAllBytes(statePath)) ?? throw new InvalidDataException("Invalid sync state."); if(result.Version!=1) throw new InvalidDataException("This workspace was used by a newer app. Update TextText."); if(result.AccountId!=accountId)throw new SharedAccountMismatchException(); return result; }
    void Save(State state) {
        var bytes=JsonSerializer.SerializeToUtf8Bytes(state);
        if(File.Exists(statePath)&&File.ReadAllBytes(statePath).AsSpan().SequenceEqual(bytes))return;
        TextPackStore.AtomicWrite(statePath,bytes);DurabilityChanged?.Invoke();
    }
    string BinaryPayloadPath(string operationId) {
        if(!Guid.TryParse(operationId,out _))throw new InvalidDataException("Invalid binary operation.");
        return Path.Combine(store.StateDirectory,"binary-outbox",operationId+".asset");
    }
    byte[]? BinaryPayload(BinaryPending pending) {
        if(pending.PayloadHash is null)return pending.BytesBase64 is null?null:Convert.FromBase64String(pending.BytesBase64);
        var path=BinaryPayloadPath(pending.Id);
        if(new FileInfo(path).Length>16*1024*1024)throw new InvalidDataException("Binary payload exceeds bounds.");
        var bytes=File.ReadAllBytes(path);
        if(TextPackStore.Hash(bytes)!=pending.PayloadHash)throw new InvalidDataException("Binary payload changed during recovery.");
        return bytes;
    }
    void Report(bool running,string? error,int pending) { Status=new(running,error,pending);StatusChanged?.Invoke(Status); }
    public async Task SyncAsync(CancellationToken cancellation=default,bool localChangesOnly=false)
    {
        if(!await gate.WaitAsync(0,cancellation)) return;
        State? state=null;
        try {
            // The existing sync lock also fences foreign active editors. This
            // engine may mirror assets/paths while retaining its own editors.
            using var fileLock=workspaceOwnership.Acquire();
            state=Load();var acknowledged=SharedEditingStore.ReconcileAcknowledgements(store,state);if(acknowledged.Count>0){Save(state);foreach(var file in acknowledged)File.Delete(file);}
            Report(true,null,state.Outbox.Count);
            var local=store.Scan().ToDictionary(x=>x.ItemId);
            if(localChangesOnly&&state.PendingPull==null&&!HasLocalWork(state,local)) {Report(false,StateError(state),state.Outbox.Count);return;}
            var remote=(await transport.ManifestAsync(cancellation)).ToDictionary(x=>x.ItemId);
            if(state.PendingPull is {} incoming && remote.TryGetValue(incoming.ItemId,out var incomingRemote) && incomingRemote.Lifecycle!=null && incomingRemote.Lifecycle!=incoming.Lifecycle) {store.Preserve(Convert.FromBase64String(incoming.Payload),"previous-lifecycle");state.PendingPull=null;Save(state);}
            if(state.PendingPull!=null) {if(IsEditing(state.PendingPull.ItemId)){Report(false,null,state.Outbox.Count);return;}ApplyPull(state);}
            local=store.Scan().ToDictionary(x=>x.ItemId);
            RememberCapabilities(state);
            ReconcileLifecycles(state,local,remote);
            RecoverMetadataAdoption(state,local,remote);
            AdoptQueuedUploadPaths(state,local,remote);
            RetrySupersededUploads(state,local,remote);
            local=store.Scan().ToDictionary(x=>x.ItemId);
            var hadPendingWrites=state.Outbox.Any(x=>!x.Conflicted&&!IsEditing(x.ItemId)&&Permitted(state,x));
            await Drain(state,cancellation);
            if(hadPendingWrites) {remote=(await transport.ManifestAsync(cancellation)).ToDictionary(x=>x.ItemId);RememberCapabilities(state);}
            if(transport.Folders.Count>20000)throw new IOException("Too many workspace folders.");
            if(transport.AuthoritativeFolders is {} catalog) {
                if(catalog.Count>20000)throw new IOException("Too many workspace folders.");
                foreach(var folder in catalog)store.ValidateManagedFolder(folder);
                var updated=(state.ManagedFolders??[]).Union(catalog,StringComparer.Ordinal).OrderBy(x=>x,StringComparer.Ordinal).ToList();
                if(updated.Count>40000)throw new IOException("Too many retained workspace folders.");
                if(state.ManagedFolders==null||!state.ManagedFolders.SequenceEqual(updated)){state.ManagedFolders=updated;Save(state);}
            }
            var folderError=false;
            foreach(var folder in transport.Folders)try{store.EnsureFolders([folder]);}catch(IOException){folderError=true;}catch(UnauthorizedAccessException){folderError=true;}
            foreach(var pair in state.Items.ToArray()) {
                cancellation.ThrowIfCancellationRequested();var id=pair.Key;
                if(!IsEditing(id) && state.BinaryOutbox.Any(x=>x.ItemId==id)) {
                    if(remote.TryGetValue(id,out var binaryRemote) && !binaryRemote.Deleted)
                        await SyncOpenBinary(state,local.GetValueOrDefault(id),pair.Value,binaryRemote,cancellation);
                    continue;
                }
                if(IsEditing(id)) {
                    if(!Blocked(state,id)&&state.PendingPull?.ItemId!=id&&remote.TryGetValue(id,out var relocated)&&!relocated.Deleted&&
                       local.TryGetValue(id,out var projection)&&projection.Path!=relocated.RelativePath&&SharedEditingStore.HasReadyCheckpoint(store,id)) {
                        var moved=SharedEditingStore.RebaseProjection(store,id,relocated.RelativePath);
                        state.Items[id]=pair.Value with{Path=moved.Path};Save(state);store.ClearIntent(id);
                        local[id]=store.Describe(moved.Path);
                    }
                    if(!Blocked(state,id)&&state.PendingPull?.ItemId!=id && remote.TryGetValue(id,out var binaryRemote) && !binaryRemote.Deleted &&
                       state.Items.TryGetValue(id,out var binaryBase)) {
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
                if(server is { Deleted:true }) {
                    if(file.Hash!=baseline.Hash) { store.Preserve(store.Read(file.Path),"conflict");Queue(state,new(Guid.NewGuid().ToString(),"conflict",id,file.Path,null,baseline.Revision,file.Hash,null,true));continue; }
                    store.Delete(file.Path,file.Hash);state.Items.Remove(id);Save(state);store.ClearIntent(id);local.Remove(id);continue;
                }
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
                if(file.Hash!=baseline.Hash) { QueueUpload(state,file,baseline.Revision);await Drain(state,cancellation); }
                else if(baseline.Refresh || server.Revision!=baseline.Revision || server.RelativePath!=file.Path) await Pull(state,id,file,cancellation,server.Lifecycle,server.Revision);
            }
            foreach(var file in local.Values.Where(x=>!state.Items.ContainsKey(x.ItemId))) {
                if(IsEditing(file.ItemId)||Blocked(state,file.ItemId))continue;
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
            foreach(var item in remote.Values.Where(x=>!store.LastScanErrors.Any(e=>e.ItemId==x.ItemId||e.Path=="."||e.Path==x.RelativePath||x.RelativePath.StartsWith(e.Path+"/",StringComparison.OrdinalIgnoreCase)) && !IsEditing(x.ItemId) && !Blocked(state,x.ItemId) && !x.Deleted && !local.ContainsKey(x.ItemId) && !state.Items.ContainsKey(x.ItemId))) await Pull(state,item.ItemId,null,cancellation,item.Lifecycle,item.Revision);
            foreach(var pending in state.Items.Where(x=>x.Value.Refresh).ToArray()) { if(IsEditing(pending.Key)||Blocked(state,pending.Key))continue;var current=store.Describe(pending.Value.Path); if(current.Hash==pending.Value.Hash) await Pull(state,pending.Key,current,cancellation,remote.GetValueOrDefault(pending.Key)?.Lifecycle,remote.GetValueOrDefault(pending.Key)?.Revision); }
            if(transport.AuthoritativeFolders is {} currentCatalog) {
                var retained=new HashSet<string>(currentCatalog,StringComparer.Ordinal);
                foreach(var folder in (state.ManagedFolders??[]).Where(x=>!retained.Contains(x)).OrderByDescending(x=>x.Length).ToArray()) {
                    try {if(!store.RemoveEmptyManagedFolder(folder))retained.Add(folder);}catch(IOException){retained.Add(folder);}catch(UnauthorizedAccessException){retained.Add(folder);}
                }
                var updated=retained.OrderBy(x=>x,StringComparer.Ordinal).ToList();
                if(state.ManagedFolders==null||!state.ManagedFolders.SequenceEqual(updated)){state.ManagedFolders=updated;Save(state);}
            }
            Report(false,StateError(state)??(folderError?"A workspace folder could not be opened. Other files continue syncing.":null),state.Outbox.Count);
        } catch(Exception error) { Report(false,error.Message,state?.Outbox.Count??0);throw; } finally {gate.Release();}
    }
    void AdoptQueuedUploadPaths(State state,Dictionary<string,PackFile> local,Dictionary<string,RemoteItem> remote) {
        foreach(var op in state.Outbox.ToArray()) {
            // A path-only remote move cannot invalidate queued content. Never
            // change a receipt identity: the replacement is a new command.
            if(op.Kind!="upload"||op.Conflicted||op.Revision==null||IsEditing(op.ItemId)
                ||state.Outbox.Count(x=>x.ItemId==op.ItemId)!=1
                ||!remote.TryGetValue(op.ItemId,out var server)||server.Deleted
                ||server.RelativePath==op.Path||server.Revision!=op.Revision
                ||server.Lifecycle!=op.Lifecycle
                ||!state.Items.TryGetValue(op.ItemId,out var baseline)
                ||!local.TryGetValue(op.ItemId,out var file)
                ||(file.Path!=op.Path&&file.Path!=server.RelativePath)
                ||(baseline.Path!=op.Path&&baseline.Path!=server.RelativePath))continue;
            var replacement=op with{Id=Guid.NewGuid().ToString(),Path=server.RelativePath};
            if(!Permitted(state,replacement))continue;
            var intent=store.Intent(op.ItemId);
            if(intent!=null&&(intent.Kind!="rename"||file.Path!=server.RelativePath))continue;
            if(file.Path!=server.RelativePath)store.Rename(file.Path,server.RelativePath,file.Hash);
            state.Outbox[state.Outbox.IndexOf(op)]=replacement;
            state.Items[op.ItemId]=baseline with{Path=server.RelativePath};
            Save(state);store.ClearIntent(op.ItemId);
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
    void ReconcileLifecycles(State state,Dictionary<string,PackFile> local,Dictionary<string,RemoteItem> remote) {
        foreach(var item in remote.Values.Where(x=>!x.Deleted&&x.Lifecycle!=null)) {
            if(IsEditing(item.ItemId))continue;
            if(state.Items.TryGetValue(item.ItemId,out var known)&&known.Lifecycle==null&&known.Revision==item.Revision)state.Items[item.ItemId]=known with{Lifecycle=item.Lifecycle};
            for(var index=0;index<state.Outbox.Count;index++){var op=state.Outbox[index];if(op.ItemId==item.ItemId&&op.Lifecycle==null&&op.Revision==item.Revision)state.Outbox[index]=op with{Lifecycle=item.Lifecycle};}
            Save(state);
            var stale=state.Outbox.Where(x=>x.ItemId==item.ItemId&&x.Lifecycle!=item.Lifecycle).ToArray();
            foreach(var op in stale) {
                if(op.Kind=="delete") {
                    state.Outbox.Remove(op);Save(state);
                    var intent=store.Intent(item.ItemId);
                    if(intent?.Kind=="delete"&&intent.Path==op.Path&&intent.Hash==op.Hash)store.ClearIntent(item.ItemId);
                } else if(!op.Conflicted) {
                    if(op.Payload!=null)store.Preserve(Convert.FromBase64String(op.Payload),"previous-lifecycle");
                    state.Outbox[state.Outbox.IndexOf(op)]=op with{Conflicted=true};Save(state);
                }
            }
            if(state.Items.TryGetValue(item.ItemId,out var baseline)&&baseline.Lifecycle!=item.Lifecycle&&!local.ContainsKey(item.ItemId)&&!state.Outbox.Any(x=>x.ItemId==item.ItemId)) {
                var intent=store.Intent(item.ItemId);
                if(intent!=null && (intent.Kind!="delete"||intent.Path!=baseline.Path||intent.Hash!=baseline.Hash))continue;
                state.Items.Remove(item.ItemId);Save(state);
                if(intent!=null)store.ClearIntent(item.ItemId);
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
    async Task SyncOpenBinary(State state,PackFile? local,Baseline baseline,RemoteItem remote,CancellationToken ct) {
        var pending=state.BinaryOutbox.FirstOrDefault(x=>x.ItemId==remote.ItemId);
        if(pending is {Conflicted:true})return;
        if(baseline.Lifecycle!=remote.Lifecycle) {
            if(pending is not null && local is not null) {
                var localPack=store.Read(local.Path);
                if(TextPackStore.Hash(localPack)!=local.Hash)throw new InvalidDataException("Local conflict pack changed during read.");
                var remotePack=await transport.DownloadAsync(remote.ItemId,ct);
                if(TextPackStore.Hash(remotePack.Data)!=remotePack.Revision)throw new InvalidDataException("Remote conflict pack changed during download.");
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
                PayloadHash:payload is null?null:TextPackStore.Hash(payload));
            state.BinaryOutbox.Add(pending);Save(state); // Exact bytes and operation ID are durable before network I/O.
        }
        try {
            var bytes=BinaryPayload(pending);
            var revision=await transport.BinaryPatchAsync(pending.ItemId,pending.Id,pending.EntryPath,pending.ExpectedHash,pending.Lifecycle,
                bytes,ct);
            if(!state.BinaryBaselines.TryGetValue(pending.ItemId,out var hashes))throw new InvalidDataException("Binary baseline is missing.");
            if(bytes is null)hashes.Remove(pending.EntryPath);
            else hashes[pending.EntryPath]=TextPackStore.Hash(bytes);
            var latest=local is null?null:store.Describe(local.Path);
            var latestAssets=latest?.ItemId==pending.ItemId?BinaryEntryPacks.Assets(store.Read(latest.Path)):null;
            var locallyCurrent=latestAssets is not null && latestAssets.Count==hashes.Count &&
                latestAssets.All(x=>hashes.GetValueOrDefault(x.Key)==x.Value.Sha256);
            state.Items[pending.ItemId]=baseline with{Revision=revision,Hash=locallyCurrent?latest!.Hash:baseline.Hash};
            state.BinaryRevisions[pending.ItemId]=revision;
            state.BinaryOutbox.Remove(pending);Save(state);
            if(pending.PayloadHash is not null)try{File.Delete(BinaryPayloadPath(pending.Id));}catch(IOException){}
        } catch(SyncConflictException) {
            var remotePack=await transport.DownloadAsync(pending.ItemId,ct);
            if(TextPackStore.Hash(remotePack.Data)!=remotePack.Revision)throw new InvalidDataException("Remote conflict pack changed during download.");
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
        state.Items[remote.ItemId]=baseline with{Hash=updated.Hash,Revision=remotePack.Revision};
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
            if(localHash!=target) {
                var bytes=target is null?null:await transport.BinaryReadAsync(remote.ItemId,entryPath,ct);
                if(bytes is not null&&(bytes.Length>16*1024*1024||TextPackStore.Hash(bytes)!=target))throw new InvalidDataException("Remote binary entry changed during download.");
                local=SharedEditingStore.ApplyRemoteBinary(store,remote.ItemId,local.Path,local.Hash,entryPath,prior,bytes);
            }
            if(target is null)known.Remove(entryPath);else known[entryPath]=target;
            state.Items[remote.ItemId]=baseline with{Hash=local.Hash,Revision=remote.Revision};Save(state);
        }
        state.BinaryRevisions[remote.ItemId]=remote.Revision;Save(state);
    }
    string? StateError(State state)=>state.BinaryOutbox.Any(x=>x.Conflicted)?"An attachment changed on another device. The local file is kept for resolution.":state.Outbox.Any(x=>x.Conflicted)?"Some documents have conflicting changes. Both copies are retained.":store.LastScanErrors.Count>0?"Some files are temporarily unavailable or invalid. Other files continue syncing.":null;
    bool HasLocalWork(State state,Dictionary<string,PackFile> local) {
        if(state.BinaryOutbox.Any(x=>!x.Conflicted && state.Capabilities?.CanWrite(x.ItemId,state.Items.GetValueOrDefault(x.ItemId)?.Path??"",true)!=false))return true;
        if(state.Outbox.Any(op=>!op.Conflicted&&!IsEditing(op.ItemId)))return true;
        foreach(var file in local.Values) {
            if(IsEditing(file.ItemId)) {
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
        while(state.Outbox.Any(x=>!x.Conflicted&&!IsEditing(x.ItemId)&&Permitted(state,x))) {
            var op=state.Outbox.First(x=>!x.Conflicted&&!IsEditing(x.ItemId)&&Permitted(state,x));string? revision=null;
            try {
                if(op.Kind=="upload") revision=await transport.UploadAsync(op.ItemId,op.Path,Convert.FromBase64String(op.Payload!),op.Revision,op.Id,ct);
                else if(op.Kind=="rename") revision=await transport.RenameAsync(op.ItemId,op.Path,op.Destination!,op.Revision!,op.Id,ct);
                else if(op.Kind=="delete") await transport.DeleteAsync(op.ItemId,op.Path,op.Revision!,op.Id,ct);
                else throw new InvalidDataException("Unknown durable sync operation.");
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
        var pack=await transport.DownloadAsync(id,ct);if(TextPackStore.Identity(pack.Data)!=id) throw new InvalidDataException("Remote identity mismatch.");
        var packedLifecycle=ReadLifecycle(pack.Data);if(packedLifecycle!=null)lifecycle=packedLifecycle;
        else if(lifecycle!=null&&pack.Revision!=expectedRevision) {var latest=(await transport.ManifestAsync(ct)).SingleOrDefault(x=>x.ItemId==id&&!x.Deleted);if(latest==null||latest.Revision!=pack.Revision||latest.RelativePath!=pack.RelativePath)throw new FileChangedException();lifecycle=latest.Lifecycle;}
        state.PendingPull=new(id,pack.RelativePath,local?.Path,local?.Hash,pack.Revision,Convert.ToBase64String(pack.Data),lifecycle??state.Items.GetValueOrDefault(id)?.Lifecycle);Save(state);ApplyPull(state);
    }
    void ApplyPull(State state) {
        var pending=state.PendingPull!;var bytes=Convert.FromBase64String(pending.Payload);var hash=TextPackStore.Hash(bytes);
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
