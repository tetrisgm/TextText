using System.IO.Compression;
using System.Text.Json;
using TextText.Core;
static class ReadinessTests
{
    static void Check(bool condition,string label){if(!condition)throw new Exception(label);Console.WriteLine("PASS "+label);}
    static byte[] Pack(string body){using var output=new MemoryStream();using(var zip=new ZipArchive(output,ZipArchiveMode.Create,true)){using var writer=new StreamWriter(zip.CreateEntry("text.md").Open());writer.Write("---\ntextTextId: \"ready-id\"\n---\n"+body);}return output.ToArray();}
    public static async Task Run(string root)
    {
        var store=new TextPackStore(Path.Combine(root,"readiness"),Path.Combine(root,"readiness-state"));var original=store.Write("Notes/Ready.textpack",Pack("baseline"));
        var state=new SyncEngine.State();state.Items[original.ItemId]=new(original.Path,original.Hash,original.Hash);var statePath=Path.Combine(store.StateDirectory,"sync.json");TextPackStore.AtomicWrite(statePath,JsonSerializer.SerializeToUtf8Bytes(state));
        using var http=new HttpClient();var engine=new SyncEngine(store,new HttpSyncTransport(http,new("https://invalid.example"),"workspace",()=>Task.FromResult("unused")));
        using var active=await engine.AcquireCollaborationAsync(original.ItemId);
        var current=store.Write(original.Path,Pack("durable collaborative projection"),original.Hash);var directory=Path.Combine(store.StateDirectory,"shared-editing",original.ItemId);Directory.CreateDirectory(directory);var cpPath=Path.Combine(directory,"checkpoint.json");
        SharedCheckpoint Checkpoint(bool pending)=>new(original.ItemId,original.Path,current.Hash,current.Hash,7,3,9,JsonSerializer.Serialize(new{version=1,epoch=7,seq=3,journalGeneration=9,revision=current.Hash,relativePath=original.Path,update="AAA=",pending=pending?new[]{"AAA="}:Array.Empty<string>()}),pending);
        void Save(SharedCheckpoint checkpoint)=>TextPackStore.AtomicWrite(cpPath,JsonSerializer.SerializeToUtf8Bytes(checkpoint));
        Check(!await engine.IsReadyAsync(original.ItemId),"active lease alone cannot authorize uncheckpointed file changes");
        Save(Checkpoint(false));Check(await engine.IsReadyAsync(original.ItemId),"durable shared checkpoint authorizes presence before file baseline catches up");
        Save(Checkpoint(true));Check(await engine.IsReadyAsync(original.ItemId),"durable pending shared projection remains presence-ready");
        Save(Checkpoint(true) with{Epoch=8});Check(!await engine.IsReadyAsync(original.ItemId),"mismatched checkpoint epoch stays fenced");
        Save(Checkpoint(true) with{ItemId="wrong-id"});Check(!await engine.IsReadyAsync(original.ItemId),"wrong checkpoint identity stays fenced");
        Save(Checkpoint(true) with{Path="Notes/Other.textpack"});Check(!await engine.IsReadyAsync(original.ItemId),"wrong checkpoint path stays fenced");
        Save(Checkpoint(true) with{Version=99});Check(!await engine.IsReadyAsync(original.ItemId),"unknown checkpoint version is not readiness");
        Save(Checkpoint(true) with{RetiredReason="External change"});Check(!await engine.IsReadyAsync(original.ItemId),"retired checkpoint cannot enable collaboration presence");
        Save(Checkpoint(false));state.PendingPull=new(original.ItemId,original.Path,original.Path,current.Hash,current.Hash,Convert.ToBase64String(Pack("incoming")));TextPackStore.AtomicWrite(statePath,JsonSerializer.SerializeToUtf8Bytes(state));Check(!await engine.IsReadyAsync(original.ItemId),"pending file transaction overrides checkpoint readiness");
        state.PendingPull=null;TextPackStore.AtomicWrite(statePath,JsonSerializer.SerializeToUtf8Bytes(state));store.Write(original.Path,Pack("external-agent edit"),current.Hash);Check(!await engine.IsReadyAsync(original.ItemId),"external change after checkpoint cannot bypass hash fencing");
    }
}
