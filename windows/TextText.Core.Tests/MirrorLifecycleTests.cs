using System.IO.Compression;
using System.Text.Json;
using TextText.Core;

static class MirrorLifecycleTests
{
    static byte[] Pack(string body) {
        using var output=new MemoryStream();
        using(var zip=new ZipArchive(output,ZipArchiveMode.Create,true))
        using(var writer=new StreamWriter(zip.CreateEntry("text.md").Open()))writer.Write("---\ntextTextId: \"lifecycle-item\"\n---\n"+body);
        return output.ToArray();
    }
    public static async Task Run(string temp,Action<bool,string> check) {
        foreach(var scenario in new[]{"restore-during-rpc","missing-payload","corrupt-payload","legacy-fenced","legacy-conflict-kind","rename-without-payload","policy-retired"}) {
            var store=new TextPackStore(Path.Combine(temp,"lifecycle-"+scenario),Path.Combine(temp,"lifecycle-state-"+scenario));
            var bytes=Pack("retained local edit");var local=store.Write("Note.textpack",bytes);
            var remoteBytes=Pack("restored remote");var revision=TextPackStore.Hash(remoteBytes);
            var remote=new Test.Fake{Data=remoteBytes,Item=new(local.ItemId,local.Path,revision,Lifecycle:"restored")};
            var legacy=scenario.StartsWith("legacy-");
            var operation=new SyncEngine.Operation("original-operation",scenario=="legacy-conflict-kind"?"conflict":scenario=="rename-without-payload"?"rename":"upload",local.ItemId,local.Path,
                scenario=="rename-without-payload"?"Moved.textpack":null,legacy?revision:"old-revision",local.Hash,
                scenario is "missing-payload" or "rename-without-payload"?null:Convert.ToBase64String(scenario=="corrupt-payload"?[1,2,3]:bytes),legacy);
            var state=new SyncEngine.State();state.Items[local.ItemId]=new(local.Path,local.Hash,operation.Revision!);state.Outbox.Add(operation);
            var statePath=Path.Combine(store.StateDirectory,"sync.json");TextPackStore.AtomicWrite(statePath,JsonSerializer.SerializeToUtf8Bytes(state));
            var before=File.ReadAllBytes(statePath);var changed=false;
            var policy=NativePolicyTestHost.Create(beforeRequest:script=>{
                if(script.Contains(".lifecycle(")) {
                    if(scenario=="restore-during-rpc")remote.Item=remote.Item! with{Lifecycle="second-restore",Revision="second-revision"};
                    if(scenario=="policy-retired")throw new MirrorPolicyUnavailableException("Fixture replaced page");
                }
                return Task.CompletedTask;
            });
            try {await new SyncEngine(store,remote,mirrorPolicy:policy).SyncAsync();}
            catch(Exception error) when(error is FileChangedException or InvalidDataException or MirrorPolicyUnavailableException) {changed=true;}
            if(scenario is "restore-during-rpc" or "missing-payload" or "corrupt-payload" or "policy-retired") {
                check(changed&&File.ReadAllBytes(statePath).SequenceEqual(before),"lifecycle "+scenario+" preserves exact durable operation and journal");
            } else {
                var after=JsonSerializer.Deserialize<SyncEngine.State>(File.ReadAllBytes(statePath))!;
                check(after.Outbox.Count==1&&after.Outbox[0]==operation with{Conflicted=true,Lifecycle=legacy?"restored":null},"lifecycle "+scenario+" retains original identity payload and conflict fence");
                var manifests = remote.ManifestCount;
                await Test.NewSync(store,remote).SyncAsync();
                check(remote.ManifestCount==manifests+1,"no-op lifecycle batch does not add a manifest refresh");
                check(JsonSerializer.Deserialize<SyncEngine.State>(File.ReadAllBytes(statePath))!.Outbox.Single().Id==operation.Id,"lifecycle fenced operation survives restart");
            }
            check(store.Read(local.Path).SequenceEqual(bytes)&&remote.UploadCount==0&&remote.DeleteCount==0,"lifecycle "+scenario+" does not write competing content");
        }
    }
}
