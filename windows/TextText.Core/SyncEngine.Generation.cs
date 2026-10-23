using System.IO.Compression;
using System.Text.Json;
namespace TextText.Core;

public sealed partial class SyncEngine
{
    readonly HashSet<string> generationInspectionItems=new(StringComparer.Ordinal);
    readonly HashSet<string> generationInspectionBlocked=new(StringComparer.Ordinal);
    ProtectedRenameScope? generationInspectionScope;
    bool generationSyncPass;
    readonly Dictionary<string,HashSet<string>> generationInspectionPaths=new(StringComparer.Ordinal);
    sealed class GenerationInspectionLease(Action release):IDisposable {public void Dispose()=>release();}
    IDisposable BeginGenerationInspection(State state,string id,RemoteItem? remote) {
        if(generationInspectionItems.Contains(id))return new GenerationInspectionLease(()=>{});
        var baseline=state.Items.GetValueOrDefault(id);var record=state.ProtectedRenames.GetValueOrDefault(id);
        var legacyUnknown=state.SharedRenames.TryGetValue(id,out var old)&&old.Lifecycle is null;
        if(transport.ProtectedRenameBinding is null&&record?.Version!=2&&!legacyUnknown)return new GenerationInspectionLease(()=>{});
        if(record?.Version!=2&&!legacyUnknown&&(baseline?.Lifecycle is not null||remote?.Lifecycle is not null))return new GenerationInspectionLease(()=>{});
        var discovery=store.InspectGenerationInventory();var paths=discovery.Files.Where(f=>f.ItemId==id).Select(f=>f.Path).ToArray();
        var needed=record?.Version==2||state.SharedRenames.TryGetValue(id,out var legacy)&&legacy.Lifecycle is null||
            baseline?.Lifecycle is null&&remote?.Lifecycle is null&&paths.Length==1&&(paths[0]!=baseline?.Path||remote is not null&&paths[0]!=remote.RelativePath);
        if(!needed)return new GenerationInspectionLease(()=>{});
        var prior=generationInspectionScope;generationInspectionScope??=transport.ProtectedRenameBinding;
        generationInspectionItems.Add(id);var names=paths.ToHashSet(StringComparer.Ordinal);if(baseline is not null)names.Add(baseline.Path);if(remote is not null)names.Add(remote.RelativePath);generationInspectionPaths[id]=names;
        if(generationSyncPass)return new GenerationInspectionLease(()=>{});
        return new GenerationInspectionLease(()=>{generationInspectionItems.Remove(id);generationInspectionBlocked.Remove(id);generationInspectionPaths.Remove(id);generationInspectionScope=prior;});
    }
    IReadOnlyList<PackFile> ScanForSync() {
        if(!CatalogQuarantined&&generationInspectionItems.Count==0)return store.Scan();
        var scope=generationInspectionScope;
        if(scope is not null) {
            if(transport.ProtectedRenameBinding!=scope)throw new SharedAccountMismatchException();
        }
        if(generationInspectionItems.Count>0)store.ValidateGenerationFolderHistory(scope);
        var files=CatalogQuarantined?store.ScanCatalogIndependent(generationInspectionItems,scope,catalogHeldIDs,CatalogHolds):store.ScanGenerationCandidates(generationInspectionItems,scope);
        foreach(var error in store.LastScanErrors) {
            if(error.ItemId is {} id&&generationInspectionItems.Contains(id))generationInspectionBlocked.Add(id);
            foreach(var pair in generationInspectionPaths)if(error.Path=="."||pair.Value.Contains(error.Path))generationInspectionBlocked.Add(pair.Key);
        }
        return files;
    }
    bool ReplacementBlockedForSync(string id) {
        if(catalogHeldIDs.Contains(id)||pathCollisionHeldIDs.Contains(id))return true;
        if(!generationInspectionItems.Contains(id))return store.ReplacementBlocked(id);
        if(generationInspectionBlocked.Contains(id))return true;
        try{_=store.GenerationProtectionSnapshot(id,generationInspectionScope??throw new SharedAccountMismatchException());return false;}
        catch(Exception error)when(error is IOException or InvalidDataException or JsonException){generationInspectionBlocked.Add(id);return true;}
    }
    void AssertReadableForSync(string id) {
        if(catalogHeldIDs.Contains(id)||pathCollisionHeldIDs.Contains(id))throw new FileChangedException();
        if(!generationInspectionItems.Contains(id)){store.AssertReplacementReadable(id);return;}
        if(generationInspectionBlocked.Contains(id))throw new FileChangedException();
        _=store.GenerationProtectionSnapshot(id,generationInspectionScope??throw new SharedAccountMismatchException());
    }
    bool ReadyCheckpointForSync(string id)=>generationInspectionItems.Contains(id)?GenerationCheckpoint(id).Ready:SharedEditingStore.HasReadyCheckpoint(store,id);
    byte[] ReadForSync(string path,string id)=>generationInspectionItems.Contains(id)?
        store.ReadGenerationProjection(path,id,generationInspectionScope??throw new SharedAccountMismatchException()):store.Read(path);
    PackFile DescribeForSync(string path,string id) {var bytes=ReadForSync(path,id);if(TextPackStore.Identity(bytes)!=id)throw new FileChangedException();return new(path,TextPackStore.Hash(bytes),id);}
    void SelectGenerationCandidates(State state,IReadOnlyDictionary<string,RemoteItem> remote,TextPackStore.GenerationInventory discovered) {
        generationInspectionItems.Clear();generationInspectionBlocked.Clear();generationInspectionPaths.Clear();generationInspectionScope=transport.ProtectedRenameBinding;
        foreach(var pair in state.Items.Where(p=>p.Value.Lifecycle is null)) {
            var local=discovered.Files.Where(f=>f.ItemId==pair.Key).ToArray();var server=remote.GetValueOrDefault(pair.Key);
            var retained=state.ProtectedRenames.GetValueOrDefault(pair.Key)?.Version==2||state.SharedRenames.ContainsKey(pair.Key);
            if(retained||generationInspectionScope is not null&&(local.Length==1&&server is {Deleted:false,Lifecycle:null}&&(pair.Value.Path!=local[0].Path||local[0].Path!=server.RelativePath)||
               discovered.Errors.Any(e=>e.ItemId==pair.Key||e.Path==pair.Value.Path)))generationInspectionItems.Add(pair.Key);
        }
        foreach(var pair in state.ProtectedRenames.Where(p=>p.Value.Version==2))generationInspectionItems.Add(pair.Key);
        foreach(var id in generationInspectionItems) {
            var paths=new HashSet<string>(StringComparer.Ordinal);
            if(state.Items.GetValueOrDefault(id) is {} baseline)paths.Add(baseline.Path);
            if(remote.GetValueOrDefault(id) is {} server)paths.Add(server.RelativePath);
            foreach(var file in discovered.Files.Where(f=>f.ItemId==id))paths.Add(file.Path);
            generationInspectionPaths[id]=paths;
        }
        if(generationInspectionItems.Count>0&&generationInspectionScope is null)foreach(var id in generationInspectionItems)generationInspectionBlocked.Add(id);
    }
    (SharedCheckpoint? Checkpoint,bool Ready) GenerationCheckpoint(string id) {
        var protection=ReadSavedProtection(id);if(!protection.Available)return(null,false);
        var directory=Path.Combine(store.StateDirectory,"shared-editing",id);var path=Path.Combine(directory,"checkpoint.json");
        if(!File.Exists(path))return(null,false);
        var checkpoint=System.Text.Json.JsonSerializer.Deserialize<SharedCheckpoint>(RetainedFileReplacement.Read(path,90*1024*1024));
        if(checkpoint is null)return(null,false);
        var discovered=store.InspectGenerationInventory();var files=discovered.Files.Where(f=>f.ItemId==id).ToArray();
        var ready=!new[]{"intent.json","move-intent.json","binary-intent.json","acknowledge.json"}.Any(n=>File.Exists(Path.Combine(directory,n)))&&
            checkpoint.RetiredReason is null&&checkpoint.ItemId==id&&files.Length==1&&discovered.Errors.Count==0&&files[0].Path==checkpoint.Path&&
            (files[0].Hash==checkpoint.ProjectedHash||checkpoint.Pending);
        return(checkpoint,ready);
    }
    // No persisted absence cache. Every nil-generation admission authenticates
    // a complete fresh manifest, the exact full pack and a second fresh reply.
    async Task<(MirrorGeneration Local,MirrorGeneration Remote)> GenerationFacts(string id,Baseline? baseline,PackFile? local,RemoteItem? remote,
        SharedCheckpoint? checkpoint,MirrorGeneration? retained,Action current,CancellationToken ct,ProtectedSavedRename.Record? pendingBinaryRecord=null) {
        var unknown=(MirrorGeneration.Unknown,MirrorGeneration.Unknown);
        if(baseline?.Lifecycle is not null||remote?.Lifecycle is not null)
            return (MirrorGeneration.FromLegacy(baseline?.Lifecycle),MirrorGeneration.FromLegacy(remote?.Lifecycle));
        if(baseline is null||local is null||remote is null||remote.Deleted||remote.RestoreFromRevision is not null||
           SavedRenameContext() is not {} context||transport.ProtectedRenameBinding!=context.Scope)return unknown;
        // No path choice is being admitted in the ordinary unchanged lane.
        // Keep unknown facts rather than spending authenticated proof reads.
        if(retained is null&&baseline.Path==local.Path&&local.Path==remote.RelativePath)return unknown;
        current();
        bool Allowed()=>transport.Capabilities is {} caps&&caps.FullAccess&&caps.CanCreateContent&&caps.CanWrite(id,remote.RelativePath,true)&&caps.CanCreate(local.Path);
        if(!Allowed())return unknown;
        var pendingBinaryContinuity=pendingBinaryRecord is {Version:2,Phase:ProtectedSavedRename.Phase.Stopped}&&
            stateOwned(pendingBinaryRecord)&&pendingBinaryRecord.ObservedGeneration==MirrorGeneration.ObservedAbsent&&
            pendingBinaryRecord.Resolution is {} resolution&&resolution.LocalPath==local.Path&&resolution.RemotePath==remote.RelativePath&&
            checkpoint is {RetiredReason:null}&&checkpoint.ItemId==id&&checkpoint.Path==local.Path&&checkpoint.ProjectedHash==local.Hash&&checkpoint.AcknowledgedRevision==baseline.Revision;
        bool stateOwned(ProtectedSavedRename.Record record) {var loaded=Load();return loaded.ProtectedRenames.GetValueOrDefault(id)==record;}
        if(checkpoint?.Pending==true&&!pendingBinaryContinuity)return unknown;
        var incorporated=local.Hash==baseline.Hash&&local.Hash==baseline.Revision||
            checkpoint is {RetiredReason:null}&&(!checkpoint.Pending||pendingBinaryContinuity)&&checkpoint.ItemId==id&&checkpoint.Path==local.Path&&
            checkpoint.ProjectedHash==local.Hash&&checkpoint.AcknowledgedRevision==baseline.Revision;
        if(!incorporated||baseline.Revision!=remote.Revision&&retained!=MirrorGeneration.ObservedAbsent)return unknown;
        bool ValidPack(byte[] bytes,string expectedHash) {
            if(TextPackStore.Hash(bytes)!=expectedHash||TextPackStore.Identity(bytes)!=id)return false;
            using var archive=new ZipArchive(new MemoryStream(bytes));return archive.GetEntry("texttext-lifecycle.json") is null;
        }
        if(!ValidPack(store.ReadGenerationProjection(local.Path,id,context.Scope),local.Hash))return unknown;
        var first=await transport.GenerationEvidenceAsync(id,ct);current();
        if(first is null)return unknown;
        if(first.Scope!=context.Scope||first.Item!=remote||first.Generation!=MirrorGeneration.ObservedAbsent)throw new FileChangedException();
        var downloaded=await transport.DownloadAsync(id,ct);current();
        if(downloaded.RelativePath!=remote.RelativePath||downloaded.Revision!=remote.Revision||!ValidPack(downloaded.Data,remote.Revision))throw new FileChangedException();
        var second=await transport.GenerationEvidenceAsync(id,ct);current();
        if(second is null)return unknown;
        if(second!=first||transport.ProtectedRenameBinding!=context.Scope||!Allowed()||TextPackStore.Hash(store.ReadGenerationProjection(local.Path,id,context.Scope))!=local.Hash)throw new FileChangedException();
        return (MirrorGeneration.ObservedAbsent,MirrorGeneration.ObservedAbsent);
    }
    async Task<bool> RevalidateTypedStoppedBinary(State state,string id,CancellationToken ct) {
        if(state.ProtectedRenames.GetValueOrDefault(id) is not {Version:2} saved)return true;
        if(saved.Phase!=ProtectedSavedRename.Phase.Stopped||saved.Resolution is not {} resolution||state.Items.GetValueOrDefault(id) is not {} baseline)return false;
        ProtectedSavedRename.Validate(saved,saved.RootHash,saved.Scope);
        var discovered=store.InspectGenerationInventory();var files=discovered.Files.Where(f=>f.ItemId==id).ToArray();
        if(files.Length!=1||discovered.Errors.Count!=0||files[0].Path!=resolution.LocalPath)return false;
        var local=files[0];var proof=SavedMoveLocalProof(id);var protection=ReadSavedProtection(id);
        var checkpointPath=Path.Combine(store.StateDirectory,"shared-editing",id,"checkpoint.json");
        if(!protection.Available||!File.Exists(checkpointPath))return false;
        var checkpoint=System.Text.Json.JsonSerializer.Deserialize<SharedCheckpoint>(RetainedFileReplacement.Read(checkpointPath,90*1024*1024));
        void Current(){ct.ThrowIfCancellationRequested();if(SavedMoveLocalProof(id)!=proof||Load().ProtectedRenames.GetValueOrDefault(id)!=saved)throw new FileChangedException();}
        var evidence=await transport.GenerationEvidenceAsync(id,ct);Current();
        if(evidence is null||evidence.Scope!=saved.Scope||evidence.Item.Deleted||evidence.Item.RelativePath!=resolution.RemotePath)return false;
        var facts=await GenerationFacts(id,baseline,local,evidence.Item,checkpoint,saved.ObservedGeneration,Current,ct,saved);Current();
        return saved.ObservedGeneration.Matches(facts.Local)&&saved.ObservedGeneration.Matches(facts.Remote)&&
            resolution.LocalGeneration is {} left&&resolution.RemoteGeneration is {} right&&left.Matches(facts.Local)&&right.Matches(facts.Remote);
    }

}
