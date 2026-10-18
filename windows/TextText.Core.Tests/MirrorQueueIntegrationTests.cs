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
}
