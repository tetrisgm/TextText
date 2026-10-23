using System.Text.Json;
using System.IO.Compression;
using TextText.Core;
using TextText.Windows;

static class InitialForegroundTests {
    public static async Task Run(string temporary,Action<bool,string> check) {
        foreach(var outcome in new[]{"home","admitted","failed-read","needs-sync","failed-view","failed-status","retire"}) {
            var root=Path.Combine(temporary,"initial-"+outcome);var state=root+"-state";
            var remote=new HeldRemote();
            PackFile? file=null;
            if(outcome=="admitted") {
                var store=new TextPackStore(root,state);using var bytes=new MemoryStream();
                using(var zip=new ZipArchive(bytes,ZipArchiveMode.Create,true))using(var writer=new StreamWriter(zip.CreateEntry("text.md").Open()))writer.Write("---\ntextTextId: \"initial-note\"\n---\nexact initial body");
                file=store.Write("Notes/Initial.textpack",bytes.ToArray());
                File.WriteAllBytes(Path.Combine(state,"sync.json"),JsonSerializer.SerializeToUtf8Bytes(new SyncEngine.State{Items={[file.ItemId]=new(file.Path,file.Hash,file.Hash)}}));
            }
            var context=new WorkspaceContext(root,"initial-workspace",new Uri("https://fixture.test"),()=>Task.FromResult("fixture"),(_,_)=>Task.CompletedTask,
                MirrorPolicyFactory:()=>NativePolicyTestHost.Create(),DeferInitialSync:true);
            var bridge=new WindowsBridge(context,remote,state);
            try {
                var listed=await bridge.InvokeAsync("files.list",JsonSerializer.SerializeToElement(new{}),default);
                check(listed is not null&&!remote.Entered.Task.IsCompleted,"initial native listing completes before remote pass admission");
                var rejected=false;try{await bridge.InvokeAsync("files.startupComplete",JsonSerializer.SerializeToElement(new{root="other",workspaceId="initial-workspace"}),default);}catch(InvalidDataException){rejected=true;}
                check(rejected&&!remote.Entered.Task.IsCompleted,"foreign initial-view completion cannot release this workspace");
                if(outcome=="retire") {await bridge.RetireAsync().WaitAsync(TimeSpan.FromSeconds(5));check(!remote.Entered.Task.IsCompleted,"retirement cancels initial hold without starting remote pass");continue;}
                if(outcome=="home")await bridge.InvokeAsync("files.startupComplete",JsonSerializer.SerializeToElement(new{root,workspaceId="initial-workspace"}),default);
                if(outcome=="failed-read")try{await bridge.InvokeAsync("files.read",JsonSerializer.SerializeToElement(new{itemId="absent"}),default);}catch(FileNotFoundException){}
                if(outcome=="needs-sync")await bridge.InvokeAsync("files.ready",JsonSerializer.SerializeToElement(new{itemId="absent"}),default);
                if(outcome=="failed-view")bridge.InitialViewFailed();
                if(outcome=="failed-status")await bridge.InvokeAsync("files.startupFailed",JsonSerializer.SerializeToElement(new{}),default);
                if(outcome=="admitted") {
                    var ready=JsonSerializer.SerializeToElement(await bridge.InvokeAsync("files.ready",JsonSerializer.SerializeToElement(new{itemId=file!.ItemId}),default));
                    check(ready.GetProperty("ready").GetBoolean()&&!remote.Entered.Task.IsCompleted,"ready local item retains priority until actual collaboration admission");
                    var opened=JsonSerializer.SerializeToElement(await bridge.InvokeAsync("collaboration.open",JsonSerializer.SerializeToElement(new{itemId=file.ItemId,path=file.Path,hash=file.Hash}),default));
                    check(!string.IsNullOrEmpty(opened.GetProperty("sessionToken").GetString()),"actual collaboration lease admits restored note before releasing initial pass");
                }
                await remote.Entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
                check(true,"initial "+outcome+" terminal releases background progress without user input");
            } finally {await bridge.RetireAsync();}
        }
    }
    sealed class HeldRemote:ISyncTransport {
        public readonly TaskCompletionSource Entered=new(TaskCreationOptions.RunContinuationsAsynchronously);
        public async Task<IReadOnlyList<RemoteItem>> ManifestAsync(CancellationToken ct=default){Entered.TrySetResult();await Task.Delay(Timeout.Infinite,ct);return [];}
        public Task<RemotePack> DownloadAsync(string id,CancellationToken ct=default)=>throw new NotSupportedException();
        public Task<string> UploadAsync(string id,string path,byte[] bytes,string? revision,string operation,CancellationToken ct=default)=>throw new NotSupportedException();
        public Task<string> RenameAsync(string id,string from,string to,string revision,string operation,CancellationToken ct=default)=>throw new NotSupportedException();
        public Task DeleteAsync(string id,string path,string revision,string operation,CancellationToken ct=default)=>throw new NotSupportedException();
    }
}
