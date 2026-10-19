using System.IO.Compression;
using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;
using TextText.Core;

// Real native storage, leases, profile publication and packaged source policy;
// the authenticated endpoint is a controlled fixture, not installed acceptance.
static class ProtectedSavedRenameIntegrationTests
{
    const string Id="saved-rename-integration",Account="saved-rename-account",Generation="generation-a";
    static readonly ProtectedRenameScope Scope=new("https://saved-rename.test","saved-rename",Account);
    public static async Task Run(string temp,Action<bool,string> check) {
        await GenericConflict(temp,check);
        await LostReply(temp,check);
        await PeerPathAfterLostReply(temp,check);
        foreach(var changed in new[]{"generation","deleted"})await RetiredAfterLostReply(temp,changed,check);
        await PeerAfterMove(temp,check);
        await AdoptPeerText(temp,check);
        await PendingBinary(temp,check);
        await StoppedBinary(temp,check);
        await ReceiveAssetPeerText(temp,check);
        await UploadAssetsPeerText(temp,check);
        await ConflictAssetPeerText(temp,check);
        await NoCheckpointReceive(temp,check);
        MaterializedBaselineUnit(check);
        await UnavailableReadiness(temp,check);
        foreach(var boundary in new[]{"open-map","adopt-map","open-duplicate","adopt-duplicate","owned"})await OwnershipDecode(temp,boundary,check);
        await RecoveryRetry(temp,check);
        await RecoveryBounds(temp,check);
        if(OperatingSystem.IsWindows())foreach(var phase in new[]{"pending","terminal","stopped","unrelated"})await FolderOwnership(temp,phase,check);
        else Console.WriteLine("SKIP saved rename folder identity guard requires actual Windows.");
        foreach(var changed in new[]{"peer-text","local-path","permission","account","workspace","origin"})await RecoveryStale(temp,changed,check);
        await TerminalAndStopped(temp,check);
        foreach(var legacy in new[]{"known","unknown","changed","conflicted"})await Legacy(temp,legacy,check);
        foreach(var field in new[]{"origin","workspace","account"})await WrongBinding(temp,field,check);
        foreach(var race in new[]{"duplicate","checkpoint","permission","lifecycle","binding"})await PolicyRace(temp,race,check);
    }
    public static async Task RunAbsence(string temp,Action<bool,string> check) {
        if(!OperatingSystem.IsWindows()){Console.WriteLine("SKIP Windows-required native absence integration: retained file identity requires Windows Fingerprint primitives; pure model/profile/HTTP controls still run.");return;}
        using(var fixture=await Fixture.Create(temp,"absent-idle",absent:true)) {
            var reads=fixture.Remote.GenerationReads;var downloads=fixture.Remote.Downloads;await fixture.Pass();
            check(fixture.Remote.GenerationReads==reads&&fixture.Remote.Downloads==downloads,"ordinary unchanged absent item issues no additional generation or full-pack reads");
            var manifests=fixture.Remote.Manifests;await fixture.Pass(true);
            check(fixture.Remote.Manifests==manifests&&fixture.Remote.GenerationReads==reads&&fixture.Remote.Downloads==downloads,"unchanged same-path absent local wake sends zero manifest generation or full-pack requests");
        }

        using(var fixture=await Fixture.Create(temp,"absent-no-binding-new",absent:true)) {
            await fixture.MoveLocal("Local.textpack");var profile=Path.Combine(fixture.Store.StateDirectory,"retained-replacement-profile","profile.json");var priorProfile=File.Exists(profile)?File.ReadAllBytes(profile):null;fixture.Remote.ProtectedRenameBinding=null;await fixture.Pass();
            check(fixture.Saved() is null&&fixture.Remote.Requests.Count==0&&(priorProfile is null?!File.Exists(profile):File.Exists(profile)&&File.ReadAllBytes(profile).SequenceEqual(priorProfile)),"missing binding holds new absent leaf rename without floor6 publication or global account failure");
            var incomplete=System.Text.Encoding.UTF8.GetBytes("owned incomplete external pack");File.WriteAllBytes(fixture.Store.Resolve("Local.textpack"),incomplete);await fixture.Pass();
            check(fixture.Remote.Requests.Count==0&&fixture.Store.LastScanErrors.Any(error=>error.Path=="Local.textpack")&&File.ReadAllBytes(fixture.Store.Resolve("Local.textpack")).SequenceEqual(incomplete),"bindingless invalid intermediate pack stays an ordinary scan error without global owner demand or generation authority");
        }
        using(var fixture=await Fixture.Create(temp,"absent-no-binding-retained",absent:true)) {
            fixture.Remote.LoseReply=true;await fixture.MoveLocal("Local.textpack");await fixture.Pass();var saved=fixture.Saved();var calls=fixture.Remote.Requests.Count;var bytes=File.ReadAllBytes(fixture.Store.Resolve("Local.textpack"));fixture.Remote.ProtectedRenameBinding=null;await fixture.Pass();
            check(saved is {Version:2}&&fixture.Saved()==saved&&fixture.Remote.Requests.Count==calls&&File.ReadAllBytes(fixture.Store.Resolve("Local.textpack")).SequenceEqual(bytes),"missing binding retains existing v2 request and projection with no fallback or dispatch");
        }
        using(var fixture=await Fixture.Create(temp,"absent-lost",absent:true)) {
            fixture.Remote.LoseReply=true;await fixture.MoveLocal("Local.textpack");await fixture.Pass(true);
            var saved=fixture.Saved();check(saved is {Version:2}&&saved.Generation==MirrorGeneration.ObservedAbsent,"observed absent rename persists typed v2 only after genuine native evidence");
            check(JsonNode.Parse(File.ReadAllBytes(Path.Combine(fixture.Store.StateDirectory,"retained-replacement-profile","profile.json")))!["Version"]!.GetValue<int>()==6,"absent request lazily publishes floor6 before retained request");
            if(saved is null)return;
            fixture.Restart();await fixture.Pass();
            check(fixture.Saved() is null&&fixture.Remote.Requests.Count==2&&fixture.Remote.Requests.All(r=>r==saved.Request),"absent lost reply restarts and replays exact immutable request with fresh evidence");
        }
        using(var fixture=await Fixture.Create(temp,"absent-unknown",absent:true)) {
            await fixture.MoveLocal("Local.textpack");fixture.Remote.GenerationAvailable=false;await fixture.Pass();
            check(fixture.Saved() is null&&fixture.Remote.Requests.Count==0,"nil lifecycle without authenticated generation evidence never stages or sends");
        }
        using(var fixture=await Fixture.Create(temp,"absent-projection",absent:true)) {
            var changed=Pack("clean current projection differs from incorporated baseline",false);await fixture.Checkpoint(changed,fixture.CheckpointValue().JournalGeneration+1);
            var old=fixture.CheckpointValue();var journal=JsonNode.Parse(old.Journal)!;journal["pending"]=new JsonArray();journal["journalGeneration"]=old.JournalGeneration+1;
            await fixture.Editing!.CheckpointAsync(fixture.Session!.SessionToken,TextPackStore.Hash(changed),changed,old with{Pending=false,JournalGeneration=old.JournalGeneration+1,Journal=journal.ToJsonString()});
            await fixture.MoveLocal("Local.textpack");
            old=fixture.CheckpointValue();journal=JsonNode.Parse(old.Journal)!;journal["pending"]=new JsonArray();journal["journalGeneration"]=old.JournalGeneration+1;
            await fixture.Editing.CheckpointAsync(fixture.Session.SessionToken,old.ProjectedHash,changed,old with{Pending=false,JournalGeneration=old.JournalGeneration+1,Journal=journal.ToJsonString()});
            fixture.Remote.GenericConflict=true;await fixture.Pass();
            check(fixture.Saved() is {Version:2}&&fixture.Store.Read("Local.textpack").SequenceEqual(changed),"clean checkpoint incorporation permits projection-only hash divergence without replacing local bytes");
        }
        foreach(var invalid in new[]{"pending","pending-unchanged","retired","ack","path","hash"}) {
            using var fixture=await Fixture.Create(temp,"absent-invalid-"+invalid,absent:true);
            await fixture.MoveLocal("Local.textpack");var changed=invalid=="pending-unchanged"?fixture.Initial:Pack("unincorporated local projection",false);await fixture.Checkpoint(changed,fixture.CheckpointValue().JournalGeneration+1);
            var path=Path.Combine(fixture.Store.StateDirectory,"shared-editing",Id,"checkpoint.json");var value=JsonNode.Parse(File.ReadAllBytes(path))!;
            if(!invalid.StartsWith("pending",StringComparison.Ordinal)) {value["Pending"]=false;var journal=JsonNode.Parse(value["Journal"]!.GetValue<string>())!;journal["pending"]=new JsonArray();
                if(invalid=="ack"){value["AcknowledgedRevision"]=new string('e',64);journal["revision"]=new string('e',64);}
                if(invalid=="path"){value["Path"]="Other.textpack";journal["relativePath"]="Other.textpack";}
                value["Journal"]=journal.ToJsonString();
                if(invalid=="retired")value["RetiredReason"]="retained external checkpoint";
                if(invalid=="hash")value["ProjectedHash"]=new string('e',64);
            }
            var raw=JsonSerializer.SerializeToUtf8Bytes(value);File.WriteAllBytes(path,raw);
            try{await fixture.Pass();}catch(Exception e)when(e is InvalidDataException or IOException){}
            check(fixture.Remote.Requests.Count==0&&fixture.Saved() is null&&fixture.Store.Read("Local.textpack").SequenceEqual(changed)&&File.ReadAllBytes(path).SequenceEqual(raw),"absent admission retains exact bytes and dispatches nothing for "+invalid+" checkpoint proof");
        }
        foreach(var race in new[]{"permission","binding","remote-path","remote-generation","projection","duplicate","checkpoint","durable-state"}) {
            using var fixture=await Fixture.Create(temp,"absent-race-"+race,absent:true);await fixture.MoveLocal("Local.textpack");
            var statePath=Path.Combine(fixture.Store.StateDirectory,"sync.json");var checkpointPath=Path.Combine(fixture.Store.StateDirectory,"shared-editing",Id,"checkpoint.json");
            var expectedState=File.ReadAllBytes(statePath);var expectedCheckpoint=File.ReadAllBytes(checkpointPath);var expectedPack=fixture.Store.Read("Local.textpack");
            fixture.Remote.GenerationHook=_=> {
                fixture.Remote.GenerationHook=null;
                if(race=="permission")fixture.Remote.Capabilities=new(false,false,[],new(){{Id,false}});
                if(race=="binding")fixture.Remote.ProtectedRenameBinding=Scope with{AccountId="other-account"};
                if(race=="remote-path")fixture.Remote.Item=fixture.Remote.Item with{RelativePath="Peer.textpack"};
                if(race=="remote-generation")fixture.Remote.Item=fixture.Remote.Item with{Lifecycle="restored",RestoreFromRevision=fixture.InitialHash};
                if(race=="projection"){expectedPack=Pack("new local text during authenticated evidence",false);File.WriteAllBytes(fixture.Store.Resolve("Local.textpack"),expectedPack);}
                if(race=="duplicate")File.Copy(fixture.Store.Resolve("Local.textpack"),fixture.Store.Resolve("Duplicate.textpack"));
                if(race=="checkpoint"){var c=JsonNode.Parse(expectedCheckpoint)!;var j=JsonNode.Parse(c["Journal"]!.GetValue<string>())!;j["journalGeneration"]=c["JournalGeneration"]!.GetValue<long>()+1;c["JournalGeneration"]=j["journalGeneration"]!.GetValue<long>();c["Journal"]=j.ToJsonString();expectedCheckpoint=JsonSerializer.SerializeToUtf8Bytes(c);File.WriteAllBytes(checkpointPath,expectedCheckpoint);}
                if(race=="durable-state"){var changed=fixture.State();changed["Items"]![Id]!["Refresh"]=true;fixture.WriteState(changed);expectedState=File.ReadAllBytes(statePath);}
            };
            try{await fixture.Pass();}catch(Exception e)when(e is IOException or InvalidDataException){}
            check(fixture.Remote.Requests.Count==0&&File.ReadAllBytes(statePath).SequenceEqual(expectedState)&&File.ReadAllBytes(checkpointPath).SequenceEqual(expectedCheckpoint)&&fixture.Store.Read("Local.textpack").SequenceEqual(expectedPack),"post-await "+race+" change retains actual native bytes and refuses rename dispatch");
        }
        using(var fixture=await Fixture.Create(temp,"absent-inactive-history",absent:true)) {
            await fixture.MoveLocal("Local.textpack");var directory=Path.Combine(fixture.Store.StateDirectory,"shared-editing",Id);var raw=File.ReadAllBytes(Path.Combine(directory,"checkpoint.json"));
            var archive=Path.Combine(directory,"archive-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(archive);File.WriteAllBytes(Path.Combine(archive,"checkpoint.json"),raw);File.WriteAllText(Path.Combine(archive,"recovered.json"),"{\"version\":1}");
            File.WriteAllBytes(Path.Combine(directory,"archived-account-"+Guid.NewGuid().ToString("N")+".json"),raw);
            File.WriteAllBytes(Path.Combine(directory,"recovery-"+Guid.NewGuid().ToString("D")+".json"),raw);
            Dictionary<string,string> Inventory()=>Directory.GetFiles(directory,"*",SearchOption.AllDirectories).Order(StringComparer.Ordinal).ToDictionary(path=>path,path=>TextPackStore.Hash(File.ReadAllBytes(path)));
            var before=Inventory();fixture.Remote.GenericConflict=true;await fixture.Pass();var saved=fixture.Saved();
            check(saved is {Version:2}&&before.OrderBy(p=>p.Key).SequenceEqual(Inventory().OrderBy(p=>p.Key)),"known inactive shared history permits absent proof without rewriting archives");
            File.WriteAllText(Path.Combine(directory,"future-intent.json"),"{\"version\":99}");before=Inventory();var state=File.ReadAllBytes(Path.Combine(fixture.Store.StateDirectory,"sync.json"));var calls=fixture.Remote.Requests.Count;
            await fixture.Pass();
            check(before.OrderBy(p=>p.Key).SequenceEqual(Inventory().OrderBy(p=>p.Key))&&fixture.Remote.Requests.Count==calls&&fixture.Saved()==saved&&File.ReadAllBytes(Path.Combine(fixture.Store.StateDirectory,"sync.json")).SequenceEqual(state),"unknown active item filename retains whole inventory and original v2 request without repair or dispatch");
        }
        if(OperatingSystem.IsWindows()){await AbsentPendingReplacement(temp,check);await AbsentPendingReplacement(temp,check,true);}
        await StoppedBinary(temp,check,true);
    }
    static async Task AbsentPendingReplacement(string temp,Action<bool,string> check,bool global=false) {
        using var fixture=await Fixture.Create(temp,"absent-pending-registry"+(global?"-bindingless-folder":""),absent:true);await fixture.MoveLocal("Local.textpack");
        if(global){fixture.Remote.LoseReply=true;await fixture.Pass();fixture.Store.EnsureFolders(["HistoryFolder"]);}
        RetainedReplacementProfile.PrepareSharedRename(fixture.Store);
        const string other="unrelated-present-item";byte[] otherBytes;
        using(var output=new MemoryStream()) {using(var zip=new ZipArchive(output,ZipArchiveMode.Create,true)) {
            using(var w=new StreamWriter(zip.CreateEntry("text.md").Open()))w.Write("---\ntextTextId: "+other+"\n---\nunrelated retained projection");
            using(var w=new StreamWriter(zip.CreateEntry("texttext-lifecycle.json").Open()))w.Write(JsonSerializer.Serialize(new{version=1,generation=Generation}));
        }otherBytes=output.ToArray();}
        var otherFile=fixture.Store.Write("Other.textpack",otherBytes);var state=fixture.State();
        state["Items"]![other]=JsonSerializer.SerializeToNode(new SyncEngine.Baseline(otherFile.Path,otherFile.Hash,otherFile.Hash,Lifecycle:Generation));
        fixture.Remote.Extra[other]=new(other,otherFile.Path,otherFile.Hash,Lifecycle:Generation,CanEditContent:true);fixture.Remote.Capabilities!.Items[other]=true;
        state["Capabilities"]=JsonSerializer.SerializeToNode(fixture.Remote.Capabilities);fixture.WriteState(state);
        var candidate=Guid.NewGuid();var unrelated=Guid.NewGuid();var registry=new ReplacementRecoveryRegistry(fixture.Store.Root,fixture.Store.StateDirectory);
        void Pending(string path,string id,byte[] before,byte[] prepared,Guid operation) {
            var full=fixture.Store.Resolve(path);var recoveryRoot=Path.Combine(fixture.Store.Root,".texttext","retained-replacements",TextPackStore.Hash(System.Text.Encoding.UTF8.GetBytes(path)));
            try{RetainedFileReplacement.Replace(full,TextPackStore.Hash(before),prepared,operation,point=>{
                if(point=="prepared")registry.Register(operation,id,path,TextPackStore.Hash(before),TextPackStore.Hash(prepared),RetainedFileReplacement.OperationDirectory(full,operation,recoveryRoot));
                if(point=="replaced")throw new OperationCanceledException("Owned fixture interruption after native replacement");
            },recoveryRoot);}catch(OperationCanceledException){}
        }
        var prepared=Pack("retained candidate committed but not classified",false);
        Pending("Local.textpack",Id,fixture.Initial,prepared,candidate);Pending(otherFile.Path,other,otherBytes,otherBytes,unrelated);
        var ownEntry=registry.Entries(Id).Single(e=>e.Operation==candidate);var operationDirectory=Path.Combine(fixture.Store.Root,ownEntry.RecoveryPath!.Replace('/',Path.DirectorySeparatorChar));
        Dictionary<string,string> OwnInventory() {
            var paths=new List<string>{fixture.Store.Resolve("Local.textpack"),Path.Combine(fixture.Store.StateDirectory,"replacement-index",candidate.ToString("D")+".json")};
            foreach(var directory in new[]{operationDirectory,Path.Combine(fixture.Store.StateDirectory,"shared-editing",Id),Path.Combine(fixture.Store.StateDirectory,"retained-replacement-profile")})if(Directory.Exists(directory))paths.AddRange(Directory.GetFiles(directory,"*",SearchOption.AllDirectories));
            return paths.Order(StringComparer.Ordinal).ToDictionary(path=>path,path=>TextPackStore.Hash(File.ReadAllBytes(path)));
        }
        string ItemState(){var v=JsonSerializer.Deserialize<SyncEngine.State>(File.ReadAllBytes(Path.Combine(fixture.Store.StateDirectory,"sync.json")))!;return JsonSerializer.Serialize(new{Item=v.Items.GetValueOrDefault(Id),Outbox=v.Outbox.Where(o=>o.ItemId==Id).ToArray(),Rename=v.ProtectedRenames.TryGetValue(Id,out var retained)?Convert.ToBase64String(ProtectedSavedRename.ArchiveBytes(retained)):null,Legacy=v.SharedRenames.GetValueOrDefault(Id),Binary=v.BinaryOutbox.Where(o=>o.ItemId==Id).ToArray(),Assets=v.BinaryBaselines.GetValueOrDefault(Id),Cursor=v.BinaryRevisions.GetValueOrDefault(Id),Pull=v.PendingPull?.ItemId==Id?v.PendingPull:null});}
        if(global) {
            var type=typeof(TextPackStore).Assembly.GetType("TextText.Core.FolderCaseRename")!;var folder=Activator.CreateInstance(type,System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.Public|System.Reflection.BindingFlags.NonPublic,null,[fixture.Store],null)!;
            try{type.GetMethod("RenameAlias",System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.NonPublic)!.Invoke(folder,[fixture.Store.Resolve("HistoryFolder"),fixture.Store.Resolve("historyfolder"),(Action<string>)(point=>{if(point=="prepared")throw new IOException("Owned pending folder interruption");})]);}catch(System.Reflection.TargetInvocationException error)when(error.InnerException is IOException){}
            fixture.Remote.ProtectedRenameBinding=null;
            var retainedFiles=Directory.GetFiles(Path.Combine(fixture.Store.StateDirectory,"folder-case"),"*",SearchOption.AllDirectories).Concat(Directory.GetFiles(Path.Combine(fixture.Store.Root,".texttext","retained-replacements"),"*",SearchOption.AllDirectories)).Concat(Directory.GetFiles(Path.Combine(fixture.Store.StateDirectory,"replacement-index"),"*",SearchOption.AllDirectories)).Append(Path.Combine(fixture.Store.StateDirectory,"sync.json")).ToArray();
            var exact=retainedFiles.ToDictionary(path=>path,path=>TextPackStore.Hash(File.ReadAllBytes(path)));var calls=fixture.Remote.Requests.Count;var refused=false;try{await fixture.Pass();}catch(Exception error)when(error is IOException or InvalidDataException){refused=true;}
            check(refused&&fixture.Remote.Requests.Count==calls&&exact.All(pair=>File.Exists(pair.Key)&&TextPackStore.Hash(File.ReadAllBytes(pair.Key))==pair.Value),"bindingless retained v2 with pending global folder history refuses before candidate or unrelated recovery mutation");return;
        }
        var before=OwnInventory();var beforeState=ItemState();await fixture.Pass();
        check(before.OrderBy(p=>p.Key).SequenceEqual(OwnInventory().OrderBy(p=>p.Key))&&ItemState()==beforeState&&fixture.Remote.Requests.Count==0,"absent naming preserves entire pending item/registry/intent/profile inventories without hidden recovery or dispatch");
        var otherEntry=registry.Entries(other).Single(e=>e.Operation==unrelated);var otherDirectory=Path.Combine(fixture.Store.Root,otherEntry.RecoveryPath!.Replace('/',Path.DirectorySeparatorChar));
        check(JsonSerializer.Deserialize<RetainedFileReplacement.Manifest>(File.ReadAllBytes(Path.Combine(otherDirectory,"manifest.json")))!.State=="completed"&&File.ReadAllBytes(fixture.Store.Resolve(otherFile.Path)).SequenceEqual(otherBytes),"unrelated present-generation valid retained recovery still completes in the same pass");
    }
    public static async Task GenericConflict(string temp,Action<bool,string> check) {
        using var fixture=await Fixture.Create(temp,"generic");fixture.Remote.GenericConflict=true;
        await fixture.MoveLocal("Local.textpack");await fixture.Pass();
        var retained=fixture.Saved();
        check(retained is not null,"generic HTTP409 retains the exact saved rename instead of discarding/re-IDing it");
        if(retained is null)return;
        check(retained.Phase==ProtectedSavedRename.Phase.Pending&&retained.Receipt is null&&fixture.Remote.LegacyCalls==0,"generic HTTP409 never fabricates a terminal receipt or calls legacy rename");
        var operation=retained.Request.OperationId;await fixture.Pass();
        check(fixture.Remote.Requests.Count==2&&fixture.Remote.Requests.All(x=>x.OperationId==operation)&&fixture.Saved()==retained,"ambiguous retries preserve immutable command ID/payload");
        var marker=JsonNode.Parse(File.ReadAllBytes(Path.Combine(fixture.Store.StateDirectory,"retained-replacement-profile","profile.json")))!;
        check(marker["Version"]!.GetValue<int>()==5,"profile5 is published before retained protected command");
    }
    static async Task LostReply(string temp,Action<bool,string> check) {
        using var fixture=await Fixture.Create(temp,"lost");fixture.Remote.LoseReply=true;
        await fixture.MoveLocal("Local.textpack");await fixture.Pass();
        var retained=fixture.Saved()!;check(retained is not null&&fixture.Remote.Item.RelativePath=="Local.textpack","lost ACK retains committed request for exact replay");
        var later=Pack("accepted later text");await fixture.Checkpoint(later,3);
        fixture.Restart();await fixture.Pass();
        check(fixture.Saved() is null&&fixture.Remote.Requests.Count==2&&fixture.Remote.Requests[0]==fixture.Remote.Requests[1],"fresh native owner replays same immutable request and removes only exact moved receipt");
        check(fixture.Store.Read("Local.textpack").SequenceEqual(later)&&fixture.CheckpointValue().JournalGeneration==3,"rename ACK never overwrites accepted editor bytes/journal generation");
    }
    public static async Task AdoptPeerText(string temp,Action<bool,string> check) {
        using var fixture=await Fixture.Create(temp,"adopt-peer-text");await fixture.MoveLocal("Local.textpack");
        fixture.Remote.Data=Pack("peer text before already-moved path adoption");fixture.Remote.Item=fixture.Remote.Item with{RelativePath="Local.textpack",Revision=TextPackStore.Hash(fixture.Remote.Data)};
        await fixture.Pass();var state=JsonSerializer.Deserialize<SyncEngine.State>(fixture.State().ToJsonString())!;
        check(state.Items[Id].Path=="Local.textpack"&&state.Items[Id].Hash==fixture.InitialHash&&state.Items[Id].Revision==fixture.InitialHash&&fixture.Remote.Requests.Count==0,"already-moved path adoption preserves incorporated content pair instead of ACKing unseen peer revision");
        var prior=fixture.CheckpointValue();var journal=JsonNode.Parse(prior.Journal)!;journal["pending"]=new JsonArray();journal["journalGeneration"]=prior.JournalGeneration+1;
        await fixture.Editing!.CheckpointAsync(fixture.Session!.SessionToken,fixture.InitialHash,fixture.Initial,prior with{Pending=false,JournalGeneration=prior.JournalGeneration+1,Journal=journal.ToJsonString()});
        fixture.Editing.Dispose();fixture.Editing=null;var downloads=fixture.Remote.Downloads;await fixture.Pass();
        state=JsonSerializer.Deserialize<SyncEngine.State>(fixture.State().ToJsonString())!;
        check(fixture.Remote.Downloads>downloads&&fixture.Store.Read("Local.textpack").SequenceEqual(fixture.Remote.Data)&&state.Items[Id].Revision==fixture.Remote.Item.Revision,"clean editor subsequently downloads unseen peer text after path adoption");
    }
    static async Task PeerPathAfterLostReply(string temp,Action<bool,string> check) {
        using var fixture=await Fixture.Create(temp,"peer-path-after-lost");fixture.Remote.LoseReply=true;
        await fixture.MoveLocal("Local.textpack");await fixture.Pass();var saved=fixture.Saved()!;
        fixture.Remote.Item=fixture.Remote.Item with{RelativePath="Peer.textpack"};fixture.Restart();await fixture.Pass();
        var state=JsonSerializer.Deserialize<SyncEngine.State>(fixture.State().ToJsonString())!;
        check(fixture.Saved() is null&&state.Items[Id].Path=="Local.textpack"&&state.Items[Id].Revision==fixture.InitialHash&&fixture.Store.Read("Local.textpack").SequenceEqual(fixture.Initial),"historical typed moved receipt completes exact old command despite later peer path, without moving or ACKing current bytes");
        await fixture.Pass();state=JsonSerializer.Deserialize<SyncEngine.State>(fixture.State().ToJsonString())!;
        check(state.Items[Id].Path=="Peer.textpack"&&fixture.Store.Read("Peer.textpack").SequenceEqual(fixture.Initial)&&fixture.Remote.Requests.Count==2&&fixture.Remote.Requests.All(request=>request==saved.Request),"next shared path pass follows later peer move without inventing a rename command or losing pending journal");
    }
    static async Task RetiredAfterLostReply(string temp,string changed,Action<bool,string> check) {
        using var fixture=await Fixture.Create(temp,"retired-lost-"+changed);fixture.Remote.LoseReply=true;
        await fixture.MoveLocal("Local.textpack");await fixture.Pass();var saved=fixture.Saved()!;
        fixture.Remote.Item=changed=="generation"?fixture.Remote.Item with{Lifecycle="restored-generation"}:fixture.Remote.Item with{Deleted=true};
        var calls=fixture.Remote.Requests.Count;await fixture.Pass();
        check(fixture.Saved()==saved&&fixture.Remote.Requests.Count==calls&&fixture.Store.Read("Local.textpack").SequenceEqual(fixture.Initial),"historical completion never crosses "+changed+" remote lifecycle after lost receipt");
    }
    static async Task UnavailableReadiness(string temp,Action<bool,string> check) {
        using var fixture=await Fixture.Create(temp,"unavailable-checkpoint");fixture.Remote.GenericConflict=true;
        await fixture.MoveLocal("Local.textpack");await fixture.Pass();var saved=fixture.Saved();var calls=fixture.Remote.Requests.Count;
        var path=Path.Combine(fixture.Store.StateDirectory,"shared-editing",Id,"checkpoint.json");var value=JsonNode.Parse(File.ReadAllBytes(path))!;
        value["Journal"]=JsonSerializer.Serialize(new{accountId=Account});var raw=JsonSerializer.SerializeToUtf8Bytes(value);File.WriteAllBytes(path,raw);
        await fixture.Pass();var row=await fixture.Sync.SavedFileMoveRecoveryReadAsync(saved!.Request.OperationId);
        check(fixture.Remote.Requests.Count==calls&&fixture.Saved()==saved&&File.ReadAllBytes(path).SequenceEqual(raw)&&!row.RetryAllowed&&!row.KeepNamesAllowed,"missing journal readiness fields hold saved request without recovering, rewriting or replaying retained bytes");
        value["Journal"]=JsonSerializer.Serialize(new{accountId="other-account"});var foreign=JsonSerializer.SerializeToUtf8Bytes(value);File.WriteAllBytes(path,foreign);
        try{await fixture.Sync.SyncAsync();throw new Exception("foreign journal treated as unavailable readiness");}catch(SharedAccountMismatchException){}
        check(fixture.Remote.Requests.Count==calls&&File.ReadAllBytes(path).SequenceEqual(foreign),"unavailable-readiness fallback never hides foreign account authority failure");
    }
    static async Task OwnershipDecode(string temp,string boundary,Action<bool,string> check) {
        using var fixture=await Fixture.Create(temp,"ownership-"+boundary);fixture.Editing!.Dispose();fixture.Editing=null;
        RetainedReplacementProfile.PrepareSharedRename(fixture.Store);
        var request=new ProtectedRenameRequest(Guid.NewGuid().ToString("D"),Id,"Original.textpack","Later.textpack",fixture.InitialHash);
        fixture.Put(ProtectedSavedRename.Pending(fixture.RootHash,request,Scope,fixture.InitialHash,Generation));
        var path=Path.Combine(fixture.Store.StateDirectory,"sync.json");
        if(boundary.EndsWith("duplicate",StringComparison.Ordinal)) {
            var raw=File.ReadAllText(path);File.WriteAllText(path,raw.Insert(raw.IndexOf('{')+1,"\"ProtectedRenames\":{},"));
        }
        var before=File.ReadAllBytes(path);var marker=Path.Combine(fixture.Store.StateDirectory,AccountRootOwnership.FileName);
        if(boundary!="owned") {
            File.Move(marker,Path.Combine(fixture.Store.StateDirectory,"preserved-owner.json"));
            Directory.Move(Path.Combine(fixture.Store.StateDirectory,"retained-replacement-profile"),Path.Combine(fixture.Store.StateDirectory,"preserved-profile"));
        }
        var refused=false;
        try {
            if(boundary.StartsWith("open-",StringComparison.Ordinal))AccountRootOwnership.Open(fixture.Store,new(Scope.Origin),Scope.WorkspaceId,Account);
            else AccountStateAdoption.AdoptAfterExplicitReview(fixture.Store,new(Scope.Origin),Scope.WorkspaceId,Account);
        }catch(Exception error)when(error is InvalidDataException or LegacyAccountStateException){refused=true;}
        check(refused==(boundary!="owned")&&File.ReadAllBytes(path).SequenceEqual(before)&&File.Exists(marker)==(boundary=="owned"),"ownership decoder "+boundary+" preserves exact state and never adopts or erases protected commands");
    }
    public static async Task UploadAssetsPeerText(string temp,Action<bool,string> check) {
        byte[] a0=new byte[]{1,2},b0=new byte[]{3,4},a1=new byte[]{5,6,7},b1=new byte[]{8,9,10};
        var initial=BinaryEntryPacks.Patch(BinaryEntryPacks.Patch(Pack("retained original text"),"assets/a.bin",null,a0),"assets/b.bin",null,b0);
        using var fixture=await Fixture.Create(temp,"upload-assets-peer-text",initial:initial);
        var changed=BinaryEntryPacks.Patch(initial,"assets/a.bin",TextPackStore.Hash(a0),a1);await fixture.Checkpoint(changed,2);
        fixture.Remote.BeforeBinaryPatch=()=>{fixture.Remote.Data=BinaryEntryPacks.Patch(BinaryEntryPacks.Patch(Pack("unseen peer text during asset CAS"),"assets/a.bin",null,a0),"assets/b.bin",null,b1);fixture.Remote.Item=fixture.Remote.Item with{Revision=TextPackStore.Hash(fixture.Remote.Data)};};
        await fixture.Pass();var state=JsonSerializer.Deserialize<SyncEngine.State>(fixture.State().ToJsonString())!;
        check(state.Items[Id].Revision==fixture.InitialHash&&fixture.CheckpointValue().AcknowledgedRevision==fixture.InitialHash&&state.BinaryRevisions.GetValueOrDefault(Id)!=fixture.Remote.Item.Revision&&fixture.Remote.BinaryRequests.Count==1,"one-entry asset CAS never ACKs peer text or marks unseen peer asset as fully incorporated");
        await fixture.Pass();state=JsonSerializer.Deserialize<SyncEngine.State>(fixture.State().ToJsonString())!;
        var local=fixture.Store.Read("Original.textpack");var assets=BinaryEntryPacks.Assets(local);
        check(assets["assets/a.bin"].Bytes.SequenceEqual(a1)&&assets["assets/b.bin"].Bytes.SequenceEqual(b1)&&state.Items[Id].Revision==fixture.InitialHash&&!TextPackStore.Markdown(local).Contains("unseen peer text"),"next asset pass fetches independent peer asset while pending text remains unacknowledged");
    }
    public static async Task ConflictAssetPeerText(string temp,Action<bool,string> check) {
        byte[] a0=new byte[]{1,2},a1=new byte[]{3,4},winner=new byte[]{5,6};
        var initial=BinaryEntryPacks.Patch(Pack("retained original text"),"assets/a.bin",null,a0);
        using var fixture=await Fixture.Create(temp,"conflict-asset-peer-text",initial:initial);
        await fixture.Checkpoint(BinaryEntryPacks.Patch(initial,"assets/a.bin",TextPackStore.Hash(a0),a1),2);
        fixture.Remote.BeforeBinaryPatch=()=>{fixture.Remote.Data=BinaryEntryPacks.Patch(Pack("unseen peer text with asset winner"),"assets/a.bin",null,winner);fixture.Remote.Item=fixture.Remote.Item with{Revision=TextPackStore.Hash(fixture.Remote.Data)};};
        await fixture.Pass();var state=JsonSerializer.Deserialize<SyncEngine.State>(fixture.State().ToJsonString())!;
        var local=fixture.Store.Read("Original.textpack");
        check(state.Items[Id].Revision==fixture.InitialHash&&fixture.CheckpointValue().AcknowledgedRevision==fixture.InitialHash&&BinaryEntryPacks.Assets(local)["assets/a.bin"].Bytes.SequenceEqual(winner)&&!TextPackStore.Markdown(local).Contains("unseen peer text")&&state.BinaryOutbox.Count==0,"asset conflict winner materializes only asset without ACKing unseen peer text or native journal");
    }
    static void MaterializedBaselineUnit(Action<bool,string> check) {
        // Unit proof: fixed hashes avoid ZIP clock/metadata assumptions.
        var before=new string('a',64);var after=new string('b',64);var other=new string('c',64);
        var baseline=new SyncEngine.Baseline("Original.textpack",before,before,Lifecycle:Generation);
        var method=typeof(SyncEngine).GetMethod("MaterializedBinaryBaseline",System.Reflection.BindingFlags.Static|System.Reflection.BindingFlags.NonPublic)!;
        SyncEngine.Baseline Apply(string prior,string materialized,string remote)=>(SyncEngine.Baseline)method.Invoke(null,new object[]{baseline,prior,materialized,remote})!;
        check(Apply(other,after,after)==baseline with{Hash=after,Revision=after},"unit exact whole-pack hash proof advances incorporated content pair");
        check(Apply(before,after,other)==baseline with{Hash=after},"unit known before-pack materialization advances hash without unseen text revision");
        check(Apply(other,after,before)==baseline,"unit unknown before-pack materialization preserves incorporated content pair");
    }
    public static async Task NoCheckpointReceive(string temp,Action<bool,string> check) {
        using var fixture=await Fixture.Create(temp,"no-checkpoint-receive",checkpoint:false);
        var local=Pack("owned external local text L before first checkpoint");File.WriteAllBytes(fixture.Store.Resolve("Original.textpack"),local);
        var asset=new byte[]{0,255,19,77};fixture.Remote.Data=BinaryEntryPacks.Patch(Pack("unseen peer text R before first checkpoint"),"assets/exact.bin",null,asset);
        fixture.Remote.Item=fixture.Remote.Item with{Revision=TextPackStore.Hash(fixture.Remote.Data)};
        await fixture.Pass();var materialized=fixture.Store.Read("Original.textpack");var state=JsonSerializer.Deserialize<SyncEngine.State>(fixture.State().ToJsonString())!;
        check(state.Items[Id].Hash==fixture.InitialHash&&state.Items[Id].Revision==fixture.InitialHash&&TextPackStore.Markdown(materialized).Contains("owned external local text L")&&BinaryEntryPacks.Assets(materialized)["assets/exact.bin"].Bytes.SequenceEqual(asset),"asset receive before first checkpoint preserves unknown local text and never promotes it to baseline");
        fixture.Editing!.Dispose();fixture.Editing=null;fixture.Remote.AllowConflictUpload=true;await fixture.Pass();
        state=JsonSerializer.Deserialize<SyncEngine.State>(fixture.State().ToJsonString())!;
        check(fixture.Store.Read("Original.textpack").SequenceEqual(materialized)&&state.Outbox.Any(operation=>operation.Conflicted)&&TextPackStore.Markdown(fixture.Remote.Data).Contains("unseen peer text R"),"ending no-checkpoint native lease preserves local L and remote R through ordinary CAS conflict instead of a clean pull");
    }
    public static async Task ReceiveAssetPeerText(string temp,Action<bool,string> check) {
        using var fixture=await Fixture.Create(temp,"receive-asset-peer-text");var asset=new byte[]{0,255,72,19,9};
        fixture.Remote.Data=BinaryEntryPacks.Patch(Pack("unseen remote text with changed asset"),"assets/exact.bin",null,asset);
        fixture.Remote.Item=fixture.Remote.Item with{Revision=TextPackStore.Hash(fixture.Remote.Data)};
        await fixture.Pass();var state=JsonSerializer.Deserialize<SyncEngine.State>(fixture.State().ToJsonString())!;
        var local=fixture.Store.Read("Original.textpack");
        check(state.Items[Id].Revision==fixture.InitialHash&&state.Items[Id].Hash==TextPackStore.Hash(local)&&state.BinaryRevisions[Id]==fixture.Remote.Item.Revision&&fixture.CheckpointValue().AcknowledgedRevision==fixture.InitialHash&&BinaryEntryPacks.Assets(local)["assets/exact.bin"].Bytes.SequenceEqual(asset)&&!TextPackStore.Markdown(local).Contains("unseen remote text"),"receiving actual changed asset tracks asset revision without ACKing unseen remote text or native journal revision");
        var prior=fixture.CheckpointValue();var journal=JsonNode.Parse(prior.Journal)!;journal["pending"]=new JsonArray();journal["journalGeneration"]=prior.JournalGeneration+1;
        await fixture.Editing!.CheckpointAsync(fixture.Session!.SessionToken,TextPackStore.Hash(local),local,prior with{Pending=false,JournalGeneration=prior.JournalGeneration+1,Journal=journal.ToJsonString()});
        fixture.Editing.Dispose();fixture.Editing=null;var downloads=fixture.Remote.Downloads;await fixture.Pass();
        state=JsonSerializer.Deserialize<SyncEngine.State>(fixture.State().ToJsonString())!;
        check(fixture.Remote.Downloads>downloads&&fixture.Store.Read("Original.textpack").SequenceEqual(fixture.Remote.Data)&&state.Items[Id].Revision==fixture.Remote.Item.Revision,"later clean native pass still downloads unincorporated text after asset-only materialization");
    }
    public static async Task StoppedBinary(string temp,Action<bool,string> check,bool absent=false) {
        using var fixture=await Fixture.Create(temp,absent?"absent-stopped-binary":"stopped-binary",absent:absent);fixture.Remote.Item=fixture.Remote.Item with{RelativePath="Server.textpack"};
        await fixture.MoveLocal("Local.textpack");
        if(absent)RetainedReplacementProfile.PrepareObservedAbsenceRename(fixture.Store);else RetainedReplacementProfile.PrepareSharedRename(fixture.Store);
        var request=new ProtectedRenameRequest(Guid.NewGuid().ToString("D"),Id,"Original.textpack","Local.textpack",fixture.InitialHash);
        fixture.Put(absent?ProtectedSavedRename.Pending(fixture.RootHash,request,Scope,fixture.InitialHash,MirrorGeneration.ObservedAbsent):ProtectedSavedRename.Pending(fixture.RootHash,request,Scope,fixture.InitialHash,Generation));await fixture.Pass();
        var row=await fixture.Sync.SavedFileMoveRecoveryReadAsync(request.OperationId);
        await fixture.Sync.KeepSavedFileMoveNamesAsync(row.Id,row.RequestHash!,row.Inspection!,true);var stopped=fixture.Saved();
        var asset=new byte[]{0,255,19,72,44};var changed=BinaryEntryPacks.Patch(fixture.Initial,"assets/exact.bin",null,asset);
        await fixture.Checkpoint(changed,fixture.CheckpointValue().JournalGeneration+1);var calls=fixture.Remote.Requests.Count;await fixture.Pass();
        check(fixture.Remote.BinaryRequests.Count==1&&fixture.Remote.Requests.Count==calls&&fixture.Saved()==stopped&&fixture.Remote.Item.RelativePath=="Server.textpack"&&BinaryEntryPacks.Assets(fixture.Store.Read("Local.textpack"))["assets/exact.bin"].Bytes.SequenceEqual(asset)&&BinaryEntryPacks.Assets(fixture.Remote.Data).TryGetValue("assets/exact.bin",out var uploaded)&&uploaded.Bytes.SequenceEqual(asset),"stopped different local/server names preserve actual binary CAS without reissuing rename or changing either name");
    }
    static async Task PendingBinary(string temp,Action<bool,string> check) {
        using var fixture=await Fixture.Create(temp,"pending-binary");var asset=new byte[]{0,255,19,72,3};
        var changed=BinaryEntryPacks.Patch(fixture.Initial,"assets/exact.bin",null,asset);
        await fixture.Checkpoint(changed,2);fixture.Remote.BinaryLoseReply=true;await fixture.Pass();
        var pending=JsonSerializer.Deserialize<SyncEngine.State>(fixture.State().ToJsonString())!.BinaryOutbox.Single();
        check(fixture.Remote.BinaryRequests.Count==1&&fixture.Remote.BinaryRequests[0]==pending.Id,"actual asset CAS lost reply retains original binary command before file relocation");
        await fixture.MoveLocal("Local.textpack");await fixture.Pass();
        var state=JsonSerializer.Deserialize<SyncEngine.State>(fixture.State().ToJsonString())!;
        check(fixture.Saved() is null&&state.BinaryOutbox.Count==0&&fixture.Remote.BinaryRequests.Count==2&&fixture.Remote.BinaryRequests.All(id=>id==pending.Id)&&BinaryEntryPacks.Assets(fixture.Store.Read("Local.textpack"))["assets/exact.bin"].Bytes.SequenceEqual(asset),"protected path completion permits unchanged binary CAS replay with exact asset bytes/ID and no full-file writer");
    }
    static async Task PeerAfterMove(string temp,Action<bool,string> check) {
        using var fixture=await Fixture.Create(temp,"peer-after-move");await fixture.MoveLocal("Local.textpack");
        fixture.Remote.AfterMoved=()=>{fixture.Remote.Data=Pack("peer text arriving after path commit");fixture.Remote.Item=fixture.Remote.Item with{Revision=TextPackStore.Hash(fixture.Remote.Data)};};
        await fixture.Pass();var state=JsonSerializer.Deserialize<SyncEngine.State>(fixture.State().ToJsonString())!;
        check(fixture.Saved() is null&&state.Items[Id].Path=="Local.textpack"&&state.Items[Id].Revision==fixture.InitialHash&&state.Items[Id].Hash==fixture.InitialHash,"typed move adopts only path, never ACKs unseen final-manifest peer text");
        await fixture.Pass();state=JsonSerializer.Deserialize<SyncEngine.State>(fixture.State().ToJsonString())!;
        check(fixture.Store.Read("Local.textpack").SequenceEqual(fixture.Initial)&&fixture.CheckpointValue().Pending&&state.Items[Id].Revision!=fixture.Remote.Item.Revision,"subsequent sync retains pending local editor bytes and leaves unseen peer revision unacknowledged");
        var prior=fixture.CheckpointValue();var journal=JsonNode.Parse(prior.Journal)!;journal["pending"]=new JsonArray();journal["journalGeneration"]=prior.JournalGeneration+1;
        await fixture.Editing!.CheckpointAsync(fixture.Session!.SessionToken,fixture.InitialHash,fixture.Initial,prior with{Pending=false,JournalGeneration=prior.JournalGeneration+1,Journal=journal.ToJsonString()});
        fixture.Editing.Dispose();fixture.Editing=null;var downloads=fixture.Remote.Downloads;
        await fixture.Pass();state=JsonSerializer.Deserialize<SyncEngine.State>(fixture.State().ToJsonString())!;
        check(fixture.Remote.Downloads>downloads&&fixture.Store.Read("Local.textpack").SequenceEqual(fixture.Remote.Data)&&state.Items[Id].Hash==fixture.Remote.Item.Revision&&state.Items[Id].Revision==fixture.Remote.Item.Revision,"once local editor is clean, subsequent sync downloads and incorporates the still-unacknowledged peer revision");
    }
    static async Task RecoveryRetry(string temp,Action<bool,string> check) {
        using var fixture=await Fixture.Create(temp,"recovery-retry");fixture.Remote.GenericConflict=true;
        await fixture.MoveLocal("Local.textpack");await fixture.Pass();var saved=fixture.Saved()!;
        var row=await fixture.Sync.SavedFileMoveRecoveryReadAsync(saved.Request.OperationId);
        check(row.State=="pending"&&row.RetryAllowed&&!row.KeepNamesAllowed&&row.RequestHash is not null&&row.Inspection is not null,"fresh pending recovery exposes exact retry but never cancellation");
        var calls=fixture.Remote.Requests.Count;
        try{await fixture.Sync.RetrySavedFileMoveAsync(row.Id,row.RequestHash!,row.Inspection!,false);throw new Exception("missing consent accepted");}catch(InvalidDataException){}
        try{await fixture.Sync.RetrySavedFileMoveAsync(row.Id,row.RequestHash!,new string('f',64),true);throw new Exception("stale inspection accepted");}catch(FileChangedException){}
        check(fixture.Remote.Requests.Count==calls&&fixture.Saved()==saved,"missing consent and stale inspection refuse before request dispatch");
        fixture.Remote.ManifestUnavailable=true;
        var unavailable=await fixture.Sync.SavedFileMoveRecoveryListAsync();
        check(unavailable.Entries.Count==1&&unavailable.Entries[0].State=="pending"&&unavailable.Entries[0].BlockedReason=="unavailable"&&unavailable.Entries[0].Inspection is null&&!unavailable.Entries[0].RetryAllowed&&!unavailable.Entries[0].KeepNamesAllowed,"offline inventory retains immutable command without inventing verified actions");
        fixture.Remote.ManifestUnavailable=false;fixture.Remote.GenericConflict=false;
        row=await fixture.Sync.SavedFileMoveRecoveryReadAsync(row.Id);
        await fixture.Sync.RetrySavedFileMoveAsync(row.Id,row.RequestHash!,row.Inspection!,true);
        check(fixture.Saved() is null&&fixture.Remote.Requests[^1]==saved.Request,"explicit recovery retries only the existing immutable command and adopts authenticated receipt");
    }
    [System.Runtime.InteropServices.DllImport("kernel32.dll",CharSet=System.Runtime.InteropServices.CharSet.Unicode,SetLastError=true)]
    static extern bool MoveFileW(string source,string target);
    static async Task FolderOwnership(string temp,string phase,Action<bool,string> check) {
        using var fixture=await Fixture.Create(temp,"folder-"+phase,true);
        RetainedReplacementProfile.PrepareSharedRename(fixture.Store);
        var request=new ProtectedRenameRequest(Guid.NewGuid().ToString("D"),Id,"Notes/Original.textpack","Notes/Renamed.textpack",fixture.InitialHash);
        var record=ProtectedSavedRename.Pending(fixture.RootHash,request,Scope,fixture.InitialHash,Generation);
        if(phase is "terminal" or "stopped")record=ProtectedSavedRename.Consume(record,new(request,Scope,"conflict","Notes/Original.textpack",fixture.InitialHash,false)).Rejected!;
        if(phase=="stopped")record=ProtectedSavedRename.Stop(record,new("Notes/Original.textpack","Notes/Original.textpack",Generation,Generation));
        fixture.Put(record);fixture.Editing!.Dispose();fixture.Editing=null;
        var from=phase=="unrelated"?"Other":"Notes";var to=from.ToLowerInvariant();
        if(!MoveFileW(fixture.Store.Resolve(from),fixture.Store.Resolve(to)))throw new IOException("Owned folder fixture rename failed.");
        fixture.Remote.GenericConflict=true;
        try{await fixture.Sync.SyncAsync();}catch(Exception error)when(error is IOException or HttpRequestException){}
        check(fixture.Remote.FolderCalls==(phase=="unrelated"?1:0)&&fixture.Saved()==record&&fixture.Store.Read(phase=="unrelated"?"Notes/Original.textpack":"notes/Original.textpack").SequenceEqual(fixture.Initial),"folder command "+phase+" respects only affected saved ownership and retains exact command/bytes");
    }
    static async Task RecoveryStale(string temp,string changed,Action<bool,string> check) {
        using var fixture=await Fixture.Create(temp,"recovery-stale-"+changed);fixture.Remote.GenericConflict=true;
        await fixture.MoveLocal("Local.textpack");await fixture.Pass();var saved=fixture.Saved()!;
        var row=await fixture.Sync.SavedFileMoveRecoveryReadAsync(saved.Request.OperationId);var calls=fixture.Remote.Requests.Count;
        if(changed=="peer-text"){fixture.Remote.Data=Pack("peer edit after inspection");fixture.Remote.Item=fixture.Remote.Item with{Revision=TextPackStore.Hash(fixture.Remote.Data)};}
        if(changed=="local-path")File.Move(fixture.Store.Resolve("Local.textpack"),fixture.Store.Resolve("Later.textpack"));
        if(changed=="permission")fixture.Remote.Capabilities=new(false,false,[],new(){{Id,false}});
        if(changed=="account")fixture.Remote.ProtectedRenameBinding=Scope with{AccountId="other-account"};
        if(changed=="workspace")fixture.Remote.ProtectedRenameBinding=Scope with{WorkspaceId="other-workspace"};
        if(changed=="origin")fixture.Remote.ProtectedRenameBinding=Scope with{Origin="https://other.test"};
        try{await fixture.Sync.RetrySavedFileMoveAsync(row.Id,row.RequestHash!,row.Inspection!,true);throw new Exception("stale "+changed+" inspection accepted");}catch(FileChangedException){}
        check(fixture.Remote.Requests.Count==calls&&fixture.Saved()==saved,"fresh actor consent refuses "+changed+" change after inspection with zero rename dispatch");
    }
    static async Task RecoveryBounds(string temp,Action<bool,string> check) {
        using var fixture=await Fixture.Create(temp,"recovery-bounds");
        RetainedReplacementProfile.PrepareSharedRename(fixture.Store);
        var map=new JsonObject();
        for(var index=0;index<101;index++) {
            var request=new ProtectedRenameRequest(Guid.NewGuid().ToString("D"),"bounded-"+index,"Before"+index+".textpack","After"+index+".textpack",fixture.InitialHash);
            var record=ProtectedSavedRename.Pending(fixture.RootHash,request,Scope,fixture.InitialHash,Generation);
            map[request.ItemId]=JsonSerializer.SerializeToNode(record);
        }
        var state=fixture.State();state["ProtectedRenames"]=map;fixture.WriteState(state);
        var manifestCalls=fixture.Remote.Manifests;
        var all=await fixture.Sync.SavedFileMoveRecoveryListAsync();
        var filtered=await fixture.Sync.SavedFileMoveRecoveryListAsync(path:"Before100.textpack");
        check(fixture.Remote.Manifests==manifestCalls&&all.Entries.All(row=>row.Inspection is null&&!row.RetryAllowed&&!row.KeepNamesAllowed)&&all.Entries.Count==100&&all.Truncated&&filtered.Entries.Count==1&&!filtered.Truncated&&filtered.Entries[0].SourcePath=="Before100.textpack","local-only recovery sends zero RPCs, bounds 100 rows, reports truncation, and filters before taking rows");
        var bytes=File.ReadAllBytes(Path.Combine(fixture.Store.StateDirectory,"sync.json"));
        var raw=System.Text.Encoding.UTF8.GetString(bytes);raw=raw.Insert(raw.IndexOf('{')+1,"\"ProtectedRenames\":{},");
        File.WriteAllText(Path.Combine(fixture.Store.StateDirectory,"sync.json"),raw);
        try{await fixture.Sync.SavedFileMoveRecoveryListAsync();throw new Exception("duplicate retained state map accepted");}catch(InvalidDataException){}
        check(File.ReadAllText(Path.Combine(fixture.Store.StateDirectory,"sync.json"))==raw,"strict whole-State duplicate preflight refuses without normalizing or losing retained bytes");
    }
    static async Task TerminalAndStopped(string temp,Action<bool,string> check) {
        using var fixture=await Fixture.Create(temp,"terminal");
        fixture.Remote.Item=fixture.Remote.Item with{RelativePath="Server.textpack"};
        await fixture.MoveLocal("Local.textpack");
        // Retain a pending immutable request through the existing owner state,
        // then the controlled endpoint supplies its actual typed CAS rejection.
        RetainedReplacementProfile.PrepareSharedRename(fixture.Store);
        var request=new ProtectedRenameRequest(Guid.NewGuid().ToString("D"),Id,"Original.textpack","Local.textpack",fixture.InitialHash);
        var pending=ProtectedSavedRename.Pending(fixture.RootHash,request,Scope,fixture.InitialHash,Generation);
        fixture.Put(pending);await fixture.Pass();var rejected=fixture.Saved()!;
        check(rejected.Phase==ProtectedSavedRename.Phase.TerminalRejected&&rejected.Receipt?.Status=="conflict"&&rejected.Receipt.RelativePath=="Server.textpack","typed exact CAS rejection is retained for explicit review");
        var calls=fixture.Remote.Requests.Count;fixture.Restart();await fixture.Pass();
        check(fixture.Remote.Requests.Count==calls&&fixture.Store.Read("Local.textpack").SequenceEqual(fixture.Initial),"terminal review survives restart without automatic rename or local overwrite");
        var review=await fixture.Sync.SavedFileMoveRecoveryReadAsync(rejected.Request.OperationId);
        check(review.State=="terminal-rejected"&&review.KeepNamesAllowed&&!review.RetryAllowed&&review.Inspection is not null,"fresh recovery inspects typed rejection with explicit keep-names action only");
        await fixture.Sync.KeepSavedFileMoveNamesAsync(review.Id,review.RequestHash!,review.Inspection!,true);
        var stopped=fixture.Saved()!;
        try{await fixture.Sync.KeepSavedFileMoveNamesAsync(review.Id,review.RequestHash!,review.Inspection!,true);throw new Exception("repeated old consent accepted");}catch(FileChangedException){}
        check(stopped.Phase==ProtectedSavedRename.Phase.Stopped&&stopped.Receipt==rejected.Receipt&&fixture.Store.Read("Local.textpack").SequenceEqual(fixture.Initial)&&fixture.Remote.Item.RelativePath=="Server.textpack","explicit keep names retains exact typed receipt and changes no local or server paths");
        fixture.Remote.Data=Pack("peer text after explicit stop");fixture.Remote.Item=fixture.Remote.Item with{Revision=TextPackStore.Hash(fixture.Remote.Data)};
        fixture.Restart();await fixture.Pass();await fixture.Pass();
        check(fixture.Remote.Requests.Count==calls&&fixture.Saved()==stopped,"stopped chosen paths/generations survive restart and peer text without silently recreating rename");
        fixture.Remote.GenericConflict=true;await fixture.MoveLocal("Deliberate.textpack");await fixture.Pass();
        var next=fixture.Saved()!;var archive=Path.Combine(fixture.Store.StateDirectory,"recovery","saved-rename-"+stopped.Request.OperationId+".json");
        check(next.Phase==ProtectedSavedRename.Phase.Pending&&next.Request.OperationId!=stopped.Request.OperationId&&next.Request.Source=="Server.textpack"&&next.Request.Destination=="Deliberate.textpack","deliberate later local path stages a fresh immutable command only after policy admission");
        check(File.ReadAllBytes(archive).SequenceEqual(ProtectedSavedRename.ArchiveBytes(stopped)),"prior exact terminal receipt is create-only archived before stopped record replacement");
    }
    static async Task Legacy(string temp,string mode,Action<bool,string> check) {
        using var fixture=await Fixture.Create(temp,"legacy-"+mode);
        await fixture.MoveLocal("Local.textpack");
        var original=new SyncEngine.Operation(Guid.NewGuid().ToString("D"),"rename",Id,"Original.textpack","Local.textpack",fixture.InitialHash,fixture.InitialHash,null,mode=="conflicted",mode=="unknown"?null:mode=="changed"?"older-generation":Generation);
        var state=fixture.State();state["SharedRenames"]=new JsonObject{[Id]=JsonNode.Parse(JsonSerializer.Serialize(original))};
        // A later text ACK may advance the current baseline hash/path evidence;
        // it must never rewrite the already captured request.
        if(mode=="known")state["Items"]![Id]!["Hash"]=new string('a',64);
        fixture.WriteState(state);fixture.Remote.GenericConflict=true;await fixture.Pass();
        if(mode=="known")check(fixture.Saved() is {} saved&&saved.Request.OperationId==original.Id&&saved.Request.BaseRevision==original.Revision&&saved.BaselineHash==original.Hash&&saved.Request.Source==original.Path&&fixture.State()["SharedRenames"]![Id] is null,"known legacy command preserves captured hash/path/revision and ID despite newer text baseline");
        else {
            var review=await fixture.Sync.SavedFileMoveRecoveryReadAsync(original.Id);
            check(fixture.Saved() is null&&fixture.State()["SharedRenames"]![Id]!.ToJsonString()==JsonSerializer.SerializeToNode(original)!.ToJsonString()&&fixture.Remote.Requests.Count==0&&fixture.Sync.Status.Error=="A saved file move needs review. Its original command and local file are retained."&&review.State=="review"&&review.RequestHash is null&&review.Inspection is null&&!review.RetryAllowed&&!review.KeepNamesAllowed,"legacy "+mode+" remains exact raw review evidence without fabricated generation, terminal proof, or actions");
        }
    }
    static async Task WrongBinding(string temp,string field,Action<bool,string> check) {
        using var fixture=await Fixture.Create(temp,"binding-"+field);fixture.Remote.GenericConflict=true;
        await fixture.MoveLocal("Local.textpack");await fixture.Pass();var saved=fixture.Saved();var calls=fixture.Remote.Requests.Count;
        fixture.Remote.ProtectedRenameBinding=field switch{"origin"=>Scope with{Origin="https://other.test"},"workspace"=>Scope with{WorkspaceId="other-workspace"},_=>Scope with{AccountId="other-account"}};
        fixture.Restart();await fixture.Pass();
        check(fixture.Remote.Requests.Count==calls&&fixture.Saved()==saved,"wrong transport "+field+" refuses before dispatch and retains exact command");
    }
    static async Task PolicyRace(string temp,string race,Action<bool,string> check) {
        using var fixture=await Fixture.Create(temp,"race-"+race);await fixture.MoveLocal("Local.textpack");var injected=false;
        fixture.Restart(async script=>{
            if(!script.Contains(".savedRename(")||injected)return;injected=true;
            if(race=="duplicate")File.WriteAllBytes(fixture.Store.Resolve("Duplicate.textpack"),fixture.Initial);
            if(race=="checkpoint")await fixture.Checkpoint(Pack("new checkpoint during policy await"),3);
            if(race=="permission")fixture.Remote.Capabilities=new(false,false,[],new(){{Id,false}});
            if(race=="lifecycle")fixture.Remote.Item=fixture.Remote.Item with{Lifecycle="restored"};
            if(race=="binding")fixture.Remote.ProtectedRenameBinding=Scope with{AccountId="other-account"};
        });
        await fixture.Pass();
        check(injected&&fixture.Remote.Requests.Count==0&&fixture.Store.Read("Local.textpack").Length>0,"post-policy "+race+" race refuses stale rename authority without touching projection");
    }
    static byte[] Pack(string text,bool lifecycle=true) {
        using var output=new MemoryStream();using(var zip=new ZipArchive(output,ZipArchiveMode.Create,true)) {
            using(var writer=new StreamWriter(zip.CreateEntry("text.md").Open()))writer.Write("---\ntextTextId: "+Id+"\n---\n"+text);
            if(lifecycle)using(var writer=new StreamWriter(zip.CreateEntry("texttext-lifecycle.json").Open()))writer.Write(JsonSerializer.Serialize(new{version=1,generation=Generation}));
            using(var stream=zip.CreateEntry("unknown.bin").Open())stream.Write(new byte[]{0,255,19,72});
        }return output.ToArray();
    }
    sealed class Fixture:IDisposable {
        public required TextPackStore Store;public required Remote Remote;public required SyncEngine Sync;public SharedEditingStore? Editing;public SharedSession? Session;
        public required byte[] Initial;public string InitialHash=>TextPackStore.Hash(Initial);public string RootHash=>TextPackStore.Hash(System.Text.Encoding.UTF8.GetBytes(Store.Root));
        public static async Task<Fixture> Create(string temp,string name,bool folders=false,byte[]? initial=null,bool checkpoint=true,bool absent=false) {
            var store=new TextPackStore(Path.Combine(temp,"saved-"+name),Path.Combine(temp,"saved-state-"+name));
            AccountRootOwnership.Open(store,new(Scope.Origin),Scope.WorkspaceId,Account);
            var bytes=initial??Pack("retained original text",!absent);var remote=new Remote(bytes,absent);if(folders){remote.Item=remote.Item with{RelativePath="Notes/Original.textpack"};remote.Folders=["Notes","Notes/Empty child","Other","Other/Empty child"];remote.SupportsFolderCaseMoves=true;remote.ManifestRevision=new string('a',64);store.EnsureFolders(remote.Folders);}var fixture=new Fixture{Store=store,Remote=remote,Initial=bytes,Sync=new(store,remote,Account,NativePolicyTestHost.Create(Account))};
            await fixture.Sync.SyncAsync();fixture.Editing=new(store,fixture.Sync,Account);fixture.Session=await fixture.Editing.OpenAsync(Id,remote.Item.RelativePath,fixture.InitialHash);if(checkpoint){await fixture.Checkpoint(bytes,1);if(absent)await fixture.CleanCheckpoint();}return fixture;
        }
        public void Restart(Func<string,Task>? hook=null) {
            Editing?.Dispose();Sync=new(Store,Remote,Account,NativePolicyTestHost.Create(Account,hook));Editing=new(Store,Sync,Account);
            var file=Store.Scan().Single(x=>x.ItemId==Id);Session=Editing.OpenAsync(Id,file.Path,file.Hash).GetAwaiter().GetResult();
        }
        public async Task Checkpoint(byte[] bytes,long generation) {
            var file=Store.Scan().Single(x=>x.ItemId==Id);var checkpointPath=File.Exists(Path.Combine(Store.StateDirectory,"shared-editing",Id,"checkpoint.json"))?CheckpointValue().Path:Session!.Document.Path;var journal=JsonSerializer.Serialize(new{version=1,accountId=Account,epoch=1,seq=0,journalGeneration=generation,revision=InitialHash,relativePath=checkpointPath,update="AAA=",pending=new[]{"AAA="}});
            await Editing!.CheckpointAsync(Session!.SessionToken,file.Hash,bytes,new(Id,checkpointPath,TextPackStore.Hash(bytes),InitialHash,1,0,generation,journal,true));
        }
        public async Task CleanCheckpoint() {
            var old=CheckpointValue();var journal=JsonNode.Parse(old.Journal)!;journal["pending"]=new JsonArray();journal["journalGeneration"]=old.JournalGeneration+1;
            var bytes=Store.Read(old.Path);await Editing!.CheckpointAsync(Session!.SessionToken,TextPackStore.Hash(bytes),bytes,old with{Pending=false,JournalGeneration=old.JournalGeneration+1,Journal=journal.ToJsonString()});
        }
        public async Task MoveLocal(string destination) {var file=Store.Scan().Single(x=>x.ItemId==Id);File.Move(Store.Resolve(file.Path),Store.Resolve(destination));await Checkpoint(Store.Read(destination),CheckpointValue().JournalGeneration+1);if(Remote.GenerationAvailable)await CleanCheckpoint();}
        public SharedCheckpoint CheckpointValue()=>JsonSerializer.Deserialize<SharedCheckpoint>(File.ReadAllBytes(Path.Combine(Store.StateDirectory,"shared-editing",Id,"checkpoint.json")))!;
        public async Task Pass(bool local=false) {try{await Sync.SyncAsync(localChangesOnly:local);}catch(Exception error)when(error is HttpRequestException or FileChangedException or SharedAccountMismatchException) { }}
        public JsonObject State()=>JsonNode.Parse(File.ReadAllBytes(Path.Combine(Store.StateDirectory,"sync.json")))!.AsObject();
        public ProtectedSavedRename.Record? Saved() {var node=State()["ProtectedRenames"]?[Id];return node is null?null:JsonSerializer.Deserialize<ProtectedSavedRename.Record>(node.ToJsonString());}
        public void WriteState(JsonObject state)=>TextPackStore.AtomicWrite(Path.Combine(Store.StateDirectory,"sync.json"),JsonSerializer.SerializeToUtf8Bytes(state));
        public void Put(ProtectedSavedRename.Record record) {var state=State();state["ProtectedRenames"]=new JsonObject{[Id]=JsonNode.Parse(JsonSerializer.Serialize(record))};TextPackStore.AtomicWrite(Path.Combine(Store.StateDirectory,"sync.json"),JsonSerializer.SerializeToUtf8Bytes(state));}
        public void Dispose()=>Editing?.Dispose();
    }
    sealed class Remote:ISyncTransport {
        public ProtectedRenameScope? ProtectedRenameBinding {get;set;}=Scope;
        public WorkspaceCapabilities? Capabilities {get;set;}=new(true,true,[],new(){{Id,true}});
        public IReadOnlyList<string> Folders {get;set;}=[];public IReadOnlyList<string>? AuthoritativeFolders=>SupportsFolderCaseMoves?Folders:null;public bool SupportsFolderCaseMoves {get;set;}public string? ManifestRevision {get;set;}public int FolderCalls;
        public Task<FolderCaseMoveReceipt> MoveFolderCaseAsync(FolderCaseMoveRequest request,CancellationToken ct=default){FolderCalls++;Folders=Folders.Select(path=>path==request.Source||path.StartsWith(request.Source+"/",StringComparison.Ordinal)?request.Destination+path[request.Source.Length..]:path).ToArray();if(Item.RelativePath.StartsWith(request.Source+"/",StringComparison.Ordinal))Item=Item with{RelativePath=request.Destination+Item.RelativePath[request.Source.Length..]};ManifestRevision=new string('b',64);return Task.FromResult(new FolderCaseMoveReceipt(request.OperationId,"moved",request.Source,request.Destination,request.Folders.Select(path=>request.Destination+path[request.Source.Length..]).ToArray(),request.Items.Select(item=>item with{RelativePath=request.Destination+item.RelativePath[request.Source.Length..]}).ToArray(),ManifestRevision));}
        public readonly Dictionary<string,RemoteItem> Extra=[];
        public RemoteItem Item;public byte[] Data;public bool GenericConflict,LoseReply,ManifestUnavailable,BinaryLoseReply,AllowConflictUpload;public int LegacyCalls,Downloads,Manifests;public Action? AfterMoved,BeforeBinaryPatch;
        public readonly List<string> BinaryRequests=[];readonly Dictionary<string,string> binaryReceipts=[],binaryInputs=[];
        public readonly List<ProtectedRenameRequest> Requests=[];readonly Dictionary<string,ProtectedRenameReceipt> receipts=[];
        public bool GenerationAvailable;public int GenerationReads;public Action<int>? GenerationHook;
        public Remote(byte[] data,bool absent=false){Data=data;GenerationAvailable=absent;Item=new(Id,"Original.textpack",TextPackStore.Hash(data),Lifecycle:absent?null:Generation,CanEditContent:true);}
        public async Task<RemoteManifestGenerationEvidence?> GenerationEvidenceAsync(string id,CancellationToken ct=default) {
            GenerationReads++;await Task.Yield();GenerationHook?.Invoke(GenerationReads);return GenerationAvailable?new(Scope,Item,TextPackStore.Hash(JsonSerializer.SerializeToUtf8Bytes(Item)),Item.Lifecycle is null?MirrorGeneration.ObservedAbsent:MirrorGeneration.Present(Item.Lifecycle)):null;
        }
        public Task<IReadOnlyList<RemoteItem>> ManifestAsync(CancellationToken ct=default){Manifests++;return ManifestUnavailable?throw new HttpRequestException("Owned fixture unavailable"):Task.FromResult<IReadOnlyList<RemoteItem>>([Item,..Extra.Values]);}
        public Task<RemoteBinaryManifest> BinaryManifestAsync(string id,CancellationToken ct=default)=>Task.FromResult(new RemoteBinaryManifest(Item.Revision,BinaryEntryPacks.Assets(Data).Values.Select(entry=>new RemoteBinaryEntry(entry.Path,entry.Sha256,entry.Bytes.Length)).ToArray()));
        public Task<byte[]> BinaryReadAsync(string id,string path,CancellationToken ct=default)=>Task.FromResult(BinaryEntryPacks.Assets(Data)[path].Bytes);
        public Task<string> BinaryPatchAsync(string id,string operation,string path,string? expected,string? generation,byte[]? bytes,CancellationToken ct=default){BinaryRequests.Add(operation);var input=JsonSerializer.Serialize(new{id,path,expected,generation,hash=bytes is null?null:TextPackStore.Hash(bytes)});if(binaryReceipts.TryGetValue(operation,out var prior)){if(binaryInputs[operation]!=input)throw new InvalidDataException("Immutable asset CAS changed");return Task.FromResult(prior);}binaryInputs[operation]=input;var before=BeforeBinaryPatch;BeforeBinaryPatch=null;before?.Invoke();if(generation!=Item.Lifecycle)throw new SyncConflictException();try{Data=BinaryEntryPacks.Patch(Data,path,expected,bytes);}catch(FileChangedException){throw new SyncConflictException();}Item=Item with{Revision=TextPackStore.Hash(Data)};binaryReceipts[operation]=Item.Revision;if(BinaryLoseReply){BinaryLoseReply=false;throw new HttpRequestException("Owned asset CAS reply lost");}return Task.FromResult(Item.Revision);}
        public Task<RemotePack> DownloadAsync(string id,CancellationToken ct=default){Downloads++;return Task.FromResult(new RemotePack(Data,Item.RelativePath,Item.Revision));}
        public Task<string> UploadAsync(string id,string path,byte[] bytes,string? revision,string operation,CancellationToken ct=default){if(AllowConflictUpload)throw new SyncConflictException();throw new InvalidOperationException("Protected fixture must not full-file upload");}
        public Task<string> RenameAsync(string id,string source,string destination,string revision,string operation,CancellationToken ct=default){LegacyCalls++;throw new SyncConflictException();}
        public Task DeleteAsync(string id,string path,string revision,string operation,CancellationToken ct=default)=>throw new InvalidOperationException("Protected fixture must not delete");
        public Task<ProtectedRenameReceipt> ProtectedRenameAsync(ProtectedRenameRequest request,CancellationToken ct=default) {
            Requests.Add(request);
            if(GenericConflict)throw new HttpRequestException("Generic fixture HTTP409",null,HttpStatusCode.Conflict);
            if(receipts.TryGetValue(request.OperationId,out var old)) {if(old.Request!=request)throw new InvalidDataException("Immutable fixture command changed");return Task.FromResult(old);}
            ProtectedRenameReceipt result;
            if(Item.RelativePath!=request.Source||Item.Revision!=request.BaseRevision||Item.Deleted)result=new(request,Scope,"conflict",Item.RelativePath,Item.Revision,Item.Deleted);
            else{Item=Item with{RelativePath=request.Destination};result=new(request,Scope,"moved",Item.RelativePath,Item.Revision,false);}
            receipts[request.OperationId]=result;AfterMoved?.Invoke();AfterMoved=null;if(LoseReply){LoseReply=false;throw new HttpRequestException("Fixture reply lost after commit");}return Task.FromResult(result);
        }
    }
}
