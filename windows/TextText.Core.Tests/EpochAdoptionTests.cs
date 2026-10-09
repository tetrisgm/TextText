using System.IO.Compression;
using System.Text.Json;
using System.Text.Json.Nodes;
using TextText.Core;

/// Authorized epoch adoption: a pending shared journal may move to a newer epoch only through
/// the exact recovery intent this store checkpointed before the client sent it.
static class EpochAdoptionTests
{
    const string Op="op-1111-2222";
    static byte[] Pack(string body) {using var output=new MemoryStream();using(var zip=new ZipArchive(output,ZipArchiveMode.Create,true)){using(var w=new StreamWriter(zip.CreateEntry("text.md").Open()))w.Write("---\ntextTextId: \"test-1\"\n---\n"+body);}return output.ToArray();}
    static JsonObject Intent(bool? adopted=null,string? operationId=null,long epoch=1,string update="AQID") {
        var value=new JsonObject{["operationId"]=operationId??Op,["epoch"]=epoch,["update"]=update};
        if(adopted!=null)value["adopted"]=adopted.Value;return value;
    }
    static SharedCheckpoint Checkpoint(string path,byte[] bytes,string revision,long epoch,long generation,JsonNode? recovery=null,bool pending=true) {
        var journal=new JsonObject{["version"]=1,["epoch"]=epoch,["seq"]=0,["journalGeneration"]=generation,["revision"]=revision,["relativePath"]=path,["update"]="AAA=",["pending"]=pending?new JsonArray("AAA="):new JsonArray(),["batch"]=null};
        if(recovery!=null)journal["recovery"]=recovery;
        return new SharedCheckpoint("test-1",path,TextPackStore.Hash(bytes),revision,epoch,0,generation,journal.ToJsonString(),pending);
    }
    public static async Task Run(string temp,Action<bool,string> Assert) {
        var files=new TextPackStore(Path.Combine(temp,"adoption"),Path.Combine(temp,"adoption-device"));
        var initial=files.Write("Notes/Adopt.textpack",Pack("start"));var transport=new Test.Fake();var sync=new SyncEngine(files,transport);await sync.SyncAsync();
        var revision=transport.Item!.Revision;var directory=Path.Combine(files.StateDirectory,"shared-editing","test-1");
        string Retained()=>JsonSerializer.Deserialize<SharedCheckpoint>(File.ReadAllText(Path.Combine(directory,"checkpoint.json")))!.Journal;
        long RetainedEpoch()=>JsonSerializer.Deserialize<SharedCheckpoint>(File.ReadAllText(Path.Combine(directory,"checkpoint.json")))!.Epoch;
        var archivePath=Path.Combine(directory,"recovery-"+Op+".json");
        Assert(SharedEditingStore.Capabilities.SequenceEqual(new[]{"epoch-adoption"}),"collaboration.open announces epoch-adoption by its exact name");
        var pendingBytes=Pack("pending");var lateBytes=Pack("pending typed during recovery");
        using(var editing=new SharedEditingStore(files,sync)) {
            var session=await editing.OpenAsync("test-1",initial.Path,initial.Hash);
            await editing.CheckpointAsync(session.SessionToken,initial.Hash,pendingBytes,Checkpoint(initial.Path,pendingBytes,revision,1,1));
            var projected=files.Describe(initial.Path).Hash;
            // Adoption flags without a checkpointed intent are a server acknowledgement alone.
            try{await editing.CheckpointAsync(session.SessionToken,projected,pendingBytes,Checkpoint(initial.Path,pendingBytes,revision,2,2,Intent(adopted:true)));throw new Exception("unchecked intent adopted");}catch(InvalidOperationException){}
            Assert(RetainedEpoch()==1&&!File.Exists(archivePath),"adoption without a checkpointed intent fails closed without archiving");
            // Journal recovery schema is validated; old journals without it remain valid.
            foreach(var (label,bad) in new (string,JsonNode)[]{("unknown field",Intent().Also(x=>x["extra"]=1)),("bad operation id",Intent(operationId:"../x")),("future epoch",Intent(epoch:2)),("empty update",Intent(update:"")),("non base64 update",Intent(update:"***")),("string adopted",Intent().Also(x=>x["adopted"]="yes"))}) {
                try{await editing.CheckpointAsync(session.SessionToken,projected,pendingBytes,Checkpoint(initial.Path,pendingBytes,revision,1,2,bad));throw new Exception(label+" accepted");}catch(InvalidDataException){}
                Assert(Retained()==Checkpoint(initial.Path,pendingBytes,revision,1,1).Journal,"invalid recovery intent keeps retained journal: "+label);
            }
            await editing.CheckpointAsync(session.SessionToken,projected,pendingBytes,Checkpoint(initial.Path,pendingBytes,revision,1,2,Intent()));
            var durable=Retained();
            using(var doc=JsonDocument.Parse(durable))Assert(doc.RootElement.GetProperty("recovery").GetProperty("operationId").GetString()==Op,"durable recovery intent survives native encode/decode");
            foreach(var (label,mismatch) in new (string,JsonNode)[]{("different operation",Intent(true,operationId:"op-other")),("different recovery epoch",Intent(true,epoch:2)),("different recovery bytes",Intent(true,update:"BAUG")),("missing adopted flag",Intent()),("adopted flag false",Intent(false))}) {
                try{await editing.CheckpointAsync(session.SessionToken,projected,lateBytes,Checkpoint(initial.Path,lateBytes,revision,2,3,mismatch));throw new Exception(label+" adopted");}catch(InvalidOperationException){}
                Assert(Retained()==durable&&RetainedEpoch()==1&&!File.Exists(archivePath),"mismatched intent cannot adopt: "+label);
            }
            // A stale file revision fails before the archive or intent is written.
            try{await editing.CheckpointAsync(session.SessionToken,initial.Hash,lateBytes,Checkpoint(initial.Path,lateBytes,revision,2,3,Intent(true)));throw new Exception("stale hash adopted");}catch(Exception e)when(e is FileChangedException or InvalidOperationException){}
            Assert(Retained()==durable&&!File.Exists(archivePath),"failed adoption checkpoint leaves prior intact");
            // An external edit means the current file is no longer the projection: no adoption.
            var externalBytes=Pack("pending external");files.Write(initial.Path,externalBytes,projected);var externalHash=files.Describe(initial.Path).Hash;
            try{await editing.CheckpointAsync(session.SessionToken,externalHash,lateBytes,Checkpoint(initial.Path,lateBytes,revision,2,3,Intent(true)));throw new Exception("externally changed file adopted");}catch(InvalidOperationException){}
            Assert(Retained()==durable&&!File.Exists(archivePath),"externally changed projection cannot adopt");
            await editing.CheckpointAsync(session.SessionToken,externalHash,externalBytes,Checkpoint(initial.Path,externalBytes,revision,1,3,Intent()));
            durable=Retained();projected=files.Describe(initial.Path).Hash;
            // The exact persisted intent, marked adopted, moves the journal to the newer epoch and archives the prior first.
            var adopted=Checkpoint(initial.Path,lateBytes,revision,2,4,Intent(true));
            var result=await editing.CheckpointAsync(session.SessionToken,projected,lateBytes,adopted);
            var archive=JsonSerializer.Deserialize<SharedCheckpoint>(File.ReadAllText(archivePath))!;
            Assert(result.Hash==TextPackStore.Hash(lateBytes)&&RetainedEpoch()==2&&archive.Journal==durable&&archive.Epoch==1,"authorized adoption replaces the epoch after archiving the prior journal");
            // Late updates continue in the new epoch; the old epoch can never return.
            var moreBytes=Pack("pending typed during recovery and later");
            await editing.CheckpointAsync(session.SessionToken,result.Hash,moreBytes,Checkpoint(initial.Path,moreBytes,revision,2,5));
            try{await editing.CheckpointAsync(session.SessionToken,files.Describe(initial.Path).Hash,moreBytes,Checkpoint(initial.Path,moreBytes,revision,1,6));throw new Exception("epoch regression accepted");}catch(InvalidOperationException){}
            Assert(RetainedEpoch()==2,"late updates stay in the adopted epoch");
            // A revoked session cannot adopt.
            editing.Close(session.SessionToken);
            try{await editing.CheckpointAsync(session.SessionToken,files.Describe(initial.Path).Hash,moreBytes,Checkpoint(initial.Path,moreBytes,revision,3,7,Intent(true,epoch:2)));throw new Exception("closed session adopted");}catch(SharedSessionClosedException){}
        }
        using(var restarted=new SharedEditingStore(files,sync)) {
            var reopened=await restarted.OpenAsync("test-1",initial.Path,files.Describe(initial.Path).Hash);
            Assert(reopened.Checkpoint?.Epoch==2&&reopened.Checkpoint.Journal==Retained()&&reopened.Checkpoint.RetiredReason==null,"adopted journal survives restart");
            // A new intent in the adopted epoch, then a crash after the durable adoption intent replays on restart with the archive kept.
            var current=files.Describe(initial.Path);var bytes=files.Read(initial.Path);
            await restarted.CheckpointAsync(reopened.SessionToken,current.Hash,bytes,Checkpoint(initial.Path,bytes,revision,2,8,Intent(epoch:2,operationId:"op-second")));
            var before=Retained();var crashBytes=Pack("crash adoption");
            var crashing=Checkpoint(initial.Path,crashBytes,revision,3,9,Intent(true,epoch:2,operationId:"op-second"));
            // Simulate the crash window: the archive and durable intent are on disk, the finish never ran.
            TextPackStore.AtomicWrite(Path.Combine(directory,"recovery-op-second.json"),JsonSerializer.SerializeToUtf8Bytes(JsonSerializer.Deserialize<SharedCheckpoint>(File.ReadAllText(Path.Combine(directory,"checkpoint.json")))));
            TextPackStore.AtomicWrite(Path.Combine(directory,"intent.json"),JsonSerializer.SerializeToUtf8Bytes(new{Version=1,BeforeHash=current.Hash,Payload=Convert.ToBase64String(crashBytes),Checkpoint=crashing}));
        }
        using(var replay=new SharedEditingStore(files,sync)) {
            var opened=await replay.OpenAsync("test-1",initial.Path,files.Describe(initial.Path).Hash);
            Assert(opened.Checkpoint?.Epoch==3&&opened.Document.Hash==TextPackStore.Hash(Pack("crash adoption"))&&File.Exists(Path.Combine(directory,"recovery-op-second.json")),"interrupted adoption replays after restart with its archive intact");
            // Retired journals cannot adopt even with a matching intent.
            var retired=JsonSerializer.Deserialize<SharedCheckpoint>(File.ReadAllText(Path.Combine(directory,"checkpoint.json")))! with{RetiredReason="Editing access was removed."};
            TextPackStore.AtomicWrite(Path.Combine(directory,"checkpoint.json"),JsonSerializer.SerializeToUtf8Bytes(retired));
            var retiredBytes=Pack("retired");
            try{await replay.CheckpointAsync(opened.SessionToken,opened.Document.Hash,retiredBytes,Checkpoint(initial.Path,retiredBytes,revision,4,10,Intent(true,epoch:3,operationId:"op-second")));throw new Exception("retired journal adopted");}catch(InvalidOperationException){}
            Assert(RetainedEpoch()==3&&!File.Exists(Path.Combine(directory,"recovery-op-third.json")),"retired journal keeps its epoch");
        }
    }
    static JsonObject Also(this JsonObject value,Action<JsonObject> mutate){mutate(value);return value;}
}
