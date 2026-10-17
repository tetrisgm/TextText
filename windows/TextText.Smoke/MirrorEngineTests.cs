using System.IO;
using System.IO.Compression;
using TextText.Core;

static class MirrorEngineTests
{
    internal sealed class Hook { public Func<Task>? Before; public int Calls; }
    sealed class Remote(byte[] initial) : ISyncTransport {
        public byte[] Bytes=initial; public int Uploads;
        public Task<IReadOnlyList<RemoteItem>> ManifestAsync(CancellationToken ct=default)=>Task.FromResult<IReadOnlyList<RemoteItem>>([new("mirror-item","Note.textpack",TextPackStore.Hash(Bytes))]);
        public Task<RemotePack> DownloadAsync(string id,CancellationToken ct=default)=>Task.FromResult(new RemotePack(Bytes,"Note.textpack",TextPackStore.Hash(Bytes)));
        public Task<string> UploadAsync(string id,string path,byte[] bytes,string? basis,string operation,CancellationToken ct=default) {
            if(basis!=TextPackStore.Hash(Bytes))throw new SyncConflictException();
            Bytes=bytes;Uploads++;return Task.FromResult(TextPackStore.Hash(bytes));
        }
        public Task<string> RenameAsync(string id,string from,string to,string basis,string operation,CancellationToken ct=default)=>throw new NotSupportedException();
        public Task DeleteAsync(string id,string path,string basis,string operation,CancellationToken ct=default)=>throw new NotSupportedException();
    }
    static byte[] Pack(string body) {
        using var bytes=new MemoryStream();
        using(var zip=new ZipArchive(bytes,ZipArchiveMode.Create,true))using(var writer=new StreamWriter(zip.CreateEntry("text.md").Open()))writer.Write("---\ntextTextId: mirror-item\ntitle: Note\n---\n"+body);
        return bytes.ToArray();
    }
    public static async Task RunAsync(string root,Func<Hook,MirrorPolicy> factory,Func<Task> reload,CancellationToken ct) {
        void Check(bool value,string label){if(!value)throw new Exception(label);Console.WriteLine("PASS "+label);}
        var store=new TextPackStore(Path.Combine(root,"policy-engine"),Path.Combine(root,"policy-engine-state"));
        var original=Pack("Original");var file=store.Write("Note.textpack",original);var remote=new Remote(original);
        var hook=new Hook();var policy=factory(hook);var engine=new SyncEngine(store,remote,mirrorPolicy:policy);
        await engine.SyncAsync(ct);
        var local=Pack("Local edit");file=store.Write(file.Path,local,file.Hash);await engine.SyncAsync(ct);await engine.SyncAsync(ct);
        Check(remote.Bytes.SequenceEqual(local)&&remote.Uploads==1&&hook.Calls>0,"native mirror uploads through packaged policy");
        var received=Pack("Remote edit");remote.Bytes=received;await engine.SyncAsync(ct);file=store.Describe(file.Path);
        Check(store.Read(file.Path).SequenceEqual(received),"native mirror pulls through packaged policy");
        file=store.Write(file.Path,Pack("Captured edit"),file.Hash);var newer=Pack("Newer external edit");
        hook.Before=async()=>{
            var excluded=false;try{await new SyncEngine(store,remote,mirrorPolicy:factory(new Hook())).SyncAsync(ct);}catch(IOException){excluded=true;}
            Check(excluded,"workspace writer lease survives policy await");
            file=store.Write(file.Path,newer,file.Hash);
        };
        var refused=false;try{await engine.SyncAsync(ct);}catch(FileChangedException){refused=true;}
        Check(refused&&store.Read(file.Path).SequenceEqual(newer)&&remote.Bytes.SequenceEqual(received),"policy result cannot upload bytes changed during its RPC");
        await engine.SyncAsync(ct);await engine.SyncAsync(ct);file=store.Describe(file.Path);
        Check(remote.Bytes.SequenceEqual(newer),"fresh policy pass uploads the retained external edit");
        var pending=Pack("Pending through page replacement");file=store.Write(file.Path,pending,file.Hash);
        hook.Before=reload;
        refused=false;try{await engine.SyncAsync(ct);}catch(Exception e)when(e is IOException or System.Text.Json.JsonException or InvalidOperationException){refused=true;}
        Check(refused&&store.Read(file.Path).SequenceEqual(pending)&&remote.Bytes.SequenceEqual(newer),"page replacement pauses mirror without fallback or lost local work");
        var resumed=new SyncEngine(store,remote,mirrorPolicy:factory(new Hook()));await resumed.SyncAsync(ct);await resumed.SyncAsync(ct);
        Check(remote.Bytes.SequenceEqual(pending)&&store.Read(file.Path).SequenceEqual(pending),"new policy connection resumes from retained native state");
    }
}
