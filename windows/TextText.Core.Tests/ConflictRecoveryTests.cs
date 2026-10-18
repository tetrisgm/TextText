using System.IO.Compression;
using System.Text.Json;
using TextText.Core;

static class ConflictRecoveryTests
{
    static byte[] Pack(string body) {
        using var output=new MemoryStream();
        using(var zip=new ZipArchive(output,ZipArchiveMode.Create,true))
        using(var writer=new StreamWriter(zip.CreateEntry("text.md").Open()))writer.Write("---\ntextTextId: \"recovery-item\"\n---\n"+body);
        return output.ToArray();
    }
    public static async Task Run(string temp,Action<bool,string> check) {
        foreach(var fault in new[]{"none","missing","corrupt","corrupt-recovery","corrupt-remote-recovery","corrupt-asset-recovery"}) {
            var store=new TextPackStore(Path.Combine(temp,"recovery-"+fault),Path.Combine(temp,"recovery-state-"+fault));
            byte[] a=[1,1],b=[2,2],c=[3,3],d=[4,4];
            var original=BinaryEntryPacks.Patch(Pack("retained text"),"assets/data.bin",null,a);
            var file=store.Write("Note.textpack",original);
            var remote=new Test.Fake{Data=original,Item=new(file.ItemId,file.Path,file.Hash)};
            var engine=Test.NewSync(store,remote);await engine.SyncAsync();
            using var lease=await engine.AcquireCollaborationAsync(file.ItemId);
            var stagedPack=BinaryEntryPacks.Patch(original,"assets/data.bin",TextPackStore.Hash(a),b);
            var laterPack=BinaryEntryPacks.Patch(original,"assets/data.bin",TextPackStore.Hash(a),c);
            var winnerPack=BinaryEntryPacks.Patch(original,"assets/data.bin",TextPackStore.Hash(a),d);
            store.Write(file.Path,stagedPack,file.Hash);
            var statePath=Path.Combine(store.StateDirectory,"sync.json");
            string? operation=null;
            var corruptCopy=Path.Combine(store.GetRecoveryDirectory(),fault switch {
                "corrupt-remote-recovery"=>"binary-conflict-remote-"+TextPackStore.Hash(winnerPack)+".textpack",
                "corrupt-asset-recovery"=>"binary-conflict-asset-"+TextPackStore.Hash(b)+".asset",
                _=>"binary-conflict-local-"+TextPackStore.Hash(laterPack)+".textpack"
            });
            remote.BeforeBinaryPatch=()=>{
                var pending=JsonSerializer.Deserialize<SyncEngine.State>(File.ReadAllBytes(statePath))!.BinaryOutbox.Single();operation=pending.Id;
                store.Write(file.Path,laterPack,store.Describe(file.Path).Hash);
                remote.Data=winnerPack;remote.Item=remote.Item! with{Revision=TextPackStore.Hash(winnerPack)};
                var staged=Path.Combine(store.StateDirectory,"binary-outbox",operation+".asset");
                if(fault=="missing")File.Delete(staged);
                if(fault=="corrupt")File.WriteAllBytes(staged,[9,9]);
                if(fault.EndsWith("-recovery",StringComparison.Ordinal))File.WriteAllBytes(corruptCopy,[9,9]);
            };
            var refused=false;try{await engine.SyncAsync(localChangesOnly:true);}catch(Exception error) when(error is IOException or InvalidDataException){refused=true;}
            var state=JsonSerializer.Deserialize<SyncEngine.State>(File.ReadAllBytes(statePath))!;
            if(fault!="none") {
                check(refused&&state.BinaryOutbox.Single().Id==operation,"binary "+fault+" retains original operation during recovery failure");
                check(store.Read(file.Path).SequenceEqual(laterPack),"binary recovery failure preserves later local edit");
                if(fault.EndsWith("-recovery",StringComparison.Ordinal)) {
                    check(File.ReadAllBytes(corruptCopy).SequenceEqual(new byte[]{9,9}),"corrupt existing recovery is never silently overwritten");
                    File.Move(corruptCopy,corruptCopy+".fixture-quarantine");
                }
                TextPackStore.AtomicWrite(Path.Combine(store.StateDirectory,"binary-outbox",operation+".asset"),b);
                await engine.SyncAsync(localChangesOnly:true);
                state=JsonSerializer.Deserialize<SyncEngine.State>(File.ReadAllBytes(statePath))!;
            }
            check(state.BinaryOutbox.Count==0,"verified recovery retires binary operation only after all copies exist");
            var recovery=store.GetRecoveryDirectory();
            check(File.ReadAllBytes(Path.Combine(recovery,"binary-conflict-local-"+TextPackStore.Hash(laterPack)+".textpack")).SequenceEqual(laterPack),"current local pack C is retained");
            check(File.ReadAllBytes(Path.Combine(recovery,"binary-conflict-remote-"+TextPackStore.Hash(winnerPack)+".textpack")).SequenceEqual(winnerPack),"remote winner D is retained");
            check(File.ReadAllBytes(Path.Combine(recovery,"binary-conflict-asset-"+TextPackStore.Hash(b)+".asset")).SequenceEqual(b),"original submitted asset B remains recoverable after later local C and remote D");
            check(BinaryEntryPacks.Assets(store.Read(file.Path))["assets/data.bin"].Bytes.SequenceEqual(d),"server winner lands after durable three-version recovery");
        }
    }
}
