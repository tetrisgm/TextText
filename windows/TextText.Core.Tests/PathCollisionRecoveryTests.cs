using System.IO.Compression;
using System.Text.Json;
using TextText.Core;

static class PathCollisionRecoveryTests
{
    const string Local="080a76d5-f83d-456f-b893-67b869d27af2",RemoteId="ee455de6-5640-453c-8632-7984a370688c",Source="Notes/Untitled 31.textpack";
    static byte[] Pack(string id,string body){using var output=new MemoryStream();using(var zip=new ZipArchive(output,ZipArchiveMode.Create,true))using(var writer=new StreamWriter(zip.CreateEntry("text.md").Open()))writer.Write($"---\ntextTextId: \"{id}\"\n---\n{body}");return output.ToArray();}
    static void Observe(SyncEngine engine,Action<string>? action)=>typeof(SyncEngine).GetProperty("PathCollisionObservationForTesting",System.Reflection.BindingFlags.NonPublic|System.Reflection.BindingFlags.Instance)!.SetValue(engine,action);
    sealed class Fixture(string root) {
        public readonly TextPackStore Store=Test.OwnedPathStore(Path.Combine(root,"files"),Path.Combine(root,"state"));
        public readonly byte[] LocalBytes=Pack(Local,"exact latest local body"),RemoteBytes=Pack(RemoteId,"exact remote body");
        public Remote Transport=null!;public SyncEngine Engine=null!;public SyncEngine.Operation LocalOperation=null!,RemoteOperation=null!;
        public void Init(){Store.Write(Source,LocalBytes);Transport=new(RemoteBytes);LocalOperation=new(Guid.NewGuid().ToString(),"upload",Local,Source,null,null,TextPackStore.Hash(LocalBytes),Convert.ToBase64String(LocalBytes),true);RemoteOperation=new(Guid.NewGuid().ToString(),"conflict",RemoteId,Source,null,TextPackStore.Hash(RemoteBytes),TextPackStore.Hash(RemoteBytes),Convert.ToBase64String(RemoteBytes),true);File.WriteAllBytes(Path.Combine(Store.StateDirectory,"sync.json"),JsonSerializer.SerializeToUtf8Bytes(new SyncEngine.State{AccountId=Test.PathAccount,Outbox=[LocalOperation,RemoteOperation]}));Engine=Test.NewOwnedPathSync(Store,Transport);}
        public SyncEngine.State State()=>JsonSerializer.Deserialize<SyncEngine.State>(File.ReadAllBytes(Path.Combine(Store.StateDirectory,"sync.json")))!;
    }
    public static async Task Run(string root,Action<bool,string> check) {
        var fixture=new Fixture(Path.Combine(root,"complete"));fixture.Init();
        await fixture.Engine.SyncAsync();
        check(fixture.Transport.Uploads==0&&fixture.State().Outbox.Count==2&&fixture.Store.Describe(Source).ItemId==Local,"actual engine retains both same-path conflicts before reviewed recovery");
        fixture.LocalOperation=fixture.State().Outbox.Single(op=>op.ItemId==Local);fixture.RemoteOperation=fixture.State().Outbox.Single(op=>op.ItemId==RemoteId);
        var rows=await fixture.Engine.ListPathCollisionsAsync();check(rows.Count==1&&rows[0].LocalItemId==Local&&rows[0].RemoteItemId==RemoteId,"recovery discovery identifies exact retained two-ID pair");
        var review=await fixture.Engine.InspectPathCollisionAsync(Local,RemoteId);var id=Guid.NewGuid().ToString();
        var receipt=await fixture.Engine.KeepBothPathCollisionAsync(review,id);
        check(receipt.State=="completed"&&fixture.Store.Read(receipt.LocalPath).SequenceEqual(fixture.LocalBytes)&&!File.Exists(fixture.Store.Resolve(Source)),"keep both durably moves exact local bytes without overwriting source with remote bytes");
        var retained=fixture.State().PathCollisions[id];
        check(retained.LocalOperation==fixture.LocalOperation with{Payload=null}&&retained.RemoteOperation==fixture.RemoteOperation with{Payload=null}&&fixture.State().Outbox.Single().Id!=fixture.LocalOperation.Id,"original operation metadata remains archived and new upload uses distinct operation identity");
        check(await fixture.Engine.KeepBothPathCollisionAsync(review,id)==receipt,"completed recovery replay returns same receipt without another upload");
        await fixture.Engine.SyncAsync();
        check(fixture.Transport.Uploads==1&&fixture.Store.Read(Source).SequenceEqual(fixture.RemoteBytes)&&fixture.Store.Read(receipt.LocalPath).SequenceEqual(fixture.LocalBytes),"actual sync converges both UUIDs and exact bodies after keep both");
        foreach(var phase in new[]{"prepared","moved","completed"}) {
            var f=new Fixture(Path.Combine(root,phase));f.Init();var inspected=await f.Engine.InspectPathCollisionAsync(Local,RemoteId);var operation=Guid.NewGuid().ToString();
            Observe(f.Engine,point=>{if(point==phase)throw new IOException("simulated process interruption at durable boundary");});var interrupted=false;
            try{await f.Engine.KeepBothPathCollisionAsync(inspected,operation);}catch(IOException){interrupted=true;}
            check(interrupted,"recovery interrupted at durable "+phase+" boundary");
            var restarted=Test.NewOwnedPathSync(f.Store,f.Transport);if(phase!="completed") {var saved=f.State().Outbox.ToArray();await restarted.SyncAsync();check(f.State().Outbox.SequenceEqual(saved)&&f.Transport.Uploads==0&&(await restarted.ListPathCollisionsAsync()).Single().ResolutionId==operation,"prepared recovery holds exact operations and remains discoverable after "+phase);}var result=await restarted.KeepBothPathCollisionAsync(inspected,operation);await restarted.SyncAsync();
            check(result.OperationId==operation&&f.Transport.Uploads==1&&f.Store.Read(Source).SequenceEqual(f.RemoteBytes)&&f.Store.Read(result.LocalPath).SequenceEqual(f.LocalBytes),"restart after "+phase+" preserves both copies and queues exactly once");
        }
        foreach(var boundary in new[]{"prepared","moved","observed"}) {
            var f=new Fixture(Path.Combine(root,"native-"+boundary));f.Init();var inspected=await f.Engine.InspectPathCollisionAsync(Local,RemoteId);var operation=Guid.NewGuid().ToString();
            var hook=typeof(TextPackStore).GetProperty("MoveObservationForTesting",System.Reflection.BindingFlags.NonPublic|System.Reflection.BindingFlags.Instance)!;hook.SetValue(f.Store,(Action<string>)(point=>{if(point==boundary)throw new IOException("native interruption");}));
            try{await f.Engine.KeepBothPathCollisionAsync(inspected,operation);}catch(IOException){}hook.SetValue(f.Store,null);
            var restarted=Test.NewOwnedPathSync(f.Store,f.Transport);var result=await restarted.KeepBothPathCollisionAsync(inspected,operation);await restarted.SyncAsync();
            check(f.Transport.Uploads==1&&f.Store.Read(Source).SequenceEqual(f.RemoteBytes)&&f.Store.Read(result.LocalPath).SequenceEqual(f.LocalBytes),"native retained move "+boundary+" resumes without overwrite or operation loss");
        }
        foreach(var change in new[]{"remote-revision","local-bytes","destination","remote-local-id","permission","account","duplicate-operation"}) {
            var f=new Fixture(Path.Combine(root,change));f.Init();var inspected=await f.Engine.InspectPathCollisionAsync(Local,RemoteId);
            switch(change){case "remote-revision":f.Transport.Revision="new-revision";break;case "local-bytes":f.Store.Write(Source,Pack(Local,"changed after review"),TextPackStore.Hash(f.LocalBytes));break;case "destination":f.Store.Write(inspected.DestinationPath,Pack(Guid.NewGuid().ToString(),"independent destination"));break;case "remote-local-id":f.Transport.LocalTombstone=true;break;case "permission":f.Transport.Permitted=false;break;case "account":f.Transport.Scope=Test.PathScope with{AccountId="other-account"};break;case "duplicate-operation":var damaged=f.State();damaged.Outbox.Add(f.LocalOperation with{ItemId=Guid.NewGuid().ToString()});File.WriteAllBytes(Path.Combine(f.Store.StateDirectory,"sync.json"),JsonSerializer.SerializeToUtf8Bytes(damaged));break;}
            var before=File.ReadAllBytes(Path.Combine(f.Store.StateDirectory,"sync.json"));var refused=false;
            try{await f.Engine.KeepBothPathCollisionAsync(inspected,Guid.NewGuid().ToString());}catch(Exception error)when(error is IOException or UnauthorizedAccessException or SharedAccountMismatchException){refused=true;}
            check(refused&&before.SequenceEqual(File.ReadAllBytes(Path.Combine(f.Store.StateDirectory,"sync.json")))&&f.Transport.Uploads==0&&File.Exists(f.Store.Resolve(Source)),"stale "+change+" refuses before journal or local move");
        }
    }
    sealed class Remote(byte[] bytes):ISyncTransport {
        public int Uploads;public bool LocalTombstone,Permitted=true;public string Revision=TextPackStore.Hash(bytes);public ProtectedRenameScope Scope=Test.PathScope;byte[]? uploaded;string? uploadedPath;
        public ProtectedRenameScope? ProtectedRenameBinding=>Scope;
        public WorkspaceCapabilities? Capabilities=>new(Permitted,Permitted,[],new(){[Local]=Permitted,[RemoteId]=Permitted});
        public IReadOnlyList<string> Folders=>["Notes"];
        public Task<IReadOnlyList<RemoteItem>> ManifestAsync(CancellationToken ct=default)=>Task.FromResult<IReadOnlyList<RemoteItem>>([new(RemoteId,Source,Revision,Lifecycle:"remote-generation"),..(uploaded is null?(LocalTombstone?new[]{new RemoteItem(Local,"Old.textpack","old",true,Lifecycle:"old-generation")}:Array.Empty<RemoteItem>()):new[]{new RemoteItem(Local,uploadedPath!,TextPackStore.Hash(uploaded),Lifecycle:"new-generation")})]);
        public Task<RemotePack> DownloadAsync(string id,CancellationToken ct=default)=>Task.FromResult(id==RemoteId?new RemotePack(bytes,Source,Revision):new RemotePack(uploaded!,uploadedPath!,TextPackStore.Hash(uploaded!)));
        public Task<string> UploadAsync(string id,string path,byte[] data,string? revision,string operation,CancellationToken ct=default){if(id!=Local||revision is not null)throw new Exception("unexpected upload");Uploads++;uploaded=data;uploadedPath=path;return Task.FromResult(TextPackStore.Hash(data));}
        public Task<string> RenameAsync(string id,string from,string to,string revision,string operation,CancellationToken ct=default)=>throw new Exception("unexpected remote rename");
        public Task DeleteAsync(string id,string path,string revision,string operation,CancellationToken ct=default)=>throw new Exception("unexpected delete");
    }
}
