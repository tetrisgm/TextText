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
            if(OperatingSystem.IsWindows()) await FolderRecovery(store,bridge,root,state,workspace,check);
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

}
