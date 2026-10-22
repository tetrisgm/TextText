using System.Text.Json;
using TextText.Core;
static class RetainedProfileConcurrencyTests
{
    static bool Refuses(Action action){try{action();return false;}catch(IOException){return true;}catch(InvalidDataException){return true;}catch(System.Reflection.TargetInvocationException error)when(error.InnerException is IOException or InvalidDataException){return true;}}
    public static void Run(string temp,Action<bool,string> assert)
    {
        var store=new TextPackStore(Path.Combine(temp,"profile-concurrent-root"),Path.Combine(temp,"profile-concurrent-state"));
        var origin=new Uri("https://texttext.test");AccountRootOwnership.Open(store,origin,"concurrent-workspace","concurrent-account");
        var ownerPath=Path.Combine(store.StateDirectory,AccountRootOwnership.FileName);var original=File.ReadAllBytes(ownerPath);var nestedRefused=false;var factoryRefused=false;var publishedVerifyRefused=false;
        var outerSucceeded=!Refuses(()=>RetainedReplacementProfile.Prepare(store,phase=>{
            if(phase=="beforeOwnerPublication") {
                nestedRefused=Refuses(()=>RetainedReplacementProfile.Prepare(new TextPackStore(store.Root,store.StateDirectory)));
                factoryRefused=Refuses(()=>AccountRootOwnership.Open(new TextPackStore(store.Root,store.StateDirectory),origin,"concurrent-workspace","concurrent-account"));
            }
            if(phase=="ownerPublished") {
                var actual=JsonSerializer.Deserialize<AccountRootOwnership.Owner>(File.ReadAllBytes(ownerPath))!;
                publishedVerifyRefused=Refuses(()=>RetainedReplacementProfile.Verify(store.StateDirectory,actual,actual.RootHash));
            }
        }));
        Console.WriteLine($"PROFILE CONCURRENCY nestedRefused={nestedRefused} factoryRefused={factoryRefused} publishedVerifyRefused={publishedVerifyRefused} outerSucceeded={outerSucceeded}");
        assert(nestedRefused&&factoryRefused,"same-root concurrent preparation and factory verification refuse active ownership migration");
        assert(outerSucceeded&&publishedVerifyRefused,"outer ownership migration completes while reentrant verification remains excluded");
        var owner=JsonSerializer.Deserialize<AccountRootOwnership.Owner>(File.ReadAllBytes(ownerPath))!;var displaced=Path.Combine(store.StateDirectory,"retained-replacement-profile","owner-displaced.json");
        assert(owner.Version==2&&File.ReadAllBytes(displaced).SequenceEqual(original),"concurrent account saves preserve the exact displaced version-one owner");
        RetainedReplacementProfile.Prepare(store);AccountRootOwnership.Open(new TextPackStore(store.Root,store.StateDirectory),origin,"concurrent-workspace","concurrent-account");
        var overlappingVerify=false;var noOpPrepare=false;var writerRefused=false;
        var verifier=typeof(RetainedReplacementProfile).GetMethod("VerifyObserved",System.Reflection.BindingFlags.Static|System.Reflection.BindingFlags.NonPublic)!;
        verifier.Invoke(null,new object?[]{store.StateDirectory,owner,owner.RootHash,(Action)(()=>{
            overlappingVerify=!Refuses(()=>RetainedReplacementProfile.Verify(store.StateDirectory,owner,owner.RootHash));
            noOpPrepare=!Refuses(()=>RetainedReplacementProfile.Prepare(new TextPackStore(store.Root,store.StateDirectory)));
            writerRefused=Refuses(()=>typeof(RetainedReplacementProfile).GetMethod("PrepareFolderCase",System.Reflection.BindingFlags.Static|System.Reflection.BindingFlags.NonPublic)!.Invoke(null,[store,null]));
        })});
        assert(overlappingVerify&&noOpPrepare&&writerRefused,"stable verification permits readers and no-op preparation while excluding actual floor migration");
        assert(File.Exists(Path.Combine(store.StateDirectory,"retained-replacement-profile.lock"))&&!File.Exists(Path.Combine(store.Root,"retained-replacement-profile.lock")),"migration lease is device-private and subsequent prepare/verify have no nested lease deadlock");
        InventoryScope(temp,assert);
        BlockedItemsScope(temp,assert);

    }
    // Sync state saves check every retained entry while holding the store.
    // Startup listing and editor close wait behind that pass.
    static void BlockedItemsScope(string temp,Action<bool,string> assert)
    {
        var store=new TextPackStore(Path.Combine(temp,"blocked-profile-root"),Path.Combine(temp,"blocked-profile-state"));
        AccountRootOwnership.Open(store,new Uri("https://texttext.test"),"blocked-workspace","blocked-account");
        RetainedReplacementProfile.PrepareObservedAbsenceRename(store);
        var registry=new ReplacementRecoveryRegistry(store.Root,store.StateDirectory);
        for(var i=0;i<200;i++) {
            var bytes=System.Text.Encoding.UTF8.GetBytes("blocked "+i);
            File.WriteAllBytes(Path.Combine(store.Root,"item-"+i+".textpack"),bytes);
            registry.Register(Guid.NewGuid(),"blocked-"+i,"item-"+i+".textpack",TextPackStore.Hash(bytes),TextPackStore.Hash(bytes));
        }
        var hook=typeof(TextPackStore).GetProperty("InventoryObservationForTesting",System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.NonPublic)!;
        var starts=0;hook.SetValue(store,(Action<string>)(phase=>{if(phase=="blockedProfileVerified")starts++;}));
        var timing=System.Diagnostics.Stopwatch.StartNew();var blocked=store.ReplacementBlockedItems();
        Console.WriteLine("BLOCKED_ITEMS_200_FLOOR6_MS "+timing.ElapsedMilliseconds);
        assert(starts==1&&blocked.Count==200,"blocked-item inspection shares one profile verification and still inspects every entry");
        var profile=Path.Combine(store.StateDirectory,"retained-replacement-profile","profile.json");var original=File.ReadAllBytes(profile);
        hook.SetValue(store,(Action<string>)(phase=>{if(phase=="blockedProfileVerified")File.WriteAllText(profile,"{}");}));
        assert(Refuses(()=>store.ReplacementBlockedItems()),"profile tampering during blocked-item inspection refuses the result");
        hook.SetValue(store,null);
        assert(Refuses(()=>store.ReplacementBlockedItems()),"a later pass revalidates the changed profile");
        File.WriteAllBytes(profile,original);
        assert(store.ReplacementBlockedItems().Count==200,"restored profile verifies again");
    }
    static void InventoryScope(string temp,Action<bool,string> assert)
    {
        var store=new TextPackStore(Path.Combine(temp,"inventory-profile-root"),Path.Combine(temp,"inventory-profile-state"));
        AccountRootOwnership.Open(store,new Uri("https://texttext.test"),"inventory-workspace","inventory-account");
        RetainedReplacementProfile.PrepareObservedAbsenceRename(store);
        for(var i=0;i<1100;i++) {
            using var output=new MemoryStream();
            using(var zip=new System.IO.Compression.ZipArchive(output,System.IO.Compression.ZipArchiveMode.Create,true)) {
                using var writer=new StreamWriter(zip.CreateEntry("text.md").Open());
                writer.Write("---\ntextTextId: \"inventory-"+i+"\"\n---\n");
            }
            File.WriteAllBytes(Path.Combine(store.Root,"item-"+i+".textpack"),output.ToArray());
        }
        var hook=typeof(TextPackStore).GetProperty("InventoryObservationForTesting",System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.NonPublic)!;
        var starts=0;hook.SetValue(store,(Action<string>)(phase=>{if(phase=="profileVerified")starts++;}));
        var timing=System.Diagnostics.Stopwatch.StartNew();var inventory=store.ScanInventory();
        Console.WriteLine("INVENTORY_1100_FLOOR6_MS "+timing.ElapsedMilliseconds);
        assert(inventory.Files.Count==1100&&starts==1,"large inventory shares one scan-scoped profile verification");
        var profile=Path.Combine(store.StateDirectory,"retained-replacement-profile","profile.json");var original=File.ReadAllBytes(profile);
        hook.SetValue(store,(Action<string>)(phase=>{if(phase=="scanned")File.WriteAllText(profile,"{}");}));
        assert(Refuses(()=>store.ScanInventory()),"profile tampering during inventory refuses the whole result");
        hook.SetValue(store,null);
        assert(Refuses(()=>store.Describe("item-0.textpack")),"failed inventory cannot leak profile authority into standalone read");
        File.WriteAllBytes(profile,original);
        assert(store.ScanInventory().Files.Count==1100,"a fresh scan revalidates restored profile bytes");
        File.WriteAllText(profile,"{}");
        assert(Refuses(()=>store.ScanInventory()),"profile changed between scans is rejected");
        File.WriteAllBytes(profile,original);
        var ownerPath=Path.Combine(store.StateDirectory,AccountRootOwnership.FileName);var owner=File.ReadAllBytes(ownerPath);
        hook.SetValue(store,(Action<string>)(phase=>{if(phase=="scanned")File.WriteAllText(ownerPath,"{}");}));
        assert(Refuses(()=>store.ScanInventory()),"owner tampering during inventory refuses the whole result");
        hook.SetValue(store,null);File.WriteAllBytes(ownerPath,owner);
        assert(store.Describe("item-0.textpack").ItemId=="inventory-0","standalone reads still validate successfully after scope disposal");
    }

}
