using System.IO.Compression;
using System.Text.Json;
using TextText.Core;

// Actual native Store/Sync fixtures with a controlled transport, not physical
// authenticated client acceptance. Program registration is owned separately.
static class MirrorTombstoneIntegrationTests
{
    public static async Task Run(string temp, Action<bool,string> check)
    {
        var results=new List<(bool Passed,string Message)>();
        foreach(var kind in new[]{"revision","path","unknown","generation","exact"}) {
            var expectedRemoval=kind=="exact";
            var suffix=Guid.NewGuid().ToString("N");
            var store=new TextPackStore(Path.Combine(temp,"tombstone-"+kind+"-"+suffix),Path.Combine(temp,"tombstone-state-"+suffix));
            const string id="b1111111-1111-4111-8111-111111111111", path="Notes/Tombstone.textpack";
            var generation=kind=="unknown"?null:"generation-a";
            var bytes=Pack(id,generation);var revision=TextPackStore.Hash(bytes);
            var remote=new Test.Fake{Data=bytes,Item=new(id,path,revision,Lifecycle:generation)};
            await Test.NewSync(store,remote).SyncAsync();
            results.Add((store.Read(path).SequenceEqual(bytes),kind+": initial projection is exact"));
            remote.Item=new(id,kind=="path"?"Moved/Tombstone.textpack":path,kind=="revision"?new string('b',64):revision,Deleted:true,Lifecycle:kind=="generation"?"generation-b":generation);
            await Test.NewSync(store,remote).SyncAsync();
            var exists=File.Exists(store.Resolve(path));
            results.Add((exists==!expectedRemoval,kind+": strict portable tombstone projection disposition"));
            results.Add((!exists||store.Read(path).SequenceEqual(bytes),kind+": any remaining projection is unchanged"));
            results.Add((Contains(store,bytes),kind+": exact original bytes retained"));
            var uploads=remote.UploadCount;var deletes=remote.DeleteCount;
            await Test.NewSync(new TextPackStore(store.Root,store.StateDirectory),remote).SyncAsync();
            results.Add((File.Exists(store.Resolve(path))==!expectedRemoval,kind+": restart preserves disposition"));
            results.Add((Contains(store,bytes)&&remote.UploadCount==uploads&&remote.DeleteCount==deletes,kind+": restart retains bytes without resurrection"));
        }
        await Boundaries(temp,results);
        await PendingRename(temp,results);
        File.WriteAllText(Path.Combine(temp,"mirror-tombstone-observations.json"),JsonSerializer.Serialize(results.Select(x=>new{passed=x.Passed,message=x.Message})));
        foreach(var result in results)check(result.Passed,result.Message);
    }
    static async Task Boundaries(string temp,List<(bool Passed,string Message)> results) {
        const string id="b2222222-2222-4222-8222-222222222222",path="Notes/Boundary.textpack";
        foreach(var mode in new[]{"hash","duplicate","restore","authority","no-local","editor","closed-checkpoint","delete-intent","conflict","pending-outbox"}) {
            var suffix=Guid.NewGuid().ToString("N");
            var store=new TextPackStore(Path.Combine(temp,"tombstone-boundary-"+suffix),Path.Combine(temp,"tombstone-boundary-state-"+suffix));
            var bytes=Pack(id,"generation-a");var hash=TextPackStore.Hash(bytes);
            var remote=new Test.Fake{Data=bytes,Item=new(id,path,hash,Lifecycle:"generation-a")};
            await Test.NewSync(store,remote).SyncAsync();
            var statePath=Path.Combine(store.StateDirectory,"sync.json");
            var before=JsonSerializer.Deserialize<SyncEngine.State>(File.ReadAllBytes(statePath))!;
            remote.Item=remote.Item! with{Deleted=true};
            var injected=false;
            var policy=NativePolicyTestHost.Create(beforeRequest:script=>{
                if(!script.Contains(".tombstone(")||injected)return Task.CompletedTask;injected=true;
                if(mode=="hash")File.WriteAllBytes(store.Resolve(path),Pack(id,"generation-b"));
                if(mode=="duplicate")File.WriteAllBytes(store.Resolve("Notes/Duplicate.textpack"),bytes);
                if(mode=="restore")remote.Item=remote.Item! with{Deleted=false,Lifecycle="generation-b"};
                if(mode=="authority")remote.Capabilities=new(false,false,[],new Dictionary<string,bool>());
                return Task.CompletedTask;
            });
            var sync=new SyncEngine(store,remote,mirrorPolicy:policy);
            using var editing=new SharedEditingStore(store,sync);
            if(mode is "conflict" or "pending-outbox") {
                File.WriteAllBytes(store.Resolve(path),Pack(id,"generation-local"));
                if(mode=="pending-outbox") {
                    remote.Item=remote.Item! with{Deleted=false};remote.FailBeforeCommit=true;
                    try{await sync.SyncAsync();}catch(HttpRequestException) { }
                    remote.Item=remote.Item! with{Deleted=true};
                    remote.Capabilities=new(false,false,[],new Dictionary<string,bool>{{id,false}});
                } else await sync.SyncAsync();
            }
            if(mode=="closed-checkpoint") {
                var session=await editing.OpenAsync(id,path,hash);
                var journal=JsonSerializer.Serialize(new{version=1,epoch=1,seq=0,journalGeneration=1,revision=hash,relativePath=path,update="AAA=",pending=Array.Empty<string>()});
                await editing.CheckpointAsync(session.SessionToken,hash,bytes,new(id,path,hash,hash,1,0,1,journal,false));
                editing.Close(session.SessionToken);
            }
            if(mode=="delete-intent")store.Delete(path,hash);
            else if(mode is "no-local" or "closed-checkpoint" or "conflict" or "pending-outbox")File.Delete(store.Resolve(path));
            before=JsonSerializer.Deserialize<SyncEngine.State>(File.ReadAllBytes(statePath))!;
            var intentBefore=store.Intent(id);
            var sharedPath=Path.Combine(store.StateDirectory,"shared-editing",id);
            var journalsBefore=Directory.Exists(sharedPath)?Directory.GetFiles(sharedPath).ToDictionary(x=>Path.GetFileName(x),x=>TextPackStore.Hash(File.ReadAllBytes(x))):new Dictionary<string,string>();
            if(mode=="editor")await editing.OpenAsync(id,path,hash);
            try{await sync.SyncAsync();}catch(FileChangedException) { }
            var after=JsonSerializer.Deserialize<SyncEngine.State>(File.ReadAllBytes(statePath))!;
            results.Add((mode is "no-local" or "editor" or "closed-checkpoint" or "delete-intent" or "conflict" or "pending-outbox"||injected,mode+": actual policy boundary reached or native ownership defers"));
            results.Add((JsonSerializer.Serialize(before.Items)==JsonSerializer.Serialize(after.Items)&&JsonSerializer.Serialize(before.Outbox)==JsonSerializer.Serialize(after.Outbox)&&JsonSerializer.Serialize(before.SharedRenames)==JsonSerializer.Serialize(after.SharedRenames),mode+": retained baseline/outbox/rename metadata unchanged"));
            results.Add((mode is "no-local" or "closed-checkpoint" or "delete-intent" or "conflict" or "pending-outbox"?!File.Exists(store.Resolve(path)):File.Exists(store.Resolve(path)),mode+": no unverified projection removal or recreation"));
            var journalsAfter=Directory.Exists(sharedPath)?Directory.GetFiles(sharedPath).ToDictionary(x=>Path.GetFileName(x),x=>TextPackStore.Hash(File.ReadAllBytes(x))):new Dictionary<string,string>();
            results.Add((store.Intent(id)==intentBefore&&JsonSerializer.Serialize(journalsAfter)==JsonSerializer.Serialize(journalsBefore),mode+": actual deletion intent and retained checkpoint bytes unchanged"));
            results.Add((remote.UploadCount==0&&remote.DeleteCount==0,mode+": no remote mutation"));
        }
    }
    static async Task PendingRename(string temp,List<(bool Passed,string Message)> results) {
        const string id="b3333333-3333-4333-8333-333333333333",path="Original.textpack",destination="Moved.textpack";
        var suffix=Guid.NewGuid().ToString("N");var store=Test.OwnedPathStore(Path.Combine(temp,"tombstone-rename-"+suffix),Path.Combine(temp,"tombstone-rename-state-"+suffix));
        var bytes=Pack(id,"generation-a");var hash=TextPackStore.Hash(bytes);
        var remote=new Test.Fake{Data=bytes,Item=new(id,path,hash,Lifecycle:"generation-a"),ProtectedRenameBinding=Test.PathScope,Capabilities=new(true,true,[],new(){{id,true}})};
        var transport=new LostRename(remote);var sync=Test.NewOwnedPathSync(store,transport);await sync.SyncAsync();
        using var editing=new SharedEditingStore(store,sync,Test.PathAccount);var session=await editing.OpenAsync(id,path,hash);
        var journal=JsonSerializer.Serialize(new{version=1,accountId=Test.PathAccount,epoch=1,seq=0,journalGeneration=1,revision=hash,relativePath=path,update="AAA=",pending=new[]{"AAA="}});
        await editing.CheckpointAsync(session.SessionToken,hash,bytes,new(id,path,hash,hash,1,0,1,journal,true));
        File.Move(store.Resolve(path),store.Resolve(destination));
        try{await sync.SyncAsync();}catch(HttpRequestException) { }
        var statePath=Path.Combine(store.StateDirectory,"sync.json");var retained=JsonSerializer.Deserialize<SyncEngine.State>(File.ReadAllBytes(statePath))!;
        results.Add((retained.ProtectedRenames.Count==1&&transport.Attempts==1,"pending rename: actual protected path persists immutable command before lost reply"));
        editing.Close(session.SessionToken);File.Delete(store.Resolve(destination));remote.Item=remote.Item! with{Deleted=true};
        var stateBefore=File.ReadAllBytes(statePath);var intentBefore=store.Intent(id);var directory=Path.Combine(store.StateDirectory,"shared-editing",id);
        var journals=Directory.GetFiles(directory).ToDictionary(x=>Path.GetFileName(x),x=>TextPackStore.Hash(File.ReadAllBytes(x)));
        await sync.SyncAsync();
        results.Add((File.ReadAllBytes(statePath).SequenceEqual(stateBefore),"pending rename: absent tombstone preserves exact durable sync state including nonempty rename/outbox/baseline"));
        results.Add((store.Intent(id)==intentBefore&&Directory.GetFiles(directory).Count()==journals.Count&&Directory.GetFiles(directory).All(x=>journals[Path.GetFileName(x)]==TextPackStore.Hash(File.ReadAllBytes(x))),"pending rename: checkpoint and intent bytes unchanged"));
        results.Add((transport.Attempts==1&&!File.Exists(store.Resolve(path))&&!File.Exists(store.Resolve(destination)),"pending rename: tombstone does not replay rename or recreate projection"));
    }
    sealed class LostRename(Test.Fake inner):ISyncTransport {
        public int Attempts;
        public ProtectedRenameScope? ProtectedRenameBinding=>inner.ProtectedRenameBinding;
        public WorkspaceCapabilities? Capabilities=>inner.Capabilities;
        public Task<ProtectedRenameReceipt> ProtectedRenameAsync(ProtectedRenameRequest request,CancellationToken ct=default){Attempts++;throw new HttpRequestException("Controlled lost typed rename reply");}
        public Task<IReadOnlyList<RemoteItem>> ManifestAsync(CancellationToken ct=default)=>inner.ManifestAsync(ct);
        public Task<RemotePack> DownloadAsync(string id,CancellationToken ct=default)=>inner.DownloadAsync(id,ct);
        public Task<string> UploadAsync(string id,string path,byte[] bytes,string? revision,string operation,CancellationToken ct=default)=>inner.UploadAsync(id,path,bytes,revision,operation,ct);
        public Task<string> RenameAsync(string id,string from,string to,string revision,string operation,CancellationToken ct=default){Attempts++;throw new HttpRequestException("Controlled lost rename reply");}
        public Task DeleteAsync(string id,string path,string revision,string operation,CancellationToken ct=default)=>inner.DeleteAsync(id,path,revision,operation,ct);
        public Task<RemoteBinaryManifest> BinaryManifestAsync(string id,CancellationToken ct=default)=>inner.BinaryManifestAsync(id,ct);
        public Task<byte[]> BinaryReadAsync(string id,string path,CancellationToken ct=default)=>inner.BinaryReadAsync(id,path,ct);
    }
    static bool Contains(TextPackStore store,byte[] bytes)=>new[]{store.Root,store.StateDirectory}.Distinct().Any(root=>Directory.EnumerateFiles(root,"*.textpack",SearchOption.AllDirectories).Any(file=>File.ReadAllBytes(file).SequenceEqual(bytes)));
    static byte[] Pack(string id,string? generation) {
        using var output=new MemoryStream();
        using(var zip=new ZipArchive(output,ZipArchiveMode.Create,true)) {
            using(var writer=new StreamWriter(zip.CreateEntry("text.md").Open()))writer.Write("---\ntextTextId: \""+id+"\"\ntitle: Tombstone\n---\nExact original bytes");
            using(var writer=new BinaryWriter(zip.CreateEntry("unknown.bin").Open()))writer.Write(new byte[]{0,1,255,13,10});
            if(generation is not null)using(var writer=new StreamWriter(zip.CreateEntry("texttext-lifecycle.json").Open()))writer.Write(JsonSerializer.Serialize(new{version=1,generation}));
        }
        return output.ToArray();
    }
}
