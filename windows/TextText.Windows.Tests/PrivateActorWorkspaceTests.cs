#if TEXTTEXT_STRESS_ACTOR
using System.IO.Compression;
using System.Text;
using System.Text.Json;
using TextText.Core;
using TextText.Windows;
static class PrivateActorWorkspaceTests
{
    sealed class Seed(string id,string path,byte[] pack) : ISyncTransport {
        public int Manifests,Downloads;
        public Task<IReadOnlyList<RemoteItem>> ManifestAsync(CancellationToken ct=default){Manifests++;return Task.FromResult<IReadOnlyList<RemoteItem>>([new(id,path,TextPackStore.Hash(pack),Lifecycle:"generation-1")]);}
        public Task<RemotePack> DownloadAsync(string itemId,CancellationToken ct=default){Downloads++;return itemId==id?Task.FromResult(new RemotePack(pack,path,TextPackStore.Hash(pack))):throw new IOException("Unknown fixture item");}
        public Task<string> UploadAsync(string itemId,string path,byte[] data,string? revision,string operation,CancellationToken ct=default)=>throw new IOException("No fixture writes authorized");
        public Task<string> RenameAsync(string itemId,string from,string to,string revision,string operation,CancellationToken ct=default)=>throw new IOException("No fixture writes authorized");
        public Task DeleteAsync(string itemId,string path,string revision,string operation,CancellationToken ct=default)=>throw new IOException("No fixture writes authorized");
    }
    public static async Task Run(Action<bool,string> check) {
        void Refuse(Action action,string label){try{action();}catch(Exception e)when(e is IOException or InvalidDataException or JsonException){check(true,label);return;}throw new Exception("Expected refusal: "+label);}
        var parent=Path.Combine(Path.GetTempPath(),"texttext-isolated-actor-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(parent);
        var session=Path.Combine(parent,"bootstrap-relay","generation-001");Directory.CreateDirectory(session);
        var root=Path.Combine(parent,"vault");var workspace=Guid.NewGuid().ToString();var item=Guid.NewGuid().ToString();var title="Six-client acceptance isolated fixture";var file=Path.Combine(root,"Notes",title+".textpack");var origin=new Uri("https://texttext.app");
        var config=new PrivateActorWorkspace.Isolation(1,root,parent);
        PrivateActorWorkspace Scope(PrivateActorWorkspace.Isolation? value=null,string? path=null)=>new(value??config,session,path??file,workspace,item,title);
        check(PrivateActorWorkspace.ParseIsolation(JsonSerializer.SerializeToElement(new{version=1,root,sessionRoot=parent}))==config,"canonical isolation schema accepted");
        foreach(var raw in new[]{"{\"version\":true,\"root\":\"x\",\"sessionRoot\":\"x\"}","{\"version\":1,\"root\":\"x\",\"sessionRoot\":\"x\",\"extra\":1}","{\"version\":1,\"root\":\"x\"}","null"})Refuse(()=>PrivateActorWorkspace.ParseIsolation(JsonDocument.Parse(raw).RootElement),"invalid isolation shape refused");
        var oneLevel=Path.Combine(parent,"generation-001");Directory.CreateDirectory(oneLevel);Refuse(()=>new PrivateActorWorkspace(config,oneLevel,file,workspace,item,title),"one-level generation refuses runner scope");
        var threeLevel=Path.Combine(parent,"extra","relay","generation-001");Directory.CreateDirectory(threeLevel);Refuse(()=>new PrivateActorWorkspace(config,threeLevel,file,workspace,item,title),"three-level generation refuses runner scope");
        var foreignSession=Path.Combine(parent+"-foreign","relay","generation-001");Directory.CreateDirectory(foreignSession);Refuse(()=>new PrivateActorWorkspace(config,foreignSession,file,workspace,item,title),"cross-parent generation refuses runner scope");
        var invalidGeneration=Path.Combine(parent,"bootstrap-relay","generation-000");Directory.CreateDirectory(invalidGeneration);Refuse(()=>new PrivateActorWorkspace(config,invalidGeneration,file,workspace,item,title),"invalid generation name refused");
        var invalidRelay=Path.Combine(parent,"invalid relay","generation-001");Directory.CreateDirectory(invalidRelay);Refuse(()=>new PrivateActorWorkspace(config,invalidRelay,file,workspace,item,title),"invalid relay name refused");
        var scope=Scope();check(!Directory.Exists(root),"isolation validation does not create vault or ownership");
        Refuse(()=>Scope(config with{Version=2}),"future isolation refused");
        Refuse(()=>Scope(config with{Root=Path.Combine(parent,"other")}),"arbitrary root refused");
        Refuse(()=>Scope(config with{SessionRoot=Path.GetTempPath()}),"foreign runner parent refused");
        Refuse(()=>Scope(path:Path.Combine(parent,"outside.textpack")),"outside fixture refused");
        Directory.CreateDirectory(root);File.WriteAllText(Path.Combine(root,"unowned.txt"),"keep");
        Refuse(()=>Scope(),"nonempty fresh root refused");Refuse(()=>scope.PrepareVerified(origin,"account"),"changed fresh membership refused before receipt");check(!File.Exists(Path.Combine(parent,"isolated-workspace-scope.json")),"failed preparation publishes no scope");
        File.Move(Path.Combine(root,"unowned.txt"),Path.Combine(parent,"retained-unowned.txt"));
        Refuse(()=>scope.PrepareVerified(new Uri("https://user@texttext.app"),"account"),"credential-bearing origin refused");
        scope.PrepareVerified(origin,"account");check(Directory.Exists(root),"verified fresh root prepared");
        var receipt=Path.Combine(parent,"isolated-workspace-scope.json");var receiptBytes=File.ReadAllBytes(receipt);
        check(!Encoding.UTF8.GetString(receiptBytes).Contains("account\""),"scope retains principal hash instead of credential or account plaintext");
        Refuse(()=>scope.PrepareVerified(origin,"account"),"interrupted prebinding cannot auto-adopt on reopen");
        WorkspaceLocation.Bind(root,origin.AbsoluteUri,workspace);scope.RevalidateBeforeBinding(origin,"account");check(true,"fresh prepublication revalidation accepts only its own native binding");
        File.WriteAllText(Path.Combine(root,"late.txt"),"late fixture bytes");Refuse(()=>scope.RevalidateBeforeBinding(origin,"account"),"late foreign root membership refuses before owner publication");File.Move(Path.Combine(root,"late.txt"),Path.Combine(parent,"retained-late.txt"));
        var store=WindowsBridge.OpenStore(root,origin,workspace);
        var owner=Path.Combine(store.StateDirectory,AccountRootOwnership.FileName);check(!File.Exists(owner),"scope receipt is not a fabricated native owner");
        byte[] pack;using(var bytes=new MemoryStream()){using(var zip=new ZipArchive(bytes,ZipArchiveMode.Create,true)){using(var writer=new StreamWriter(zip.CreateEntry("text.md").Open()))writer.Write("---\ntextTextId: "+item+"\n---\nfixture");}pack=bytes.ToArray();}
        var policy=NativePolicyTestHost.Create("account");await policy.ReadyAsync();
        var initialSync=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var context=new WorkspaceContext(root,workspace,origin,()=>Task.FromResult("controlled-fixture"),(name,value)=>{if(name=="texttext:vault-sync-status"&&JsonSerializer.SerializeToElement(value).TryGetProperty("onlineReady",out var online)&&online.GetBoolean())initialSync.TrySetResult();return Task.CompletedTask;},AccountId:"account",MirrorPolicyFactory:()=>policy);
        var transport=new Seed(item,"Notes/"+title+".textpack",pack);
        using(var bridge=new WindowsBridge(context,transport,null)) {
            using var timeout=new CancellationTokenSource(TimeSpan.FromSeconds(10));bool ready=false;
            await initialSync.Task.WaitAsync(timeout.Token);
            try {while(!ready){timeout.Token.ThrowIfCancellationRequested();var result=JsonSerializer.SerializeToElement(await bridge.InvokeAsync("files.ready",JsonSerializer.SerializeToElement(new{itemId=item}),timeout.Token));ready=result.GetProperty("ready").GetBoolean();if(!ready)await Task.Delay(20,timeout.Token);}}
            catch(OperationCanceledException){var engine=(SyncEngine)typeof(WindowsBridge).GetField("sync",System.Reflection.BindingFlags.NonPublic|System.Reflection.BindingFlags.Instance)!.GetValue(bridge)!;Console.WriteLine(JsonSerializer.Serialize(new{fixtureDiagnostic=true,transport.Manifests,transport.Downloads,engine.Status,projection=File.Exists(file),state=File.Exists(Path.Combine(store.StateDirectory,"sync.json"))}));throw;}

            check(File.Exists(file)&&File.Exists(Path.Combine(store.StateDirectory,"sync.json")),"actual bridge initial sync materializes fixture and durable state");
            await bridge.RetireAsync();
        }
        RetainedReplacementProfile.Prepare(store);
        var ownerBytes=File.ReadAllBytes(owner);var stateBytes=File.ReadAllBytes(Path.Combine(store.StateDirectory,"sync.json"));var packBytes=File.ReadAllBytes(file);
        scope.VerifyPublished(origin,"account");scope.VerifyFixture();check(true,"genuine production owner and materialized identity verified");
        var second=Path.Combine(parent,"campaign-relay","generation-001");Directory.CreateDirectory(second);var reopened=new PrivateActorWorkspace(config,second,file,workspace,item,title);reopened.PrepareVerified(origin,"account");
        check(File.ReadAllBytes(owner).SequenceEqual(ownerBytes)&&File.ReadAllBytes(receipt).SequenceEqual(receiptBytes),"distinct fresh relay reopens same root owner and immutable scope bytes");
        Refuse(()=>reopened.PrepareVerified(origin,"foreign"),"foreign principal cannot reopen");
        var foreign=new PrivateActorWorkspace(config,second,file,Guid.NewGuid().ToString(),item,title);Refuse(()=>foreign.PrepareVerified(origin,"account"),"foreign workspace cannot reopen");
        var profile=Path.Combine(store.StateDirectory,"retained-replacement-profile","profile.json");var profileBytes=File.ReadAllBytes(profile);var marker=JsonSerializer.Deserialize<RetainedReplacementProfile.Marker>(profileBytes)!;
        File.WriteAllText(profile,JsonSerializer.Serialize(marker with{Version=99}));Refuse(()=>reopened.PrepareVerified(origin,"account"),"future retained native profile refuses reopen");File.WriteAllBytes(profile,profileBytes);
        File.Move(owner,owner+".retained");Refuse(()=>reopened.PrepareVerified(origin,"account"),"missing actual owner refuses without recreation");check(!File.Exists(owner),"reopen never fabricates missing owner");File.Move(owner+".retained",owner);
        File.WriteAllBytes(receipt,Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(receiptBytes).TrimEnd('}')+",\"future\":true}"));Refuse(()=>reopened.PrepareVerified(origin,"account"),"unknown immutable scope field refused");File.WriteAllBytes(receipt,receiptBytes);
        File.Move(file,file+".retained");Refuse(()=>reopened.PrepareVerified(origin,"account"),"missing actual fixture refuses reopen");File.Move(file+".retained",file);
        if(OperatingSystem.IsWindows()) {
            var linkedParent=Path.Combine(Path.GetTempPath(),"texttext-isolated-link-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(linkedParent);
            var linkedSession=Path.Combine(linkedParent,"relay","generation-001");Directory.CreateDirectory(linkedSession);var linkedRoot=Path.Combine(linkedParent,"vault");
            try {
                Directory.CreateSymbolicLink(linkedRoot,Path.Combine(linkedParent,"missing-target"));
                Refuse(()=>new PrivateActorWorkspace(new(1,linkedRoot,linkedParent),linkedSession,Path.Combine(linkedRoot,"fixture.textpack"),workspace,item,title),"actual dangling reparse root refused");
            }catch(UnauthorizedAccessException){Console.WriteLine("SKIP symlink creation unavailable; no actual reparse assertion claimed");}
        }
        check(File.ReadAllBytes(owner).SequenceEqual(ownerBytes),"all refusals preserve native owner bytes");
        check(File.ReadAllBytes(Path.Combine(store.StateDirectory,"sync.json")).SequenceEqual(stateBytes)&&File.ReadAllBytes(file).SequenceEqual(packBytes)&&File.ReadAllBytes(profile).SequenceEqual(profileBytes)&&File.ReadAllBytes(receipt).SequenceEqual(receiptBytes),"refusals retain exact native state profile scope and projection bytes");
    }
}
#endif
