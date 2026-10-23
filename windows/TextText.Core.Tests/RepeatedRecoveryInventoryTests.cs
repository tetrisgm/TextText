using System.IO.Compression;
using System.Reflection;
using System.Text;
using TextText.Core;

static class RepeatedRecoveryInventoryTests
{
    static byte[] Pack(int revision)
    {
        using var output=new MemoryStream();
        using(var zip=new ZipArchive(output,ZipArchiveMode.Create,true))
        using(var writer=new StreamWriter(zip.CreateEntry("text.md").Open()))writer.Write("---\ntextTextId: \"history-item\"\n---\nrevision "+revision);
        return output.ToArray();
    }
    public static void Run(string temp,Action<bool,string> check)
    {
        if(!OperatingSystem.IsWindows()){Console.WriteLine("SKIP repeated recovery inventory: requires actual Windows replacement primitive and identity index");return;}
        const int count=32;
        var store=new TextPackStore(Path.Combine(temp,"repeated-recovery"),Path.Combine(temp,"repeated-recovery-state"));
        AccountRootOwnership.Open(store,new Uri("https://texttext.test"),"history-workspace","history-account");
        RetainedReplacementProfile.Prepare(store);
        var registry=new ReplacementRecoveryRegistry(store.Root,store.StateDirectory);
        var target=store.Resolve("History.textpack");var previous=Pack(0);File.WriteAllBytes(target,previous);
        var recoveryRoot=Path.Combine(store.Root,".texttext","retained-replacements",TextPackStore.Hash(Encoding.UTF8.GetBytes("History.textpack")));
        RetainedFileReplacement.Recovery? first=null;
        for(var revision=1;revision<=count;revision++) {
            var next=Pack(revision);var operation=Guid.NewGuid();
            var directory=RetainedFileReplacement.OperationDirectory(target,operation,recoveryRoot);
            registry.Register(operation,"history-item","History.textpack",TextPackStore.Hash(previous),TextPackStore.Hash(next),directory);
            var recovery=RetainedFileReplacement.Replace(target,TextPackStore.Hash(previous),next,operation,recoveryRoot:recoveryRoot);
            first??=recovery;previous=next;
        }
        var scans=0;var validations=0;
        var observation=typeof(TextPackStore).GetProperty("InventoryObservationForTesting",BindingFlags.Instance|BindingFlags.NonPublic)!;
        var entries=typeof(TextPackStore).GetProperty("RemovalObservationForTesting",BindingFlags.Instance|BindingFlags.NonPublic)!;
        observation.SetValue(store,(Action<string>)(phase=>{if(phase=="scanned")scans++;}));
        entries.SetValue(store,(Action<string>)(phase=>{if(phase=="registryEntryValidated")validations++;}));
        var clock=System.Diagnostics.Stopwatch.StartNew();var inventory=store.ScanInventory();
        Console.WriteLine("REPEATED_RECOVERY_32_SCAN_MS "+clock.ElapsedMilliseconds);
        check(inventory.Files.Count==1&&scans==1&&validations==count,"one inventory scan validates each retained record once even when all records belong to one item");
        scans=0;validations=0;_=store.ScanInventory();
        check(scans==1&&validations==count,"a later scan revalidates every retained record rather than reusing prior recovery authority");
        File.WriteAllBytes(first!.Displaced,Encoding.UTF8.GetBytes("changed retained bytes"));
        inventory=store.ScanInventory();
        check(inventory.Files.Count==0&&store.LastScanErrors.Count>0,"changed old displaced bytes still fence the current document after warm scans");
        check(File.ReadAllBytes(target).SequenceEqual(previous),"recovery validation retains the exact current document");
    }
}
