using System.Text.Json;
using System.Text.RegularExpressions;
namespace TextText.Core;
public sealed record SharedCheckpoint(string ItemId,string Path,string ProjectedHash,string AcknowledgedRevision,long Epoch,long Seq,long JournalGeneration,string Journal,bool Pending,int Version=1,string? RetiredReason=null);
public sealed record SharedSession(string SessionToken,PackFile Document,SharedCheckpoint? Checkpoint);
public sealed class SharedSessionClosedException() : InvalidOperationException("This editing session is no longer active.");
public sealed class SharedEditingStore(TextPackStore store,SyncEngine sync) : IDisposable
{
    sealed record Intent(int Version,string BeforeHash,string Payload,SharedCheckpoint Checkpoint);
    sealed record Active(string ItemId,string Path,IDisposable Lease);
    readonly Dictionary<string,Active> sessions=[];readonly SemaphoreSlim gate=new(1,1);bool disposed;
    string DirectoryFor(string id) {if(!Regex.IsMatch(id,@"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$"))throw new InvalidDataException("Invalid identity.");var path=System.IO.Path.Combine(store.StateDirectory,"shared-editing",id);Directory.CreateDirectory(path);return path;}
    static T? Read<T>(string path) {if(!File.Exists(path))return default;if(new FileInfo(path).Length>90*1024*1024)throw new InvalidDataException("Shared state exceeds bounds.");return JsonSerializer.Deserialize<T>(File.ReadAllBytes(path))??throw new InvalidDataException("Invalid shared state.");}
    static void Save<T>(string path,T value)=>TextPackStore.AtomicWrite(path,JsonSerializer.SerializeToUtf8Bytes(value));
    static bool ValidHash(string hash)=>Regex.IsMatch(hash,@"^[0-9a-f]{64}$");
    void Validate(SharedCheckpoint cp) {
        _=DirectoryFor(cp.ItemId);_=store.Resolve(cp.Path);
        if(cp.Version!=1 || !ValidHash(cp.ProjectedHash)||!ValidHash(cp.AcknowledgedRevision)||cp.Epoch<1||cp.Seq<0||cp.JournalGeneration<1||cp.Epoch>9007199254740991||cp.Seq>9007199254740991||cp.JournalGeneration>9007199254740991||cp.Journal.Length>4*1024*1024)throw new InvalidDataException("Unsupported shared checkpoint. Retained edits are unchanged.");
        using var doc=JsonDocument.Parse(cp.Journal);var j=doc.RootElement;
        if(j.GetProperty("version").GetInt32()!=1||j.GetProperty("epoch").GetInt64()!=cp.Epoch||j.GetProperty("seq").GetInt64()!=cp.Seq||j.GetProperty("journalGeneration").GetInt64()!=cp.JournalGeneration||j.GetProperty("revision").GetString()!=cp.AcknowledgedRevision||j.GetProperty("relativePath").GetString()!=cp.Path)throw new InvalidDataException("Journal metadata mismatch.");
        if(Convert.FromBase64String(j.GetProperty("update").GetString()!).Length==0)throw new InvalidDataException("Empty journal update.");
        var pending=j.GetProperty("pending");if(pending.GetArrayLength()>1024)throw new InvalidDataException("Too many pending updates.");
        foreach(var update in pending.EnumerateArray()){if(update.GetString()!.Length>700000)throw new InvalidDataException("Pending update too large.");_=Convert.FromBase64String(update.GetString()!);}
        if(!cp.Pending && (pending.GetArrayLength()>0 || (j.TryGetProperty("batch",out var batch)&&batch.ValueKind!=JsonValueKind.Null) || (j.TryGetProperty("unqueuedDirty",out var dirty)&&dirty.ValueKind==JsonValueKind.True)))throw new InvalidDataException("Unacknowledged updates marked saved.");
    }
    public static bool HasProtectedState(string stateDirectory,string itemId) {
        if(!Regex.IsMatch(itemId,@"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$"))throw new InvalidDataException("Invalid remote identity.");
        var directory=System.IO.Path.Combine(stateDirectory,"shared-editing",itemId);
        if(File.Exists(System.IO.Path.Combine(directory,"intent.json"))||File.Exists(System.IO.Path.Combine(directory,"acknowledge.json")))return true;
        var cp=Read<SharedCheckpoint>(System.IO.Path.Combine(directory,"checkpoint.json"));
        return cp!=null&&(cp.Version!=1||cp.Pending||cp.RetiredReason!=null);
    }
    internal static List<string> ReconcileAcknowledgements(TextPackStore store,SyncEngine.State state) {
        var completed=new List<string>();var root=System.IO.Path.Combine(store.StateDirectory,"shared-editing");if(!System.IO.Directory.Exists(root))return completed;
        foreach(var file in System.IO.Directory.EnumerateFiles(root,"acknowledge.json",SearchOption.AllDirectories)) {
            var cp=Read<SharedCheckpoint>(file)!;if(cp.Version!=1||cp.Pending||!ValidHash(cp.ProjectedHash)||!ValidHash(cp.AcknowledgedRevision))throw new InvalidDataException("Invalid checkpoint acknowledgement.");
            if(File.Exists(System.IO.Path.Combine(System.IO.Path.GetDirectoryName(file)!,"intent.json")))continue;
            var current=store.Describe(cp.Path);if(current.ItemId!=cp.ItemId||current.Hash!=cp.ProjectedHash)continue;
            if(state.Outbox.Any(x=>x.ItemId==cp.ItemId)||state.PendingPull?.ItemId==cp.ItemId)continue;
            state.Items[cp.ItemId]=new(cp.Path,cp.ProjectedHash,cp.AcknowledgedRevision);completed.Add(file);
        }return completed;
    }
    SharedCheckpoint? Recover(string itemId) {
        var directory=DirectoryFor(itemId);var intent=Read<Intent>(System.IO.Path.Combine(directory,"intent.json"));
        if(intent!=null) {if(intent.Version!=1)throw new InvalidDataException("Unsupported shared intent.");Finish(intent,directory);}
        var cp=Read<SharedCheckpoint>(System.IO.Path.Combine(directory,"checkpoint.json"));if(cp!=null){Validate(cp);if(cp.ItemId!=itemId)throw new InvalidDataException("Shared identity mismatch.");}return cp;
    }
    PackFile Finish(Intent intent,string directory) {
        Validate(intent.Checkpoint);var bytes=Convert.FromBase64String(intent.Payload);if(TextPackStore.Identity(bytes)!=intent.Checkpoint.ItemId||TextPackStore.Hash(bytes)!=intent.Checkpoint.ProjectedHash)throw new InvalidDataException("Invalid shared projection.");
        var current=store.Describe(intent.Checkpoint.Path);
        if(current.Hash==intent.BeforeHash)current=store.Write(current.Path,bytes,current.Hash);
        else if(current.Hash!=intent.Checkpoint.ProjectedHash){Save(System.IO.Path.Combine(directory,"checkpoint.json"),intent.Checkpoint with{RetiredReason="The file changed outside this editing session. Its shared edits are retained."});store.Preserve(bytes,"shared-conflict");File.Delete(System.IO.Path.Combine(directory,"intent.json"));throw new FileChangedException();}
        Save(System.IO.Path.Combine(directory,"checkpoint.json"),intent.Checkpoint);File.Delete(System.IO.Path.Combine(directory,"intent.json"));return current;
    }
    public async Task<SharedSession> OpenAsync(string itemId,string path,string expectedHash,CancellationToken ct=default) {
        await gate.WaitAsync(ct);try {
            ObjectDisposedException.ThrowIf(disposed,this);
            foreach(var token in sessions.Where(x=>x.Value.ItemId==itemId).Select(x=>x.Key).ToArray())CloseInternal(token);
            var lease=await sync.AcquireCollaborationAsync(itemId,ct);
            try {var cp=Recover(itemId);var file=store.Describe(path);if(file.ItemId!=itemId || (file.Hash!=expectedHash && file.Hash!=cp?.ProjectedHash))throw new FileChangedException();
                if(cp!=null&&file.Hash!=cp.ProjectedHash){var directory=DirectoryFor(itemId);if(cp.Pending||cp.RetiredReason!=null){cp=cp with{RetiredReason="The file changed outside shared editing. Its saved shared edits are retained for recovery."};Save(System.IO.Path.Combine(directory,"checkpoint.json"),cp);}else{Save(System.IO.Path.Combine(directory,"archived-"+Guid.NewGuid().ToString("N")+".json"),cp);File.Delete(System.IO.Path.Combine(directory,"checkpoint.json"));cp=null;}}
                var token=Guid.NewGuid().ToString();sessions[token]=new(itemId,path,lease);return new(token,file,cp);
            }catch{lease.Dispose();throw;}
        }finally{gate.Release();}
    }
    public async Task<PackFile> CheckpointAsync(string sessionToken,string expectedHash,byte[] textPack,SharedCheckpoint checkpoint,CancellationToken ct=default) {
        await gate.WaitAsync(ct);try {
            ObjectDisposedException.ThrowIf(disposed,this);
            if(!sessions.TryGetValue(sessionToken,out var session))throw new SharedSessionClosedException();
            Validate(checkpoint);if(checkpoint.ItemId!=session.ItemId||checkpoint.Path!=session.Path||TextPackStore.Identity(textPack)!=session.ItemId||TextPackStore.Hash(textPack)!=checkpoint.ProjectedHash)throw new InvalidDataException("Checkpoint identity mismatch.");
            var prior=Recover(session.ItemId);var current=store.Describe(session.Path);
            if(prior!=null) {
                if(prior.RetiredReason!=null||checkpoint.JournalGeneration<prior.JournalGeneration||prior.Pending&&checkpoint.Epoch!=prior.Epoch)throw new InvalidOperationException("Newer or protected shared edits are retained.");
                if(checkpoint.JournalGeneration==prior.JournalGeneration){if(checkpoint!=prior||current.Hash!=prior.ProjectedHash)throw new InvalidOperationException("Conflicting checkpoint generation.");return current;}
            }
            if(current.Hash!=expectedHash)throw new FileChangedException();
            var directory=DirectoryFor(session.ItemId);var intent=new Intent(1,expectedHash,Convert.ToBase64String(textPack),checkpoint);
            if(!checkpoint.Pending)Save(System.IO.Path.Combine(directory,"acknowledge.json"),checkpoint);
            Save(System.IO.Path.Combine(directory,"intent.json"),intent);var result=Finish(intent,directory);
            if(!checkpoint.Pending){await sync.AcknowledgeCheckpointAsync(session.ItemId,session.Path,result.Hash,checkpoint.AcknowledgedRevision,ct);File.Delete(System.IO.Path.Combine(directory,"acknowledge.json"));}
            return result;
        }finally{gate.Release();}
    }
    public async Task RecoverAsync(string sessionToken,string recoveryPath,string recoveryHash,CancellationToken ct=default) {
        await gate.WaitAsync(ct);try {
            ObjectDisposedException.ThrowIf(disposed,this);
            if(!sessions.TryGetValue(sessionToken,out var session))throw new InvalidOperationException("This editing session is no longer active.");
            var recovery=store.Describe(recoveryPath);if(recovery.Hash!=recoveryHash||recovery.ItemId==session.ItemId||recoveryPath==session.Path)throw new InvalidDataException("Save a distinct recovery document first.");
            var directory=DirectoryFor(session.ItemId);var archive=System.IO.Path.Combine(directory,"archive-"+Guid.NewGuid().ToString("N"));System.IO.Directory.CreateDirectory(archive);
            foreach(var name in new[]{"checkpoint.json","intent.json","acknowledge.json"}){var source=System.IO.Path.Combine(directory,name);if(File.Exists(source))TextPackStore.AtomicWrite(System.IO.Path.Combine(archive,name),File.ReadAllBytes(source));}
            Save(System.IO.Path.Combine(archive,"recovered.json"),new{Version=1,recovery.ItemId,recovery.Path,recovery.Hash});
            // Recheck the explicitly saved copy before releasing protected state.
            if(store.Describe(recoveryPath).Hash!=recoveryHash)throw new FileChangedException();
            foreach(var name in new[]{"checkpoint.json","intent.json","acknowledge.json"})File.Delete(System.IO.Path.Combine(directory,name));
            CloseInternal(sessionToken);
        }finally{gate.Release();}
    }
    void CloseInternal(string token){if(sessions.Remove(token,out var active))active.Lease.Dispose();}
    public void Close(string sessionToken){gate.Wait();try{CloseInternal(sessionToken);}finally{gate.Release();}}
    public void Dispose(){gate.Wait();try{disposed=true;foreach(var token in sessions.Keys.ToArray())CloseInternal(token);}finally{gate.Release();}}
}
