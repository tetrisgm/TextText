using System.Diagnostics;
using System.IO.Compression;
using System.Text.Json;
using TextText.Core;
using TextText.Windows;

static class ReplacementBridgeTests
{
    static JsonElement Json(object value)=>JsonSerializer.SerializeToElement(value);
    static byte[] Pack(string text,string id="bridge-recovery") {
        using var output=new MemoryStream();using(var archive=new ZipArchive(output,ZipArchiveMode.Create,true))
        using(var writer=new StreamWriter(archive.CreateEntry("text.md").Open()))writer.Write("---\ntextTextId: \""+id+"\"\n---\n"+text);
        return output.ToArray();
    }
    public static async Task Run(string temporary,Action<bool,string> check)
    {
        if(OperatingSystem.IsWindows()) {
            var stableRoot=Path.Combine(temporary,"stable-handoff-bridge-root");var stableState=Path.Combine(temporary,"stable-handoff-bridge-state");
            var stableStore=new TextPackStore(stableRoot,stableState);var stableOrigin=new Uri("https://fixture.test");
            AccountRootOwnership.Open(stableStore,stableOrigin,"workspace","account-a");
            var stableFile=stableStore.Write("Note.textpack",Pack("stable body","stable-handoff-item"));
            var recoveryFile=stableStore.Write("Recovery.textpack",Pack("retained recovery","stable-recovery-item"));
            typeof(RetainedReplacementProfile).GetMethod("PrepareFolderSync",System.Reflection.BindingFlags.NonPublic|System.Reflection.BindingFlags.Static)!.Invoke(null,[stableStore,null]);
            var stableContext=new WorkspaceContext(stableRoot,"workspace",stableOrigin,()=>Task.FromResult("fixture"),(_,_)=>Task.CompletedTask,AccountId:"account-a",MirrorPolicyFactory:()=>NativePolicyTestHost.Create("account-a"));
            var stableTransport=new StalledTransport();stableTransport.Release.TrySetResult();
            using var stableBridge=new WindowsBridge(stableContext,stableTransport,stableState);
            var priorProfile=File.ReadAllBytes(Path.Combine(stableState,"retained-replacement-profile","profile.json"));
            foreach(var malformed in new object[]{new {itemId=stableFile.ItemId,path=stableFile.Path,localHandoffVersion=1},new {itemId=stableFile.ItemId,path=stableFile.Path,hash=42,localHandoffVersion=1}}) {
                var invalid=false;try{await stableBridge.InvokeAsync("collaboration.open",Json(malformed),CancellationToken.None);}catch(Exception error)when(error is InvalidDataException or InvalidOperationException or KeyNotFoundException){invalid=true;}
                check(invalid&&File.ReadAllBytes(Path.Combine(stableState,"retained-replacement-profile","profile.json")).SequenceEqual(priorProfile),"malformed opening refuses before profile publication");
            }
            using(var migrationReader=new FileStream(Path.Combine(stableState,"retained-replacement-profile.lock"),FileMode.Open,FileAccess.Read,FileShare.Read)) {
                var notOpened=false;
                try{await stableBridge.InvokeAsync("collaboration.open",Json(new {itemId=stableFile.ItemId,path=stableFile.Path,hash=stableFile.Hash,localHandoffVersion=1}),CancellationToken.None);}catch(HandoffNotOpenException){notOpened=true;}
                check(notOpened&&File.ReadAllBytes(Path.Combine(stableState,"retained-replacement-profile","profile.json")).SequenceEqual(priorProfile),"actual floor3 migration busy proves handoff was not opened and preserves profile");
                using var cancelled=new CancellationTokenSource();cancelled.Cancel();var cancellation=false;
                try{await stableBridge.InvokeAsync("collaboration.open",Json(new {itemId=stableFile.ItemId,path=stableFile.Path,hash=stableFile.Hash,localHandoffVersion=1}),cancelled.Token);}catch(OperationCanceledException){cancellation=true;}
                check(cancellation,"cancelled opening is never certified as handoff not opened");
            }
            async Task<object?> RetryCertifiedOpen() {
                for(var attempt=0;;attempt++) {
                    try{return await stableBridge.InvokeAsync("collaboration.open",Json(new {itemId=stableFile.ItemId,path=stableFile.Path,hash=stableFile.Hash,localHandoffVersion=1}),CancellationToken.None);}
                    catch(HandoffNotOpenException)when(attempt<49){await Task.Delay(20);}
                }
            }
            var firstOpen=JsonSerializer.SerializeToElement(await RetryCertifiedOpen());
            await stableBridge.InvokeAsync("collaboration.recover",Json(new {sessionToken=firstOpen.GetProperty("sessionToken").GetString(),recoveryPath=recoveryFile.Path,recoveryHash=recoveryFile.Hash}),CancellationToken.None);
            using(var writer=new FileStream(Path.Combine(stableState,"retained-replacement-profile.lock"),FileMode.Open,FileAccess.ReadWrite,FileShare.None)) {
                var recoveredOwnerReleased=false;
                try{await stableBridge.InvokeAsync("collaboration.open",Json(new {itemId=stableFile.ItemId,path=stableFile.Path,hash=stableFile.Hash,localHandoffVersion=1}),CancellationToken.None);}catch(HandoffNotOpenException){recoveredOwnerReleased=true;}
                check(recoveredOwnerReleased,"successful recovery releases tracked owner before certified preparation retry");
                var ownerPath=Path.Combine(stableState,AccountRootOwnership.FileName);var ownerBytes=File.ReadAllBytes(ownerPath);
                try {
                    var foreign=JsonSerializer.Deserialize<AccountRootOwnership.Owner>(ownerBytes)! with{AccountId="account-b"};
                    File.WriteAllBytes(ownerPath,JsonSerializer.SerializeToUtf8Bytes(foreign));var accountRefused=false;
                    try{await stableBridge.InvokeAsync("collaboration.open",Json(new {itemId=stableFile.ItemId,path=stableFile.Path,hash=stableFile.Hash,localHandoffVersion=1}),CancellationToken.None);}catch(SharedAccountMismatchException){accountRefused=true;}
                    check(accountRefused,"held profile lock cannot certify a changed retained principal");
                }finally{File.WriteAllBytes(ownerPath,ownerBytes);}

            }
            using(var reader=new FileStream(Path.Combine(stableState,"retained-replacement-profile.lock"),FileMode.Open,FileAccess.Read,FileShare.Read)) {
                var opened=JsonSerializer.SerializeToElement(await stableBridge.InvokeAsync("collaboration.open",Json(new {itemId=stableFile.ItemId,path=stableFile.Path,hash=stableFile.Hash,localHandoffVersion=1}),CancellationToken.None));
                check(opened.GetProperty("localHandoff").GetProperty("profileVersion").GetInt32()==4,"stable bridge handoff opens under shared verifier lease");
                var duplicateRefused=false;
                try{await stableBridge.InvokeAsync("collaboration.open",Json(new {itemId=stableFile.ItemId,path=stableFile.Path,hash=stableFile.Hash,localHandoffVersion=1}),CancellationToken.None);}catch(IOException){duplicateRefused=true;}
                check(duplicateRefused,"an already-published editor refusal is not certified as handoff not opened");
                await stableBridge.InvokeAsync("collaboration.close",Json(new {sessionToken=opened.GetProperty("sessionToken").GetString()}),CancellationToken.None);
            }
        }
        string root=Path.Combine(temporary,"replacement-bridge-root"),state=Path.Combine(temporary,"replacement-bridge-state");
        var store=new TextPackStore(root,state);var origin=new Uri("https://texttext.test");const string workspace="workspace";
        AccountRootOwnership.Open(store,origin,workspace,"account-a");
        var prepared=Pack("keep current");var file=store.Write("Note.textpack",prepared);RetainedReplacementProfile.Prepare(store);
        var operation=Guid.NewGuid();var registry=new ReplacementRecoveryRegistry(root,state);var displaced=new byte[]{1,2,3};
        registry.Register(operation,file.ItemId,file.Path,new string('a',64),TextPackStore.Hash(prepared));
        var directory=RetainedFileReplacement.OperationDirectory(store.Resolve(file.Path),operation);Directory.CreateDirectory(directory);
        RetainedFileReplacement.Create(Path.Combine(directory,"prepared"),prepared);RetainedFileReplacement.Create(Path.Combine(directory,"displaced"),displaced);
        RetainedFileReplacement.SaveJson(Path.Combine(directory,"manifest.json"),new RetainedFileReplacement.Manifest(1,operation,"Note.textpack",new string('a',64),TextPackStore.Hash(prepared),"conflict"),creating:true);
        var transport=new StalledTransport();var context=new WorkspaceContext(root,workspace,origin,()=>Task.FromResult("fixture"),(_,_)=>Task.CompletedTask,AccountId:"account-a",MirrorPolicyFactory:()=>NativePolicyTestHost.Create("account-a"));
        var bridge=new WindowsBridge(context,transport,state);
        try {
            var wrongAccount=new StalledTransport();var refused=false;
            try{using var wrong=new WindowsBridge(context with{AccountId="account-b"},wrongAccount,state);}catch(SharedAccountMismatchException){refused=true;}
            check(refused&&!wrongAccount.ManifestStarted.Task.IsCompleted,"owned factory accepts attested profile two and refuses another principal before discovery");
            var handoffConfig=JsonSerializer.SerializeToElement(await bridge.InvokeAsync("collaboration.localHandoffConfig",Json(new {}),CancellationToken.None));
            check(handoffConfig.GetProperty("version").GetInt32()==1&&handoffConfig.GetProperty("profileVersion").GetInt32()==4,"native handoff configuration advertises owned private support");
            foreach(var version in new object[]{true,0,2,"1"}) {
                refused=false;try{await bridge.InvokeAsync("collaboration.open",Json(new {itemId=file.ItemId,path=file.Path,hash=file.Hash,localHandoffVersion=version}),CancellationToken.None);}catch(InvalidDataException){refused=true;}
                check(refused,"native handoff refuses noninteger or unsupported requested version before lease");
            }
            refused=false;try{await bridge.InvokeAsync("collaboration.localHandoffConfig",Json(new {future=true}),CancellationToken.None);}catch(InvalidDataException){refused=true;}
            check(refused,"native handoff config refuses unknown request fields");
            object Scope(string requestedRoot,string requestedWorkspace="workspace",string? account="account-a")=>new {workspaceRoot=requestedRoot,workspaceId=requestedWorkspace,accountId=account};
            foreach(var invalid in new[]{Scope(root+"-other"),Scope(root,"other-workspace"),Scope(root,account:"account-b")}) {
                refused=false;try{await bridge.InvokeAsync("files.replacementList",Json(invalid),CancellationToken.None);}catch(Exception error)when(error is IOException or SharedAccountMismatchException){refused=true;}
                check(refused,"native recovery refuses a changed root, workspace or account scope");
            }
            var clock=Stopwatch.StartNew();
            var list=Json((await bridge.InvokeAsync("files.replacementList",Json(Scope(root)),CancellationToken.None))!);
            check(clock.Elapsed<TimeSpan.FromSeconds(2)&&list.GetArrayLength()==1&&!Directory.Exists(Path.Combine(state,"recovery")),"native replacement listing answers without network or export writes");
            var read=Json((await bridge.InvokeAsync("files.replacementRead",Json(new{workspaceRoot=root,workspaceId=workspace,accountId="account-a",id=operation.ToString("D"),version="displaced"}),CancellationToken.None))!);
            check(read.GetProperty("opaque").GetBoolean()&&Convert.FromBase64String(read.GetProperty("data").GetString()!).SequenceEqual(displaced),"native recovery exposes exact opaque displaced bytes");
            _=await bridge.InvokeAsync("files.resolveReplacement",Json(new{workspaceRoot=root,workspaceId=workspace,accountId="account-a",id=operation.ToString("D"),path=file.Path,itemId=file.ItemId,currentHash=file.Hash,preparedHash=file.Hash,displacedHash=TextPackStore.Hash(displaced)}),CancellationToken.None);
            var resolved=Json((await bridge.InvokeAsync("files.replacementList",Json(Scope(root)),CancellationToken.None))!);
            check(resolved.GetArrayLength()==1&&resolved[0].GetProperty("resolved").GetBoolean(),"native explicit recovery keeps readonly retained versions discoverable");
            var removedBytes=Pack("removed baseline","bridge-removed");var removed=store.Write("Removed.textpack",removedBytes);var removal=Guid.NewGuid();
            registry.Register(removal,removed.ItemId,removed.Path,removed.Hash,removed.Hash,kind:"removal");
            var removalDirectory=RetainedFileReplacement.OperationDirectory(store.Resolve(removed.Path),removal);Directory.CreateDirectory(removalDirectory);
            RetainedFileReplacement.Create(Path.Combine(removalDirectory,"prepared"),removedBytes);
            File.Move(store.Resolve(removed.Path),Path.Combine(removalDirectory,"displaced"));
            RetainedFileReplacement.SaveJson(Path.Combine(removalDirectory,"manifest.json"),new RetainedFileReplacement.Manifest(1,removal,"Removed.textpack",removed.Hash,removed.Hash,"conflict",Kind:"removal"),creating:true);
            var absent=Json((await bridge.InvokeAsync("files.replacementRead",Json(new{workspaceRoot=root,workspaceId=workspace,accountId="account-a",id=removal.ToString("D"),version="current"}),CancellationToken.None))!);
            check(absent.GetProperty("absent").GetBoolean()&&absent.GetProperty("hash").ValueKind==JsonValueKind.Null&&absent.GetProperty("data").ValueKind==JsonValueKind.Null,"native removal bridge returns explicit absence without an empty TextPack");
            refused=false;try{_=await bridge.InvokeAsync("files.resolveReplacement",Json(new{workspaceRoot=root,workspaceId=workspace,accountId="account-a",id=removal.ToString("D"),path=removed.Path,itemId=removed.ItemId,currentHash=(string?)null,preparedHash=removed.Hash,displacedHash=removed.Hash,kind="replacement",currentPresent=false}),CancellationToken.None);}catch(InvalidDataException){refused=true;}
            check(refused,"native removal consent refuses replacement-kind absence");
            _=await bridge.InvokeAsync("files.resolveReplacement",Json(new{workspaceRoot=root,workspaceId=workspace,accountId="account-a",id=removal.ToString("D"),path=removed.Path,itemId=removed.ItemId,currentHash=(string?)null,preparedHash=removed.Hash,displacedHash=removed.Hash,kind="removal",currentPresent=false}),CancellationToken.None);
            check(!File.Exists(store.Resolve(removed.Path))&&store.ReplacementRecoveryList().Single(entry=>entry.Id==removal.ToString("D")).Resolved,"native keep-deleted consent preserves absence and readonly retained versions");
            var uncapturedBytes=Pack("uncaptured baseline","bridge-uncaptured");var uncaptured=store.Write("Uncaptured.textpack",uncapturedBytes);var unfinished=Guid.NewGuid();
            registry.Register(unfinished,uncaptured.ItemId,uncaptured.Path,uncaptured.Hash,uncaptured.Hash,kind:"removal");
            var unfinishedDirectory=RetainedFileReplacement.OperationDirectory(store.Resolve(uncaptured.Path),unfinished);Directory.CreateDirectory(unfinishedDirectory);
            RetainedFileReplacement.Create(Path.Combine(unfinishedDirectory,"prepared"),uncapturedBytes);
            RetainedFileReplacement.SaveJson(Path.Combine(unfinishedDirectory,"manifest.json"),new RetainedFileReplacement.Manifest(1,unfinished,"Uncaptured.textpack",uncaptured.Hash,uncaptured.Hash,"pending",Kind:"removal"),creating:true);
            var recreated=Pack("recreated current","bridge-current-other");File.WriteAllBytes(store.Resolve(uncaptured.Path),recreated);
            var unfinishedList=Json((await bridge.InvokeAsync("files.replacementList",Json(Scope(root)),CancellationToken.None))!);
            var unfinishedRow=unfinishedList.EnumerateArray().Single(row=>row.GetProperty("id").GetString()==unfinished.ToString("D"));
            check(!unfinishedRow.GetProperty("captured").GetBoolean()&&unfinishedRow.GetProperty("displacedHash").ValueKind==JsonValueKind.Null,"native uncaptured recovery row reports no displaced version honestly");
            var noCapture=Json((await bridge.InvokeAsync("files.replacementRead",Json(new{workspaceRoot=root,workspaceId=workspace,accountId="account-a",id=unfinished.ToString("D"),version="displaced"}),CancellationToken.None))!);
            check(noCapture.GetProperty("absent").GetBoolean()&&noCapture.GetProperty("data").ValueKind==JsonValueKind.Null,"native uncaptured displaced read never fabricates an empty archive");
            _=await bridge.InvokeAsync("files.cancelUncapturedDeletion",Json(new{workspaceRoot=root,workspaceId=workspace,accountId="account-a",id=unfinished.ToString("D"),path=uncaptured.Path,itemId=uncaptured.ItemId,preparedHash=uncaptured.Hash,currentPresent=true,currentHash=TextPackStore.Hash(recreated)}),CancellationToken.None);
            check(File.ReadAllBytes(store.Resolve(uncaptured.Path)).SequenceEqual(recreated)&&store.ReplacementRecoveryList().Single(entry=>entry.Id==unfinished.ToString("D")).Resolved,"native cancel unfinished deletion preserves recreated bytes and keeps readonly snapshots");
            var moveBaseline=Pack("move baseline","bridge-move");var moveForeign=Pack("foreign destination","bridge-move-foreign");
            var moveSource=Pack("recreated source","bridge-source-foreign");var moving=store.Write("MoveFrom.textpack",moveBaseline);
            var moveHook=typeof(TextPackStore).GetProperty("MoveObservationForTesting",System.Reflection.BindingFlags.NonPublic|System.Reflection.BindingFlags.Instance)!;
            moveHook.SetValue(store,(Action<string>)(phase=>{if(phase=="beforeMove")File.WriteAllBytes(store.Resolve(moving.Path),moveForeign);}));
            var moveRefused=false;try{store.Rename(moving.Path,"MoveTo.textpack",moving.Hash);}catch(IOException){moveRefused=true;}
            finally{moveHook.SetValue(store,null);}
            check(moveRefused,"bridge fixture reproduces a refused foreign move without acknowledging its old baseline");
            File.WriteAllBytes(store.Resolve(moving.Path),moveSource);
            var moves=Json((await bridge.InvokeAsync("files.replacementList",Json(Scope(root)),CancellationToken.None))!);
            var moveRow=moves.EnumerateArray().Single(row=>row.GetProperty("kind").GetString()=="move");
            var moveId=moveRow.GetProperty("id").GetString()!;
            check(moveRow.GetProperty("sourcePath").GetString()==moving.Path&&moveRow.GetProperty("sourcePresent").GetBoolean()&&
                moveRow.GetProperty("sourceHash").GetString()==TextPackStore.Hash(moveSource),"native move listing binds the recreated original path and destination");
            var sourceRead=Json((await bridge.InvokeAsync("files.replacementRead",Json(new{workspaceRoot=root,workspaceId=workspace,accountId="account-a",id=moveId,version="source"}),CancellationToken.None))!);
            check(Convert.FromBase64String(sourceRead.GetProperty("data").GetString()!).SequenceEqual(moveSource),"native move source inspection returns exact recreated bytes");
            object MoveConsent(string sourceHash,string account="account-a")=>new {workspaceRoot=root,workspaceId=workspace,accountId=account,id=moveId,
                kind="move",path="MoveTo.textpack",sourcePath=moving.Path,itemId=moving.ItemId,preparedHash=moving.Hash,
                displacedHash=TextPackStore.Hash(moveForeign),captured=true,currentPresent=true,currentHash=TextPackStore.Hash(moveForeign),sourcePresent=true,sourceHash};
            refused=false;try{await bridge.InvokeAsync("files.resolveMove",Json(MoveConsent(new string('f',64))),CancellationToken.None);}catch(IOException){refused=true;}
            check(refused,"move consent refuses a source hash changed since inspection");
            refused=false;try{await bridge.InvokeAsync("files.resolveMove",Json(MoveConsent(TextPackStore.Hash(moveSource),"account-b")),CancellationToken.None);}catch(Exception error)when(error is IOException or SharedAccountMismatchException){refused=true;}
            check(refused,"move consent refuses another account before acknowledgement");
            _=await bridge.InvokeAsync("files.resolveMove",Json(MoveConsent(TextPackStore.Hash(moveSource))),CancellationToken.None);
            check(File.ReadAllBytes(store.Resolve(moving.Path)).SequenceEqual(moveSource)&&File.ReadAllBytes(store.Resolve("MoveTo.textpack")).SequenceEqual(moveForeign)&&
                store.ReplacementRecoveryList().Single(entry=>entry.Id==moveId).Resolved,"native move consent preserves both foreign visible files and retained baseline");
            if(OperatingSystem.IsWindows()) {await FolderRecovery(store,bridge,root,state,workspace,check);await FolderSyncRecovery(temporary,check);}
            else Console.WriteLine("SKIP folder recovery bridge filesystem fixtures: actual Windows required");
            transport.Release.TrySetResult();await bridge.RetireAsync();
            var closed=false;try{await bridge.InvokeAsync("files.replacementRead",Json(Scope(root)),CancellationToken.None);}catch(Exception error)when(error is OperationCanceledException or ObjectDisposedException){closed=true;}
            check(closed,"retired native bridge refuses recovery reads from the old connection");
            closed=false;try{await bridge.InvokeAsync("files.folderRenameList",Json(Scope(root)),CancellationToken.None);}catch(Exception error)when(error is OperationCanceledException or ObjectDisposedException){closed=true;}
            check(closed,"retired native bridge refuses folder recovery from the old connection");
        }finally{transport.Release.TrySetResult();await bridge.RetireAsync();}
    }
    static async Task FolderRecovery(TextPackStore store,WindowsBridge bridge,string root,string state,string workspace,Action<bool,string> check)
    {
        object Scope(string? id=null,string? fromPath=null,string? toPath=null,string? inspection=null,string? requestedRoot=null,string? requestedWorkspace=null,string account="account-a")=>new {
            workspaceRoot=requestedRoot??root,workspaceId=requestedWorkspace??workspace,accountId=account,id,fromPath,toPath,inspection
        };
        store.EnsureFolders(["Notes"]);
        if(!Directory.Exists(store.Resolve("notes")))throw new IOException("Actual Windows bridge fixture requires the ordinary case-insensitive volume.");
        File.WriteAllText(store.Resolve("Notes/child.txt"),"original directory bytes");
        var hook=typeof(TextPackStore).GetProperty("FolderCaseObservationForTesting",System.Reflection.BindingFlags.NonPublic|System.Reflection.BindingFlags.Instance)!;
        hook.SetValue(store,(Action<string>)(phase=>{if(phase=="prepared")throw new IOException("Fixture interrupts after durable folder intent, before rename.");}));
        var interrupted=false;try{store.EnsureFolders(["notes"]);}catch(IOException){interrupted=true;}finally{hook.SetValue(store,null);}
        check(interrupted,"folder bridge fixture retains actual interrupted native directory rename intent");
        Directory.Move(store.Resolve("Notes"),store.Resolve("original-preserved"));Directory.CreateDirectory(store.Resolve("Notes"));File.WriteAllText(store.Resolve("Notes/foreign.txt"),"foreign current bytes");
        var fenced=false;try{_=store.Scan();}catch(IOException){fenced=true;}check(fenced,"unresolved folder metadata fences ordinary inventory while recovery remains available");
        var requests=(SemaphoreSlim)typeof(WindowsBridge).GetField("requests",System.Reflection.BindingFlags.NonPublic|System.Reflection.BindingFlags.Instance)!.GetValue(bridge)!;
        JsonElement row;
        await requests.WaitAsync();
        try {
            var clock=Stopwatch.StartNew();
            var list=Json((await bridge.InvokeAsync("files.folderRenameList",Json(Scope()),CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(2)))!);
            check(clock.Elapsed<TimeSpan.FromSeconds(2)&&list.GetArrayLength()==1,"folder recovery listing bypasses blocked mutations, sync and fenced normal inventory");row=list[0].Clone();
            var keys=new[]{"id","fromPath","toPath","expectedIdentity","from","to","inspection","summary","resolutionBlocked","resolved"};
            check(row.EnumerateObject().Select(p=>p.Name).Order().SequenceEqual(keys.Order())&&row.GetProperty("from").EnumerateObject().Select(p=>p.Name).Order().SequenceEqual(new[]{"identity","present"})&&row.GetProperty("to").EnumerateObject().Select(p=>p.Name).Order().SequenceEqual(new[]{"identity","present"}),"folder recovery row has exact10 camelcase fields and exact endpoint shape");
            check(row.GetProperty("fromPath").GetString()=="Notes"&&row.GetProperty("toPath").GetString()=="notes"&&row.GetProperty("from").GetProperty("present").GetBoolean()&&!row.GetProperty("to").GetProperty("present").GetBoolean()&&row.GetProperty("to").GetProperty("identity").ValueKind==JsonValueKind.Null&&!row.GetProperty("resolved").GetBoolean(),"folder recovery reports exact physical endpoint presence without invented directory snapshots");
            var read=Json((await bridge.InvokeAsync("files.folderRenameRead",Json(Scope(id:row.GetProperty("id").GetString())),CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(2)))!);
            check(read.GetRawText()==row.GetRawText(),"folder recovery read preserves exact scoped metadata shape while mutation gate is held");
            using var cancel=new CancellationTokenSource();var pending=bridge.InvokeAsync("files.resolveFolderRename",Json(Scope(row.GetProperty("id").GetString(),"Notes","notes",row.GetProperty("inspection").GetString())),cancel.Token);cancel.Cancel();var cancelled=false;try{await pending;}catch(OperationCanceledException){cancelled=true;}
            check(cancelled&&!store.FolderRenameRecoveryRead(row.GetProperty("id").GetString()!).Resolved,"cancelled queued folder consent never acknowledges or mutates the retained directories");
        } finally {requests.Release();}
        var id=row.GetProperty("id").GetString()!;var inspection=row.GetProperty("inspection").GetString()!;
        foreach(var method in new[]{"files.folderRenameList","files.folderRenameRead","files.resolveFolderRename"}) {
            foreach(var invalid in new[]{Scope(id,"Notes","notes",inspection,requestedRoot:root+"-other"),Scope(id,"Notes","notes",inspection,requestedWorkspace:"other"),Scope(id,"Notes","notes",inspection,account:"account-b")}) {
                var refused=false;try{await bridge.InvokeAsync(method,Json(invalid),CancellationToken.None);}catch(Exception error)when(error is IOException or InvalidDataException or SharedAccountMismatchException){refused=true;}
                check(refused,"folder recovery "+method+" refuses changed root/workspace/account scope");
            }
            using var cancel=new CancellationTokenSource();cancel.Cancel();var cancelled=false;try{await bridge.InvokeAsync(method,Json(Scope(id,"Notes","notes",inspection)),cancel.Token);}catch(OperationCanceledException){cancelled=true;}
            check(cancelled,"folder recovery "+method+" honors request cancellation before metadata access");
        }
        File.WriteAllText(store.Resolve("Notes/foreign.txt"),"foreign bytes changed after inspection");
        var stale=false;try{await bridge.InvokeAsync("files.resolveFolderRename",Json(Scope(id,"Notes","notes",inspection)),CancellationToken.None);}catch(IOException){stale=true;}
        check(stale&&!store.FolderRenameRecoveryRead(id).Resolved,"folder consent refuses stale inspected tree metadata and leaves durable intent unresolved");
        var ownerPath=Path.Combine(state,AccountRootOwnership.FileName);var ownerBytes=File.ReadAllBytes(ownerPath);var owner=JsonSerializer.Deserialize<AccountRootOwnership.Owner>(ownerBytes)!;
        TextPackStore.AtomicWrite(ownerPath,JsonSerializer.SerializeToUtf8Bytes(owner with{AccountId="changed-after-inspection"}));
        var ownerRefused=false;try{await bridge.InvokeAsync("files.folderRenameRead",Json(Scope(id)),CancellationToken.None);}catch(Exception error)when(error is IOException or InvalidDataException or SharedAccountMismatchException){ownerRefused=true;}finally{TextPackStore.AtomicWrite(ownerPath,ownerBytes);}
        check(ownerRefused&&!store.FolderRenameRecoveryRead(id).Resolved,"folder recovery refuses replaced profile ownership rather than adopting another principal");
        var fresh=Json((await bridge.InvokeAsync("files.folderRenameRead",Json(Scope(id)),CancellationToken.None))!);
        var result=Json((await bridge.InvokeAsync("files.resolveFolderRename",Json(Scope(id,"Notes","notes",fresh.GetProperty("inspection").GetString())),CancellationToken.None))!);
        check(result.EnumerateObject().Count()==1&&result.GetProperty("resolved").GetBoolean()&&store.FolderRenameRecoveryRead(id).Resolved,"fresh scoped folder consent returns explicit acknowledgement and retains inspectable history");
        check(File.ReadAllText(store.Resolve("original-preserved/child.txt"))=="original directory bytes"&&File.ReadAllText(store.Resolve("Notes/foreign.txt"))=="foreign bytes changed after inspection","folder acknowledgement preserves both current directory trees byte for byte");
        _=store.Scan();
    }

    sealed class FolderSyncTransport:ISyncTransport {
        internal readonly TaskCompletionSource ManifestEntered=new(TaskCreationOptions.RunContinuationsAsynchronously),ReleaseManifest=new(TaskCreationOptions.RunContinuationsAsynchronously);
        internal int Inspections,Cancellations;internal bool Cancelled,Offline;internal Action<bool>? BeforeReply;internal FolderCaseMoveRequest Command=null!;
        public bool SupportsFolderCaseMoves=>true;public string ManifestRevision=>new('a',64);public IReadOnlyList<string> Folders=>["Notes","Notes/Empty child"];public IReadOnlyList<string>? AuthoritativeFolders=>Folders;
        public async Task<IReadOnlyList<RemoteItem>> ManifestAsync(CancellationToken ct=default){ManifestEntered.TrySetResult();await ReleaseManifest.Task.WaitAsync(ct);return [];}
        public Task<FolderCaseMoveReceipt> MoveFolderCaseAsync(FolderCaseMoveRequest r,CancellationToken ct=default)=>throw new HttpRequestException("Original outcome remains unknown.");
        public Task<FolderCaseRecoveryReply> RecoverFolderCaseAsync(FolderCaseMoveRequest r,bool cancel,string? inspection,CancellationToken ct=default){if(Offline)throw new HttpRequestException("offline");if(JsonSerializer.Serialize(r)!=JsonSerializer.Serialize(Command))throw new Exception("Bridge changed retained original request");Inspections++;if(cancel){Cancellations++;Cancelled=true;}BeforeReply?.Invoke(cancel);return Task.FromResult(Cancelled?new FolderCaseRecoveryReply("cancelled",new string('c',64),r.OperationId,r.Source,r.Destination,new string('d',64),new string('a',64)):new FolderCaseRecoveryReply("review",new string('c',64),r.OperationId,r.Source,r.Destination,new string('d',64),new string('a',64),["Notes","Notes/Empty child"],[]));}
        public Task<RemotePack> DownloadAsync(string id,CancellationToken ct=default)=>throw new Exception("Unexpected download");public Task<string> UploadAsync(string id,string path,byte[] bytes,string? revision,string operation,CancellationToken ct=default)=>throw new Exception("Unexpected child upload");public Task<string> RenameAsync(string id,string from,string to,string revision,string operation,CancellationToken ct=default)=>throw new Exception("Unexpected child rename");public Task DeleteAsync(string id,string path,string revision,string operation,CancellationToken ct=default)=>throw new Exception("Unexpected child delete");
    }
    [System.Runtime.InteropServices.DllImport("kernel32.dll",CharSet=System.Runtime.InteropServices.CharSet.Unicode,SetLastError=true)]static extern bool MoveFileW(string source,string destination);
    static async Task FolderSyncRecovery(string temporary,Action<bool,string> check)
    {
        var root=Path.Combine(temporary,"folder-sync-recovery-root");var state=Path.Combine(temporary,"folder-sync-recovery-state");var origin=new Uri("https://texttext.test");var store=new TextPackStore(root,state);AccountRootOwnership.Open(store,origin,"workspace","account-a");store.EnsureFolders(["Notes/Empty child"]);
        typeof(RetainedReplacementProfile).GetMethod("PrepareFolderSync",System.Reflection.BindingFlags.Static|System.Reflection.BindingFlags.NonPublic)!.Invoke(null,[store,null]);
        var identity=(string)typeof(TextPackStore).Assembly.GetType("TextText.Core.FolderCaseRename")!.GetMethod("Identity",System.Reflection.BindingFlags.Static|System.Reflection.BindingFlags.NonPublic,null,[typeof(string)],null)!.Invoke(null,[store.Resolve("Notes")])!;
        var request=new FolderCaseMoveRequest(Guid.NewGuid().ToString("D"),"Notes","notes",new string('a',64),["Notes","Notes/Empty child"],[]);var command=new SyncEngine.FolderSyncCommand(1,request,identity,TextPackStore.Hash(System.Text.Encoding.UTF8.GetBytes(store.Root)),"account-a");
        TextPackStore.AtomicWrite(Path.Combine(state,"sync.json"),JsonSerializer.SerializeToUtf8Bytes(new SyncEngine.State{AccountId="account-a",ManagedFolders=["Notes","Notes/Empty child"],FolderCommand=command}));if(!MoveFileW(store.Resolve("Notes"),store.Resolve("notes")))throw new IOException("Fixture case rename failed.");
        var remote=new FolderSyncTransport{Command=request};var context=new WorkspaceContext(root,"workspace",origin,()=>Task.FromResult("fixture"),(_,_)=>Task.CompletedTask,AccountId:"account-a",MirrorPolicyFactory:()=>NativePolicyTestHost.Create("account-a"));using var bridge=new WindowsBridge(context,remote,state);await remote.ManifestEntered.Task.WaitAsync(TimeSpan.FromSeconds(4));
        object Scope(string? id=null,string? inspection=null,string? local=null,string? hash=null,bool consent=true,string? requestedRoot=null,string workspace="workspace",string account="account-a")=>new{workspaceRoot=requestedRoot??root,workspaceId=workspace,accountId=account,id,inspection,localInspection=local,requestHash=hash,consent};
        var list=Json((await bridge.InvokeAsync("files.folderSyncMoveList",Json(Scope()),CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(3)))!);var row=list[0];
        var keys=new[]{"id","command","state","requestHash","expectedIdentity","from","to","localInspection","inspection","manifestRevision","folders","items","result","resolutionBlocked"};check(list.GetArrayLength()==1&&row.EnumerateObject().Select(x=>x.Name).Order().SequenceEqual(keys.Order())&&row.GetProperty("command").GetProperty("operationId").GetString()==request.OperationId,"network-backed folder sync recovery returns exact14-key scoped row while ordinary sync is stalled");
        remote.Offline=true;var unavailable=Json((await bridge.InvokeAsync("files.folderSyncMoveRead",Json(Scope(request.OperationId)),CancellationToken.None))!);check(unavailable.GetProperty("state").GetString()=="unavailable"&&unavailable.GetProperty("requestHash").ValueKind==JsonValueKind.Null&&unavailable.GetProperty("inspection").ValueKind==JsonValueKind.Null&&unavailable.GetProperty("resolutionBlocked").ValueKind==JsonValueKind.String,"offline recovery retains immutable command/local proof with explicitly unverified server state");remote.Offline=false;
        var inspection=row.GetProperty("inspection").GetString();var local=row.GetProperty("localInspection").GetString();var hash=row.GetProperty("requestHash").GetString();var initialCalls=remote.Inspections;
        foreach(var method in new[]{"files.folderSyncMoveList","files.folderSyncMoveRead","files.resolveFolderSyncMove"})foreach(var invalid in new[]{Scope(request.OperationId,inspection,local,hash,requestedRoot:root+"-other"),Scope(request.OperationId,inspection,local,hash,workspace:"other"),Scope(request.OperationId,inspection,local,hash,account:"account-b")}){var refused=false;try{await bridge.InvokeAsync(method,Json(invalid),CancellationToken.None);}catch(Exception e)when(e is IOException or SharedAccountMismatchException){refused=true;}check(refused&&remote.Inspections==initialCalls,"folder sync recovery "+method+" refuses changed root/workspace/account before network");}
        var consentRefused=false;try{await bridge.InvokeAsync("files.resolveFolderSyncMove",Json(Scope(request.OperationId,inspection,local,hash,consent:false)),CancellationToken.None);}catch(InvalidDataException){consentRefused=true;}check(consentRefused&&remote.Cancellations==0,"folder sync cancellation requires explicit consent before any authoritative request");
        using(var cancelled=new CancellationTokenSource()){cancelled.Cancel();var refused=false;try{await bridge.InvokeAsync("files.folderSyncMoveRead",Json(Scope(request.OperationId)),cancelled.Token);}catch(OperationCanceledException){refused=true;}check(refused&&remote.Inspections==initialCalls,"cancelled folder sync recovery read sends no network request");}
        File.WriteAllText(store.Resolve("notes/retained-after-inspection.txt"),"exact current local bytes");remote.ReleaseManifest.SetResult();var stale=false;try{await bridge.InvokeAsync("files.resolveFolderSyncMove",Json(Scope(request.OperationId,inspection,local,hash)),CancellationToken.None);}catch(FileChangedException){stale=true;}check(stale&&remote.Cancellations==0,"folder sync cancellation refuses local changes after inspection before server cancellation");
        var ownerPath=Path.Combine(state,AccountRootOwnership.FileName);var ownerBytes=File.ReadAllBytes(ownerPath);var owner=JsonSerializer.Deserialize<AccountRootOwnership.Owner>(ownerBytes)!;TextPackStore.AtomicWrite(ownerPath,JsonSerializer.SerializeToUtf8Bytes(owner with{AccountId="other-account"}));var changed=false;try{await bridge.InvokeAsync("files.folderSyncMoveRead",Json(Scope(request.OperationId)),CancellationToken.None);}catch(Exception e)when(e is IOException or InvalidDataException or SharedAccountMismatchException){changed=true;}finally{TextPackStore.AtomicWrite(ownerPath,ownerBytes);}check(changed&&remote.Cancellations==0,"folder sync recovery refuses replaced profile ownership without relabeling retained work");
        remote.BeforeReply=_=>TextPackStore.AtomicWrite(ownerPath,JsonSerializer.SerializeToUtf8Bytes(owner with{AccountId="changed-after-network"}));var afterReadRefused=false;try{await bridge.InvokeAsync("files.folderSyncMoveRead",Json(Scope(request.OperationId)),CancellationToken.None);}catch(Exception e)when(e is IOException or InvalidDataException or SharedAccountMismatchException){afterReadRefused=true;}finally{remote.BeforeReply=null;TextPackStore.AtomicWrite(ownerPath,ownerBytes);}check(afterReadRefused&&remote.Cancellations==0,"folder sync recovery rejects account replacement after authoritative inspection returns");
        row=Json((await bridge.InvokeAsync("files.folderSyncMoveRead",Json(Scope(request.OperationId)),CancellationToken.None))!);remote.BeforeReply=cancel=>{if(cancel)TextPackStore.AtomicWrite(ownerPath,JsonSerializer.SerializeToUtf8Bytes(owner with{AccountId="changed-after-cancel"}));};var afterCancelRefused=false;try{await bridge.InvokeAsync("files.resolveFolderSyncMove",Json(Scope(request.OperationId,row.GetProperty("inspection").GetString(),row.GetProperty("localInspection").GetString(),row.GetProperty("requestHash").GetString())),CancellationToken.None);}catch(Exception e)when(e is IOException or InvalidDataException or SharedAccountMismatchException){afterCancelRefused=true;}finally{remote.BeforeReply=null;TextPackStore.AtomicWrite(ownerPath,ownerBytes);}check(afterCancelRefused&&remote.Cancellations==1&&JsonDocument.Parse(File.ReadAllBytes(Path.Combine(state,"sync.json"))).RootElement.GetProperty("FolderCommand").ValueKind==JsonValueKind.Object&&!File.Exists(Path.Combine(state,"folder-sync-cancellations",request.OperationId+".json")),"account replacement after server cancellation preserves pending command until its original scope returns");
        row=Json((await bridge.InvokeAsync("files.folderSyncMoveRead",Json(Scope(request.OperationId)),CancellationToken.None))!);var resolved=Json((await bridge.InvokeAsync("files.resolveFolderSyncMove",Json(Scope(request.OperationId,row.GetProperty("inspection").GetString(),row.GetProperty("localInspection").GetString(),row.GetProperty("requestHash").GetString())),CancellationToken.None))!);check(resolved.GetProperty("resolved").GetBoolean()&&remote.Cancellations==2&&File.Exists(Path.Combine(state,"folder-sync-cancellations",request.OperationId+".json"))&&File.ReadAllText(store.Resolve("notes/retained-after-inspection.txt"))=="exact current local bytes"&&Directory.Exists(store.Resolve("notes/Empty child")),"fresh scoped cancellation retains authoritative tombstone before clearing only command state and preserves local tree");
        var empty=Json((await bridge.InvokeAsync("files.folderSyncMoveList",Json(Scope()),CancellationToken.None))!);check(empty.GetArrayLength()==0,"cancelled pending folder command clears from active recovery listing");await bridge.RetireAsync();
    }

}
