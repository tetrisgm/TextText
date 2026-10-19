using System.IO.Compression;
using System.Text.Json;
using TextText.Core;

// Production engine + shared TypeScript policy; transport and disk journal are isolated fixtures.
static class MirrorQueueIntegrationTests
{
    sealed class Remote : ISyncTransport {
        public readonly Dictionary<string,RemotePack> Files = [];
        public readonly List<(string Id,string Item,string Path,byte[] Payload)> Sent = [];
        public int AttemptedUploads;
        public readonly List<(string Id,byte[]? Payload)> BinarySent = [];
        public WorkspaceCapabilities Grant = new(true,true,[],[]);
        public WorkspaceCapabilities? Capabilities => Grant;
        public Task<IReadOnlyList<RemoteItem>> ManifestAsync(CancellationToken ct=default) => Task.FromResult<IReadOnlyList<RemoteItem>>(Files.Select(pair=>new RemoteItem(pair.Key,pair.Value.RelativePath,pair.Value.Revision)).ToArray());
        public Task<RemotePack> DownloadAsync(string id,CancellationToken ct=default) => Task.FromResult(Files[id]);
        public Task<string> UploadAsync(string id,string path,byte[] data,string? revision,string operation,CancellationToken ct=default) {
            AttemptedUploads++;
            if(!Grant.CanWrite(id,path,revision is not null))throw new InvalidOperationException("Queue sent with revoked permission.");
            if(Files[id].Revision!=revision)throw new SyncConflictException();
            Sent.Add((operation,id,path,data.ToArray()));var hash=TextPackStore.Hash(data);Files[id]=new(data.ToArray(),path,hash);return Task.FromResult(hash);
        }
        public Task<string> BinaryPatchAsync(string id,string operation,string entry,string? expected,string? lifecycle,byte[]? bytes,CancellationToken ct=default) {
            BinarySent.Add((operation,bytes?.ToArray()));
            var pack=Files[id];var patched=BinaryEntryPacks.Patch(pack.Data,entry,expected,bytes);var revision=TextPackStore.Hash(patched);
            Files[id]=new(patched,pack.RelativePath,revision);return Task.FromResult(revision);
        }
        public Task<string> RenameAsync(string id,string from,string to,string revision,string operation,CancellationToken ct=default) => throw new InvalidOperationException("Unexpected queue rename.");
        public Task DeleteAsync(string id,string path,string revision,string operation,CancellationToken ct=default) => throw new InvalidOperationException("Unexpected queue delete.");
    }
    sealed record Fixture(TextPackStore Store,Remote Remote,SyncEngine.Operation[] Operations,string StatePath);
    static byte[] Pack(string id,string body) {
        using var output=new MemoryStream();using(var zip=new ZipArchive(output,ZipArchiveMode.Create,true)) {
            using(var writer=new StreamWriter(zip.CreateEntry("text.md").Open()))writer.Write($"---\ntextTextId: \"{id}\"\n---\n{body}");
            using(var writer=new StreamWriter(zip.CreateEntry("opaque.bin").Open()))writer.Write("preserve opaque bytes "+id);
        }return output.ToArray();
    }
    static Fixture Make(string temp,string name,int count) {
        var store=new TextPackStore(Path.Combine(temp,name),Path.Combine(temp,name+"-state"));var remote=new Remote();var state=new SyncEngine.State();var operations=new List<SyncEngine.Operation>();
        for(var i=0;i<count;i++) {
            var id="queue-item-"+i.ToString("D3");var path="Note-"+i.ToString("D3")+".textpack";var original=Pack(id,"remote original "+i);var revision=TextPackStore.Hash(original);var pending=Pack(id,"retained exact payload "+i);var file=store.Write(path,pending);
            remote.Files[id]=new(original,path,revision);remote.Grant.Items[id]=true;
            var operation=new SyncEngine.Operation("queue-operation-"+(count-i).ToString("D3"),"upload",id,path,null,revision,file.Hash,Convert.ToBase64String(pending));
            state.Items[id]=new(path,revision,revision);state.Outbox.Add(operation);operations.Add(operation);
        }
        state.Capabilities=remote.Grant;var statePath=Path.Combine(store.StateDirectory,"sync.json");TextPackStore.AtomicWrite(statePath,JsonSerializer.SerializeToUtf8Bytes(state));return new(store,remote,operations.ToArray(),statePath);
    }
    static SyncEngine.State State(Fixture f) => JsonSerializer.Deserialize<SyncEngine.State>(File.ReadAllBytes(f.StatePath))!;
    public static async Task Run(string temp,Action<bool,string> check) {
        await BinaryQueueFences(temp,check);
        var f=Make(temp,"queue-budget",129);var engine=new SyncEngine(f.Store,f.Remote,mirrorPolicy:NativePolicyTestHost.Create());await engine.SyncAsync();
        check(f.Remote.Sent.Count==128&&engine.HasEligiblePending&&engine.Status.Pending==1,"queue shared policy enforces Windows128 pass budget and hasMore for129 retained uploads");
        check(f.Remote.Sent.Select(x=>x.Id).SequenceEqual(f.Operations.Take(128).Select(x=>x.Id)),"queue sends captured FIFO operation IDs without lexical resort or regeneration");
        check(f.Remote.Sent.Select((sent,i)=>sent.Item==f.Operations[i].ItemId&&sent.Path==f.Operations[i].Path&&sent.Payload.SequenceEqual(Convert.FromBase64String(f.Operations[i].Payload!))).All(x=>x),"queue retains every captured identity path and opaque ZIP payload");
        check(State(f).Outbox.SequenceEqual(f.Operations.Skip(128)),"queue budget persists exact129th operation unchanged");
        var restarted=new SyncEngine(f.Store,f.Remote,mirrorPolicy:NativePolicyTestHost.Create());await restarted.SyncAsync();
        check(f.Remote.Sent.Count==129&&f.Remote.Sent.Last().Id==f.Operations.Last().Id&&f.Remote.Sent.Last().Payload.SequenceEqual(Convert.FromBase64String(f.Operations.Last().Payload!))&&State(f).Outbox.Count==0&&!restarted.HasEligiblePending,"queue restart replays exact remaining intent once without fresh IDs or payload rewrite");
        foreach(var scenario in new[]{"permission","protected-journal","stale-policy","unavailable-policy"}) {
            var q=Make(temp,"queue-"+scenario,1);var original=q.Operations.Single();MirrorPolicy? policy=null;var changed=false;
            policy=NativePolicyTestHost.Create(beforeRequest:script=>{
                if(!changed&&script.Contains(".queue(")) {
                    changed=true;
                    if(scenario=="permission")q.Remote.Grant=new(false,false,[],new(){{original.ItemId,false}});
                    if(scenario=="protected-journal") {
                        var directory=Path.Combine(q.Store.StateDirectory,"shared-editing",original.ItemId);Directory.CreateDirectory(directory);
                        var checkpoint=new SharedCheckpoint(original.ItemId,original.Path,original.Hash,original.Revision!,1,0,1,"{}",true);
                        TextPackStore.AtomicWrite(Path.Combine(directory,"checkpoint.json"),JsonSerializer.SerializeToUtf8Bytes(checkpoint));
                    }
                    if(scenario=="stale-policy")policy!.Retire();
                    if(scenario=="unavailable-policy")throw new IOException("Injected unavailable policy page.");
                }return Task.CompletedTask;
            });
            var queue=new SyncEngine(q.Store,q.Remote,mirrorPolicy:policy);Exception? failure=null;try{await queue.SyncAsync();}catch(Exception error){failure=error;}
            check(changed,"queue "+scenario+" reaches actual shared queue RPC");
            if(scenario is "stale-policy" or "unavailable-policy")check(failure is IOException or TimeoutException,"queue "+scenario+" refuses unavailable or retired decision");
            else check(failure is null,"queue "+scenario+" refuses stale captured send without transport mutation");
            check(q.Remote.AttemptedUploads==0&&q.Remote.Sent.Count==0&&State(q).Outbox.SequenceEqual(q.Operations),"queue "+scenario+" retains original durable IDs identity path and payload");
            check(q.Store.Read(original.Path).SequenceEqual(Convert.FromBase64String(original.Payload!)),"queue "+scenario+" leaves local bytes unchanged");
        }
    }
    static async Task BinaryQueueFences(string temp,Action<bool,string> check) {
        foreach(var scenario in new[]{"permission","unavailable-policy","editor-owned"}) {
            var f=Make(temp,"binary-queue-"+scenario,1);var id=f.Operations[0].ItemId;var path=f.Operations[0].Path;
            var original=BinaryEntryPacks.Patch(f.Remote.Files[id].Data,"assets/data.bin",null,[1,2]);
            var local=BinaryEntryPacks.Patch(original,"assets/data.bin",TextPackStore.Hash([1,2]),[3,4,255]);
            var old=f.Store.Describe(path);var file=f.Store.Write(path,local,old.Hash);var revision=TextPackStore.Hash(original);
            f.Remote.Files[id]=new(original,path,revision);
            var operation=new SyncEngine.BinaryPending(Guid.NewGuid().ToString(),id,"assets/data.bin",TextPackStore.Hash([1,2]),null,null,file.Hash,
                PayloadHash:TextPackStore.Hash([3,4,255]),SourcePath:path);
            var state=new SyncEngine.State{Capabilities=f.Remote.Grant};state.Items[id]=new(path,revision,revision);
            state.BinaryBaselines[id]=new(){{"assets/data.bin",TextPackStore.Hash([1,2])}};state.BinaryOutbox.Add(operation);
            TextPackStore.AtomicWrite(f.StatePath,JsonSerializer.SerializeToUtf8Bytes(state));
            var payloadPath=Path.Combine(f.Store.StateDirectory,"binary-outbox",operation.Id+".asset");TextPackStore.AtomicWrite(payloadPath,[3,4,255]);
            if(scenario=="editor-owned") {
                var dir=Path.Combine(f.Store.StateDirectory,"shared-editing",id);Directory.CreateDirectory(dir);
                TextPackStore.AtomicWrite(Path.Combine(dir,"checkpoint.json"),JsonSerializer.SerializeToUtf8Bytes(new SharedCheckpoint(id,path,file.Hash,revision,1,0,1,"{}",true)));
            }
            var observed=false;var ownership=false;
            var policy=NativePolicyTestHost.Create(beforeRequest:script=>{
                if(script.Contains(".queue(")&&script.Contains("\"lane\":\"binary\"")) {
                    observed=true;ownership=script.Contains("\"editorOwned\":true");
                    if(scenario=="permission")f.Remote.Grant=new(false,false,[],new(){{id,false}});
                    if(scenario=="unavailable-policy")throw new IOException("Injected unavailable binary policy.");
                }return Task.CompletedTask;
            });
            try{await new SyncEngine(f.Store,f.Remote,mirrorPolicy:policy).SyncAsync();}catch(IOException)when(scenario=="unavailable-policy"){}
            check(observed,"binary "+scenario+" consults actual shared binary lane before CAS");
            if(scenario=="editor-owned") {
                check(ownership&&f.Remote.BinarySent.Count==1,"binary lane truthfully captures active editor and permits existing asset CAS semantics");
            } else {
                check(f.Remote.BinarySent.Count==0&&State(f).BinaryOutbox.SequenceEqual(new[]{operation})&&File.ReadAllBytes(payloadPath).SequenceEqual(new byte[]{3,4,255}),"binary "+scenario+" keeps exact durable identity and staged payload without attempted send");
                f.Remote.Grant=new(true,true,[],new(){{id,true}});
                await new SyncEngine(f.Store,f.Remote,mirrorPolicy:NativePolicyTestHost.Create()).SyncAsync();
                check(f.Remote.BinarySent.Count==1&&f.Remote.BinarySent[0].Id==operation.Id&&f.Remote.BinarySent[0].Payload!.SequenceEqual(new byte[]{3,4,255})&&State(f).BinaryOutbox.Count==0,"binary restart retries exact original ID and bytes after authority returns");
            }
        }
    }

}
