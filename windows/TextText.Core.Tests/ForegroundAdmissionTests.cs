using System.IO.Compression;
using System.Text.Json;
using TextText.Core;

static class ForegroundAdmissionTests
{
    static int Pending(SyncEngine engine) => (int)typeof(SyncEngine).GetField("pendingAdmissions",System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.NonPublic)!.GetValue(engine)!;
    static byte[] Pack(string body) {
        using var output=new MemoryStream();
        using(var zip=new ZipArchive(output,ZipArchiveMode.Create,true))
        using(var writer=new StreamWriter(zip.CreateEntry("text.md").Open()))writer.Write("---\ntextTextId: \"admission-1\"\n---\n"+body);
        return output.ToArray();
    }
    public static async Task Run(string root,Action<bool,string> assert) {
        foreach(var mode in new[]{"admit","cancel","outbox"}) {
            var cancel=mode=="cancel";
            var dir=Path.Combine(root,mode);
            var store=new TextPackStore(Path.Combine(dir,"files"),Path.Combine(dir,"state"));
            var data=Pack("original exact");var file=store.Write("Notes/a.textpack",data);
            var state=new SyncEngine.State { Items={ [file.ItemId]=new(file.Path,file.Hash,file.Hash) } };
            if(mode=="outbox")state.Outbox.Add(new(Guid.NewGuid().ToString(),"upload",file.ItemId,file.Path,null,file.Hash,file.Hash,Convert.ToBase64String(data)));
            File.WriteAllBytes(Path.Combine(store.StateDirectory,"sync.json"),JsonSerializer.SerializeToUtf8Bytes(state));
            var remote=new Test.Fake {Item=new(file.ItemId,file.Path,file.Hash),Data=data,
                ManifestEntered=new(TaskCreationOptions.RunContinuationsAsynchronously),HoldManifest=new(TaskCreationOptions.RunContinuationsAsynchronously)};
            var engine=Test.NewSync(store,remote);
            using var deadline=new CancellationTokenSource(TimeSpan.FromSeconds(20));
            var pass=engine.SyncPassAsync(deadline.Token);
            await remote.ManifestEntered.Task.WaitAsync(deadline.Token);
            using var admissionCancellation=CancellationTokenSource.CreateLinkedTokenSource(deadline.Token);
            var admission=engine.AcquireCollaborationAsync(file.ItemId,admissionCancellation.Token);
            assert(Pending(engine)==1&&!admission.IsCompleted,"admission waits while manifest is in flight");
            if(cancel) {
                admissionCancellation.Cancel();
                try {await admission;} catch(OperationCanceledException) { }
                assert(Pending(engine)==0,"cancelled admission removes its priority request");
                using var readinessCancellation=CancellationTokenSource.CreateLinkedTokenSource(deadline.Token);
                var readiness=engine.IsReadyAsync(file.ItemId,readinessCancellation.Token);
                assert(Pending(engine)==1&&!readiness.IsCompleted,"readiness queues foreground priority behind active pass");
                readinessCancellation.Cancel();
                try {await readiness;} catch(OperationCanceledException) { }
                assert(Pending(engine)==0,"bounded readiness cancellation removes its priority request");
            }
            remote.HoldManifest.SetResult();
            var outcome=await pass.WaitAsync(deadline.Token);
            if(cancel) {
                assert(outcome==SyncEngine.PassOutcome.Completed,"cancelled request does not cause needless pass yield");
                continue;
            }
            assert(outcome==SyncEngine.PassOutcome.ForegroundYield,"pass yields at a durable validated checkpoint before remaining item work");
            if(mode=="outbox") {
                var refused=false;
                try { using var unexpected=await admission.WaitAsync(deadline.Token); }
                catch(IOException) { refused=true; }
                var retained=JsonSerializer.Deserialize<SyncEngine.State>(File.ReadAllBytes(Path.Combine(store.StateDirectory,"sync.json")))!;
                assert(refused&&retained.Outbox.Count==1&&retained.Outbox[0]==state.Outbox[0]&&remote.UploadCount==0,
                    "yield does not bypass pending outbox admission fence or alter durable operation");
                continue;
            }
            using var lease=await admission.WaitAsync(deadline.Token);
            assert(Pending(engine)==0&&remote.ManifestCount==1,"queued editor acquires gate before another manifest");
            var acknowledged="ack-after-yield";
            await engine.AcknowledgeCheckpointAsync(file.ItemId,file.Path,file.Hash,acknowledged,deadline.Token);
            var next=await engine.SyncPassAsync(deadline.Token);
            var persisted=JsonSerializer.Deserialize<SyncEngine.State>(File.ReadAllBytes(Path.Combine(store.StateDirectory,"sync.json")))!;
            assert(next==SyncEngine.PassOutcome.Completed&&persisted.Items[file.ItemId].Revision==acknowledged,
                "next pass reloads acknowledged state changed during yield instead of resuming stale snapshot");
            assert(remote.UploadCount==0&&store.Read(file.Path).SequenceEqual(data),"admitted editor bytes and remote projection remain unchanged");
            var pendingField=typeof(SyncEngine).GetField("pendingAdmissions",System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.NonPublic)!;
            var shouldYield=typeof(SyncEngine).GetMethod("YieldForAdmission",System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.NonPublic)!;
            var savedBytes=File.ReadAllBytes(Path.Combine(store.StateDirectory,"sync.json"));
            persisted.Items[file.ItemId]=persisted.Items[file.ItemId] with {Revision="not-durable"};
            pendingField.SetValue(engine,1);
            try {assert(!(bool)shouldYield.Invoke(engine,new object[]{persisted})!&&File.ReadAllBytes(Path.Combine(store.StateDirectory,"sync.json")).SequenceEqual(savedBytes),
                "unsaved state refuses checkpoint without writing it");}
            finally {pendingField.SetValue(engine,0);}
        }
        await Flood(Path.Combine(root,"readiness-flood"),assert);
    }
    static async Task Flood(string root,Action<bool,string> assert) {
        var store=new TextPackStore(Path.Combine(root,"files"),Path.Combine(root,"state"));
        var data=Pack("queued exact content");var file=store.Write("Notes/a.textpack",data);
        var operation=new SyncEngine.Operation(Guid.NewGuid().ToString(),"upload",file.ItemId,file.Path,null,file.Hash,file.Hash,Convert.ToBase64String(data));
        var state=new SyncEngine.State { Items={ [file.ItemId]=new(file.Path,file.Hash,file.Hash) },Outbox={operation} };
        File.WriteAllBytes(Path.Combine(store.StateDirectory,"sync.json"),JsonSerializer.SerializeToUtf8Bytes(state));
        var remote=new Test.Fake {Item=new(file.ItemId,file.Path,file.Hash),Data=data};
        var engine=Test.NewSync(store,remote);
        using var deadline=new CancellationTokenSource(TimeSpan.FromSeconds(20));
        for(var wave=0;wave<3;wave++) {
            if(wave==1)foreach(var cancelled in new[]{true,false}) {
                remote.ManifestEntered=new(TaskCreationOptions.RunContinuationsAsynchronously);
                remote.HoldManifest=new(TaskCreationOptions.RunContinuationsAsynchronously);
                using var stopped=CancellationTokenSource.CreateLinkedTokenSource(deadline.Token);
                var interrupted=engine.SyncPassAsync(stopped.Token);
                await remote.ManifestEntered.Task.WaitAsync(deadline.Token);
                if(cancelled)stopped.Cancel();else remote.HoldManifest.SetException(new IOException("fixture manifest failed"));
                var failed=false;
                try {await interrupted;}catch(Exception error)when(error is OperationCanceledException or IOException){failed=true;}
                assert(failed&&Pending(engine)==0&&remote.UploadCount==0,"failed or cancelled retry releases gate without forging progress");
            }
            remote.ManifestEntered=new(TaskCreationOptions.RunContinuationsAsynchronously);
            remote.HoldManifest=new(TaskCreationOptions.RunContinuationsAsynchronously);
            var pass=engine.SyncPassAsync(deadline.Token);
            await remote.ManifestEntered.Task.WaitAsync(deadline.Token);
            var readers=Enumerable.Range(0,40).Select(_=>engine.IsReadyAsync(file.ItemId,deadline.Token)).ToArray();
            assert(Pending(engine)==40,"fresh readiness wave queues during every pass");
            remote.HoldManifest.SetResult();
            var result=await pass.WaitAsync(deadline.Token);
            await Task.WhenAll(readers).WaitAsync(deadline.Token);
            if(wave==0)assert(result==SyncEngine.PassOutcome.ForegroundYield&&remote.UploadCount==0,"first readiness wave receives foreground priority");
            else assert(remote.UploadCount==1&&remote.Operations.Count==1&&remote.Operations[0]==operation.Id,
                "repeated readiness cannot starve or duplicate queued upload");
            assert(Pending(engine)==0,"finite readiness wave drains without leaked priority");
        }
        var saved=JsonSerializer.Deserialize<SyncEngine.State>(File.ReadAllBytes(Path.Combine(store.StateDirectory,"sync.json")))!;
        assert(saved.Outbox.Count==0&&remote.Data.SequenceEqual(data)&&store.Read(file.Path).SequenceEqual(data),
            "readiness flood leaves exact durable and remote content with empty acknowledged outbox");
    }
}
