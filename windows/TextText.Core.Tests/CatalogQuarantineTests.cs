using System.IO.Compression;
using System.Text.Json;
using TextText.Core;

static class CatalogQuarantineTests {
    static byte[] Pack(string id,string body) {using var output=new MemoryStream();using(var zip=new ZipArchive(output,ZipArchiveMode.Create,true))using(var writer=new StreamWriter(zip.CreateEntry("text.md").Open()))writer.Write($"---\ntextTextId: \"{id}\"\n---\n{body}");return output.ToArray();}
    public static async Task Run(string root,Action<bool,string> check) {
        var store=new TextPackStore(Path.Combine(root,"files"),Path.Combine(root,"state"));
        var upload=Pack("good-upload","exact upload");var held=Pack("held","exact retained");var download=Pack("good-download","exact download");
        var local=store.Write("Good/Upload.textpack",upload);var heldFile=store.Write("Bad/Held.textpack",held);
        var operation=new SyncEngine.Operation("held-op","upload",heldFile.ItemId,heldFile.Path,null,null,heldFile.Hash,Convert.ToBase64String(held));
        var state=new SyncEngine.State{Outbox=[operation,new("good-op","upload",local.ItemId,local.Path,null,null,local.Hash,Convert.ToBase64String(upload))],ManagedFolders=["Retained"],Items={ [heldFile.ItemId]=new(heldFile.Path,heldFile.Hash,heldFile.Hash) }};
        File.WriteAllBytes(Path.Combine(store.StateDirectory,"sync.json"),JsonSerializer.SerializeToUtf8Bytes(state));
        var remote=new Remote(download);var engine=Test.NewSync(store,remote);Exception? failure=null;
        try{await engine.SyncAsync();}catch(Exception error){failure=error;}
        if(failure is not null)Console.WriteLine(failure);
        check(failure is null,"nonportable catalog folder does not stop unrelated actual-engine sync");
        check(remote.Uploads==1&&remote.Uploaded!.SequenceEqual(upload),"unrelated queued upload reaches remote exactly once with exact bytes");
        check(store.Read("Good/Download.textpack").SequenceEqual(download),"unrelated remote item downloads exact bytes");
        var after=JsonSerializer.Deserialize<SyncEngine.State>(File.ReadAllBytes(Path.Combine(store.StateDirectory,"sync.json")))!;
        check(after.Outbox.Contains(operation)&&store.Read(heldFile.Path).SequenceEqual(held)&&remote.HeldCalls==0,"portable alias subtree retains exact operation and bytes without remote dispatch");
        check(engine.CatalogIssues.Count==1&&engine.CatalogIssues[0].Path=="Bad "&&remote.Folders.Contains("Bad "),"scoped issue is visible while raw server catalog remains unchanged");
        check(after.ManagedFolders!.SequenceEqual(state.ManagedFolders!)&&!Directory.Exists(Path.Combine(store.Root,"Empty")),"quarantine leaves topology baseline and provisioning untouched");
        remote.Catalog=["../fatal"];var fatal=false;try{await engine.SyncAsync();}catch(IOException){fatal=true;}
        check(fatal&&engine.CatalogIssues.Count==0&&engine.Status.Error is not null,"fatal validation clears stale scoped notice and preserves actual failure");
        var changedStore=new TextPackStore(Path.Combine(root,"changed-files"),Path.Combine(root,"changed-state"));
        var changedFile=changedStore.Write("Good/Upload.textpack",upload);
        File.WriteAllBytes(Path.Combine(changedStore.StateDirectory,"sync.json"),JsonSerializer.SerializeToUtf8Bytes(new SyncEngine.State{Outbox=[new("changed-op","upload",changedFile.ItemId,changedFile.Path,null,null,changedFile.Hash,Convert.ToBase64String(upload))]}));
        var changedRemote=new Remote(download){ChangeCatalogOnRefresh=true};var changedEngine=Test.NewSync(changedStore,changedRemote);var changed=false;
        try{await changedEngine.SyncAsync();}catch(FileChangedException){changed=true;}
        check(changed&&changedRemote.Uploads==1&&changedRemote.Downloads==0,"changed catalog on fresh manifest stops before further item work after durable upload");
        foreach(var invalidItems in new[]{new[]{new RemoteItem("bad","Good/invalid?.textpack","r")},new[]{new RemoteItem("bad","Good/CON.textpack","r")},new[]{new RemoteItem("bad","../escape.textpack","r")},new[]{new RemoteItem("bad","Bad /../escape.textpack","r")},new[]{new RemoteItem("a","Good/Same.textpack","r"),new RemoteItem("b","good/same.textpack","r")}}) {
            var invalidStore=new TextPackStore(Path.Combine(root,Guid.NewGuid().ToString()),Path.Combine(root,Guid.NewGuid().ToString()));
            var invalidRemote=new Remote(download){ExtraItems=invalidItems};var invalidEngine=Test.NewSync(invalidStore,invalidRemote);var denied=false;
            try{await invalidEngine.SyncAsync();}catch(IOException){denied=true;}
            check(denied&&invalidRemote.Uploads==0&&invalidRemote.Downloads==0,"invalid or portable-aliased remote item path fails before content writes");
        }
        var repairStore=new TextPackStore(Path.Combine(root,"repair-files"),Path.Combine(root,"repair-state"));
        var repairRemote=new Remote(download){NoHeld=true};var repairEngine=Test.NewSync(repairStore,repairRemote);await repairEngine.SyncAsync();
        repairRemote.Catalog=["Good"];await repairEngine.SyncAsync();
        check(repairEngine.CatalogIssues.Count==0&&repairStore.Read("Good/Download.textpack").SequenceEqual(download),"fresh repaired catalog clears scoped warning without resetting state or content");
        if(OperatingSystem.IsWindows()) {
            var linkStore=new TextPackStore(Path.Combine(root,"link-files"),Path.Combine(root,"link-state"));var target=Path.Combine(root,"link-target");Directory.CreateDirectory(target);
            Directory.CreateSymbolicLink(Path.Combine(linkStore.Root,"Bad"),target);
            var linkRemote=new Remote(download);var linkEngine=Test.NewSync(linkStore,linkRemote);var denied=false;
            try{await linkEngine.SyncAsync();}catch(IOException){denied=true;}
            check(denied&&linkRemote.Uploads==0&&linkRemote.Downloads==0&&!Directory.EnumerateFileSystemEntries(target).Any(),"physical alias under held prefix fails closed without touching target or remote");
        }
        foreach(var unsafePath in new[]{"../escape","Good/../escape"}) {
            var unsafeStore=new TextPackStore(Path.Combine(root,Guid.NewGuid().ToString()),Path.Combine(root,Guid.NewGuid().ToString()));
            var unsafeRemote=new Remote(download){Catalog=[unsafePath]};var unsafeEngine=Test.NewSync(unsafeStore,unsafeRemote);var denied=false;
            try{await unsafeEngine.SyncAsync();}catch(IOException){denied=true;}
            check(denied&&unsafeRemote.Uploads==0&&unsafeRemote.Downloads==0,"traversal catalog stays globally fail-closed before content writes");
        }
    }
    sealed class Remote(byte[] download):ISyncTransport {
        public int Uploads,HeldCalls,Downloads,Manifests;public bool ChangeCatalogOnRefresh,NoHeld;public RemoteItem[] ExtraItems=[];public string[] Catalog=["Bad ","Good","Empty"];public byte[]? Uploaded;
        public IReadOnlyList<string> Folders=>Catalog;
        public IReadOnlyList<string>? AuthoritativeFolders=>Folders;
        public Task<IReadOnlyList<RemoteItem>> ManifestAsync(CancellationToken ct=default){if(++Manifests>1&&ChangeCatalogOnRefresh)Catalog=["NewBad ","Good"];return Task.FromResult<IReadOnlyList<RemoteItem>>([..ExtraItems,new("good-download","Good/Download.textpack",TextPackStore.Hash(download)),..(NoHeld?Array.Empty<RemoteItem>():new[]{new RemoteItem("bad-remote","Bad /Remote.textpack","bad-revision"),new RemoteItem("held","Bad /Held.textpack","tombstone",true)}),..(Uploaded is null?Array.Empty<RemoteItem>():new[]{new RemoteItem("good-upload","Good/Upload.textpack",TextPackStore.Hash(Uploaded))})]);}
        public Task<RemotePack> DownloadAsync(string id,CancellationToken ct=default){Downloads++;if(id=="good-upload"&&Uploaded is not null)return Task.FromResult(new RemotePack(Uploaded,"Good/Upload.textpack",TextPackStore.Hash(Uploaded)));if(id!="good-download"){HeldCalls++;throw new Exception("held download");}return Task.FromResult(new RemotePack(download,"Good/Download.textpack",TextPackStore.Hash(download)));}
        public Task<string> UploadAsync(string id,string path,byte[] data,string? revision,string operation,CancellationToken ct=default){if(id!="good-upload"){HeldCalls++;throw new Exception("held upload");}Uploads++;Uploaded=data;return Task.FromResult(TextPackStore.Hash(data));}
        public Task<string> RenameAsync(string id,string from,string to,string revision,string operation,CancellationToken ct=default)=>throw new Exception("unexpected rename");
        public Task DeleteAsync(string id,string path,string revision,string operation,CancellationToken ct=default)=>throw new Exception("unexpected delete");
    }
}
