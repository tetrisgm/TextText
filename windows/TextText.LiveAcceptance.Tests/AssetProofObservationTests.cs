using System.IO.Compression;
using System.Text;
using System.Text.Json;
using TextText.Core;

internal static class AssetProofObservationTests
{
    // Match the existing portable Core fixtures: /var is a macOS alias, not
    // an allowed linked ancestor for a real TextPackStore root.
    static string TemporaryBase()
    {
        var path = Path.GetTempPath();
        return OperatingSystem.IsMacOS() && path.StartsWith("/var/", StringComparison.Ordinal)
            ? "/private" + path : path;
    }

    internal static async Task Run(Action<bool,string> check)
    {
        void Refuse(Action action, string label) { try { action(); } catch { check(true,label); return; } throw new Exception("Expected refusal: " + label); }
        var id = "e1111111-1111-4111-8111-111111111111";
        JsonElement Request(object value) => JsonSerializer.SerializeToElement(value);
        check(AssetProofObservation.Request(Request(new { version = 1, sampleId = id })) == id,"asset current sample accepted");
        foreach(var raw in new[]{"{}","{\"version\":true,\"sampleId\":\""+id+"\"}","{\"version\":1,\"version\":1,\"sampleId\":\""+id+"\"}","{\"version\":1,\"sampleId\":\""+id.ToUpperInvariant()+"\"}","{\"version\":2,\"sampleId\":\""+id+"\"}"}) {
            using var doc=JsonDocument.Parse(raw);Refuse(()=>AssetProofObservation.Request(doc.RootElement),"asset malformed sample refused");
        }
        byte[] Pack(string body="Body",string markdownBody="Body",bool asset=true,string name="assets/test.bin",string prefix="",string? markdownTitle=null) {
            using var output=new MemoryStream();using(var zip=new ZipArchive(output,ZipArchiveMode.Create,true)) {
                void Add(string key,byte[] bytes){using var stream=zip.CreateEntry(prefix+key,CompressionLevel.NoCompression).Open();stream.Write(bytes);}
                Add("text.md",Encoding.UTF8.GetBytes("---\ntextTextId: "+id+(markdownTitle is null?"":"\ntitle: "+markdownTitle)+"\n---\n\n"+markdownBody));
                Add("document.json",Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new{schemaVersion=1,content=new{title="Title",body},hidden=new{invalidButNotCertified=true}})));
                if(asset)Add(name,[0,255,128,31]);
            }return output.ToArray();
        }
        var bytes=Pack();var pack=AssetProofObservation.Inspect(bytes,id);
        check(pack.ArchiveHash==TextPackStore.Hash(bytes)&&pack.Assets["assets/test.bin"]==TextPackStore.Hash([0,255,128,31]),"asset exact bytes and real map hashed");
        check(pack.RawDocument.Contains("invalidButNotCertified"),"raw helper preserves hidden fields without schema certification");
        Refuse(()=>AssetProofObservation.Inspect(bytes,Guid.NewGuid().ToString()),"foreign raw pack refused");
        Refuse(()=>AssetProofObservation.Inspect(Pack(markdownBody:"Different"),id),"stale markdown JSON refused");
        Refuse(()=>AssetProofObservation.Inspect(Pack(asset:false),id),"empty real asset map refused");
        Refuse(()=>AssetProofObservation.Inspect(Pack(name:"assets/../escape"),id),"unsafe archive path refused");
        check(AssetProofObservation.Inspect(Pack(prefix:"Owned.textbundle/"),id).Assets.ContainsKey("assets/test.bin"),"wrapped archive uses root-relative real assets");
        Refuse(()=>AssetProofObservation.Inspect(Pack(markdownTitle:"Foreign"),id),"stale explicit markdown title refused");
        Refuse(()=>AssetProofObservation.Inspect(Pack(name:"text.md"),id),"duplicate ZIP member refused");
        var invalidName=Pack();var nameBytes=Encoding.UTF8.GetBytes("assets/test.bin");
        for(var offset=0;offset<=invalidName.Length-nameBytes.Length;offset++)if(invalidName.AsSpan(offset,nameBytes.Length).SequenceEqual(nameBytes))invalidName[offset+nameBytes.Length-1]=255;
        Refuse(()=>AssetProofObservation.Inspect(invalidName,id),"malformed UTF8 archive name refused before identity");
        var badCrc=Pack();var nameOffset=badCrc.AsSpan().IndexOf(nameBytes);check(nameOffset>=30,"owned binary local header found");
        var extra=System.Buffers.Binary.BinaryPrimitives.ReadUInt16LittleEndian(badCrc.AsSpan(nameOffset-2,2));badCrc[nameOffset+nameBytes.Length+extra]^=1;
        Refuse(()=>AssetProofObservation.Inspect(badCrc,id),"actual corrupt binary CRC refused");
        var a=new object();var capture=new AssetProofObservation.Capture(a,a,a,"token","Note.textpack","checkpoint");
        AssetProofObservation.Unchanged(capture,capture);check(true,"same capture accepted");
        Refuse(()=>AssetProofObservation.Unchanged(capture,capture with{Active=new object()}),"same-path replacement session refused");
        Refuse(()=>AssetProofObservation.Unchanged(capture,capture with{Fingerprint="changed"}),"checkpoint generation change refused");
        Refuse(()=>AssetProofObservation.Unchanged(capture,capture with{Path="Other.textpack"}),"actual session path change refused");
        // Genuine Core session, not a fake sessions dictionary. Setup writes are
        // confined to this disposable fixture; capture itself must create nothing.
        var root=Path.Combine(TemporaryBase(),"texttext-asset-session-"+Guid.NewGuid().ToString("N"));
        var store=new TextPackStore(Path.Combine(root,"vault"),Path.Combine(root,"state"));
        var origin=new Uri("https://texttext.app");const string account="fixture-account", workspace="fixture-workspace";
        AccountRootOwnership.Open(store,origin,workspace,account);
        var file=store.Write("Owned.textpack",bytes);
        var remote=new ObservationTransport();var sync=new SyncEngine(store,remote,account,NativePolicyTestHost.Create(account));
        await sync.SyncAsync();
        using var editing=new SharedEditingStore(store,sync,account);
        var session=await editing.OpenAsync(id,file.Path,file.Hash);
        var bridge=new ActualBridge(editing);
        Dictionary<string,string> Inventory()=>Directory.GetFiles(root,"*",SearchOption.AllDirectories).ToDictionary(path=>Path.GetRelativePath(root,path),path=>new FileInfo(path).Length==0?TextPackStore.Hash([]):TextPackStore.Hash(File.ReadAllBytes(path)),StringComparer.Ordinal);
        var inventory=JsonSerializer.Serialize(Inventory().OrderBy(e=>e.Key));
        var actual=await AssetProofObservation.CaptureSession(bridge,id,account,workspace,origin,store.Root,default);
        check(actual.Path==file.Path&&JsonSerializer.Serialize(Inventory().OrderBy(e=>e.Key))==inventory,"actual Core session capture performs no writes");
        var itemDirectory=Path.Combine(store.StateDirectory,"shared-editing",id);
        var retainedDirectory=Path.Combine(root,"retained-empty-shared-directory");
        Directory.Move(itemDirectory,retainedDirectory);
        var absentInventory=JsonSerializer.Serialize(Inventory().OrderBy(e=>e.Key));
        await AssetProofObservation.CaptureSession(bridge,id,account,workspace,origin,store.Root,default);
        check(!Directory.Exists(itemDirectory)&&JsonSerializer.Serialize(Inventory().OrderBy(e=>e.Key))==absentInventory,"absent shared directory remains absent under actual capture");
        Directory.Move(retainedDirectory,itemDirectory);
        foreach(var mismatch in new[]{(Account:"foreign-account",Workspace:workspace,Origin:origin,Root:store.Root),
            (Account:account,Workspace:"foreign-workspace",Origin:origin,Root:store.Root),
            (Account:account,Workspace:workspace,Origin:new Uri("https://foreign.test"),Root:store.Root),
            (Account:account,Workspace:workspace,Origin:origin,Root:Path.Combine(root,"foreign-root"))}) {
            bool refused=false;
            try{await AssetProofObservation.CaptureSession(bridge,id,mismatch.Account,mismatch.Workspace,mismatch.Origin,mismatch.Root,default);}catch{refused=true;}
            check(refused&&JsonSerializer.Serialize(Inventory().OrderBy(e=>e.Key))==inventory,"actual Core principal/workspace/origin/root mismatch refuses without writes");
        }
        editing.Close(session.SessionToken);
        var reopened=await editing.OpenAsync(id,file.Path,file.Hash);
        var newer=await AssetProofObservation.CaptureSession(bridge,id,account,workspace,origin,store.Root,default);
        Refuse(()=>AssetProofObservation.Unchanged(actual,newer),"actual same-path reopened session refused");
        var checkpoint=Path.Combine(store.StateDirectory,"shared-editing",id,"checkpoint.json");
        File.WriteAllText(checkpoint,"{malformed");var retained=File.ReadAllBytes(checkpoint);
        bool malformed=false;try{await AssetProofObservation.CaptureSession(bridge,id,account,workspace,origin,store.Root,default);}catch{malformed=true;}
        check(malformed&&File.ReadAllBytes(checkpoint).SequenceEqual(retained),"malformed actual checkpoint refuses without recovery or mutation");
        File.Move(checkpoint,Path.Combine(root,"retained-malformed-checkpoint.json"));
        RetainedReplacementProfile.Prepare(store);
        var migrationLease=Path.Combine(store.StateDirectory,"retained-replacement-profile.lock");
        if(File.Exists(migrationLease))File.Move(migrationLease,Path.Combine(root,"retained-profile-lease"));
        var profileInventory=JsonSerializer.Serialize(Inventory().OrderBy(e=>e.Key));
        await AssetProofObservation.CaptureSession(bridge,id,account,workspace,origin,store.Root,default);
        check(!File.Exists(migrationLease)&&JsonSerializer.Serialize(Inventory().OrderBy(e=>e.Key))==profileInventory,"genuine completed profile read creates no migration lease or state");
        bool staged=false;
        try{RetainedReplacementProfile.PrepareLocalHandoff(store,stage=>{if(stage=="localHandoffProfileStaged"){staged=true;throw new IOException("Owned fixture interruption");}});}catch(IOException){}
        check(staged,"genuine profile publication interrupted after staging");
        if(File.Exists(migrationLease))File.Move(migrationLease,Path.Combine(root,"retained-second-profile-lease"));
        var stagedInventory=JsonSerializer.Serialize(Inventory().OrderBy(e=>e.Key));
        bool stagedRefused=false;try{await AssetProofObservation.CaptureSession(bridge,id,account,workspace,origin,store.Root,default);}catch{stagedRefused=true;}
        check(stagedRefused&&!File.Exists(migrationLease)&&JsonSerializer.Serialize(Inventory().OrderBy(e=>e.Key))==stagedInventory,"genuine pending profile refuses without repair or lease creation");
        editing.Close(reopened.SessionToken);
        check(AssetProofObservation.CanonicalScript("\";throw Error('content')//").Contains("JSON.parse(raw)"),"canonical input stays data argument");
        if (!OperatingSystem.IsWindows()) {
            Console.WriteLine("SKIP Windows retained replacement/folder history fixtures require actual PC.");
            return;
        }
        var historyRoot=Path.Combine(TemporaryBase(),"texttext-asset-history-"+Guid.NewGuid().ToString("N"));
        var historyStore=new TextPackStore(Path.Combine(historyRoot,"vault"),Path.Combine(historyRoot,"state"));
        AccountRootOwnership.Open(historyStore,origin,workspace,account);
        var historyFile=historyStore.Write("Owned.textpack",bytes);
        var historySync=new SyncEngine(historyStore,new ObservationTransport(),account,NativePolicyTestHost.Create(account));
        await historySync.SyncAsync();using var historyEditing=new SharedEditingStore(historyStore,historySync,account);
        var historySession=await historyEditing.OpenAsync(id,historyFile.Path,historyFile.Hash);
        historyStore.Write(historyFile.Path,bytes,historyFile.Hash);
        var registry=Path.Combine(historyStore.StateDirectory,"replacement-index");
        check(Directory.Exists(registry)&&Directory.GetFiles(registry,"*.json").Length>0,"genuine completed replacement history exists");
        string HistoryInventory()=>JsonSerializer.Serialize(Directory.GetFiles(historyRoot,"*",SearchOption.AllDirectories).Order(StringComparer.Ordinal).Select(path=>new{path,hash=new FileInfo(path).Length==0?TextPackStore.Hash([]):TextPackStore.Hash(File.ReadAllBytes(path))}));
        var historyLease=Path.Combine(historyStore.StateDirectory,"retained-replacement-profile.lock");
        if(File.Exists(historyLease))File.Move(historyLease,Path.Combine(historyRoot,"retained-profile-lease"));
        var historyBefore=HistoryInventory();
        var completed=await AssetProofObservation.CaptureSession(new ActualBridge(historyEditing),id,account,workspace,origin,historyStore.Root,default);
        check(!File.Exists(historyLease)&&HistoryInventory()==historyBefore,"completed history attests without replay, lease or mutation");
        // Deny content reads while permitting metadata handles. A hidden
        // payload hash/read in the observer must fail this genuine capture.
        var retainedEntry=Directory.GetFiles(registry,"*.json").Single();
        using(var record=JsonDocument.Parse(File.ReadAllBytes(retainedEntry))) {
            var retainedOperation=record.RootElement.GetProperty("Operation").GetString()!;
            var retainedManifest=Directory.EnumerateFiles(historyRoot,"manifest.json",SearchOption.AllDirectories).Single(path=>Path.GetFileName(Path.GetDirectoryName(path))==retainedOperation);
            var noReadDirectory=Path.GetDirectoryName(retainedManifest)!;
            var noReadBefore=HistoryInventory();
            using(var preparedNoRead=new FileStream(Path.Combine(noReadDirectory,"prepared"),FileMode.Open,FileAccess.Write,FileShare.Write|FileShare.Delete))
            using(var displacedNoRead=new FileStream(Path.Combine(noReadDirectory,"displaced"),FileMode.Open,FileAccess.Write,FileShare.Write|FileShare.Delete))
                await AssetProofObservation.CaptureSession(new ActualBridge(historyEditing),id,account,workspace,origin,historyStore.Root,default);
            check(HistoryInventory()==noReadBefore&&!File.Exists(historyLease),"completed history attests with retained payload reads denied; only metadata fingerprints are used");
        }
        var unknown=Path.Combine(registry,".staged-owned-test");File.WriteAllText(unknown,"{}");
        var unknownBefore=HistoryInventory();bool unknownRefused=false;
        try{await AssetProofObservation.CaptureSession(new ActualBridge(historyEditing),id,account,workspace,origin,historyStore.Root,default);}catch{unknownRefused=true;}
        check(unknownRefused&&HistoryInventory()==unknownBefore,"staged unknown history refuses without writes");
        File.Move(unknown,Path.Combine(historyRoot,"retained-unknown-index"));
        var entryPath=Directory.GetFiles(registry,"*.json").Single();
        using var entryDocument=JsonDocument.Parse(File.ReadAllBytes(entryPath));var operation=entryDocument.RootElement.GetProperty("Operation").GetString()!;
        var manifest=Directory.EnumerateFiles(historyRoot,"manifest.json",SearchOption.AllDirectories).Single(p=>Path.GetFileName(Path.GetDirectoryName(p))==operation);
        var operationDirectory=Path.GetDirectoryName(manifest)!;var relocated=Path.Combine(historyRoot,"retained-moved-operation");Directory.Move(operationDirectory,relocated);
        var movedBefore=HistoryInventory();bool movedRefused=false;
        try{await AssetProofObservation.CaptureSession(new ActualBridge(historyEditing),id,account,workspace,origin,historyStore.Root,default);}catch{movedRefused=true;}
        check(movedRefused&&HistoryInventory()==movedBefore,"missing exact stored history refuses without relocation scan or repair");
        Directory.Move(relocated,operationDirectory);
        var prepared=Path.Combine(operationDirectory,"prepared");File.AppendAllText(prepared,"owned retained mutation");
        var mutatedBefore=HistoryInventory();bool mutatedRefused=false;
        try{await AssetProofObservation.CaptureSession(new ActualBridge(historyEditing),id,account,workspace,origin,historyStore.Root,default);}catch{mutatedRefused=true;}
        check(mutatedRefused&&HistoryInventory()==mutatedBefore,"changed retained fingerprint refuses without classification or mutation");
        historyEditing.Close(historySession.SessionToken);
        var folderRoot=Path.Combine(TemporaryBase(),"texttext-asset-folder-history-"+Guid.NewGuid().ToString("N"));
        var folderStore=new TextPackStore(Path.Combine(folderRoot,"vault"),Path.Combine(folderRoot,"state"));
        AccountRootOwnership.Open(folderStore,origin,workspace,account);
        var folderFile=folderStore.Write("Owned.textpack",bytes);
        var folderSync=new SyncEngine(folderStore,new ObservationTransport(),account,NativePolicyTestHost.Create(account));
        await folderSync.SyncAsync();using var folderEditing=new SharedEditingStore(folderStore,folderSync,account);
        var folderSession=await folderEditing.OpenAsync(id,folderFile.Path,folderFile.Hash);
        folderStore.EnsureFolders(["Notes"]);folderStore.EnsureFolders(["notes"]);
        var folderDirectory=Path.Combine(folderStore.StateDirectory,"folder-case");
        check(Directory.GetFiles(folderDirectory,"*.json").Length>0,"genuine completed folder history exists");
        var folderLease=Path.Combine(folderStore.StateDirectory,"folder-case.lock");
        var folderProfileLease=Path.Combine(folderStore.StateDirectory,"retained-replacement-profile.lock");
        void RemoveFixtureLeases(string suffix){foreach(var leasePath in new[]{folderLease,folderProfileLease})if(File.Exists(leasePath))File.Move(leasePath,Path.Combine(folderRoot,Path.GetFileName(leasePath)+suffix));}
        string FolderInventory()=>JsonSerializer.Serialize(Directory.GetFiles(folderRoot,"*",SearchOption.AllDirectories).Order(StringComparer.Ordinal).Select(path=>new{path,hash=new FileInfo(path).Length==0?TextPackStore.Hash([]):TextPackStore.Hash(File.ReadAllBytes(path))}));
        RemoveFixtureLeases("-completed");var folderBefore=FolderInventory();
        await AssetProofObservation.CaptureSession(new ActualBridge(folderEditing),id,account,workspace,origin,folderStore.Root,default);
        check(FolderInventory()==folderBefore&&!File.Exists(folderLease)&&!File.Exists(folderProfileLease),"completed folder history attests without creating lease or changing bytes");
        var hook=typeof(TextPackStore).GetProperty("FolderCaseObservationForTesting",System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.NonPublic)!;
        bool interrupted=false;
        hook.SetValue(folderStore,(Action<string>)(point=>{if(point=="prepared"){interrupted=true;throw new IOException("Owned pending folder fixture");}}));
        try{folderStore.EnsureFolders(["NOTES"]);}catch(IOException){}finally{hook.SetValue(folderStore,null);}
        check(interrupted,"genuine pending folder operation retained");
        RemoveFixtureLeases("-pending");var pendingFolderBefore=FolderInventory();bool pendingFolderRefused=false;
        try{await AssetProofObservation.CaptureSession(new ActualBridge(folderEditing),id,account,workspace,origin,folderStore.Root,default);}catch{pendingFolderRefused=true;}
        check(pendingFolderRefused&&FolderInventory()==pendingFolderBefore&&!File.Exists(folderLease)&&!File.Exists(folderProfileLease),"pending folder history refuses without classification repair or lease creation");
        folderEditing.Close(folderSession.SessionToken);
    }
    sealed class ActualBridge(SharedEditingStore value) { readonly SharedEditingStore editing=value; }
    sealed class ObservationTransport : ISyncTransport {
        RemoteItem? item;byte[]? bytes;
        public WorkspaceCapabilities? Capabilities => new(true,true,[],[]);
        public Task<IReadOnlyList<RemoteItem>> ManifestAsync(CancellationToken cancellation=default)=>Task.FromResult<IReadOnlyList<RemoteItem>>(item is null?[]:[item]);
        public Task<RemotePack> DownloadAsync(string itemId,CancellationToken cancellation=default)=>Task.FromResult(new RemotePack(bytes!,item!.RelativePath,item.Revision));
        public Task<string> UploadAsync(string itemId,string path,byte[] data,string? baseRevision,string operationId,CancellationToken cancellation=default){bytes=data;item=new(itemId,path,TextPackStore.Hash(data),Lifecycle:"known-fixture");return Task.FromResult(item.Revision);}
        public Task<string> RenameAsync(string itemId,string from,string to,string baseRevision,string operationId,CancellationToken cancellation=default)=>throw new NotSupportedException();
        public Task DeleteAsync(string itemId,string path,string baseRevision,string operationId,CancellationToken cancellation=default)=>throw new NotSupportedException();
    }

}
