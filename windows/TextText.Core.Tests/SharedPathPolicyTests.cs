using System.IO.Compression;
using System.Text.Json;
using TextText.Core;
static class SharedPathPolicyTests {
    const string Id="shared-path-policy";
    static byte[] Pack() {using var memory=new MemoryStream();using(var zip=new ZipArchive(memory,ZipArchiveMode.Create,true)){using var text=new StreamWriter(zip.CreateEntry("text.md").Open());text.Write("---\ntextTextId: \""+Id+"\"\n---\nRetained shared bytes");}return memory.ToArray();}
    static SharedCheckpoint Checkpoint(string path,string hash,long generation) {
        var journal=JsonSerializer.Serialize(new{version=1,epoch=1,seq=0,journalGeneration=generation,revision=hash,relativePath=path,update="AAA=",pending=new[]{"AAA="}});
        return new(Id,path,hash,hash,1,0,generation,journal,true);
    }
    public static async Task Run(string temp,Action<bool,string> check) {
        foreach(var mode in new[]{"mismatch","unknown","known","duplicate","checkpoint","lifecycle","adopt","diverged"}) {
            var store=new TextPackStore(Path.Combine(temp,"path-"+mode),Path.Combine(temp,"path-state-"+mode));
            var bytes=Pack();var file=store.Write("Original.textpack",bytes);
            var remote=new Test.Fake{Data=bytes,Item=new(Id,file.Path,file.Hash,Lifecycle:"generation-a")};
            await Test.NewSync(store,remote).SyncAsync();
            var statePath=Path.Combine(store.StateDirectory,"sync.json");
            var state=JsonSerializer.Deserialize<SyncEngine.State>(File.ReadAllBytes(statePath))!;
            state.Items[Id]=state.Items[Id] with{Lifecycle=mode=="unknown"?null:"generation-a"};
            TextPackStore.AtomicWrite(statePath,JsonSerializer.SerializeToUtf8Bytes(state));
            SharedEditingStore? editing=null;SharedSession? session=null;var injected=false;
            var policy=NativePolicyTestHost.Create(beforeRequest:async script=>{
                if(!script.Contains(".sharedPath(")||injected)return;injected=true;
                if(mode=="duplicate")File.WriteAllBytes(store.Resolve("Duplicate.textpack"),bytes);
                if(mode=="lifecycle")remote.Item=remote.Item! with{Lifecycle="generation-after-await"};
                if(mode=="checkpoint")await editing!.CheckpointAsync(session!.SessionToken,file.Hash,bytes,Checkpoint(file.Path,file.Hash,2));
            });
            var sync=new SyncEngine(store,remote,mirrorPolicy:policy);using(editing=new SharedEditingStore(store,sync)) {
                session=await editing.OpenAsync(Id,file.Path,file.Hash);await editing.CheckpointAsync(session.SessionToken,file.Hash,bytes,Checkpoint(file.Path,file.Hash,1));
                remote.Item=remote.Item! with{RelativePath="Remote.textpack",Lifecycle=mode=="mismatch"?"generation-b":"generation-a"};
                if(mode is "adopt" or "diverged")File.Move(store.Resolve(file.Path),store.Resolve(mode=="adopt"?"Remote.textpack":"Local.textpack"));
                try{await sync.SyncAsync();}catch(FileChangedException) when(mode is "duplicate" or "checkpoint" or "lifecycle") { }
                var after=JsonSerializer.Deserialize<SyncEngine.State>(File.ReadAllBytes(statePath))!;
                if(mode is "known" or "adopt")check(File.Exists(store.Resolve("Remote.textpack"))&&after.Items[Id].Path=="Remote.textpack"&&store.Read("Remote.textpack").SequenceEqual(bytes),"protected path adopts attested generation "+mode);
                else check(!File.Exists(store.Resolve("Remote.textpack"))&&after.Items[Id].Path==file.Path&&store.Read(mode=="diverged"?"Local.textpack":file.Path).SequenceEqual(bytes),"protected path refuses unverified/stale facts "+mode);
                check(remote.UploadCount==0&&after.SharedRenames.Count==0,"path-only policy leaves full-file uploads and IDs untouched "+mode);
            }
        }
    }
}
