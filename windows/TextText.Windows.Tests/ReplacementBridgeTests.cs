using System.Diagnostics;
using System.IO.Compression;
using System.Text.Json;
using TextText.Core;
using TextText.Windows;

static class ReplacementBridgeTests
{
    static JsonElement Json(object value)=>JsonSerializer.SerializeToElement(value);
    static byte[] Pack(string text) {
        using var output=new MemoryStream();using(var archive=new ZipArchive(output,ZipArchiveMode.Create,true))
        using(var writer=new StreamWriter(archive.CreateEntry("text.md").Open()))writer.Write("---\ntextTextId: \"bridge-recovery\"\n---\n"+text);
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
            transport.Release.TrySetResult();await bridge.RetireAsync();
            var closed=false;try{await bridge.InvokeAsync("files.replacementRead",Json(Scope(root)),CancellationToken.None);}catch(Exception error)when(error is OperationCanceledException or ObjectDisposedException){closed=true;}
            check(closed,"retired native bridge refuses recovery reads from the old connection");
        }finally{transport.Release.TrySetResult();await bridge.RetireAsync();}
    }
}
