using System.IO.Compression;
using System.Text.Json;
using TextText.Core;

static class RetainedReplacementSyncFenceTests
{
    static byte[] Pack(string value,string id="fenced-item") {
        using var output=new MemoryStream();using(var archive=new ZipArchive(output,ZipArchiveMode.Create,true))
        using(var writer=new StreamWriter(archive.CreateEntry("text.md").Open()))writer.Write("---\ntextTextId: \""+id+"\"\n---\n"+value);
        return output.ToArray();
    }
    static Guid Conflict(TextPackStore store,PackFile file,byte[] prepared) {
        var operation=Guid.NewGuid();byte[] expected=Pack("before"),displaced=Pack("external");
        var registry=new ReplacementRecoveryRegistry(store.Root,store.StateDirectory);
        registry.Register(operation,file.ItemId,file.Path,TextPackStore.Hash(expected),TextPackStore.Hash(prepared));
        var directory=RetainedFileReplacement.OperationDirectory(store.Resolve(file.Path),operation);Directory.CreateDirectory(directory);
        RetainedFileReplacement.Create(Path.Combine(directory,"prepared"),prepared);RetainedFileReplacement.Create(Path.Combine(directory,"displaced"),displaced);
        RetainedFileReplacement.SaveJson(Path.Combine(directory,"manifest.json"),new RetainedFileReplacement.Manifest(1,operation,Path.GetFileName(file.Path),TextPackStore.Hash(expected),TextPackStore.Hash(prepared),"conflict"),creating:true);
        return operation;
    }
    public static async Task Run(string temp,Action<bool,string> check) {
        foreach(var stage in new[]{"before-rpc","after-rpc"}) {
            var store=new TextPackStore(Path.Combine(temp,"replacement-sync-"+stage),Path.Combine(temp,"replacement-sync-state-"+stage));
            var candidate=Pack("accepted local content");var file=store.Write("Note.textpack",candidate);var remote=new Remote();
            Guid operation=Guid.Empty;
            if(stage=="before-rpc") {
                operation=Conflict(store,file,candidate);
                store.Write("Other.textpack",Pack("unrelated work","other-item"));
            } else remote.AfterUpload=id=>{if(id==file.ItemId)operation=Conflict(store,file,candidate);};
            var refused=false;
            try{await Test.NewSync(store,remote).SyncAsync();}catch(RetainedFileReplacement.RequiredException){refused=true;}
            var state=JsonSerializer.Deserialize<SyncEngine.State>(File.ReadAllBytes(Path.Combine(store.StateDirectory,"sync.json")))!;
            if(stage=="before-rpc") {
                check(!remote.Items.ContainsKey(file.ItemId)&&remote.Items.ContainsKey("other-item")&&!state.Items.ContainsKey(file.ItemId),"existing replacement fence blocks its upload while unrelated items continue syncing");
            } else {
                check(refused&&remote.Commits==1&&state.Outbox.Single().ItemId==file.ItemId&&!state.Items.ContainsKey(file.ItemId),"replacement conflict arising during upload retains original operation and refuses baseline acknowledgement");
                var originalOperation=state.Outbox.Single().Id;
                var registry=new ReplacementRecoveryRegistry(store.Root,store.StateDirectory);var inspection=registry.Inspect(registry.Entries().Single());
                store.ResolveReplacement(operation.ToString("D"),file.Path,file.ItemId,TextPackStore.Hash(candidate),inspection.PreparedHash,inspection.DisplacedHash);
                await Test.NewSync(store,remote).SyncAsync();
                var after=JsonSerializer.Deserialize<SyncEngine.State>(File.ReadAllBytes(Path.Combine(store.StateDirectory,"sync.json")))!;
                check(after.Outbox.Count==0&&remote.Commits==1&&remote.Operations.Count(id=>id==originalOperation)==2,"explicit recovery resumes the exact idempotent upload without committing twice");
            }
        }
    }
    sealed class Remote:ISyncTransport {
        public Dictionary<string,RemoteItem> Items=[];readonly Dictionary<string,byte[]> data=[];readonly Dictionary<string,string> receipts=[];
        public Action<string>? AfterUpload;public List<string> Operations=[];public int Commits;
        public Task<IReadOnlyList<RemoteItem>> ManifestAsync(CancellationToken cancellation=default)=>Task.FromResult<IReadOnlyList<RemoteItem>>(Items.Values.ToArray());
        public Task<RemotePack> DownloadAsync(string itemId,CancellationToken cancellation=default)=>Task.FromResult(new RemotePack(data[itemId],Items[itemId].RelativePath,Items[itemId].Revision));
        public Task<string> UploadAsync(string itemId,string path,byte[] bytes,string? baseline,string operation,CancellationToken cancellation=default) {
            Operations.Add(operation);if(receipts.TryGetValue(operation,out var saved))return Task.FromResult(saved);
            var revision=TextPackStore.Hash(bytes);receipts[operation]=revision;data[itemId]=bytes;Items[itemId]=new(itemId,path,revision);Commits++;
            var hook=AfterUpload;AfterUpload=null;hook?.Invoke(itemId);return Task.FromResult(revision);
        }
        public Task<string> RenameAsync(string itemId,string from,string to,string revision,string operation,CancellationToken cancellation=default)=>throw new NotSupportedException();
        public Task DeleteAsync(string itemId,string path,string revision,string operation,CancellationToken cancellation=default)=>throw new NotSupportedException();
    }
}
