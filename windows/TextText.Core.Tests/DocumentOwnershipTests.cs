using System.IO.Compression;
using System.Diagnostics;
using System.Text.Json;
using TextText.Core;
static class DocumentOwnershipTests
{
    static byte[] Pack() { using var output=new MemoryStream();using(var zip=new ZipArchive(output,ZipArchiveMode.Create,true)) {using var writer=new StreamWriter(zip.CreateEntry("text.md").Open());writer.Write("---\ntextTextId: test-1\n---\nOwned baseline");}return output.ToArray(); }
    public static async Task Run(string temporary,Action<bool,string> assert) {
        var store=new TextPackStore(Path.Combine(temporary,"document-owner"),Path.Combine(temporary,"document-owner-state"));
        var original=store.Write("Owned.textpack",Pack());var remote=new Test.Fake();var first=Test.NewSync(store,remote);await first.SyncAsync();
        using var a=new SharedEditingStore(store,first);
        var second=Test.NewSync(store,remote);
        using var b=new SharedEditingStore(new TextPackStore(store.Root,store.StateDirectory),second);
        var active=await a.OpenAsync(original.ItemId,original.Path,original.Hash);var refused=false;
        var duplicateRefused=false;try{await a.OpenAsync(original.ItemId,original.Path,original.Hash);}catch(IOException){duplicateRefused=true;}
        assert(duplicateRefused,"duplicate open cannot silently retire another live native view");
        try {await b.OpenAsync(original.ItemId,original.Path,original.Hash);}catch(IOException){refused=true;}
        assert(refused,"another native actor cannot acquire the live document");
        await first.SyncAsync();
        var mirrorRefused=false;try{await second.SyncAsync();}catch(IOException){mirrorRefused=true;}
        assert(mirrorRefused,"a competing background mirror cannot run during active editing");
        a.Close(active.SessionToken);await second.SyncAsync();var next=await b.OpenAsync(original.ItemId,original.Path,original.Hash);
        assert(next.SessionToken!=active.SessionToken,"released document receives a new native owner token");
        b.Close(next.SessionToken);
        remote.ManifestEntered=new(TaskCreationOptions.RunContinuationsAsynchronously);remote.HoldManifest=new(TaskCreationOptions.RunContinuationsAsynchronously);
        var syncing=first.SyncAsync();
        try {
            await remote.ManifestEntered.Task.WaitAsync(TimeSpan.FromSeconds(10));var openingRefused=false;
            try{await b.OpenAsync(original.ItemId,original.Path,original.Hash);}catch(IOException){openingRefused=true;}
            assert(openingRefused,"background pass retains workspace ownership across a network await");
        } finally {remote.HoldManifest.TrySetResult();await syncing;remote.HoldManifest=null;remote.ManifestEntered=null;}
        var afterSync=await b.OpenAsync(original.ItemId,original.Path,original.Hash);b.Close(afterSync.SessionToken);
        await KilledOwner(store,original,remote,assert);
    }
    public static async Task Hold(string root) {
        root=Path.GetFullPath(root);var nonce=Environment.GetEnvironmentVariable("TEXTTEXT_DOCUMENT_FIXTURE_NONCE");
        if(Path.GetFileName(root)!="document-owner"||!Path.GetFileName(Path.GetDirectoryName(root)!).StartsWith("texttext-core-test-",StringComparison.Ordinal)||nonce is null||File.ReadAllText(Path.Combine(root,".document-owner-fixture"))!=nonce)throw new InvalidOperationException("Not an owned document fixture.");
        var store=new TextPackStore(root,root+"-state");var original=store.Describe("Owned.textpack");
        using var editing=new SharedEditingStore(store,Test.NewSync(store,new Test.Fake()));
        var session=await editing.OpenAsync(original.ItemId,original.Path,original.Hash);
        if(session.Checkpoint is not {Pending:true})throw new Exception("Pending journal was not restored.");
        File.WriteAllText(Path.Combine(root,".document-owner-ready"),session.SessionToken);
        await Task.Delay(TimeSpan.FromSeconds(30));
    }
    static async Task KilledOwner(TextPackStore store,PackFile original,Test.Fake remote,Action<bool,string> assert) {
        var bytes=store.Read(original.Path);var journal=JsonSerializer.Serialize(new{version=1,epoch=1,seq=0,journalGeneration=1,revision=original.Hash,relativePath=original.Path,update="AAA=",pending=new[]{"AAA="},batch=new{operationId="retained-process-operation",updates=new[]{"AAA="}}});
        var checkpoint=new SharedCheckpoint(original.ItemId,original.Path,original.Hash,original.Hash,1,0,1,journal,true);
        using(var preparing=new SharedEditingStore(store,Test.NewSync(store,remote))) {
            var h=await preparing.OpenAsync(original.ItemId,original.Path,original.Hash);
            await preparing.CheckpointAsync(h.SessionToken,original.Hash,bytes,checkpoint);preparing.Close(h.SessionToken);
        }
        var nonce=Guid.NewGuid().ToString("N");File.WriteAllText(Path.Combine(store.Root,".document-owner-fixture"),nonce);
        var start=OwnedTestProcess.Create();
        start.ArgumentList.Add("--hold-document-owner-fixture");start.ArgumentList.Add(store.Root);
        start.Environment.Clear();foreach(var key in new[]{"PATH","HOME","TMPDIR","TEMP","TMP","DOTNET_ROOT","SystemRoot"})if(Environment.GetEnvironmentVariable(key) is {} value)start.Environment[key]=value;
        start.Environment["TEXTTEXT_DOCUMENT_FIXTURE_NONCE"]=nonce;
        using var child=Process.Start(start)??throw new Exception("Could not start owned document child.");
        var stdout=child.StandardOutput.ReadToEndAsync();var stderr=child.StandardError.ReadToEndAsync();
        try {
            var ready=Path.Combine(store.Root,".document-owner-ready");var deadline=DateTime.UtcNow.AddSeconds(15);
            while(!File.Exists(ready)&&!child.HasExited&&DateTime.UtcNow<deadline)await Task.Delay(20);
            assert(File.Exists(ready)&&!child.HasExited,"child owns the restored pending document before termination");
            var stale=File.ReadAllText(ready);
            var replacementSync=Test.NewSync(store,remote);
            using var replacement=new SharedEditingStore(store,replacementSync);var refused=false;
            try{await replacement.OpenAsync(original.ItemId,original.Path,original.Hash);}catch(IOException){refused=true;}
            assert(refused,"separate live native process cannot be displaced");
            var mirrorRefused=false;try{await replacementSync.SyncAsync();}catch(IOException){mirrorRefused=true;}
            assert(mirrorRefused,"foreign background mirror is fenced by the live child process");
            child.Kill(entireProcessTree:true);await child.WaitForExitAsync();
            var resumed=await replacement.OpenAsync(original.ItemId,original.Path,original.Hash);
            assert(resumed.SessionToken!=stale&&resumed.Checkpoint?.Journal==journal&&store.Read(original.Path).SequenceEqual(bytes),"killed owner takeover preserves exact pending journal, operation and file");
            var staleRefused=false;try{await replacement.CheckpointAsync(stale,original.Hash,bytes,checkpoint);}catch(SharedSessionClosedException){staleRefused=true;}
            assert(staleRefused,"terminated owner token cannot checkpoint through the replacement");replacement.Close(resumed.SessionToken);
        } finally {if(!child.HasExited){child.Kill(entireProcessTree:true);await child.WaitForExitAsync();}assert((await stdout).Length<8192&&(await stderr).Length<8192,"owned child diagnostic output stays bounded");}
    }
}
