using System.IO.Compression;
using System.Text.Json;
using System.Text.Json.Nodes;
using TextText.Core;

/// A native retirement that only repeats the retained journal's own "retired" text mirrors the browser's revivable retirement.
/// A newer unretired checkpoint of the same epoch and path lifts it; native-originated, ambiguous, cross-epoch, stale, or revoked checkpoints stay fenced.
static class MirroredRetirementTests
{
    const string Reason="This note needs to be reopened. Your edits are saved for recovery.";
    static byte[] Pack(string body) {using var output=new MemoryStream();using(var zip=new ZipArchive(output,ZipArchiveMode.Create,true)){using(var w=new StreamWriter(zip.CreateEntry("text.md").Open()))w.Write("---\ntextTextId: \"test-1\"\n---\n"+body);}return output.ToArray();}
    static SharedCheckpoint Checkpoint(string path,byte[] bytes,string revision,long epoch,long generation,string? retired=null,string? nativeReason=null) {
        var journal=new JsonObject{["version"]=1,["epoch"]=epoch,["seq"]=0,["journalGeneration"]=generation,["revision"]=revision,["relativePath"]=path,["update"]="AAA=",["pending"]=new JsonArray("AAA="),["batch"]=null};
        if(retired!=null)journal["retired"]=retired;
        return new SharedCheckpoint("test-1",path,TextPackStore.Hash(bytes),revision,epoch,0,generation,journal.ToJsonString(),true,RetiredReason:nativeReason??retired);
    }
    public static async Task Run(string temp,Action<bool,string> Assert) {
        var files=new TextPackStore(Path.Combine(temp,"mirrored"),Path.Combine(temp,"mirrored-device"));
        var initial=files.Write("Notes/Mirror.textpack",Pack("start"));var transport=new Test.Fake();var sync=new SyncEngine(files,transport);await sync.SyncAsync();
        var revision=transport.Item!.Revision;var checkpointPath=Path.Combine(files.StateDirectory,"shared-editing","test-1","checkpoint.json");
        SharedCheckpoint Retained()=>JsonSerializer.Deserialize<SharedCheckpoint>(File.ReadAllText(checkpointPath))!;
        var pendingBytes=Pack("Pending human");
        using(var editing=new SharedEditingStore(files,sync)) {
            var session=await editing.OpenAsync("test-1",initial.Path,initial.Hash);
            // An older build reopened a retired browser journal and checkpointed its own text as the native retirement.
            await editing.CheckpointAsync(session.SessionToken,initial.Hash,pendingBytes,Checkpoint(initial.Path,pendingBytes,revision,1,2,retired:Reason));
            var projected=files.Describe(initial.Path).Hash;
            Assert(Retained().RetiredReason==Reason&&SharedEditingStore.HasProtectedState(files.StateDirectory,"test-1"),"mirrored retirement is retained as protected state");
            // Another epoch cannot lift it; neither can a stale or equal generation.
            try{await editing.CheckpointAsync(session.SessionToken,projected,pendingBytes,Checkpoint(initial.Path,pendingBytes,revision,2,3));throw new Exception("other epoch lifted");}catch(InvalidOperationException){}
            try{await editing.CheckpointAsync(session.SessionToken,projected,pendingBytes,Checkpoint(initial.Path,pendingBytes,revision,1,2));throw new Exception("same generation lifted");}catch(InvalidOperationException){}
            try{await editing.CheckpointAsync(session.SessionToken,projected,pendingBytes,Checkpoint(initial.Path,pendingBytes,revision,1,1));throw new Exception("stale generation lifted");}catch(InvalidOperationException){}
            // A checkpoint that still carries a retirement cannot lift one either.
            try{await editing.CheckpointAsync(session.SessionToken,projected,pendingBytes,Checkpoint(initial.Path,pendingBytes,revision,1,3,retired:Reason));throw new Exception("retired checkpoint lifted");}catch(InvalidOperationException){}
            Assert(Retained().RetiredReason==Reason&&Retained().JournalGeneration==2,"mismatched epoch, generation, or retirement keeps the mirrored retirement");
            // The revived journal of the same epoch and path lifts the mirror and keeps the pending edit.
            var revived=await editing.CheckpointAsync(session.SessionToken,projected,pendingBytes,Checkpoint(initial.Path,pendingBytes,revision,1,3));
            Assert(revived.Hash==TextPackStore.Hash(pendingBytes)&&Retained().RetiredReason==null&&Retained().Pending&&Retained().JournalGeneration==3,"same-epoch newer unretired checkpoint lifts the mirrored retirement");
            // A retirement whose text differs from the journal's own retired text is ambiguous and stays fenced.
            TextPackStore.AtomicWrite(checkpointPath,JsonSerializer.SerializeToUtf8Bytes(Checkpoint(initial.Path,pendingBytes,revision,1,3,retired:Reason,nativeReason:"Editing access was removed.")));
            try{await editing.CheckpointAsync(session.SessionToken,projected,pendingBytes,Checkpoint(initial.Path,pendingBytes,revision,1,4));throw new Exception("ambiguous retirement lifted");}catch(InvalidOperationException){}
            Assert(Retained().RetiredReason=="Editing access was removed."&&Retained().JournalGeneration==3,"retirement text that differs from the journal stays fenced");
            // A retirement this store recorded itself has no matching journal text and stays fenced.
            TextPackStore.AtomicWrite(checkpointPath,JsonSerializer.SerializeToUtf8Bytes(Checkpoint(initial.Path,pendingBytes,revision,1,3,nativeReason:"The file changed outside this editing session. Its shared edits are retained.")));
            try{await editing.CheckpointAsync(session.SessionToken,projected,pendingBytes,Checkpoint(initial.Path,pendingBytes,revision,1,4));throw new Exception("native retirement lifted");}catch(InvalidOperationException){}
            Assert(Retained().RetiredReason!=null&&Retained().JournalGeneration==3&&files.Describe(initial.Path).Hash==projected,"native-originated retirement stays fenced and the projection is untouched");
            // A revoked session cannot lift a mirror.
            TextPackStore.AtomicWrite(checkpointPath,JsonSerializer.SerializeToUtf8Bytes(Checkpoint(initial.Path,pendingBytes,revision,1,3,retired:Reason)));
            editing.Close(session.SessionToken);
            try{await editing.CheckpointAsync(session.SessionToken,projected,pendingBytes,Checkpoint(initial.Path,pendingBytes,revision,1,4));throw new Exception("closed session lifted");}catch(SharedSessionClosedException){}
            Assert(Retained().RetiredReason==Reason,"revoked session keeps the mirrored retirement");
        }
        // The store that recorded a file-changed retirement through its own intent path keeps it across restart.
        using(var restarted=new SharedEditingStore(files,sync)) {
            var reopened=await restarted.OpenAsync("test-1",initial.Path,files.Describe(initial.Path).Hash);
            Assert(reopened.Checkpoint?.RetiredReason==Reason&&reopened.Checkpoint.Pending,"mirrored retirement is reported to the reopened editor for the client to revive");
            var lifted=await restarted.CheckpointAsync(reopened.SessionToken,reopened.Document.Hash,pendingBytes,Checkpoint(initial.Path,pendingBytes,revision,1,4));
            Assert(lifted.Hash==TextPackStore.Hash(pendingBytes)&&Retained().RetiredReason==null,"mirrored retirement lifts after restart");
            // A file-changed retirement recorded by this store's own intent path: the journal carries no retired text, so it stays fenced.
            var external=Pack("external edit");files.Write(initial.Path,external,lifted.Hash);var externalHash=files.Describe(initial.Path).Hash;
            TextPackStore.AtomicWrite(Path.Combine(files.StateDirectory,"shared-editing","test-1","intent.json"),JsonSerializer.SerializeToUtf8Bytes(new{Version=1,BeforeHash=lifted.Hash,Payload=Convert.ToBase64String(pendingBytes),Checkpoint=Checkpoint(initial.Path,pendingBytes,revision,1,5)}));
        }
        using(var conflicted=new SharedEditingStore(files,sync)) {
            try{await conflicted.OpenAsync("test-1",initial.Path,files.Describe(initial.Path).Hash);}catch(FileChangedException){}
            var retained=Retained();
            Assert(retained.RetiredReason!=null&&retained.RetiredReason!=Reason,"interrupted intent against a changed file records a native retirement");
            var reopened=await conflicted.OpenAsync("test-1",initial.Path,files.Describe(initial.Path).Hash);
            try{await conflicted.CheckpointAsync(reopened.SessionToken,reopened.Document.Hash,pendingBytes,Checkpoint(initial.Path,pendingBytes,revision,1,6));throw new Exception("native file-changed retirement lifted");}catch(InvalidOperationException){}
            Assert(Retained().RetiredReason==retained.RetiredReason&&TextPackStore.Markdown(files.Read(initial.Path)).EndsWith("external edit"),"native file-changed retirement stays fenced and the external content is preserved");
        }
    }
}
