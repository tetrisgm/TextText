using System.IO.Compression;
using System.Text;
using System.Text.Json;
using TextText.Core;
static class RetainedRemovalTests
{
    static byte[] Pack(string body,string id="removed-id") {using var output=new MemoryStream();using(var zip=new ZipArchive(output,ZipArchiveMode.Create,true))using(var writer=new StreamWriter(zip.CreateEntry("text.md").Open()))writer.Write("---\ntextTextId: \""+id+"\"\n---\n"+body);return output.ToArray();}
    static void Observe(TextPackStore store,Action<string>? action)=>typeof(TextPackStore).GetProperty("RemovalObservationForTesting",System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.NonPublic)!.SetValue(store,action);
    static bool Refuses(Action action){try{action();return false;}catch(IOException){return true;}catch(InvalidDataException){return true;}}
    public static void Run(string temp,Action<bool,string> assert)
    {
        TextPackStore Store(string name)=>new(Path.Combine(temp,"removal-"+name),Path.Combine(temp,"removal-"+name+"-state"));
        ReplacementRecoveryRegistry Registry(TextPackStore store)=>new(store.Root,store.StateDirectory);
        var before=Pack("before");var expected=TextPackStore.Hash(before);
        {
            var store=Store("parent-swap");store.Write("Folder/Note.textpack",before);
            var parent=Path.Combine(store.Root,"Folder");var parked=parent+"-parked";var outside=Path.Combine(temp,"removal-parent-swap-outside");Directory.CreateDirectory(outside);
            var outsidePath=Path.Combine(outside,"Note.textpack");File.WriteAllBytes(outsidePath,before);
            Observe(store,phase=>{if(phase=="beforeCapture"){Directory.Move(parent,parked);Directory.CreateSymbolicLink(parent,outside);}});
            var refused=Refuses(()=>store.Delete("Folder/Note.textpack",expected));
            assert(refused&&File.Exists(outsidePath)&&File.ReadAllBytes(outsidePath).SequenceEqual(before)&&File.ReadAllBytes(Path.Combine(Directory.Exists(parked)?parked:parent,"Note.textpack")).SequenceEqual(before),"final parent-link substitution refuses removal and preserves both original and outside bytes");
        }
        {
            var store=Store("success");store.Write("Note.textpack",before);store.Delete("Note.textpack",expected);
            var entry=Registry(store).Entries().Single();var inspection=Registry(store).Inspect(entry);var marker=store.Intent("removed-id");
            assert(!File.Exists(store.Resolve("Note.textpack"))&&inspection.Prepared.SequenceEqual(before)&&inspection.Displaced.SequenceEqual(before),"successful removal retains both expected snapshot and actual displaced inode");
            assert(entry.Kind=="removal"&&entry.DeletionMarkerPublished==true&&marker?.OperationId==entry.Operation.ToString("D"),"user removal publishes exactly its operation-bound deletion marker");
            assert(store.ReplacementRecoveryList().Single().Resolved&&store.ReplacementRecoveryRead(entry.Operation.ToString("D"),"prepared").Data!.SequenceEqual(before),"successful user-removal history remains available offline as a readonly completed row");
            assert(Directory.GetFiles(store.GetRecoveryDirectory(),"trash-*.textpack").Length==1,"successful removal exports immutable exact bytes into global offline Trash recovery");
            store.ClearIntent("removed-id",marker!);new TextPackStore(store.Root,store.StateDirectory).AssertReplacementReadable("removed-id");
            assert(store.Intent("removed-id") is null,"consumed deletion marker is not reconstructed after restart");
        }
        {
            var store=Store("remote");store.Write("Note.textpack",before);store.RemoveRetaining("Note.textpack",expected);
            assert(store.Intent("removed-id") is null&&Registry(store).Entries().Single().UserDeletion!=true,"remote removal retains inode without manufacturing a user deletion intent");
        }
        foreach(var kind in new[]{"same-id","other-id","opaque"}) {
            var store=Store("race-"+kind);store.Write("Note.textpack",before);
            var actual=kind=="opaque"?Encoding.UTF8.GetBytes("external non archive bytes"):Pack("raced bytes",kind=="other-id"?"other-id":"removed-id");
            Observe(store,phase=>{if(phase=="beforeCapture")File.WriteAllBytes(store.Resolve("Note.textpack"),actual);});
            assert(Refuses(()=>store.Delete("Note.textpack",expected)),"removal final capture fences actual raced "+kind+" inode");
            Observe(store,null);
            var entry=Registry(store).Entries().Single();var inspection=Registry(store).Inspect(entry);
            assert(!File.Exists(store.Resolve("Note.textpack"))&&inspection.Displaced.SequenceEqual(actual)&&inspection.Prepared.SequenceEqual(before)&&store.Intent("removed-id") is null,"raced removal never unlinks or acknowledges displaced "+kind+" bytes");
            var row=store.ReplacementRecoveryList().Single();var absent=store.ReplacementRecoveryRead(row.Id,"current");var displaced=store.ReplacementRecoveryRead(row.Id,"displaced");
            assert(row.Kind=="removal"&&!row.CurrentPresent&&row.CurrentHash is null&&absent.Absent&&absent.Hash is null&&absent.Data is null&&displaced.Data!.SequenceEqual(actual),"removal recovery exposes exact absence and retained "+kind+" bytes");
            if(kind=="opaque")assert(displaced.Opaque,"opaque displaced removal bytes remain downloadable");
            assert(Refuses(()=>store.ResolveReplacement(row.Id,row.Path,row.ItemId,null,row.PreparedHash,row.DisplacedHash,currentPresent:false,kind:"replacement")),"removal consent binds captured operation kind "+kind);
            store.ResolveReplacement(row.Id,row.Path,row.ItemId,null,row.PreparedHash,row.DisplacedHash,currentPresent:false,kind:"removal");
            assert(store.Intent("removed-id")?.Hash==expected&&store.ReplacementRecoveryList().Single().Resolved,"explicit keep-absence preserves alternatives before issuing deletion "+kind);
            var prepared=store.ReplacementRecoveryRead(row.Id,"prepared");assert(prepared.Data!.SequenceEqual(before),"resolved removal alternatives stay available "+kind);
        }
        foreach(var stop in new[]{"prepared","captured","beforeDeletionMarker"}) {
            var store=Store("crash-"+stop);store.Write("Note.textpack",before);Observe(store,phase=>{if(phase==stop)throw new IOException("simulated stop");});
            assert(Refuses(()=>store.Delete("Note.textpack",expected)),"removal interruption preserves durable state at "+stop);
            var reopened=new TextPackStore(store.Root,store.StateDirectory);reopened.AssertReplacementReadable("removed-id");var entry=Registry(reopened).Entries().Single();
            if(stop=="prepared")assert(File.ReadAllBytes(store.Resolve("Note.textpack")).SequenceEqual(before)&&entry.DeletionIntentCancelled==true&&reopened.Intent("removed-id") is null,"uncaptured unchanged removal cancels without deleting or issuing intent");
            else assert(reopened.Intent("removed-id")?.OperationId==entry.Operation.ToString("D")&&entry.DeletionMarkerPublished==true,"captured removal reconstructs one-time marker after "+stop+" interruption");
        }
        {
            var store=Store("marker-consumption-gap");store.Write("Note.textpack",before);Observe(store,phase=>{if(phase=="markerWritten")throw new IOException("crash before publication flag");});
            assert(Refuses(()=>store.Delete("Note.textpack",expected)),"crash between marker and publication flag retains operation binding");
            var registry=Registry(store);var entry=registry.Entries().Single();var marker=store.Intent("removed-id");
            assert(marker?.OperationId==entry.Operation.ToString("D")&&entry.DeletionMarkerPublished!=true,"publication crash fixture leaves exact bound marker before flag");
            var acknowledgement=new TextPackStore(store.Root,store.StateDirectory);acknowledgement.ClearIntent("removed-id",marker!);
            new TextPackStore(store.Root,store.StateDirectory).AssertReplacementReadable("removed-id");
            assert(store.Intent("removed-id") is null&&registry.Entries().Single().DeletionMarkerPublished==true,"independent acknowledgement records exact publication before consuming marker across restart");
        }
        {
            var store=Store("restore-second-delete");store.Write("Note.textpack",before);Observe(store,phase=>{if(phase=="beforeDeletionMarker")throw new IOException("crash");});
            _=Refuses(()=>store.Delete("Note.textpack",expected));Observe(store,null);var restored=Pack("new restored content");File.WriteAllBytes(store.Resolve("Note.textpack"),restored);
            _=store.Read("Note.textpack");assert(Registry(store).Entries().Single().DeletionIntentCancelled==true&&store.Intent("removed-id") is null,"restored file cancels stale unissued deletion intent");
            var freshHash=TextPackStore.Hash(restored);store.Delete("Note.textpack",freshHash);new TextPackStore(store.Root,store.StateDirectory).AssertReplacementReadable("removed-id");
            assert(store.Intent("removed-id")?.Hash==freshHash,"second deletion after restore keeps fresh hash instead of recreating older intent");
        }
        foreach(var shape in new[]{"unique","duplicate","changed","foreign-original"}) {
            var store=Store("uncaptured-rename-"+shape);store.Write("Note.textpack",before);Observe(store,phase=>{if(phase=="prepared"){File.Move(store.Resolve("Note.textpack"),store.Resolve("Renamed.textpack"));throw new IOException("interrupted uncaptured rename");}});
            _=Refuses(()=>store.Delete("Note.textpack",expected));Observe(store,null);
            if(shape=="duplicate")File.WriteAllBytes(store.Resolve("Duplicate.textpack"),before);
            if(shape=="changed")File.WriteAllBytes(store.Resolve("Renamed.textpack"),Pack("changed relocated bytes"));
            if(shape=="foreign-original")File.WriteAllBytes(store.Resolve("Note.textpack"),Pack("foreign original","foreign-id"));
            if(shape=="unique") {
                assert(store.Read("Renamed.textpack").SequenceEqual(before)&&store.Intent("removed-id") is null&&Registry(store).Entries().Single().DeletionIntentCancelled==true,"unique exact uncaptured rename cancels removal without retargeting or changing bytes");
            } else assert(Refuses(()=>store.Read("Renamed.textpack")),"ambiguous uncaptured removal refuses "+shape+" without retargeting");
        }
        {
            var store=Store("readonly-foreign-current");store.Write("Note.textpack",before);Observe(store,phase=>{if(phase=="captured")throw new IOException("crash");});_ = Refuses(()=>store.Delete("Note.textpack",expected));Observe(store,null);
            var entry=Registry(store).Entries().Single();var journal=Path.Combine(store.StateDirectory,"replacement-index",entry.Operation.ToString("D")+".json");var journalBefore=File.ReadAllBytes(journal);var actual=Encoding.UTF8.GetBytes("foreign malformed recreated current");File.WriteAllBytes(store.Resolve("Note.textpack"),actual);
            var row=store.ReplacementRecoveryList().Single();var current=store.ReplacementRecoveryRead(row.Id,"current");
            assert(current.Opaque&&current.Data!.SequenceEqual(actual)&&row.CurrentPresent&&row.CurrentHash==TextPackStore.Hash(actual),"removal recovery observes exact recreated malformed original pathname");
            assert(File.ReadAllBytes(journal).SequenceEqual(journalBefore)&&store.Intent("removed-id") is null&&!Directory.Exists(Path.Combine(store.StateDirectory,"recovery","replacement-"+row.Id)),"removal list and download do not publish classification, exports, or deletion intent");
            store.ResolveReplacement(row.Id,row.Path,row.ItemId,row.CurrentHash,row.PreparedHash,row.DisplacedHash,currentPresent:true,kind:"removal");
            assert(File.ReadAllBytes(store.Resolve("Note.textpack")).SequenceEqual(actual)&&store.Intent("removed-id") is null,"explicit keep-present removal never overwrites recreated current or issues deletion");
        }
        {
            var store=Store("active-capture");store.Write("Note.textpack",before);var blocked=false;var cancelBlocked=false;
            Observe(store,phase=>{if(phase=="prepared"){var second=new TextPackStore(store.Root,store.StateDirectory);blocked=Refuses(()=>second.AssertReplacementReadable("removed-id"));var active=Registry(second).Entries().Single();cancelBlocked=Refuses(()=>second.CancelUncapturedDeletion(active.Operation.ToString("D"),active.Path,active.ItemId,expected,true,expected));}});
            store.Delete("Note.textpack",expected);Observe(store,null);
            assert(blocked&&cancelBlocked&&store.Intent("removed-id")?.Hash==expected,"second store cannot cancel an active capture while operation lease is held");
            assert(Directory.GetFiles(Path.Combine(store.StateDirectory,"replacement-capture-leases"),"*.lock").Length==1&&!Directory.GetFiles(store.Root,"*.lock",SearchOption.AllDirectories).Any(),"production capture leases remain device-private and retain no synced lock file");
        }
        {
            var store=Store("restore-expected-pending");store.Write("Note.textpack",before);Observe(store,phase=>{if(phase=="prepared")throw new IOException("stop before capture");});_ = Refuses(()=>store.Delete("Note.textpack",expected));Observe(store,null);
            File.WriteAllBytes(store.Resolve("Note.textpack"),Pack("changed before capture"));assert(Refuses(()=>store.Read("Note.textpack")),"uncaptured changed original remains refused");
            var entry=Registry(store).Entries().Single();var directory=RetainedFileReplacement.OperationDirectory(store.Resolve("Note.textpack"),entry.Operation,Path.Combine(store.Root,".texttext","retained-replacements",TextPackStore.Hash(Encoding.UTF8.GetBytes("Note.textpack"))));
            assert(RetainedFileReplacement.InspectDirectory(directory,"Note.textpack",entry.Operation).Record.State=="pending","uncaptured ambiguous operation remains pending for safe forward recovery");
            File.WriteAllBytes(store.Resolve("Note.textpack"),before);assert(store.Read("Note.textpack").SequenceEqual(before)&&store.Intent("removed-id") is null,"restoring exact expected uncaptured original cancels without deleting");
        }
        foreach(var shape in new[]{"present","absent","opaque","cancelled-ack","receipt-crash"}) {
            var store=Store("explicit-uncaptured-"+shape);store.Write("Note.textpack",before);Observe(store,phase=>{if(phase=="prepared")throw new IOException("uncaptured interruption");});_ = Refuses(()=>store.Delete("Note.textpack",expected));Observe(store,null);
            if(shape=="absent")File.Move(store.Resolve("Note.textpack"),Path.Combine(temp,"explicit-uncaptured-absent-outside.textpack"));
            else if(shape=="opaque")File.WriteAllBytes(store.Resolve("Note.textpack"),Encoding.UTF8.GetBytes("recreated opaque current"));
            else File.WriteAllBytes(store.Resolve("Note.textpack"),Pack("changed current for explicit cancellation"));
            var row=store.ReplacementRecoveryList().Single();var current=store.ReplacementRecoveryRead(row.Id,"current");var prepared=store.ReplacementRecoveryRead(row.Id,"prepared");var missing=store.ReplacementRecoveryRead(row.Id,"displaced");
            assert(!row.Captured&&row.DisplacedHash is null&&missing.Absent&&missing.Hash is null&&missing.Data is null&&prepared.Data!.SequenceEqual(before),"uncaptured recovery exposes baseline and honest absent displaced snapshot "+shape);
            if(shape=="cancelled-ack") {
                try{store.CancelUncapturedDeletion(row.Id,row.Path,row.ItemId,row.PreparedHash,row.CurrentPresent,row.CurrentHash,()=>throw new OperationCanceledException());throw new Exception("missing cancellation");}catch(OperationCanceledException){}
                assert(Registry(store).Entries().Single().UncapturedCancellation is null&&Directory.GetFiles(Path.Combine(store.StateDirectory,"recovery","uncaptured-"+row.Id)).Length>0,"cancelled uncaptured acknowledgement retains exports without recording consent");
            }
            if(shape=="receipt-crash")Observe(store,phase=>{if(phase=="uncapturedCancellationPreserved")throw new IOException("crash after explicit receipt");});
            if(shape=="receipt-crash")assert(Refuses(()=>store.CancelUncapturedDeletion(row.Id,row.Path,row.ItemId,row.PreparedHash,row.CurrentPresent,row.CurrentHash)),"explicit uncaptured receipt survives interruption before helper cancellation");
            else store.CancelUncapturedDeletion(row.Id,row.Path,row.ItemId,row.PreparedHash,row.CurrentPresent,row.CurrentHash);
            Observe(store,null);var restarted=new TextPackStore(store.Root,store.StateDirectory);restarted.AssertReplacementReadable("removed-id");
            assert(restarted.Intent("removed-id") is null&&restarted.ReplacementRecoveryList().Single().Resolved&&!restarted.ReplacementRecoveryList().Single().Captured,"explicit uncaptured cancellation remains inspectable and never emits deletion "+shape);
            var after=restarted.ReplacementRecoveryRead(row.Id,"current");assert(after.Absent==current.Absent&&(after.Data is null?current.Data is null:after.Data.SequenceEqual(current.Data!)),"explicit uncaptured cancellation never changes original current presence or bytes "+shape);
        }
        {
            var store=Store("uncaptured-relocated-readonly");store.Write("Note.textpack",before);Observe(store,phase=>{if(phase=="prepared")throw new IOException("stop");});_=Refuses(()=>store.Delete("Note.textpack",expected));Observe(store,null);
            File.Move(store.Resolve("Note.textpack"),store.Resolve("Other.textpack"));File.WriteAllBytes(store.Resolve("Note.textpack"),Pack("foreign current","foreign-current"));
            var row=store.ReplacementRecoveryList().Single();assert(row.ResolutionBlocked is not null&&store.ReplacementRecoveryRead(row.Id,"prepared").Data!.SequenceEqual(before),"relocated identity does not hide unrelated recovery inspection or baseline download");
            assert(Refuses(()=>store.CancelUncapturedDeletion(row.Id,row.Path,row.ItemId,row.PreparedHash,row.CurrentPresent,row.CurrentHash)),"strict uncaptured cancellation refuses relocated identity ambiguity");
        }
        if(OperatingSystem.IsWindows()) {
            var store=Store("native-open-descriptor");store.Write("Note.textpack",before);FileStream? writer=null;
            Observe(store,phase=>{if(phase=="beforeCapture")writer=new FileStream(store.Resolve("Note.textpack"),FileMode.Open,FileAccess.ReadWrite,FileShare.ReadWrite|FileShare.Delete);});
            assert(Refuses(()=>store.Delete("Note.textpack",expected)),"actual Windows retained removal refuses completion while displaced writer remains open");
            var later=Pack("late native displaced descriptor edit");if(writer is null)throw new Exception("Missing retained descriptor.");writer.Position=0;writer.Write(later);writer.SetLength(later.Length);writer.Flush(true);writer.Dispose();Observe(store,null);
            var entry=Registry(store).Entries().Single();assert(Registry(store).Inspect(entry).Displaced.SequenceEqual(later)&&!File.Exists(store.Resolve("Note.textpack")),"actual old Windows removal descriptor edits remain retained after pathname capture");
            var row=store.ReplacementRecoveryList().Single();store.ResolveReplacement(row.Id,row.Path,row.ItemId,null,row.PreparedHash,row.DisplacedHash!,currentPresent:false,kind:"removal");
            assert(store.Intent("removed-id")?.Hash==expected,"explicit actual Windows removal recovery retains late writer bytes before deletion intent");
        }
    }
}
