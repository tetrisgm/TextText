using System.IO.Compression;
using System.Text.Json;
using TextText.Core;

static class LocalRenameTests
{
    const string Identity = "local-rename";
    static byte[] Pack(string body, string id = Identity)
    {
        using var output = new MemoryStream();
        using (var zip = new ZipArchive(output, ZipArchiveMode.Create, true))
        using (var writer = new StreamWriter(zip.CreateEntry("text.md").Open()))
            writer.Write("---\ntextTextId: \"" + id + "\"\n---\n" + body);
        return output.ToArray();
    }
    static SharedCheckpoint Checkpoint(string path, string revision, byte[] bytes, long generation)
    {
        var journal = JsonSerializer.Serialize(new { version = 1, accountId=Test.PathAccount, epoch = 3, seq = 4,
            journalGeneration = generation, revision, relativePath = path, update = "AAA=",
            pending = new[] { "AAA=" }, batch = new { operationId = "same-pending-batch", updates = new[] { "AAA=" } } });
        return new(Identity, path, TextPackStore.Hash(bytes), revision, 3, 4, generation, journal, true);
    }
    static SharedCheckpoint Retained(TextPackStore files) => JsonSerializer.Deserialize<SharedCheckpoint>(
        File.ReadAllText(Path.Combine(files.StateDirectory, "shared-editing", Identity, "checkpoint.json")))!;

    public static async Task Run(string temp, Action<bool, string> assert)
    {
        var files = Test.OwnedPathStore(Path.Combine(temp, "local-rename"), Path.Combine(temp, "local-rename-state"));
        var initial = files.Write("Notes/Original.textpack", Pack("baseline"));
        var remote = new Test.Fake();
        var sync = Test.NewOwnedPathSync(files, remote);
        await sync.SyncAsync();
        await Test.AttestPathGeneration(sync, remote);
        var target = "Archive/Moved.textpack";
        var pending = Pack("pending human edit");
        var next = Pack("pending human edit and more");
        using (var editing = new SharedEditingStore(files, sync,Test.PathAccount))
        {
            var session = await editing.OpenAsync(Identity, initial.Path, initial.Hash);
            var saved = await editing.CheckpointAsync(session.SessionToken, initial.Hash, pending,
                Checkpoint(initial.Path, initial.Hash, pending, 1));
            Directory.CreateDirectory(Path.GetDirectoryName(files.Resolve(target))!);
            File.Move(files.Resolve(initial.Path), files.Resolve(target));
            var continued = await editing.CheckpointAsync(session.SessionToken, saved.Hash, next,
                Checkpoint(initial.Path, initial.Hash, next, 2));
            assert(continued.Path == target && continued.Hash == TextPackStore.Hash(next),
                "raw external rename preserves same active session and checkpoints at unique new path");
            var retained = Retained(files);
            using var journal = JsonDocument.Parse(retained.Journal);
            assert(retained.Path == target && retained.Pending && retained.JournalGeneration == 2 && retained.Epoch == 3 && retained.Seq == 4 &&
                retained.AcknowledgedRevision == initial.Hash && journal.RootElement.GetProperty("batch").GetProperty("operationId").GetString() == "same-pending-batch",
                "raw external rename preserves pending batch identity generation and lifecycle");
            assert(!File.Exists(files.Resolve(initial.Path)) && files.Read(target).SequenceEqual(next),
                "raw external rename never recreates old path or loses pending bytes");
            await sync.SyncAsync(localChangesOnly: true);
            assert(remote.Item?.RelativePath == target && remote.UploadCount == 1 && files.Read(target).SequenceEqual(next),
                "active raw rename announces path without uploading pending editor bytes");
        }
        using var reopened = new SharedEditingStore(files, Test.NewOwnedPathSync(files, remote),Test.PathAccount);
        var recovered = await reopened.OpenAsync(Identity, target, TextPackStore.Hash(next));
        assert(recovered.Checkpoint?.Pending == true && recovered.Checkpoint.Path == target && recovered.Checkpoint.JournalGeneration == 2,
            "raw external rename pending journal survives restart");
        await VerifyOrdering(temp, "sync-first", assert);
        await VerifyOrdering(temp, "closed", assert);
        await VerifyOrdering(temp, "external-edit", assert);
        await VerifyOrdering(temp, "restored-lifecycle", assert);
        await VerifyRefusal(temp, "duplicate", assert);
        await VerifyRefusal(temp, "collision", assert);
        await VerifyAnnouncement(temp, "lost-reply", assert);
        await VerifyAnnouncement(temp, "closed-reply", assert);
        await VerifyAnnouncement(temp, "moved-during-reply", assert);
        await VerifyAnnouncement(temp, "ack-moved-during-reply", assert);
        await VerifyAnnouncement(temp, "restored-during-reply", assert);
    }
    static async Task VerifyOrdering(string temp, string ordering, Action<bool,string> assert)
    {
        var files=Test.OwnedPathStore(Path.Combine(temp,"rename-"+ordering),Path.Combine(temp,"rename-state-"+ordering));
        var initial=files.Write("Notes/Before.textpack",Pack("baseline"));
        var remote=new Test.Fake();var sync=Test.NewOwnedPathSync(files,remote);await sync.SyncAsync();
        var pending=Pack("human pending");var cp=Checkpoint(initial.Path,initial.Hash,pending,1);
        var editing=new SharedEditingStore(files,sync,Test.PathAccount);
        var session=await editing.OpenAsync(Identity,initial.Path,initial.Hash);
        await editing.CheckpointAsync(session.SessionToken,initial.Hash,pending,cp);
        if(ordering=="closed")editing.Dispose();
        const string target="Notes/After.textpack";
        File.Move(files.Resolve(initial.Path),files.Resolve(target));
        if(ordering=="sync-first")await sync.SyncAsync();
        if(ordering=="restored-lifecycle") {
            remote.Item=remote.Item! with{Lifecycle="restored-lifecycle"};
            await sync.SyncAsync();
            assert(remote.Item.RelativePath==initial.Path&&files.Read(target).SequenceEqual(pending)&&Retained(files).Pending,
                "pending raw rename never reorganizes a restored remote lifecycle");
        }
        if(ordering=="closed") {
            editing=new SharedEditingStore(files,Test.NewOwnedPathSync(files,remote),Test.PathAccount);
            session=await editing.OpenAsync(Identity,target,TextPackStore.Hash(pending));
            assert(session.Checkpoint?.Path==target&&session.Checkpoint.Pending,
                "closed external rename reopens retained pending journal at new path");
        }
        using(editing) {
            var expectedHash=TextPackStore.Hash(pending);
            if(ordering=="external-edit") {
                var outside=Pack("outside edit");File.WriteAllBytes(files.Resolve(target),outside);
                try {await editing.CheckpointAsync(session.SessionToken,expectedHash,pending,cp);throw new Exception("changed raw relocation accepted stale checkpoint");}
                catch(FileChangedException) { }
                assert(files.Read(target).SequenceEqual(outside)&&Retained(files).ProjectedHash==expectedHash&&Retained(files).Path==target,
                    "changed raw relocation retains external bytes and pending reconciliation baseline");
                expectedHash=TextPackStore.Hash(outside);
            }
            var next=Pack("human pending and reconciled writing");
            var saved=await editing.CheckpointAsync(session.SessionToken,expectedHash,next,Checkpoint(target,initial.Hash,next,2));
            assert(saved.Path==target&&files.Read(target).SequenceEqual(next)&&Retained(files).Pending,
                "raw rename continues pending checkpoint after "+ordering);
        }
    }
    static async Task VerifyRefusal(string temp,string scenario,Action<bool,string> assert)
    {
        var files=Test.OwnedPathStore(Path.Combine(temp,"rename-refuse-"+scenario),Path.Combine(temp,"rename-refuse-state-"+scenario));
        var initial=files.Write("Original.textpack",Pack("baseline"));
        var sync=Test.NewOwnedPathSync(files,new Test.Fake());await sync.SyncAsync();
        using var editing=new SharedEditingStore(files,sync,Test.PathAccount);
        var session=await editing.OpenAsync(Identity,initial.Path,initial.Hash);
        var pending=Pack("human pending");var cp=Checkpoint(initial.Path,initial.Hash,pending,1);
        await editing.CheckpointAsync(session.SessionToken,initial.Hash,pending,cp);
        var retained=Retained(files);
        const string target="Moved.textpack";
        File.Move(files.Resolve(initial.Path),files.Resolve(target));
        var other=scenario=="duplicate"?Pack("second ambiguous copy"):Pack("unrelated occupied source","different-id");
        var otherPath=scenario=="duplicate"?"Copy.textpack":initial.Path;
        File.WriteAllBytes(files.Resolve(otherPath),other);
        var later=Pack("later edit");
        try {await editing.CheckpointAsync(session.SessionToken,cp.ProjectedHash,later,Checkpoint(initial.Path,initial.Hash,later,2));throw new Exception("unsafe raw rename followed "+scenario);}
        catch(FileChangedException) { }
        assert(files.Read(target).SequenceEqual(pending)&&files.Read(otherPath).SequenceEqual(other)&&Retained(files)==retained,
            "raw rename refuses "+scenario+" without choosing path or changing retained journal");
    }

    static async Task VerifyAnnouncement(string temp,string scenario,Action<bool,string> assert)
    {
        var files=Test.OwnedPathStore(Path.Combine(temp,"announcement-"+scenario),Path.Combine(temp,"announcement-state-"+scenario));
        var initial=files.Write("Original.textpack",Pack("baseline"));
        var remote=new RenameTransport();var sync=Test.NewOwnedPathSync(files,remote);await sync.SyncAsync();await Test.AttestPathGeneration(sync,remote.Inner);
        var editing=new SharedEditingStore(files,sync,Test.PathAccount);
        var session=await editing.OpenAsync(Identity,initial.Path,initial.Hash);
        var pending=Pack("retained pending writing");
        await editing.CheckpointAsync(session.SessionToken,initial.Hash,pending,Checkpoint(initial.Path,initial.Hash,pending,1));
        File.Move(files.Resolve(initial.Path),files.Resolve("Moved.textpack"));
        remote.LoseReply=scenario is "lost-reply" or "closed-reply";
        remote.AfterRename=scenario=="moved-during-reply"?()=>File.Move(files.Resolve("Moved.textpack"),files.Resolve("MovedAgain.textpack")):
            scenario=="restored-during-reply"?()=>remote.Inner.Item=remote.Inner.Item! with{Lifecycle="restored-during-reply"}:null;
        if(scenario=="ack-moved-during-reply")remote.AfterRename=()=> {
            remote.Inner.Data=pending;remote.Inner.Item=remote.Inner.Item! with{Revision=TextPackStore.Hash(pending)};
            var clean=Checkpoint(initial.Path,TextPackStore.Hash(pending),pending,2);
            var journal=System.Text.Json.Nodes.JsonNode.Parse(clean.Journal)!;
            journal["pending"]=new System.Text.Json.Nodes.JsonArray();journal["batch"]=null;
            clean=clean with{Pending=false,Journal=journal.ToJsonString()};
            // Sync owns the gate, so this acknowledgement is retained on disk.
            editing.CheckpointAsync(session.SessionToken,TextPackStore.Hash(pending),pending,clean).GetAwaiter().GetResult();
            File.Move(files.Resolve("Moved.textpack"),files.Resolve("MovedAgain.textpack"));
        };
        try {await sync.SyncAsync();} catch(HttpRequestException) when(scenario is "lost-reply" or "closed-reply") { }
        var statePath=Path.Combine(files.StateDirectory,"sync.json");
        SyncEngine.State State()=>JsonSerializer.Deserialize<SyncEngine.State>(File.ReadAllBytes(statePath))!;
        if(scenario is "lost-reply" or "closed-reply") {
            var operation=State().ProtectedRenames[Identity];
            assert(operation.Request.OperationId==remote.Ids.Single()&&operation.Request.Destination=="Moved.textpack"&&operation.Request.Source==initial.Path,
                "lost path reply retains exact durable rename operation before restart");
            // Checkpointing remains available despite the retained announcement.
            var closed=scenario=="closed-reply";
            var next=closed?files.Read("Moved.textpack"):Pack("more typing while rename reply is lost");
            var checkpoint=Checkpoint(initial.Path,initial.Hash,next,2);
            if(closed) {
                // The text operation was acknowledged separately; the path RPC
                // still has an ambiguous reply and must survive editor closure.
                remote.Inner.Data=next;remote.Inner.Item=remote.Inner.Item! with{Revision=TextPackStore.Hash(next)};
                var journal=System.Text.Json.Nodes.JsonNode.Parse(checkpoint.Journal)!;
                journal["pending"]=new System.Text.Json.Nodes.JsonArray();journal["batch"]=null;journal["revision"]=remote.Inner.Item.Revision;
                checkpoint=checkpoint with{AcknowledgedRevision=remote.Inner.Item.Revision,Pending=false,Journal=journal.ToJsonString()};
            }
            await editing.CheckpointAsync(session.SessionToken,TextPackStore.Hash(pending),next,checkpoint);
            editing.Dispose();sync=Test.NewOwnedPathSync(files,remote);
            if(closed)await sync.SyncAsync();
            editing=new SharedEditingStore(files,sync,Test.PathAccount);
            session=await editing.OpenAsync(Identity,"Moved.textpack",TextPackStore.Hash(next));
            if(!closed)await sync.SyncAsync();
            assert(remote.Ids.Count==2&&remote.Ids[0]==remote.Ids[1]&&State().ProtectedRenames.Count==0&&State().Items[Identity].Path=="Moved.textpack",
                "restart replays identical path operation and clears only its confirmed receipt");
            assert(files.Read("Moved.textpack").SequenceEqual(next)&&session.Checkpoint?.Pending==!closed&&remote.Inner.UploadCount==1,
                "lost path response retains correct journal across "+scenario);
            if(closed)assert(State().Items[Identity].Revision==TextPackStore.Hash(next)&&State().Items[Identity].Hash==TextPackStore.Hash(next),"old move receipt preserves separately ACKed current text hash/revision pair");
        } else if(scenario is "moved-during-reply" or "ack-moved-during-reply") {
            assert(files.Read("MovedAgain.textpack").SequenceEqual(pending)&&Retained(files).Path=="MovedAgain.textpack"&&State().Items[Identity].Path=="Moved.textpack",
                "post-reply recheck follows newer local move while recording only attested remote path");
            await sync.SyncAsync();
            assert(remote.Inner.Item?.RelativePath=="MovedAgain.textpack"&&remote.Ids.Count==2&&remote.Ids[0]!=remote.Ids[1]&&Retained(files).Pending==(scenario!="ack-moved-during-reply"),
                "newer local move receives its own durable path operation after "+scenario);
            if(scenario=="ack-moved-during-reply") {
                assert(!File.Exists(Path.Combine(files.StateDirectory,"shared-editing",Identity,"acknowledge.json"))&&State().Items[Identity].Hash==TextPackStore.Hash(pending),
                    "deferred acknowledgement follows current attested journal path before advancing baseline");
                editing.Dispose();editing=new SharedEditingStore(files,Test.NewOwnedPathSync(files,remote),Test.PathAccount);
                var reopened=await editing.OpenAsync(Identity,"MovedAgain.textpack",TextPackStore.Hash(pending));
                assert(reopened.Checkpoint?.Pending==false&&reopened.Checkpoint.Path=="MovedAgain.textpack"&&reopened.Checkpoint.JournalGeneration==2,
                    "clean acknowledged projection reopens after second move during rename reply");
            }
        } else {
            assert(State().Items[Identity].Path==initial.Path&&State().ProtectedRenames.Count==1&&State().ProtectedRenames[Identity].Phase==ProtectedSavedRename.Phase.Pending&&State().ProtectedRenames[Identity].Receipt is null&&Retained(files).Pending&&files.Read("Moved.textpack").SequenceEqual(pending),
                "post-reply restored lifecycle cannot advance stale baseline or discard announcement intent");
            await sync.SyncAsync();
            assert(remote.Ids.Count==1,"retained path announcement is not replayed into a restored lifecycle");
            await sync.SyncAsync(localChangesOnly:true);
            assert(remote.Ids.Count==1&&State().ProtectedRenames[Identity].Phase==ProtectedSavedRename.Phase.Pending,"shared policy rechecks a retired-generation pending receipt without dispatching or fabricating terminal proof");
        }
        editing.Dispose();
    }
    sealed class RenameTransport : ISyncTransport
    {
        public readonly Test.Fake Inner=new(){ProtectedRenameBinding=Test.PathScope,Capabilities=new(true,true,[],new(){{Identity,true}})};
        public ProtectedRenameScope? ProtectedRenameBinding=>Inner.ProtectedRenameBinding;
        public WorkspaceCapabilities? Capabilities=>Inner.Capabilities;
        public readonly List<string> Ids=[];
        public bool LoseReply;
        public Action? AfterRename;
        public Task<IReadOnlyList<RemoteItem>> ManifestAsync(CancellationToken ct=default)=>Inner.ManifestAsync(ct);
        public Task<RemotePack> DownloadAsync(string id,CancellationToken ct=default)=>Inner.DownloadAsync(id,ct);
        public Task<string> UploadAsync(string id,string path,byte[] bytes,string? revision,string operation,CancellationToken ct=default)=>Inner.UploadAsync(id,path,bytes,revision,operation,ct);
        public async Task<string> RenameAsync(string id,string from,string to,string revision,string operation,CancellationToken ct=default) {
            Ids.Add(operation);var result=await Inner.RenameAsync(id,from,to,revision,operation,ct);
            var after=AfterRename;AfterRename=null;after?.Invoke();
            if(LoseReply){LoseReply=false;throw new HttpRequestException("Rename response lost");}
            return result;
        }
        public async Task<ProtectedRenameReceipt> ProtectedRenameAsync(ProtectedRenameRequest request,CancellationToken ct=default) {
            Ids.Add(request.OperationId);var result=await Inner.ProtectedRenameAsync(request,ct);
            var after=AfterRename;AfterRename=null;after?.Invoke();
            if(LoseReply){LoseReply=false;throw new HttpRequestException("Rename response lost");}
            return result;
        }
        public Task DeleteAsync(string id,string path,string revision,string operation,CancellationToken ct=default)=>Inner.DeleteAsync(id,path,revision,operation,ct);
        public Task<RemoteBinaryManifest> BinaryManifestAsync(string id,CancellationToken ct=default)=>Inner.BinaryManifestAsync(id,ct);
        public Task<byte[]> BinaryReadAsync(string id,string path,CancellationToken ct=default)=>Inner.BinaryReadAsync(id,path,ct);
        public Task<string> BinaryPatchAsync(string id,string operation,string path,string? hash,string? lifecycle,byte[]? bytes,CancellationToken ct=default)=>Inner.BinaryPatchAsync(id,operation,path,hash,lifecycle,bytes,ct);
    }

}
