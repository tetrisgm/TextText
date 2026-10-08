using System.Text.Json;
using System.IO.Compression;
namespace TextText.Core;
public sealed record RemoteItem(string ItemId,string RelativePath,string Revision,bool Deleted=false,string? Lifecycle=null,string? RestoreFromRevision=null,bool? CanEditContent=null);
public sealed record RemotePack(byte[] Data,string RelativePath,string Revision);
public interface ISyncTransport
{
    IReadOnlyList<string> Folders => [];
    WorkspaceCapabilities? Capabilities => null;
    Task<IReadOnlyList<RemoteItem>> ManifestAsync(CancellationToken cancellation=default);
    Task<RemotePack> DownloadAsync(string itemId,CancellationToken cancellation=default);
    Task<string> UploadAsync(string itemId,string path,byte[] data,string? baseRevision,string operationId,CancellationToken cancellation=default);
    Task<string> RenameAsync(string itemId,string from,string to,string baseRevision,string operationId,CancellationToken cancellation=default);
    Task DeleteAsync(string itemId,string path,string baseRevision,string operationId,CancellationToken cancellation=default);
}
public sealed class SyncConflictException() : IOException("The remote file changed; both copies are preserved.");
public sealed record SyncStatus(bool Running,string? Error,int Pending);
public sealed class SyncEngine
{
    public sealed record Baseline(string Path,string Hash,string Revision,bool Refresh=false,string? Lifecycle=null);
    public sealed record Operation(string Id,string Kind,string ItemId,string Path,string? Destination,string? Revision,string Hash,string? Payload,bool Conflicted=false,string? Lifecycle=null);
    public sealed record Incoming(string ItemId,string Path,string? OldPath,string? ExpectedHash,string Revision,string Payload,string? Lifecycle=null);
    public sealed class State { [System.Text.Json.Serialization.JsonExtensionData] public Dictionary<string,JsonElement>? AdditionalData {get;set;} public WorkspaceCapabilities? Capabilities {get;set;} public Incoming? PendingPull {get;set;} public int Version {get;set;}=1; public Dictionary<string,Baseline> Items {get;set;}=[]; public List<Operation> Outbox {get;set;}=[]; }
    readonly HashSet<string> collaborating=[];
    readonly TextPackStore store; readonly ISyncTransport transport; readonly SemaphoreSlim gate=new(1,1); readonly string statePath;
    public SyncStatus Status {get;private set;}=new(false,null,0);
    public event Action<SyncStatus>? StatusChanged;
    public event Action? DurabilityChanged;
    public SyncEngine(TextPackStore store,ISyncTransport transport) { this.store=store;this.transport=transport;statePath=Path.Combine(store.StateDirectory,"sync.json"); }
    public async Task<IDisposable> AcquireCollaborationAsync(string itemId,CancellationToken ct=default) {
        await gate.WaitAsync(ct);try {var state=Load();if(state.Outbox.Any(x=>x.ItemId==itemId)||state.PendingPull?.ItemId==itemId)throw new IOException("Pending file sync must finish before joining shared editing.");lock(collaborating)if(!collaborating.Add(itemId))throw new InvalidOperationException("An editor already owns this document.");return new Fence(this,itemId);}finally{gate.Release();}
    }
    sealed class Fence(SyncEngine owner,string id):IDisposable {bool disposed;public void Dispose(){lock(owner.collaborating){if(!disposed){owner.collaborating.Remove(id);disposed=true;}}}}
    bool IsEditing(string id){lock(collaborating)return collaborating.Contains(id)||SharedEditingStore.HasProtectedState(store.StateDirectory,id);}
    public async Task AcknowledgeCheckpointAsync(string itemId,string path,string hash,string revision,CancellationToken ct=default) {
        await gate.WaitAsync(ct);try {
            if(!collaborating.Contains(itemId))throw new InvalidOperationException("An active collaboration fence is required.");
            var current=store.Describe(path);if(current.ItemId!=itemId || current.Hash!=hash)throw new FileChangedException();
            var state=Load();if(state.Outbox.Any(x=>x.ItemId==itemId)||state.PendingPull?.ItemId==itemId)throw new IOException("Pending file changes must synchronize before joining collaboration.");
            state.Items[itemId]=new(path,hash,revision,Lifecycle:state.Items.GetValueOrDefault(itemId)?.Lifecycle);Save(state);
        }finally{gate.Release();}
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
    State Load() { if(!File.Exists(statePath)) return new(); var result=JsonSerializer.Deserialize<State>(File.ReadAllBytes(statePath)) ?? throw new InvalidDataException("Invalid sync state."); if(result.Version!=1) throw new InvalidDataException("This workspace was used by a newer app. Update TextText."); return result; }
    void Save(State state) {
        var bytes=JsonSerializer.SerializeToUtf8Bytes(state);
        if(File.Exists(statePath)&&File.ReadAllBytes(statePath).AsSpan().SequenceEqual(bytes))return;
        TextPackStore.AtomicWrite(statePath,bytes);DurabilityChanged?.Invoke();
    }
    void Report(bool running,string? error,int pending) { Status=new(running,error,pending);StatusChanged?.Invoke(Status); }
    public async Task SyncAsync(CancellationToken cancellation=default,bool localChangesOnly=false)
    {
        if(!await gate.WaitAsync(0,cancellation)) return;
        State? state=null;
        try {
            // FileShare.None is the cross-process fence; it is released after crashes.
            using var fileLock=new FileStream(Path.Combine(store.StateDirectory,"sync.lock"),FileMode.OpenOrCreate,FileAccess.ReadWrite,FileShare.None);
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
            var hadPendingWrites=state.Outbox.Any(x=>!x.Conflicted&&!IsEditing(x.ItemId)&&Permitted(state,x));
            await Drain(state,cancellation);
            if(hadPendingWrites) {remote=(await transport.ManifestAsync(cancellation)).ToDictionary(x=>x.ItemId);RememberCapabilities(state);}
            if(transport.Folders.Count>20000)throw new IOException("Too many workspace folders.");
            var folderError=false;
            foreach(var folder in transport.Folders)try{store.EnsureFolders([folder]);}catch(IOException){folderError=true;}catch(UnauthorizedAccessException){folderError=true;}
            foreach(var pair in state.Items.ToArray()) {
                cancellation.ThrowIfCancellationRequested();var id=pair.Key;if(IsEditing(id)||Blocked(state,id))continue;var baseline=pair.Value;var intent=store.Intent(id);
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
                    Queue(state,new(Guid.NewGuid().ToString(),"rename",id,baseline.Path,file.Path,baseline.Revision,baseline.Hash,null));await Drain(state,cancellation);if(Blocked(state,id))continue;baseline=state.Items[id];
                }
                if(file.Hash!=baseline.Hash) { QueueUpload(state,file,baseline.Revision);await Drain(state,cancellation); }
                else if(baseline.Refresh || server.Revision!=baseline.Revision || server.RelativePath!=file.Path) await Pull(state,id,file,cancellation,server.Lifecycle,server.Revision);
            }
            foreach(var file in local.Values.Where(x=>!state.Items.ContainsKey(x.ItemId))) {
                if(IsEditing(file.ItemId)||Blocked(state,file.ItemId))continue;
                if(remote.TryGetValue(file.ItemId,out var server)) {
                    if(server.Deleted) { store.Preserve(store.Read(file.Path),"conflict");Queue(state,new(Guid.NewGuid().ToString(),"conflict",file.ItemId,file.Path,null,server.Revision,file.Hash,null,true));continue; }
                    var pack=await transport.DownloadAsync(file.ItemId,cancellation);
                    if(!TextPackStore.Equivalent(pack.Data,store.Read(file.Path))) { store.Preserve(pack.Data,"remote-conflict");store.Preserve(store.Read(file.Path),"conflict");Queue(state,new(Guid.NewGuid().ToString(),"conflict",file.ItemId,file.Path,null,server.Revision,file.Hash,null,true));continue; }
                    state.Items[file.ItemId]=new(file.Path,file.Hash,pack.Revision,Lifecycle:ReadLifecycle(pack.Data)??(pack.Revision==server.Revision?server.Lifecycle:throw new FileChangedException()));Save(state);
                } else { QueueUpload(state,file,null);await Drain(state,cancellation); }
            }
            foreach(var item in remote.Values.Where(x=>!store.LastScanErrors.Any(e=>e.ItemId==x.ItemId||e.Path=="."||e.Path==x.RelativePath||x.RelativePath.StartsWith(e.Path+"/",StringComparison.OrdinalIgnoreCase)) && !IsEditing(x.ItemId) && !Blocked(state,x.ItemId) && !x.Deleted && !local.ContainsKey(x.ItemId) && !state.Items.ContainsKey(x.ItemId))) await Pull(state,item.ItemId,null,cancellation,item.Lifecycle,item.Revision);
            foreach(var pending in state.Items.Where(x=>x.Value.Refresh).ToArray()) { if(IsEditing(pending.Key)||Blocked(state,pending.Key))continue;var current=store.Describe(pending.Value.Path); if(current.Hash==pending.Value.Hash) await Pull(state,pending.Key,current,cancellation,remote.GetValueOrDefault(pending.Key)?.Lifecycle,remote.GetValueOrDefault(pending.Key)?.Revision); }
            Report(false,StateError(state)??(folderError?"A workspace folder could not be opened. Other files continue syncing.":null),state.Outbox.Count);
        } catch(Exception error) { Report(false,error.Message,state?.Outbox.Count??0);throw; } finally {gate.Release();}
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
    string? StateError(State state)=>state.Outbox.Any(x=>x.Conflicted)?"Some documents have conflicting changes. Both copies are retained.":store.LastScanErrors.Count>0?"Some files are temporarily unavailable or invalid. Other files continue syncing.":null;
    bool HasLocalWork(State state,Dictionary<string,PackFile> local) {
        if(state.Outbox.Any(op=>!op.Conflicted&&!IsEditing(op.ItemId)))return true;
        foreach(var file in local.Values) {
            if(IsEditing(file.ItemId)||Blocked(state,file.ItemId))continue;
            if(!state.Items.TryGetValue(file.ItemId,out var baseline)||baseline.Refresh||baseline.Hash!=file.Hash||baseline.Path!=file.Path)return true;
        }
        foreach(var item in state.Items)if(!local.ContainsKey(item.Key)&&!IsEditing(item.Key)&&!Blocked(state,item.Key)&&store.Intent(item.Key)?.Kind=="delete")return true;
        return false;
    }
    public async Task<WorkspaceCapabilities?> CapabilitiesAsync(CancellationToken ct=default) {await gate.WaitAsync(ct);try{return Load().Capabilities;}finally{gate.Release();}}
    void RememberCapabilities(State state) {if(transport.Capabilities is {} current && JsonSerializer.Serialize(state.Capabilities)!=JsonSerializer.Serialize(current)){state.Capabilities=current;Save(state);}}
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
