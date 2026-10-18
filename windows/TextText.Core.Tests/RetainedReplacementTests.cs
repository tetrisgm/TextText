using System.IO.Compression;
using System.Text.Json;
using System.Text.Json.Nodes;
using TextText.Core;

static class RetainedReplacementTests
{
    static byte[] Pack(string text,string id="retained-id")
    {
        using var output = new MemoryStream();
        using (var zip = new ZipArchive(output, ZipArchiveMode.Create, true))
        using (var writer = new StreamWriter(zip.CreateEntry("text.md").Open())) writer.Write("---\ntextTextId: \""+id+"\"\n---\n" + text);
        return output.ToArray();
    }
    static bool Refuses(Action action) { try { action(); return false; } catch (IOException) { return true; } catch (InvalidDataException) { return true; } }
    public static void Run(string temp, Action<bool, string> assert)
    {
        byte[] before = Pack("before"), prepared = Pack("accepted candidate"), external = Pack("external displaced bytes");
        {
            var root=Path.Combine(temp,"registry-index-scale");var state=Path.Combine(temp,"registry-index-scale-state");Directory.CreateDirectory(root);
            var registry=new ReplacementRecoveryRegistry(root,state);var directory=Path.Combine(state,"replacement-index");Directory.CreateDirectory(directory);
            var hash=TextPackStore.Hash(before);var rootHash=TextPackStore.Hash(System.Text.Encoding.UTF8.GetBytes(root));
            ReplacementRecoveryRegistry.Entry? selected=null;string? selectedPath=null;
            for(var number=0;number<4100;number++) {
                var entry=new ReplacementRecoveryRegistry.Entry(1,Guid.NewGuid(),rootHash,null,"indexed-"+number,"Note.textpack",hash,hash);
                var path=Path.Combine(directory,entry.Operation.ToString("D")+".json");File.WriteAllBytes(path,JsonSerializer.SerializeToUtf8Bytes(entry));
                if(number==4099){selected=entry;selectedPath=path;}
            }
            assert(registry.Entries().Count==4100,"retained registry has no lifetime record-count refusal");
            assert(registry.Entries("indexed-4099").Count==1&&registry.Entries("absent").Count==0,"per-item registry index selects only the requested stable identity");
            File.WriteAllBytes(selectedPath!,JsonSerializer.SerializeToUtf8Bytes(selected! with{Version=2}));
            assert(Refuses(()=>registry.Entries("indexed-4099")),"warm index revalidates selected record after in-place future-schema edit");
            File.WriteAllBytes(selectedPath!,JsonSerializer.SerializeToUtf8Bytes(selected));
            var added=selected! with{Operation=Guid.NewGuid(),ItemId="new-identity"};
            RetainedFileReplacement.SaveJson(Path.Combine(directory,added.Operation.ToString("D")+".json"),added,creating:true);
            assert(new ReplacementRecoveryRegistry(root,state).Entries("new-identity").Count==1,"atomic private publication invalidates identity membership across registry instances");
            RetainedFileReplacement.Create(Path.Combine(directory,Guid.NewGuid().ToString("D")+".json"),System.Text.Encoding.UTF8.GetBytes("{}"));
            assert(Refuses(()=>registry.Entries("absent")),"unidentified newly published registry record blocks unrelated reads");
        }

        {
            var root=Path.Combine(temp,"registry-operation-alias");var state=Path.Combine(temp,"registry-operation-alias-state");Directory.CreateDirectory(root);
            var registry=new ReplacementRecoveryRegistry(root,state);var operation=Guid.NewGuid();var target=Path.Combine(root,"Note.textpack");
            var stage=Path.Combine(root,".texttext","retained-replacements",TextPackStore.Hash(System.Text.Encoding.UTF8.GetBytes("Note.textpack")));
            var recovery=RetainedFileReplacement.OperationDirectory(target,operation,stage);
            registry.Register(operation,"retained-id","Note.textpack",TextPackStore.Hash(before),TextPackStore.Hash(prepared),recovery);
            var first=registry.Entries().Single();var alias=first with{Operation=Guid.NewGuid()};var indexDirectory=Path.Combine(state,"replacement-index");
            RetainedFileReplacement.SaveJson(Path.Combine(indexDirectory,alias.Operation.ToString("D")+".json"),alias,creating:true);
            var names=Directory.GetFileSystemEntries(indexDirectory);var leading=JsonSerializer.Deserialize<ReplacementRecoveryRegistry.Entry>(File.ReadAllBytes(names[0]))!;
            var shared=Path.GetRelativePath(root,RetainedFileReplacement.OperationDirectory(target,leading.Operation,stage)).Replace('\\','/');
            foreach(var name in names){var entry=JsonSerializer.Deserialize<ReplacementRecoveryRegistry.Entry>(File.ReadAllBytes(name))!;File.WriteAllBytes(name,JsonSerializer.SerializeToUtf8Bytes(entry with{RecoveryPath=shared}));}
            assert(Refuses(()=>registry.Entries()),"a second operation cannot reuse another registry operation's recovery path");
        }
        foreach (var shape in new[] { "before-primitive", "complete", "unexpected-displaced", "missing-target", "missing-backup", "corrupt-prepared", "future-manifest" }) {
            var root = Path.Combine(temp, "replacement-" + shape); Directory.CreateDirectory(root);
            var state = Path.Combine(temp, "replacement-state-" + shape); Directory.CreateDirectory(state);
            var target = Path.Combine(root, "Note.textpack"); File.WriteAllBytes(target, prepared);
            var operation = Guid.NewGuid(); var registry = new ReplacementRecoveryRegistry(root, state);
            registry.Register(operation, "retained-id", "Note.textpack", TextPackStore.Hash(before), TextPackStore.Hash(prepared));
            var directory = RetainedFileReplacement.OperationDirectory(target, operation); Directory.CreateDirectory(directory);
            RetainedFileReplacement.Create(Path.Combine(directory, "prepared"), shape == "corrupt-prepared" ? external : prepared);
            RetainedFileReplacement.Create(Path.Combine(directory, "replacement"), prepared);
            if (shape is not ("before-primitive" or "missing-backup")) RetainedFileReplacement.Create(Path.Combine(directory, "displaced"), shape == "unexpected-displaced" ? external : before);
            RetainedFileReplacement.SaveJson(Path.Combine(directory, "manifest.json"),
                new RetainedFileReplacement.Manifest(shape == "future-manifest" ? 2 : 1, operation, "Note.textpack", TextPackStore.Hash(before), TextPackStore.Hash(prepared), "pending"), creating: true);
            if (shape == "missing-target") File.Delete(target);
            if (shape == "complete") {
                registry.AssertReadable("retained-id");
                var manifestPath=Path.Combine(directory,"manifest.json");var knownManifest=File.ReadAllBytes(manifestPath);
                var future=JsonSerializer.Deserialize<RetainedFileReplacement.Manifest>(knownManifest)! with{Version=2};
                File.WriteAllBytes(manifestPath,JsonSerializer.SerializeToUtf8Bytes(future));
                assert(Refuses(()=>registry.AssertReadable("retained-id")),"warm manifest cache refuses an in-place future-version replacement");
                File.WriteAllBytes(manifestPath,knownManifest);
                assert(RetainedFileReplacement.Inspect(target, operation).Record.State == "completed", "retained replacement reconstructs completion only with exact target and backup");
                File.WriteAllBytes(target, external); registry.AssertReadable("retained-id");
                assert(File.ReadAllBytes(target).SequenceEqual(external), "later legitimate save does not invalidate completed retained replacement");
                File.WriteAllBytes(Path.Combine(directory, "displaced"), external);
                assert(Refuses(() => registry.AssertReadable("retained-id")), "late displaced inode write reopens completed recovery fence");
            } else assert(Refuses(() => registry.AssertReadable("retained-id")), "partial retained replacement refuses " + shape);
            assert(File.ReadAllBytes(Path.Combine(directory, "replacement")).SequenceEqual(prepared), "partial classification never consumes replacement candidate " + shape);
        }
        foreach(var displacedKind in new[]{"same-id","other-id","opaque"}) {
            byte[] displaced=displacedKind=="opaque"?[1,2,3]:displacedKind=="other-id"?Pack("other external document","other-id"):external;
            var root = Path.Combine(temp, "replacement-resolve-"+displacedKind); Directory.CreateDirectory(root);
            var state = Path.Combine(temp, "replacement-resolve-state-"+displacedKind); Directory.CreateDirectory(state);
            var target = Path.Combine(root, "Original.textpack"); var operation = Guid.NewGuid();
            var registry = new ReplacementRecoveryRegistry(root, state);
            registry.Register(operation, "retained-id", "Original.textpack", TextPackStore.Hash(before), TextPackStore.Hash(prepared));
            var directory = RetainedFileReplacement.OperationDirectory(target, operation); Directory.CreateDirectory(directory);
            RetainedFileReplacement.Create(Path.Combine(directory, "prepared"), prepared);
            RetainedFileReplacement.Create(Path.Combine(directory, "displaced"), displaced);
            RetainedFileReplacement.SaveJson(Path.Combine(directory, "manifest.json"),
                new RetainedFileReplacement.Manifest(1, operation, "Original.textpack", TextPackStore.Hash(before), TextPackStore.Hash(prepared), "conflict"), creating: true);
            var renamed = Path.Combine(root, "Renamed.textpack"); File.WriteAllBytes(renamed, prepared);
            assert(Refuses(() => registry.AssertReadable("retained-id")) && Refuses(() => registry.AssertReadable(null)), "identity and unidentified reads remain fenced after raw rename");
            var observed = new ReplacementRecoveryRegistry.Resolution(TextPackStore.Hash(prepared), TextPackStore.Hash(prepared), TextPackStore.Hash(displaced));
            assert(Refuses(() => registry.ResolveKeepCurrent(operation, "retained-id", "Renamed.textpack", observed with { CurrentHash = TextPackStore.Hash(before) })), "stale recovery inspection cannot resolve");
            var inspectionStore=new TextPackStore(root,state);
            assert(!inspectionStore.ReplacementRecoveryList().Single().Resolved&&!Directory.Exists(Path.Combine(state,"recovery","replacement-"+operation.ToString("D"))),"replacement inspection lists retained bytes without creating exports or requiring extra recovery space");
            var retained=inspectionStore.ReplacementRecoveryRead(operation.ToString("D"),"displaced");
            assert(retained.Data.SequenceEqual(displaced)&&retained.Opaque==(displacedKind=="opaque"),"displaced "+displacedKind+" recovery exposes exact bytes without inventing document identity");
            var cancelled=false;
            try{registry.ResolveKeepCurrent(operation,"retained-id","Renamed.textpack",observed,()=>throw new OperationCanceledException("cancelled after export"));}
            catch(OperationCanceledException){cancelled=true;}
            assert(cancelled&&registry.Entries().Single().Resolution is null&&Directory.GetFiles(Path.Combine(state,"recovery","replacement-"+operation.ToString("D"))).Length==2,"cancellation after exporting alternatives preserves retained bytes and leaves consent unresolved");
            registry.ResolveKeepCurrent(operation, "retained-id", "Renamed.textpack", observed);
            registry.AssertReadable("retained-id");
            assert(inspectionStore.ReplacementRecoveryList().Single().Resolved,"explicitly resolved recovery remains discoverable for downloads");
            assert(File.ReadAllBytes(renamed).SequenceEqual(prepared) && Directory.GetFiles(Path.Combine(state, "recovery", "replacement-" + operation.ToString("D"))).Length == 2,
                "explicit keep-current retains both exact alternatives without replacing visible bytes");
            var store=new TextPackStore(root,state);
            var next=store.Write("Renamed.textpack",before,TextPackStore.Hash(prepared));
            assert(next.Hash==TextPackStore.Hash(before),"resolved replacement permits the next normal save at a raw-renamed path");
            var unrelatedBytes=Pack("other item","unrelated-id");
            var unrelated=store.Write("Unrelated.textpack",unrelatedBytes);
            File.WriteAllBytes(Path.Combine(directory, "displaced"), before);
            assert(Refuses(() => registry.AssertReadable("retained-id")), "late displaced writer reopens explicit acknowledgment");
            assert(store.ReplacementRecoveryList().Count==1&&!store.ReplacementRecoveryList().Single().Resolved,"late displaced edits reopen only their explicit recovery row");
            assert(store.Read(unrelated.Path).SequenceEqual(unrelatedBytes),"a fenced item leaves unrelated local documents readable");
            assert(store.Write(unrelated.Path,Pack("unrelated next save","unrelated-id"),unrelated.Hash).ItemId=="unrelated-id","a fenced item leaves unrelated local documents writable");
            var otherRoot = Path.Combine(temp, "copied-replacement-root"); Directory.CreateDirectory(otherRoot);
            assert(Refuses(() => new ReplacementRecoveryRegistry(otherRoot, state).Entries()), "copied registry cannot resolve in a different workspace root");
            File.WriteAllText(Path.Combine(state, AccountRootOwnership.FileName), JsonSerializer.Serialize(new AccountRootOwnership.Owner(1, "https://texttext.app", "workspace", "other-account", TextPackStore.Hash(System.Text.Encoding.UTF8.GetBytes(root)))));
            assert(Refuses(() => registry.Entries()), "replacement registry cannot be adopted implicitly by a newly bound account");
        }
        foreach(var rename in new[]{"file","folder"}) {
            var root=Path.Combine(temp,"replacement-completed-move-"+rename);Directory.CreateDirectory(Path.Combine(root,"Folder"));
            var state=Path.Combine(temp,"replacement-completed-move-state-"+rename);Directory.CreateDirectory(state);
            var target=Path.Combine(root,"Folder","Original.textpack");File.WriteAllBytes(target,prepared);
            var registry=new ReplacementRecoveryRegistry(root,state);var operation=Guid.NewGuid();
            registry.Register(operation,"retained-id","Folder/Original.textpack",TextPackStore.Hash(before),TextPackStore.Hash(prepared));
            var directory=RetainedFileReplacement.OperationDirectory(target,operation);Directory.CreateDirectory(directory);
            RetainedFileReplacement.Create(Path.Combine(directory,"prepared"),prepared);RetainedFileReplacement.Create(Path.Combine(directory,"displaced"),before);
            RetainedFileReplacement.SaveJson(Path.Combine(directory,"manifest.json"),new RetainedFileReplacement.Manifest(1,operation,"Original.textpack",TextPackStore.Hash(before),TextPackStore.Hash(prepared),"pending"),creating:true);
            registry.AssertReadable("retained-id");
            string moved;
            if(rename=="folder"){Directory.Move(Path.Combine(root,"Folder"),Path.Combine(root,"Moved"));moved="Moved/Original.textpack";}
            else{File.Move(target,Path.Combine(root,"Folder","Renamed.textpack"));moved="Folder/Renamed.textpack";}
            var store=new TextPackStore(root,state);assert(store.Read(moved).SequenceEqual(prepared),"completed replacement follows a raw "+rename+" move");
            assert(store.Write(moved,external,TextPackStore.Hash(prepared)).Hash==TextPackStore.Hash(external),"completed replacement permits save after raw "+rename+" move");
        }
        foreach(var interruption in new[]{"none","ownerPreserved","profilePrepared","ownerStaged","ownerPublished","beforeOwnerPublication"}) {
            var root=Path.Combine(temp,"replacement-profile-"+interruption);var store=new TextPackStore(root,Path.Combine(temp,"replacement-profile-state-"+interruption));
            AccountRootOwnership.Open(store,new Uri("https://texttext.app"),"workspace","account-a");
            var marker=Path.Combine(store.StateDirectory,AccountRootOwnership.FileName);var original=File.ReadAllBytes(marker);
            var visible=store.Write("Visible.textpack",prepared);
            var changed=original;
            if(interruption=="beforeOwnerPublication") {
                var owner=JsonSerializer.Deserialize<AccountRootOwnership.Owner>(original)!;
                changed=JsonSerializer.SerializeToUtf8Bytes(owner with{AccountId="account-b"});
                assert(Refuses(()=>RetainedReplacementProfile.Prepare(store,point=>{if(point==interruption)File.WriteAllBytes(marker,changed);})),"owner publication retains an actual final-check principal race");
                assert(File.ReadAllBytes(Path.Combine(store.StateDirectory,"retained-replacement-profile","owner-displaced.json")).SequenceEqual(changed),"owner publication preserves actual changed principal bytes");
                assert(Refuses(()=>AccountRootOwnership.Open(store,new Uri("https://texttext.app"),"workspace","account-a")),"unattested raced owner cannot reopen as the earlier principal");
                assert(Refuses(()=>store.Read(visible.Path))&&Refuses(()=>store.ValidateReplacementRegistry()),"already-open reads and sync scope refuse a raced owner profile before the first replacement index exists");
                continue;
            }
            try{RetainedReplacementProfile.Prepare(store,point=>{if(point==interruption)throw new IOException("process interruption");});}catch(IOException)when(interruption!="none"){}
            RetainedReplacementProfile.Prepare(store);AccountRootOwnership.Open(store,new Uri("https://texttext.app"),"workspace","account-a");
            var current=JsonSerializer.Deserialize<AccountRootOwnership.Owner>(File.ReadAllBytes(marker))!;
            assert(current.Version==2 && File.ReadAllBytes(Path.Combine(store.StateDirectory,"retained-replacement-profile","owner-v1.json")).SequenceEqual(original),"owned replacement profile resumes "+interruption+" without losing original owner");
            assert(current.Version!=1,"known prior owner-version-one factory refuses retained replacement profile "+interruption);
        }
        foreach(var publication in new[]{"ownerPreserved","futurePublished"}) {
            var root=Path.Combine(temp,"replacement-owner-one-"+publication);var store=new TextPackStore(root,Path.Combine(temp,"replacement-owner-one-state-"+publication));
            var origin=new Uri("https://texttext.app");AccountRootOwnership.Open(store,origin,"workspace","account-a");
            var file=store.Write("Note.textpack",prepared);var owner=Path.Combine(store.StateDirectory,AccountRootOwnership.FileName);var original=File.ReadAllBytes(owner);
            try{RetainedReplacementProfile.Prepare(store,phase=>{if(phase==(publication=="ownerPreserved"?"ownerPreserved":"profilePrepared"))throw new IOException("interrupted publication");});}catch(IOException){}
            if(publication=="ownerPreserved") {
                AccountRootOwnership.Open(store,origin,"workspace","account-a");
                assert(store.Read(file.Path).SequenceEqual(prepared)&&File.ReadAllBytes(owner).SequenceEqual(original),"owner-preserved-only profile directory permits verified opening and forward migration");
                RetainedReplacementProfile.Prepare(store);
            } else {
                var profile=Path.Combine(store.StateDirectory,"retained-replacement-profile","profile.json");var value=JsonNode.Parse(File.ReadAllBytes(profile))!;value["Version"]=2;File.WriteAllText(profile,value.ToJsonString());var future=File.ReadAllBytes(profile);
                assert(Refuses(()=>store.Read(file.Path))&&Refuses(()=>AccountRootOwnership.Open(store,origin,"workspace","account-a")),"published future profile fences both already-open reads and fresh owner-version-one factories without an index");
                assert(File.ReadAllBytes(owner).SequenceEqual(original)&&File.ReadAllBytes(profile).SequenceEqual(future),"future profile refusal preserves exact ownership and marker bytes");
            }
        }
        if (OperatingSystem.IsWindows()) foreach (var race in new[] { false, true }) {
            var root = Path.Combine(temp, "replacement-actual-" + race); Directory.CreateDirectory(root);
            var target = Path.Combine(root, "Actual.textpack"); File.WriteAllBytes(target, before);
            var operation = Guid.NewGuid();
            if (race) {
                assert(Refuses(() => RetainedFileReplacement.Replace(target, TextPackStore.Hash(before), prepared, operation,
                    point => { if (point == "beforeReplace") File.WriteAllBytes(target, external); })), "actual Windows replacement retains a final-check race as conflict");
                var recovery = RetainedFileReplacement.Inspect(target, operation);
                assert(File.ReadAllBytes(recovery.Displaced).SequenceEqual(external) && File.ReadAllBytes(recovery.Prepared).SequenceEqual(prepared), "actual Windows primitive retains raced displaced and immutable candidate bytes");
            } else {
                var recovery = RetainedFileReplacement.Replace(target, TextPackStore.Hash(before), prepared, operation);
                assert(recovery.Record.State == "completed" && File.ReadAllBytes(recovery.Displaced).SequenceEqual(before) && File.ReadAllBytes(target).SequenceEqual(prepared), "actual Windows retained replacement verifies both versions");
            }
        }
        if (OperatingSystem.IsWindows()) {
            var root = Path.Combine(temp, "replacement-open-handle"); Directory.CreateDirectory(root);
            var target = Path.Combine(root, "Actual.textpack"); File.WriteAllBytes(target, before);
            var operation = Guid.NewGuid();
            using (var writer = new FileStream(target, FileMode.Open, FileAccess.ReadWrite, FileShare.ReadWrite | FileShare.Delete)) {
                assert(Refuses(() => RetainedFileReplacement.Replace(target, TextPackStore.Hash(before), prepared, operation)),
                    "actual Windows primitive refuses initial snapshot while an in-place writer is open");
            }
            // Opening the old inode after its hash check models a writer that
            // arrives in the syscall gap and keeps its handle through replacement.
            FileStream? displacedWriter = null;
            try {
                assert(Refuses(() => RetainedFileReplacement.Replace(target, TextPackStore.Hash(before), prepared, operation,
                    point => { if (point == "beforeReplace") displacedWriter = new FileStream(target, FileMode.Open, FileAccess.ReadWrite, FileShare.ReadWrite | FileShare.Delete); })),
                    "actual old writable descriptor prevents false completion acknowledgement");
                if (displacedWriter is null) throw new Exception("Missing displaced writer fixture.");
                displacedWriter.Position = 0; displacedWriter.Write(external); displacedWriter.SetLength(external.Length); displacedWriter.Flush(true);
            } finally { displacedWriter?.Dispose(); }
            var recovery = RetainedFileReplacement.Inspect(target, operation);
            assert(File.ReadAllBytes(recovery.Displaced).SequenceEqual(external) && File.ReadAllBytes(target).SequenceEqual(prepared),
                "old descriptor writes remain retained separately from candidate projection");
        }
    }
}
