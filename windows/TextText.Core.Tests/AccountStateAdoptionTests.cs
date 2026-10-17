using System.IO.Compression;
using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;
using TextText.Core;

static class AccountStateAdoptionTests
{
    sealed class Interrupted : IOException;
    sealed record Fixture(TextPackStore Store,Test.Fake Remote,string Path,byte[] Pending,string Operation,string CheckpointPath,byte[] State,byte[] Checkpoint,byte[] Projection);
    static byte[] Pack(string id,string body) {
        using var output=new MemoryStream();
        using(var zip=new ZipArchive(output,ZipArchiveMode.Create,true)) {
            using(var writer=new StreamWriter(zip.CreateEntry("text.md").Open()))writer.Write("---\ntextTextId: \""+id+"\"\n---\n"+body);
            using(var asset=zip.CreateEntry("assets/exact.bin").Open())asset.Write(new byte[]{0,7,255,3});
        }
        return output.ToArray();
    }
    static async Task<Fixture> Create(string temporary,string name) {
        var store=new TextPackStore(Path.Combine(temporary,name),Path.Combine(temporary,name+"-state"));var remote=new Test.Fake();var sync=Test.NewSync(store,remote);
        var file=store.Write("Notes/Queued.textpack",Pack("adoption-note","Original"));await sync.SyncAsync();
        var pending=Pack("adoption-note","Retained offline edit");store.Write(file.Path,pending,file.Hash);remote.FailBeforeCommit=true;
        try{await sync.SyncAsync();throw new Exception("Expected offline refusal");}catch(HttpRequestException){}
        var shared=store.Write("Notes/Shared.textpack",Pack("adoption-shared","Original shared content"));var projection=Pack("adoption-shared","Retained shared content");
        var journal=JsonSerializer.Serialize(new{version=1,epoch=1,seq=0,journalGeneration=1,revision=shared.Hash,relativePath=shared.Path,update="AAA=",pending=new[]{"AAA="}});
        using(var editing=new SharedEditingStore(store,sync)) {
            var opened=await editing.OpenAsync(shared.ItemId,shared.Path,shared.Hash);
            await editing.CheckpointAsync(opened.SessionToken,shared.Hash,projection,new(shared.ItemId,shared.Path,TextPackStore.Hash(projection),shared.Hash,1,0,1,journal,true));editing.Close(opened.SessionToken);
        }
        var state=File.ReadAllBytes(Path.Combine(store.StateDirectory,"sync.json"));var cpPath="shared-editing/adoption-shared/checkpoint.json";
        return new(store,remote,file.Path,pending,JsonSerializer.Deserialize<SyncEngine.State>(state)!.Outbox.Single().Id,cpPath,state,File.ReadAllBytes(Path.Combine(store.StateDirectory,cpPath)),projection);
    }
    public static void ResumeFixture(string root) {
        var canonical=Path.GetFullPath(root);var parent=Path.GetFileName(Path.GetDirectoryName(canonical));
        if(!Path.GetFileName(canonical).StartsWith("adoption-process-",StringComparison.Ordinal)||parent is null||!parent.StartsWith("texttext-core-test-",StringComparison.Ordinal))throw new InvalidOperationException("Not an owned adoption fixture.");
        var nonce=Environment.GetEnvironmentVariable("TEXTTEXT_ADOPTION_FIXTURE_NONCE");
        if(nonce is null||File.ReadAllText(Path.Combine(canonical,".adoption-fixture"))!=nonce)throw new InvalidOperationException("Fixture ownership did not match.");
        var store=new TextPackStore(canonical,canonical+"-state");
        var result=AccountStateAdoption.AdoptAfterExplicitReview(store,new Uri("https://texttext.test"),"workspace","account-a");
        if(result.AlreadyBound||result.RecoveryDirectory is null)throw new InvalidOperationException("Interrupted adoption did not resume.");
        Console.WriteLine("PASS separate process resumes the recorded adoption");
    }
    static async Task SeparateProcess(string temporary,Action<bool,string> assert) {
        var f=await Create(temporary,"adoption-process-restart");var nonce=Guid.NewGuid().ToString("N");File.WriteAllText(Path.Combine(f.Store.Root,".adoption-fixture"),nonce);
        try{AccountStateAdoption.AdoptAfterExplicitReview(f.Store,new Uri("https://texttext.test"),"workspace","account-a",step=>{if(step=="applied:"+f.CheckpointPath)throw new Interrupted();});}catch(Interrupted){}
        var start=new ProcessStartInfo(Environment.ProcessPath!){UseShellExecute=false,RedirectStandardOutput=true,RedirectStandardError=true};
        if(Path.GetFileNameWithoutExtension(start.FileName).Equals("dotnet",StringComparison.OrdinalIgnoreCase))start.ArgumentList.Add(typeof(AccountStateAdoptionTests).Assembly.Location);
        start.ArgumentList.Add("--resume-account-adoption-fixture");start.ArgumentList.Add(f.Store.Root);start.Environment["TEXTTEXT_ADOPTION_FIXTURE_NONCE"]=nonce;
        using var child=Process.Start(start)??throw new Exception("Could not start owned adoption child.");
        var output=child.StandardOutput.ReadToEndAsync();var errors=child.StandardError.ReadToEndAsync();
        using var deadline=new CancellationTokenSource(TimeSpan.FromSeconds(20));
        try{await child.WaitForExitAsync(deadline.Token);}catch(OperationCanceledException){child.Kill(entireProcessTree:true);await child.WaitForExitAsync();throw new TimeoutException("Owned adoption child exceeded its deadline.");}
        var stdout=await output;var stderr=await errors;
        assert(child.ExitCode==0&&stdout.Contains("PASS separate process resumes the recorded adoption")&&stdout.Length<8192&&stderr.Length<8192,"a separate native process resumes frozen adoption bytes and hashes");
        var state=JsonSerializer.Deserialize<SyncEngine.State>(File.ReadAllBytes(Path.Combine(f.Store.StateDirectory,"sync.json")))!;
        assert(state.AccountId=="account-a"&&state.Outbox.Single().Id==f.Operation&&f.Store.Read(f.Path).SequenceEqual(f.Pending),"separate-process adoption retains original pending operation and file");
    }
    static async Task NoSpace(Action<bool,string> assert) {
        var location=Environment.GetEnvironmentVariable("TEXTTEXT_ADOPTION_NOSPACE_VOLUME");
        if(string.IsNullOrWhiteSpace(location))return;
        var volume=Path.GetFullPath(location);var drive=new DriveInfo(Path.GetPathRoot(volume)!);
        if(File.ReadAllText(Path.Combine(volume,".texttext-checkpoint-test-volume"))!="texttext checkpoint ENOSPC fixture v1\n" ||
            drive.TotalSize<16*1024*1024 || drive.TotalSize>128*1024*1024 || volume!=drive.RootDirectory.FullName)
            throw new InvalidOperationException("Refusing to fill anything except the explicitly marked tiny test volume");
        var temporary=Path.Combine(volume,"adoption-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(temporary);
        var f=await Create(temporary,"disk-full");var fill=Path.Combine(temporary,"fill");
        using var stream=new FileStream(fill,FileMode.CreateNew,FileAccess.Write,FileShare.None,4096,FileOptions.WriteThrough);
        var released=false;
        try {
            var refused=false;
            try {AccountStateAdoption.AdoptAfterExplicitReview(f.Store,new Uri("https://texttext.test"),"workspace","account-a",phase=> {
                if(phase!="intent")return;
                foreach(var length in new[]{1024*1024,4096}) {
                    var block=new byte[length];Array.Fill(block,(byte)0x5a);
                    while(true){try{stream.Write(block);stream.Flush(true);}catch(IOException error)when((error.HResult&0xffff)is 39 or 112){break;}}
                }
            });}catch(IOException error)when((error.HResult&0xffff)is 39 or 112){refused=true;}
            assert(refused&&File.ReadAllBytes(Path.Combine(f.Store.StateDirectory,"sync.json")).SequenceEqual(f.State)
                &&File.ReadAllBytes(Path.Combine(f.Store.StateDirectory,f.CheckpointPath)).SequenceEqual(f.Checkpoint)
                &&f.Store.Read("Notes/Shared.textpack").SequenceEqual(f.Projection),"real disk-full adoption preserves original metadata and projection");
            assert(File.Exists(Path.Combine(f.Store.StateDirectory,AccountRootOwnership.PendingAdoption)),"real disk-full adoption keeps its recorded intent");
            var blocked=false;try{_=Test.NewSync(f.Store,f.Remote,"account-a");}catch(LegacyAccountStateException){blocked=true;}
            assert(blocked,"ordinary sync stays blocked after disk-full adoption");
            stream.SetLength(0);stream.Flush(true);stream.Dispose();released=true;File.Delete(fill);
            var deadline=DateTime.UtcNow.AddSeconds(10);
            while(drive.AvailableFreeSpace<8*1024*1024&&DateTime.UtcNow<deadline)await Task.Delay(100);
            assert(drive.AvailableFreeSpace>=8*1024*1024,"adoption verifies reclaimed fixture space before retry");
            var result=AccountStateAdoption.AdoptAfterExplicitReview(f.Store,new Uri("https://texttext.test"),"workspace","account-a");
            assert(File.ReadAllBytes(Path.Combine(result.RecoveryDirectory!,"before/sync.json")).SequenceEqual(f.State),"disk-full adoption retains exact original backup");
            f.Remote.Capabilities=new(true,true,[],new(){["adoption-note"]=true,["adoption-shared"]=true});
            await Test.NewSync(f.Store,f.Remote,"account-a").SyncAsync();
            assert(f.Remote.Operations.Last()==f.Operation&&f.Store.Read(f.Path).SequenceEqual(f.Pending),"real disk-full adoption resumes original pending work");
        } finally {if(!released){stream.SetLength(0);stream.Flush(true);}}
    }
    public static async Task Run(string temporary,Action<bool,string> assert) {
        var origin=new Uri("https://texttext.test");
        await SeparateProcess(temporary,assert);
        await NoSpace(assert);
        var live=await Create(temporary,"adoption-live-writer");var liveSync=Test.NewSync(live.Store,live.Remote);
        using(var lease=await liveSync.AcquireCollaborationAsync("adoption-shared")) {
            var snapshot=File.ReadAllBytes(Path.Combine(live.Store.StateDirectory,"sync.json"));var refused=false;
            try{AccountStateAdoption.AdoptAfterExplicitReview(live.Store,origin,"workspace","account-a");}catch(IOException){refused=true;}
            assert(refused&&File.ReadAllBytes(Path.Combine(live.Store.StateDirectory,"sync.json")).SequenceEqual(snapshot)
                &&!File.Exists(Path.Combine(live.Store.StateDirectory,AccountRootOwnership.PendingAdoption)),"a live editing lease excludes adoption before publishing an intent");
        }
        assert(!AccountStateAdoption.AdoptAfterExplicitReview(live.Store,origin,"workspace","account-a").AlreadyBound,"released editing lease allows explicit adoption");
        var stale=false;try{await liveSync.SyncAsync();}catch(SharedAccountMismatchException){stale=true;}
        assert(stale,"a retained legacy sync object cannot write after adoption");

        var phases=new[]{"prepared:shared-editing/adoption-shared/checkpoint.json","prepared:sync.json","intent","applied:shared-editing/adoption-shared/checkpoint.json","applied:sync.json","owner"};
        foreach(var phase in phases) {
            var f=await Create(temporary,"adoption-"+Array.IndexOf(phases,phase));var stopped=false;
            try{AccountStateAdoption.AdoptAfterExplicitReview(f.Store,origin,"workspace","account-a",step=>{if(step==phase)throw new Interrupted();});}catch(Interrupted){stopped=true;}
            assert(stopped,"adoption reaches controlled interruption "+phase);
            var pointer=Path.Combine(f.Store.StateDirectory,AccountRootOwnership.PendingAdoption);
            if(phase.StartsWith("prepared:")) {
                assert(!File.Exists(pointer)&&File.ReadAllBytes(Path.Combine(f.Store.StateDirectory,"sync.json")).SequenceEqual(f.State)
                    &&File.ReadAllBytes(Path.Combine(f.Store.StateDirectory,f.CheckpointPath)).SequenceEqual(f.Checkpoint),"preparation interruption changes no original record");
            } else {
                var state=File.ReadAllBytes(Path.Combine(f.Store.StateDirectory,"sync.json"));var checkpoint=File.ReadAllBytes(Path.Combine(f.Store.StateDirectory,f.CheckpointPath));var denied=false;
                try{AccountStateAdoption.AdoptAfterExplicitReview(f.Store,origin,"workspace","account-b");}catch(Exception error)when(error is SharedAccountMismatchException or InvalidDataException){denied=true;}
                assert(denied&&File.ReadAllBytes(Path.Combine(f.Store.StateDirectory,"sync.json")).SequenceEqual(state)
                    &&File.ReadAllBytes(Path.Combine(f.Store.StateDirectory,f.CheckpointPath)).SequenceEqual(checkpoint),"another account cannot resume or rewrite an interrupted adoption");
                denied=false;try{_=Test.NewSync(f.Store,f.Remote,"account-a");}catch(LegacyAccountStateException){denied=true;}
                assert(denied,"ordinary sync cannot replay a partly adopted queue");
            }
            var result=AccountStateAdoption.AdoptAfterExplicitReview(f.Store,origin,"workspace","account-a");
            assert(!result.AlreadyBound&&result.RecoveryDirectory is not null&&!File.Exists(pointer),"same account completes its exact adoption transaction");
            assert(File.ReadAllBytes(Path.Combine(result.RecoveryDirectory!,"before/sync.json")).SequenceEqual(f.State)
                &&File.ReadAllBytes(Path.Combine(result.RecoveryDirectory!,"before/"+f.CheckpointPath)).SequenceEqual(f.Checkpoint),"adoption retains exact original metadata bytes");
            var adopted=JsonSerializer.Deserialize<SyncEngine.State>(File.ReadAllBytes(Path.Combine(f.Store.StateDirectory,"sync.json")))!;
            var cp=JsonSerializer.Deserialize<SharedCheckpoint>(File.ReadAllBytes(Path.Combine(f.Store.StateDirectory,f.CheckpointPath)))!;
            assert(adopted.AccountId=="account-a"&&adopted.Outbox.Single().Id==f.Operation&&adopted.Capabilities?.CanCreateContent==false
                &&JsonNode.Parse(cp.Journal)!["accountId"]!.GetValue<string>()=="account-a"&&cp.Pending,
                "adoption binds ownership without replacing pending identity or cached foreign grants");
            assert(f.Store.Read(f.Path).SequenceEqual(f.Pending)&&f.Store.Read("Notes/Shared.textpack").SequenceEqual(f.Projection),"adoption changes no projected pack or asset bytes");
            var count=Directory.GetDirectories(f.Store.StateDirectory,".account-adoption-*").Length;
            assert(AccountStateAdoption.AdoptAfterExplicitReview(f.Store,origin,"workspace","account-a").AlreadyBound
                &&Directory.GetDirectories(f.Store.StateDirectory,".account-adoption-*").Length==count,"completed adoption retry does not create another archive");
            f.Remote.Capabilities=new(true,true,[],new(){["adoption-note"]=true,["adoption-shared"]=true});
            await Test.NewSync(f.Store,f.Remote,"account-a").SyncAsync();
            assert(f.Remote.Data.SequenceEqual(f.Pending)&&f.Remote.Operations.Last()==f.Operation&&f.Remote.UploadCount==2,"adopted queue resumes original operation and payload exactly once");
            await Test.NewSync(f.Store,f.Remote,"account-a").SyncAsync();
            assert(f.Remote.UploadCount==2,"reopened adopted state does not duplicate an acknowledged upload");
        }
        var divergent=await Create(temporary,"adoption-divergent");
        try{AccountStateAdoption.AdoptAfterExplicitReview(divergent.Store,origin,"workspace","account-a",step=>{if(step=="intent")throw new Interrupted();});}catch(Interrupted){}
        var statePath=Path.Combine(divergent.Store.StateDirectory,"sync.json");var changed=divergent.State.Concat(new byte[]{32}).ToArray();File.WriteAllBytes(statePath,changed);var blocked=false;
        try{AccountStateAdoption.AdoptAfterExplicitReview(divergent.Store,origin,"workspace","account-a");}catch(FileChangedException){blocked=true;}
        assert(blocked&&File.ReadAllBytes(statePath).SequenceEqual(changed)
            &&File.ReadAllBytes(Path.Combine(divergent.Store.StateDirectory,divergent.CheckpointPath)).SequenceEqual(divergent.Checkpoint),"external state divergence blocks adoption before any original is overwritten");
        var racing=await Create(temporary,"adoption-racing-target");
        var racingState=Path.Combine(racing.Store.StateDirectory,"sync.json");var racingBytes=racing.State.Concat(new byte[]{32}).ToArray();blocked=false;
        try { AccountStateAdoption.AdoptAfterExplicitReview(racing.Store,origin,"workspace","account-a",step=> {
            if(step=="applied:"+racing.CheckpointPath)File.WriteAllBytes(racingState,racingBytes);
        }); } catch(FileChangedException) {blocked=true;}
        assert(blocked&&File.ReadAllBytes(racingState).SequenceEqual(racingBytes)
            &&File.Exists(Path.Combine(racing.Store.StateDirectory,AccountRootOwnership.PendingAdoption)),"a target changed during adoption is preserved before its replacement");
        foreach(var failure in new[]{"future-state","foreign-state","future-intent","malformed-intent","unsafe-path","corrupt-before","corrupt-after"}) {
            var f=await Create(temporary,"adoption-refuse-"+failure);
            var stateFile=Path.Combine(f.Store.StateDirectory,"sync.json");var pointer=Path.Combine(f.Store.StateDirectory,AccountRootOwnership.PendingAdoption);
            if(failure is "future-state" or "foreign-state") {
                var record=JsonNode.Parse(f.State)!;
                if(failure=="future-state")record["Version"]=999;else record["AccountId"]="account-b";
                File.WriteAllBytes(stateFile,JsonSerializer.SerializeToUtf8Bytes(record));
            } else {
                try{AccountStateAdoption.AdoptAfterExplicitReview(f.Store,origin,"workspace","account-a",step=>{if(step=="intent")throw new Interrupted();});}catch(Interrupted){}
                var intent=JsonSerializer.Deserialize<AccountStateAdoption.Intent>(File.ReadAllBytes(pointer))!;
                if(failure=="future-intent")File.WriteAllBytes(pointer,JsonSerializer.SerializeToUtf8Bytes(intent with {Version=999}));
                else if(failure is "malformed-intent" or "unsafe-path") {
                    var bad=JsonNode.Parse(File.ReadAllBytes(pointer))!;
                    if(failure=="malformed-intent")bad["Entries"]=null;else bad["Entries"]![0]!["Path"]="../outside.json";
                    File.WriteAllBytes(pointer,JsonSerializer.SerializeToUtf8Bytes(bad));
                } else {
                    var copy=Path.Combine(f.Store.StateDirectory,intent.Directory,failure=="corrupt-before"?"before":"after","sync.json");
                    File.WriteAllBytes(copy,File.ReadAllBytes(copy).Concat(new byte[]{32}).ToArray());
                }
            }
            var retained=File.ReadAllBytes(stateFile);var pointerBytes=File.Exists(pointer)?File.ReadAllBytes(pointer):null;var refused=false;
            try{AccountStateAdoption.AdoptAfterExplicitReview(f.Store,origin,"workspace","account-a");}catch(Exception error)when(error is InvalidDataException or SharedAccountMismatchException){refused=true;}
            assert(refused&&File.ReadAllBytes(stateFile).SequenceEqual(retained)
                &&File.ReadAllBytes(Path.Combine(f.Store.StateDirectory,f.CheckpointPath)).SequenceEqual(f.Checkpoint)
                &&(pointerBytes is null?!File.Exists(pointer):File.ReadAllBytes(pointer).SequenceEqual(pointerBytes)),"adoption refuses "+failure+" with all retained records unchanged");
        }
    }
}
