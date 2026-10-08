using System.Text.Json;
using System.Text.RegularExpressions;
namespace TextText.Core;
public sealed record SharedCheckpoint(string ItemId,string Path,string ProjectedHash,string AcknowledgedRevision,long Epoch,long Seq,long JournalGeneration,string Journal,bool Pending,int Version=1,string? RetiredReason=null);
public sealed record SharedSession(string SessionToken,PackFile Document,SharedCheckpoint? Checkpoint);
public sealed class SharedSessionClosedException() : InvalidOperationException("This editing session is no longer active.");
public sealed class SharedEditingStore(TextPackStore store,SyncEngine sync) : IDisposable
{
    sealed record MoveIntent(int Version,string SourcePath,SharedCheckpoint Checkpoint);
    sealed record Intent(int Version,string BeforeHash,string Payload,SharedCheckpoint Checkpoint);
    sealed record Active(string ItemId,string Path,IDisposable Lease);
    readonly Dictionary<string,Active> sessions=[];readonly SemaphoreSlim gate=new(1,1);bool disposed;
    string DirectoryFor(string id) {if(!Regex.IsMatch(id,@"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$"))throw new InvalidDataException("Invalid identity.");var path=System.IO.Path.Combine(store.StateDirectory,"shared-editing",id);Directory.CreateDirectory(path);return path;}
    static T? Read<T>(string path) {if(!File.Exists(path))return default;if(new FileInfo(path).Length>90*1024*1024)throw new InvalidDataException("Shared state exceeds bounds.");return JsonSerializer.Deserialize<T>(File.ReadAllBytes(path))??throw new InvalidDataException("Invalid shared state.");}
    static void Save<T>(string path,T value)=>TextPackStore.AtomicWrite(path,JsonSerializer.SerializeToUtf8Bytes(value));
    static bool ValidHash(string hash)=>Regex.IsMatch(hash,@"^[0-9a-f]{64}$");
    static void Validate(TextPackStore store,SharedCheckpoint cp) {
        if(!Regex.IsMatch(cp.ItemId,@"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$"))throw new InvalidDataException("Invalid identity.");_=store.Resolve(cp.Path);
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
        if(File.Exists(System.IO.Path.Combine(directory,"move-intent.json"))||File.Exists(System.IO.Path.Combine(directory,"intent.json"))||File.Exists(System.IO.Path.Combine(directory,"acknowledge.json")))return true;
        var cp=Read<SharedCheckpoint>(System.IO.Path.Combine(directory,"checkpoint.json"));
        return cp!=null&&(cp.Version!=1||cp.Pending||cp.RetiredReason!=null);
    }
    internal static bool HasReadyCheckpoint(TextPackStore store,string itemId) {
        if(!Regex.IsMatch(itemId,@"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$"))return false;
        var directory=System.IO.Path.Combine(store.StateDirectory,"shared-editing",itemId);
        if(File.Exists(System.IO.Path.Combine(directory,"intent.json"))||File.Exists(System.IO.Path.Combine(directory,"move-intent.json")))return false;
        try {
            var cp=Read<SharedCheckpoint>(System.IO.Path.Combine(directory,"checkpoint.json"));
            if(cp==null||cp.ItemId!=itemId||cp.RetiredReason!=null)return false;
            Validate(store,cp);var file=store.Describe(cp.Path);
            return file.ItemId==itemId&&file.Path==cp.Path&&file.Hash==cp.ProjectedHash;
        }catch(Exception error)when(error is IOException or InvalidDataException or JsonException or InvalidOperationException or KeyNotFoundException or FormatException or ArgumentException or UnauthorizedAccessException){return false;}
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
    public static SharedCheckpoint RebaseProjection(TextPackStore store,string itemId,string newPath,
        bool interruptAfterIntent=false,bool interruptAfterMove=false) => store.WithExclusiveMutation(() => {
        if(!Regex.IsMatch(itemId,@"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$"))throw new InvalidDataException("Invalid identity.");
        var directory=System.IO.Path.Combine(store.StateDirectory,"shared-editing",itemId);
        RecoverMove(store,directory,itemId);
        if(File.Exists(System.IO.Path.Combine(directory,"intent.json")))throw new IOException("A shared checkpoint is still being recovered.");
        var cp=Read<SharedCheckpoint>(System.IO.Path.Combine(directory,"checkpoint.json"))??throw new InvalidOperationException("No shared projection is available.");
        Validate(store,cp);if(cp.ItemId!=itemId||cp.RetiredReason!=null)throw new InvalidDataException("Shared identity mismatch.");
        if(cp.Path==newPath)return cp;
        var source=store.Describe(cp.Path);
        if(source.ItemId!=itemId||source.Hash!=cp.ProjectedHash||File.Exists(store.Resolve(newPath)))throw new FileChangedException();
        var journal=System.Text.Json.Nodes.JsonNode.Parse(cp.Journal)!;journal["relativePath"]=newPath;
        var target=cp with{Path=newPath,Journal=journal.ToJsonString()};Validate(store,target);
        var intent=new MoveIntent(1,cp.Path,target);Save(System.IO.Path.Combine(directory,"move-intent.json"),intent);
        if(interruptAfterIntent)throw new IOException("Interrupted before shared move.");
        return FinishMove(store,directory,intent,interruptAfterMove);
    });
    static void RecoverMove(TextPackStore store,string directory,string itemId) {
        var intent=Read<MoveIntent>(System.IO.Path.Combine(directory,"move-intent.json"));
        if(intent!=null){if(intent.Checkpoint.ItemId!=itemId)throw new InvalidDataException("Shared identity mismatch.");FinishMove(store,directory,intent);}
    }
    static SharedCheckpoint FinishMove(TextPackStore store,string directory,MoveIntent intent,bool interruptAfterMove=false) {
        var cp=intent.Checkpoint;Validate(store,cp);
        if(intent.Version!=1||intent.SourcePath==cp.Path)throw new InvalidDataException("Invalid shared move.");
        if(File.Exists(store.Resolve(intent.SourcePath))) {
            var current=store.Describe(intent.SourcePath);if(current.ItemId!=cp.ItemId||current.Hash!=cp.ProjectedHash)throw new FileChangedException();
            store.Rename(intent.SourcePath,cp.Path,current.Hash);
            if(interruptAfterMove)throw new IOException("Interrupted after shared move.");
        }
        var moved=store.Describe(cp.Path);if(moved.ItemId!=cp.ItemId||moved.Hash!=cp.ProjectedHash)throw new FileChangedException();
        Save(System.IO.Path.Combine(directory,"checkpoint.json"),cp);File.Delete(System.IO.Path.Combine(directory,"move-intent.json"));return cp;
    }
    SharedCheckpoint? Recover(string itemId) {
        var directory=DirectoryFor(itemId);store.WithExclusiveMutation(()=>{RecoverMove(store,directory,itemId);return true;});var intent=Read<Intent>(System.IO.Path.Combine(directory,"intent.json"));
        if(intent!=null) {if(intent.Version!=1)throw new InvalidDataException("Unsupported shared intent.");Finish(intent,directory);}
        var cp=Read<SharedCheckpoint>(System.IO.Path.Combine(directory,"checkpoint.json"));if(cp!=null){Validate(store,cp);if(cp.ItemId!=itemId)throw new InvalidDataException("Shared identity mismatch.");}return cp;
    }
    PackFile Finish(Intent intent,string directory) {
        Validate(store,intent.Checkpoint);var bytes=Convert.FromBase64String(intent.Payload);if(TextPackStore.Identity(bytes)!=intent.Checkpoint.ItemId||TextPackStore.Hash(bytes)!=intent.Checkpoint.ProjectedHash)throw new InvalidDataException("Invalid shared projection.");
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
            string? acknowledgedDirectory=null;
            var result=store.WithExclusiveMutation(() => {
                var prior=Recover(session.ItemId);
                if(checkpoint.Path!=session.Path&&checkpoint.Path!=prior?.Path)throw new InvalidDataException("Checkpoint identity mismatch.");
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
                Validate(store,checkpoint);if(checkpoint.ItemId!=session.ItemId||TextPackStore.Identity(textPack)!=session.ItemId||TextPackStore.Hash(textPack)!=checkpoint.ProjectedHash)throw new InvalidDataException("Checkpoint identity mismatch.");
                var current=store.Describe(session.Path);
                if(prior!=null) {
                    if(prior.RetiredReason!=null||checkpoint.JournalGeneration<prior.JournalGeneration||prior.Pending&&checkpoint.Epoch!=prior.Epoch)throw new InvalidOperationException("Newer or protected shared edits are retained.");
                    if(checkpoint.JournalGeneration==prior.JournalGeneration){if(checkpoint with{Journal=prior.Journal}!=prior||!System.Text.Json.Nodes.JsonNode.DeepEquals(System.Text.Json.Nodes.JsonNode.Parse(checkpoint.Journal),System.Text.Json.Nodes.JsonNode.Parse(prior.Journal))||current.Hash!=prior.ProjectedHash)throw new InvalidOperationException("Conflicting checkpoint generation.");return current;}
                }
                if(current.Hash!=expectedHash)throw new FileChangedException();
                var directory=DirectoryFor(session.ItemId);var intent=new Intent(1,expectedHash,Convert.ToBase64String(textPack),checkpoint);
                if(!checkpoint.Pending){Save(System.IO.Path.Combine(directory,"acknowledge.json"),checkpoint);acknowledgedDirectory=directory;}
                Save(System.IO.Path.Combine(directory,"intent.json"),intent);return Finish(intent,directory);
            });
            // Never wait for the sync gate while holding the filesystem lock.
            if(acknowledgedDirectory!=null){await sync.AcknowledgeCheckpointAsync(session.ItemId,session.Path,result.Hash,checkpoint.AcknowledgedRevision,ct);File.Delete(System.IO.Path.Combine(acknowledgedDirectory,"acknowledge.json"));}
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
