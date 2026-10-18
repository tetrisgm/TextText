using System.IO.Compression;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using TextText.Core;
static class RetainedRemovalCausalityTests
{
    static byte[] Pack(string body){using var output=new MemoryStream();using(var zip=new ZipArchive(output,ZipArchiveMode.Create,true))using(var writer=new StreamWriter(zip.CreateEntry("text.md").Open()))writer.Write("---\ntextTextId: \"causal-id\"\n---\n"+body);return output.ToArray();}
    static bool Refuses(Action action){try{action();return false;}catch(IOException){return true;}catch(InvalidDataException){return true;}}
    static void Observe(TextPackStore store,Action<string>? action)=>typeof(TextPackStore).GetProperty("RemovalObservationForTesting",System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.NonPublic)!.SetValue(store,action);
    public static void Run(string temp,Action<bool,string> assert)
    {
        TextPackStore Store(string name)=>new(Path.Combine(temp,"causal-"+name),Path.Combine(temp,"causal-"+name+"-state"));
        ReplacementRecoveryRegistry Registry(TextPackStore store)=>new(store.Root,store.StateDirectory);
        string Marker(TextPackStore store)=>Path.Combine(store.StateDirectory,"intent-causal-id.json");
        var before=Pack("first contents");var expected=TextPackStore.Hash(before);
        Guid Pause(TextPackStore store){store.Write("Note.textpack",before);Observe(store,phase=>{if(phase=="beforeDeletionMarker")throw new IOException("paused before marker");});if(!Refuses(()=>store.Delete("Note.textpack",expected)))throw new Exception("Missing pause");Observe(store,null);return Registry(store).Entries().Single().Operation;}
        Guid IndependentPublisher(TextPackStore store,byte[] bytes) {
            // Model a separately completed, fully bound publisher. It preserves
            // exact real snapshots; fixture writes only the publication receipt.
            File.WriteAllBytes(store.Resolve("Note.textpack"),bytes);var operation=Guid.NewGuid();var hash=TextPackStore.Hash(bytes);var registry=Registry(store);
            var stage=Path.Combine(store.Root,".texttext","retained-replacements",TextPackStore.Hash(Encoding.UTF8.GetBytes("Note.textpack")));
            _=RetainedFileRemoval.Capture(store.Resolve("Note.textpack"),hash,stage,operation,phase=>{if(phase=="prepared")registry.Register(operation,"causal-id","Note.textpack",hash,hash,RetainedFileReplacement.OperationDirectory(store.Resolve("Note.textpack"),operation,stage),kind:"removal",userDeletion:true);},Path.Combine(store.StateDirectory,"replacement-capture-leases",operation.ToString("D")+".lock"));
            RetainedFileReplacement.SaveJson(Marker(store),new FileIntent("delete","causal-id","Note.textpack",hash,OperationId:operation.ToString("D")));
            var entry=registry.Entries().Single(item=>item.Operation==operation);RetainedFileReplacement.SaveJson(Path.Combine(store.StateDirectory,"replacement-index",operation.ToString("D")+".json"),entry with{DeletionMarkerPublished=true});return operation;
        }
        foreach(var order in new[]{"absent","restoration-observed","normal-new-delete"}) {
            var store=Store(order);var old=Pause(store);Guid newer=Guid.Empty;byte[]? markerBefore=null;
            if(order=="absent"){newer=IndependentPublisher(store,Pack("newer deletion"));markerBefore=File.ReadAllBytes(Marker(store));}
            else {
                File.WriteAllBytes(store.Resolve("Note.textpack"),before);var entered=false;
                Observe(store,phase=>{if(phase=="restorationObserved"&&!entered){entered=true;if(order=="normal-new-delete"){new TextPackStore(store.Root,store.StateDirectory).Delete("Note.textpack",expected);newer=Guid.Parse(store.Intent("causal-id")!.OperationId!);}else newer=IndependentPublisher(store,before);markerBefore=File.ReadAllBytes(Marker(store));}});
            }
            store.AssertReplacementReadable("causal-id");Observe(store,null);var entry=Registry(store).Entries().Single(item=>item.Operation==old);
            assert(markerBefore is not null&&File.ReadAllBytes(Marker(store)).SequenceEqual(markerBefore)&&Guid.Parse(store.Intent("causal-id")!.OperationId!)==newer,"older marker publication preserves exact newer operation bytes in "+order+" ordering");
            assert(entry.DeletionIntentCancelled==true&&(order=="normal-new-delete"||entry.SupersededBy==newer),"older unissued deletion records exact cancellation or supersession in "+order+" ordering");
            var newest=store.Intent("causal-id")!;store.ClearIntent("causal-id",newest);new TextPackStore(store.Root,store.StateDirectory).AssertReplacementReadable("causal-id");
            assert(store.Intent("causal-id") is null,"consumed newer marker never resurrects the older deletion in "+order+" ordering");
        }
        foreach(var sameBytes in new[]{true,false}) {
            var store=Store("prior-marker-"+sameBytes);store.Write("Note.textpack",before);store.Delete("Note.textpack",expected);var prior=store.Intent("causal-id")!;var restored=sameBytes?before:Pack("restored edited contents");File.WriteAllBytes(store.Resolve("Note.textpack"),restored);var clearedBeforeCapture=false;
            Observe(store,phase=>{if(phase=="prepared")clearedBeforeCapture=store.Intent("causal-id") is null;});store.Delete("Note.textpack",TextPackStore.Hash(restored));Observe(store,null);var current=store.Intent("causal-id")!;
            assert(clearedBeforeCapture&&current.OperationId!=prior.OperationId&&current.Hash==TextPackStore.Hash(restored),"new source-present deletion acknowledges prior bound marker before capture with same-bytes="+sameBytes);
            store.ClearIntent("causal-id",current);new TextPackStore(store.Root,store.StateDirectory).AssertReplacementReadable("causal-id");assert(store.Intent("causal-id") is null,"prior bound marker remains consumed after second deletion acknowledgement same-bytes="+sameBytes);
        }
        foreach(var bad in new[]{"legacy","missing-operation","unknown-field"}) {
            var store=Store("reject-"+bad);var old=Pause(store);var intent=new FileIntent("delete","causal-id","Note.textpack",expected,OperationId:bad=="legacy"?null:Guid.NewGuid().ToString("D"));var fields=JsonSerializer.SerializeToNode(intent)!.AsObject();if(bad=="unknown-field")fields["FutureMeaning"]=true;var bytes=Encoding.UTF8.GetBytes(fields.ToJsonString());RetainedFileReplacement.Create(Marker(store),bytes);
            assert(Refuses(()=>store.AssertReplacementReadable("causal-id"))&&File.ReadAllBytes(Marker(store)).SequenceEqual(bytes)&&Registry(store).Entries().Single(item=>item.Operation==old).SupersededBy is null,"old deletion refuses implicit coalescing of "+bad+" marker");
        }
        {
            var store=Store("legacy-before-capture");store.Write("Note.textpack",before);var legacy=JsonSerializer.SerializeToUtf8Bytes(new FileIntent("delete","causal-id","Note.textpack",expected));RetainedFileReplacement.Create(Marker(store),legacy);
            assert(Refuses(()=>store.Delete("Note.textpack",expected))&&File.ReadAllBytes(store.Resolve("Note.textpack")).SequenceEqual(before)&&File.ReadAllBytes(Marker(store)).SequenceEqual(legacy)&&Registry(store).Entries().Count==0,"unbound prior deletion refuses before any new pathname capture");
        }
    }
}
