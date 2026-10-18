using TextText.Core;

static class RecoveryAssetTests
{
    public static void Run(string temp,Action<bool,string> check)
    {
        var store=new TextPackStore(Path.Combine(temp,"raw-asset-recovery"),Path.Combine(temp,"raw-asset-recovery-state"));
        byte[] bytes=[1,2,3];var hash=TextPackStore.Hash(bytes);
        var operation=new SyncEngine.BinaryPending(Guid.NewGuid().ToString("D"),"asset-item","assets/submitted.bin",null,"lifecycle",null,new string('a',64),PayloadHash:hash,SourcePath:"Note.textpack");
        var file=store.PreserveSubmittedAsset(bytes,operation);var entry=store.RecoveryAssets().Assets.Single();
        check(entry.Hash==hash&&entry.ByteLength==3&&entry.EntryPath==operation.EntryPath&&entry.ItemPath==operation.SourcePath,"raw attachment recovery displays only verified immutable origin metadata");
        check(store.RecoveryAssetRead(entry.Id,entry.Hash).Data.SequenceEqual(bytes),"raw attachment download returns exact submitted bytes");
        var sidecar=Path.Combine(store.GetRecoveryDirectory(),"binary-conflict-asset-"+hash+"-"+operation.Id+".json");
        File.WriteAllText(sidecar,"{corrupt saved provenance");
        entry=store.RecoveryAssets().Assets.Single();
        check(entry.ProvenanceError is not null&&entry.EntryPath is null&&entry.ItemPath is null&&store.RecoveryAssetRead(entry.Id,entry.Hash).Data.SequenceEqual(bytes),"corrupt origin metadata remains visible while exact raw bytes stay downloadable");
        var refused=false;try{store.PreserveSubmittedAsset(bytes,operation);}catch(InvalidDataException){refused=true;}
        check(refused&&File.ReadAllText(sidecar)=="{corrupt saved provenance","submitted asset retirement cannot overwrite corrupt existing provenance");
        File.WriteAllBytes(file,[9,9,9]);refused=false;
        try{store.RecoveryAssetRead(entry.Id,entry.Hash);}catch(FileChangedException){refused=true;}
        check(refused,"changed raw recovery bytes refuse stale download inspection");
        File.WriteAllBytes(file,bytes);
        var oversized=Path.Combine(store.GetRecoveryDirectory(),"binary-conflict-asset-"+new string('e',64)+".asset");
        using(var sparse=new FileStream(oversized,FileMode.CreateNew,FileAccess.Write))sparse.SetLength(16L*1024*1024+1);
        check(store.RecoveryAssets().Truncated,"oversized retained attachment reports listing truncation before allocation");
        for(var index=0;index<201;index++)store.PreserveAsset([(byte)index,(byte)(index>>8)],"binary-conflict-asset");
        var bounded=store.RecoveryAssets();check(bounded.Assets.Count==200&&bounded.Truncated,"raw attachment recovery listing remains bounded to two hundred records");
    }
}
