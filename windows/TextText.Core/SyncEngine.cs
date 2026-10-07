using System.Text.Json;
namespace TextText.Core;
public sealed record RemoteItem(string ItemId,string RelativePath,string Revision,bool Deleted=false);
public sealed record RemotePack(byte[] Data,string RelativePath,string Revision);
public interface ISyncTransport
{
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
    public sealed record Baseline(string Path,string Hash,string Revision,bool Refresh=false);
    public sealed record Operation(string Id,string Kind,string ItemId,string Path,string? Destination,string? Revision,string Hash,string? Payload,bool Conflicted=false);
    public sealed record Incoming(string ItemId,string Path,string? OldPath,string? ExpectedHash,string Revision,string Payload);
    public sealed class State { [System.Text.Json.Serialization.JsonExtensionData] public Dictionary<string,JsonElement>? AdditionalData {get;set;} public Incoming? PendingPull {get;set;} public int Version {get;set;}=1; public Dictionary<string,Baseline> Items {get;set;}=[]; public List<Operation> Outbox {get;set;}=[]; }
    readonly HashSet<string> collaborating=[];
    readonly TextPackStore store; readonly ISyncTransport transport; readonly SemaphoreSlim gate=new(1,1); readonly string statePath;
    public SyncStatus Status {get;private set;}=new(false,null,0);
    public event Action<SyncStatus>? StatusChanged;
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
            state.Items[itemId]=new(path,hash,revision);Save(state);
        }finally{gate.Release();}
    }
    public async Task<bool> IsReadyAsync(string itemId,CancellationToken ct=default) {
        await gate.WaitAsync(ct);try {var state=Load();if(state.Outbox.Any(x=>x.ItemId==itemId)||state.PendingPull?.ItemId==itemId)return false;if(SharedEditingStore.HasReadyCheckpoint(store,itemId))return true;if(SharedEditingStore.HasProtectedState(store.StateDirectory,itemId))return false;
            if(!state.Items.TryGetValue(itemId,out var baseline))return false;try{var file=store.Describe(baseline.Path);return file.ItemId==itemId&&file.Hash==baseline.Hash&&!baseline.Refresh;}catch(IOException){return false;}
        }finally{gate.Release();}
    }
    public async Task<string?> BaselineRevisionAsync(string itemId,CancellationToken ct=default) {await gate.WaitAsync(ct);try{return Load().Items.GetValueOrDefault(itemId)?.Revision;}finally{gate.Release();}}
    static bool Blocked(State state,string id)=>state.Outbox.Any(x=>x.ItemId==id&&x.Conflicted);
    State Load() { if(!File.Exists(statePath)) return new(); var result=JsonSerializer.Deserialize<State>(File.ReadAllBytes(statePath)) ?? throw new InvalidDataException("Invalid sync state."); if(result.Version!=1) throw new InvalidDataException("This workspace was used by a newer app. Update TextText."); return result; }
    void Save(State state)=>TextPackStore.AtomicWrite(statePath,JsonSerializer.SerializeToUtf8Bytes(state));
    void Report(bool running,string? error,int pending) { Status=new(running,error,pending);StatusChanged?.Invoke(Status); }
    public async Task SyncAsync(CancellationToken cancellation=default)
    {
        if(!await gate.WaitAsync(0,cancellation)) return;
        State? state=null;
        try {
            // FileShare.None is the cross-process fence; it is released after crashes.
            using var fileLock=new FileStream(Path.Combine(store.StateDirectory,"sync.lock"),FileMode.OpenOrCreate,FileAccess.ReadWrite,FileShare.None);
            state=Load();var acknowledged=SharedEditingStore.ReconcileAcknowledgements(store,state);if(acknowledged.Count>0){Save(state);foreach(var file in acknowledged)File.Delete(file);}
            Report(true,null,state.Outbox.Count);
            if(state.PendingPull!=null) {if(IsEditing(state.PendingPull.ItemId)){Report(false,null,state.Outbox.Count);return;}ApplyPull(state);}
            await Drain(state,cancellation);
            var local=store.Scan().ToDictionary(x=>x.ItemId); var remote=(await transport.ManifestAsync(cancellation)).ToDictionary(x=>x.ItemId);
            foreach(var pair in state.Items.ToArray()) {
                cancellation.ThrowIfCancellationRequested();var id=pair.Key;if(IsEditing(id)||Blocked(state,id))continue;var baseline=pair.Value;var intent=store.Intent(id);
                local.TryGetValue(id,out var file); remote.TryGetValue(id,out var server);
                if(intent?.Kind=="delete" && file==null) {
                    if(File.Exists(store.Resolve(intent.Path)))continue;
                    if(server is { Deleted:false }) { Queue(state,new(Guid.NewGuid().ToString(),"delete",id,baseline.Path,null,baseline.Revision,baseline.Hash,null)); await Drain(state,cancellation); }
                    else { state.Items.Remove(id);Save(state);store.ClearIntent(id); } continue;
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
                else if(baseline.Refresh || server.Revision!=baseline.Revision || server.RelativePath!=file.Path) await Pull(state,id,file,cancellation);
            }
            foreach(var file in local.Values.Where(x=>!state.Items.ContainsKey(x.ItemId))) {
                if(IsEditing(file.ItemId)||Blocked(state,file.ItemId))continue;
                if(remote.TryGetValue(file.ItemId,out var server)) {
                    if(server.Deleted) { store.Preserve(store.Read(file.Path),"conflict");Queue(state,new(Guid.NewGuid().ToString(),"conflict",file.ItemId,file.Path,null,server.Revision,file.Hash,null,true));continue; }
                    var pack=await transport.DownloadAsync(file.ItemId,cancellation);
                    if(!TextPackStore.Equivalent(pack.Data,store.Read(file.Path))) { store.Preserve(pack.Data,"remote-conflict");store.Preserve(store.Read(file.Path),"conflict");Queue(state,new(Guid.NewGuid().ToString(),"conflict",file.ItemId,file.Path,null,server.Revision,file.Hash,null,true));continue; }
                    state.Items[file.ItemId]=new(file.Path,file.Hash,pack.Revision);Save(state);
                } else { QueueUpload(state,file,null);await Drain(state,cancellation); }
            }
            foreach(var item in remote.Values.Where(x=>!store.LastScanErrors.Any(e=>e.ItemId==x.ItemId||e.Path=="."||e.Path==x.RelativePath||x.RelativePath.StartsWith(e.Path+"/",StringComparison.OrdinalIgnoreCase)) && !IsEditing(x.ItemId) && !Blocked(state,x.ItemId) && !x.Deleted && !local.ContainsKey(x.ItemId) && !state.Items.ContainsKey(x.ItemId))) await Pull(state,item.ItemId,null,cancellation);
            foreach(var pending in state.Items.Where(x=>x.Value.Refresh).ToArray()) { if(IsEditing(pending.Key)||Blocked(state,pending.Key))continue;var current=store.Describe(pending.Value.Path); if(current.Hash==pending.Value.Hash) await Pull(state,pending.Key,current,cancellation); }
            Report(false,state.Outbox.Any(x=>x.Conflicted)?"Some documents have conflicting changes. Both copies are retained.":store.LastScanErrors.Count>0?"Some files are temporarily unavailable or invalid. Other files continue syncing.":null,state.Outbox.Count);
        } catch(Exception error) { Report(false,error.Message,state?.Outbox.Count??0);throw; } finally {gate.Release();}
    }
    void QueueUpload(State state,PackFile file,string? revision) {
        var bytes=store.Read(file.Path);if(TextPackStore.Hash(bytes)!=file.Hash) throw new FileChangedException();
        Queue(state,new(Guid.NewGuid().ToString(),"upload",file.ItemId,file.Path,null,revision,file.Hash,Convert.ToBase64String(bytes)));
    }
    void Queue(State state,Operation operation) {state.Outbox.Add(operation);Save(state);}
    async Task Drain(State state,CancellationToken ct) {
        while(state.Outbox.Any(x=>!x.Conflicted&&!IsEditing(x.ItemId))) {
            var op=state.Outbox.First(x=>!x.Conflicted&&!IsEditing(x.ItemId));string? revision=null;
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
            else state.Items[op.ItemId]=new(op.Destination??op.Path,op.Hash,revision!,op.Kind=="upload");
            state.Outbox.Remove(op);Save(state);if(op.Kind!="upload")store.ClearIntent(op.ItemId);
        }
    }
    async Task Pull(State state,string id,PackFile? local,CancellationToken ct) {
        var pack=await transport.DownloadAsync(id,ct);if(TextPackStore.Identity(pack.Data)!=id) throw new InvalidDataException("Remote identity mismatch.");
        state.PendingPull=new(id,pack.RelativePath,local?.Path,local?.Hash,pack.Revision,Convert.ToBase64String(pack.Data));Save(state);ApplyPull(state);
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
        state.Items[pending.ItemId]=new(pending.Path,hash,pending.Revision);state.PendingPull=null;Save(state);store.ClearIntent(pending.ItemId);
    }
}
