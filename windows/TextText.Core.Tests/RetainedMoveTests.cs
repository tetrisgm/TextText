using System.IO.Compression;
using TextText.Core;
static class RetainedMoveTests
{
    static byte[] Pack(string body,string id="move-id"){using var output=new MemoryStream();using(var zip=new ZipArchive(output,ZipArchiveMode.Create,true))using(var writer=new StreamWriter(zip.CreateEntry("text.md").Open()))writer.Write("---\ntextTextId: \""+id+"\"\n---\n"+body);return output.ToArray();}
    static bool Refuses(Action action){try{action();return false;}catch(IOException){return true;}catch(InvalidDataException){return true;}}
    static void Observe(TextPackStore store,Action<string>? action)=>typeof(TextPackStore).GetProperty("MoveObservationForTesting",System.Reflection.BindingFlags.NonPublic|System.Reflection.BindingFlags.Instance)!.SetValue(store,action);
    public static void Run(string temp,Action<bool,string> assert)
    {
        TextPackStore Store(string name)=>new(Path.Combine(temp,"move-"+name),Path.Combine(temp,"move-"+name+"-state"));
        var before=Pack("before");var expected=TextPackStore.Hash(before);var raced=Pack("foreign raced source","foreign-id");
        {
            var store=Store("race");store.Write("From.textpack",before);Observe(store,phase=>{if(phase=="beforeMove")File.WriteAllBytes(store.Resolve("From.textpack"),raced);});
            assert(Refuses(()=>store.Rename("From.textpack","To.textpack",expected)),"move refuses acknowledgment when actual moved source changed at final boundary");Observe(store,null);
            assert(File.ReadAllBytes(store.Resolve("To.textpack")).SequenceEqual(raced),"failed raced move preserves actual foreign bytes visibly at destination without rollback");
            assert(Refuses(()=>store.Read("To.textpack"))&&Refuses(()=>store.Write("From.textpack",Pack("new source","another-id")))&&Refuses(()=>store.AssertReplacementReadable("move-id")),"unresolved move fences expected identity and both original paths including foreign destination");
            if(OperatingSystem.IsWindows())assert(Refuses(()=>store.Read("to.textpack")),"move path fence includes Windows case aliases of a foreign destination");
            store.Write("Other.textpack",Pack("unrelated","unrelated-id"));assert(store.Describe("Other.textpack").ItemId=="unrelated-id","unrelated identity and path remain usable during move conflict");
            var row=store.ReplacementRecoveryList().Single();var current=store.ReplacementRecoveryRead(row.Id,"current");var source=store.ReplacementRecoveryRead(row.Id,"source");
            assert(row.Kind=="move"&&row.Captured&&row.SourcePath=="From.textpack"&&row.SourcePresent==false&&source.Absent&&current.ItemId=="foreign-id"&&current.Data!.SequenceEqual(raced)&&store.ReplacementRecoveryRead(row.Id,"prepared").Data!.SequenceEqual(before),"move recovery exposes actual foreign identity, both path presence and exact immutable baseline");
            var cancelled=false;try{store.ResolveMove(row.Id,row.Path,row.SourcePath!,row.ItemId,row.PreparedHash,row.DisplacedHash,row.Captured,row.CurrentPresent,row.CurrentHash,row.SourcePresent!.Value,row.SourceHash,()=>throw new OperationCanceledException());}catch(OperationCanceledException){cancelled=true;}
            assert(cancelled&&!store.ReplacementRecoveryList().Single().Resolved&&Directory.GetFiles(Path.Combine(store.GetRecoveryDirectory(),"replacement-"+row.Id)).Length==2,"move cancellation after export preserves alternatives without acknowledging");
            store.ResolveMove(row.Id,row.Path,row.SourcePath!,row.ItemId,row.PreparedHash,row.DisplacedHash,row.Captured,row.CurrentPresent,row.CurrentHash,row.SourcePresent!.Value,row.SourceHash);
            assert(store.Read("To.textpack").SequenceEqual(raced)&&store.ReplacementRecoveryList().Single().Resolved&&!File.Exists(store.Resolve("From.textpack")),"explicit move consent preserves actual paths and bytes and leaves readonly recovery available");
        }
        {
            var store=Store("normal");store.Write("From.textpack",before);store.Rename("From.textpack","Folder/To.textpack",expected);
            var next=store.UpdateMarkdown("Folder/To.textpack","---\ntextTextId: \"move-id\"\n---\nlater",expected);
            assert(store.Describe(next.Path).Hash==next.Hash&&!store.ReplacementRecoveryList().Any(),"completed move permits later legitimate destination edits and normal recovery omits automatic move history");
        }
        {
            var store=Store("snapshot-changed");store.Write("From.textpack",before);store.Rename("From.textpack","To.textpack",expected);
            var registry=new ReplacementRecoveryRegistry(store.Root,store.StateDirectory);var entry=registry.Entries().Single();var inspection=registry.Inspect(entry);
            File.WriteAllBytes(inspection.Recovery.Displaced,raced);
            assert(Refuses(()=>store.Read("To.textpack"))&&!store.ReplacementRecoveryList().Single().Resolved,"changed completed move snapshot reopens a visible unresolved recovery row");
        }
        {
            var store=Store("duplicate");store.Write("From.textpack",before);Observe(store,phase=>{if(phase=="beforeMove")File.WriteAllBytes(store.Resolve("From.textpack"),raced);});
            assert(Refuses(()=>store.Rename("From.textpack","To.textpack",expected)),"duplicate move fixture retains final-boundary conflict");Observe(store,null);File.WriteAllBytes(store.Resolve("Elsewhere.textpack"),before);
            var row=store.ReplacementRecoveryList().Single();assert(row.ResolutionBlocked is not null&&store.ReplacementRecoveryRead(row.Id,"prepared").Data!.SequenceEqual(before),"relocated expected identity blocks move consent while retained snapshots stay downloadable");
            assert(Refuses(()=>store.ResolveMove(row.Id,row.Path,row.SourcePath!,row.ItemId,row.PreparedHash,row.DisplacedHash,row.Captured,row.CurrentPresent,row.CurrentHash,row.SourcePresent!.Value,row.SourceHash)),"move consent refuses ambiguous relocated expected identity");
        }
        {
            var store=Store("pending");store.Write("From.textpack",before);Observe(store,phase=>{if(phase=="prepared")throw new IOException("simulated pre-capture interruption");});
            assert(Refuses(()=>store.Rename("From.textpack","To.textpack",expected)),"pending move intent is durable before pathname mutation");Observe(store,null);
            var restarted=new TextPackStore(store.Root,store.StateDirectory);assert(restarted.Read("From.textpack").SequenceEqual(before)&&!File.Exists(store.Resolve("To.textpack")),"restart cancels exact unchanged unperformed move without changing paths");
        }
        {
            var store=Store("moved-before-snapshot");store.Write("From.textpack",before);Observe(store,phase=>{if(phase=="moved")throw new IOException("simulated post-rename interruption");});
            assert(Refuses(()=>store.Rename("From.textpack","To.textpack",expected)),"post-rename crash leaves durable move intent");Observe(store,null);
            var restarted=new TextPackStore(store.Root,store.StateDirectory);assert(restarted.Read("To.textpack").SequenceEqual(before)&&!File.Exists(store.Resolve("From.textpack")),"restart verifies exact moved bytes and completes missing observed snapshot");
        }
        {
            var store=Store("uncaptured-changed");store.Write("From.textpack",before);Observe(store,phase=>{if(phase=="prepared"){File.WriteAllBytes(store.Resolve("From.textpack"),raced);throw new IOException("uncaptured changed source");}});
            assert(Refuses(()=>store.Rename("From.textpack","To.textpack",expected)),"changed uncaptured move remains recoverable");Observe(store,null);
            var row=store.ReplacementRecoveryList().Single();assert(!row.Captured&&row.DisplacedHash is null&&!row.CurrentPresent&&row.SourcePresent==true&&store.ReplacementRecoveryRead(row.Id,"displaced").Absent,"uncaptured move exposes honest absent observed version and exact foreign source");
            store.ResolveMove(row.Id,row.Path,row.SourcePath!,row.ItemId,row.PreparedHash,null,false,false,null,true,row.SourceHash);
            assert(store.Read("From.textpack").SequenceEqual(raced)&&!File.Exists(store.Resolve("To.textpack")),"explicit uncaptured move consent never performs delayed rename");
        }
        {
            var store=Store("unsafe-third-path");store.Write("From.textpack",before);Observe(store,phase=>{if(phase=="beforeMove")File.WriteAllBytes(store.Resolve("From.textpack"),raced);});
            assert(Refuses(()=>store.Rename("From.textpack","To.textpack",expected)),"unsafe-third-path fixture retains move conflict");Observe(store,null);
            var outside=Path.Combine(temp,"move-outside-identity");Directory.CreateDirectory(outside);File.WriteAllBytes(Path.Combine(outside,"Hidden.textpack"),before);
            try {
                Directory.CreateSymbolicLink(store.Resolve("Linked"),outside);var row=store.ReplacementRecoveryList().Single();
                assert(store.ReplacementRecoveryRead(row.Id,"prepared").Data!.SequenceEqual(before),"unsafe third path does not hide retained move downloads");
                assert(Refuses(()=>store.ResolveMove(row.Id,row.Path,row.SourcePath!,row.ItemId,row.PreparedHash,row.DisplacedHash,row.Captured,row.CurrentPresent,row.CurrentHash,row.SourcePresent!.Value,row.SourceHash))&&!store.ReplacementRecoveryList().Single().Resolved,"strict move consent refuses an incomplete third-path identity scan");
            }catch(UnauthorizedAccessException){Console.WriteLine("SKIP third-path symlink creation requires Windows developer mode");}
        }
        {
            var store=Store("malformed-utf8");store.Write("From.textpack",before);byte[] malformed;
            using(var output=new MemoryStream()){using(var zip=new ZipArchive(output,ZipArchiveMode.Create,true))using(var file=zip.CreateEntry("text.md").Open())file.Write(new byte[]{0xff,0x80,0xff});malformed=output.ToArray();}
            Observe(store,phase=>{if(phase=="prepared"){File.WriteAllBytes(store.Resolve("From.textpack"),malformed);throw new IOException("uncaptured malformed source");}});
            assert(Refuses(()=>store.Rename("From.textpack","To.textpack",expected)),"malformed UTF8 source remains in durable uncaptured move");Observe(store,null);
            var row=store.ReplacementRecoveryList().Single();var source=store.ReplacementRecoveryRead(row.Id,"source");
            assert(source.Opaque&&source.Data!.SequenceEqual(malformed)&&source.Hash==TextPackStore.Hash(malformed),"malformed UTF8 move source remains available as exact opaque bytes");
            store.ResolveMove(row.Id,row.Path,row.SourcePath!,row.ItemId,row.PreparedHash,null,false,false,null,true,row.SourceHash);
            assert(File.ReadAllBytes(store.Resolve("From.textpack")).SequenceEqual(malformed)&&store.ReplacementRecoveryList().Single().Resolved,"strict move consent permits exact opaque endpoint bytes without changing paths");
        }
        {
            var store=Store("active");store.Write("From.textpack",before);var refused=false;
            Observe(store,phase=>{if(phase=="prepared")refused=Refuses(()=>new TextPackStore(store.Root,store.StateDirectory).AssertReplacementReadable("move-id"));});
            store.Rename("From.textpack","To.textpack",expected);assert(refused&&store.Read("To.textpack").SequenceEqual(before),"another store cannot cancel an actively leased move before its capture");
        }
    }
}
