using System.Text.Json;
using TextText.Core;

static class SharedRenameProfileTests
{
    public static void ProducePreviousFactoryFixtures(string parent)
    {
        Directory.CreateDirectory(parent);
        foreach(var version in new[]{4,5}) {
            var fixture=Path.Combine(parent,"floor-"+version);
            if(Directory.Exists(fixture))throw new IOException("Fixture already exists");
            var store=new TextPackStore(Path.Combine(fixture,"vault"),Path.Combine(fixture,"device"));
            AccountRootOwnership.Open(store,new Uri("https://fixture.test"),"workspace","account");
            RetainedReplacementProfile.PrepareLocalHandoff(store);
            byte[] bytes;
            using(var output=new MemoryStream()) {
                using(var zip=new System.IO.Compression.ZipArchive(output,System.IO.Compression.ZipArchiveMode.Create,true))
                using(var writer=new StreamWriter(zip.CreateEntry("text.md").Open()))writer.Write("---\ntextTextId: \"pending-fixture\"\n---\nretained pending fixture");
                bytes=output.ToArray();
            }
            var file=store.Write("Pending.textpack",bytes);
            var state=new SyncEngine.State {AccountId="account"};
            state.Outbox.Add(new(Guid.NewGuid().ToString(),"upload",file.ItemId,file.Path,null,null,file.Hash,Convert.ToBase64String(bytes)));
            state.AdditionalData=new() { ["SharedRenameRecovery"]=JsonSerializer.SerializeToElement("invalid-future-map-sentinel") };
            TextPackStore.AtomicWrite(Path.Combine(store.StateDirectory,"sync.json"),JsonSerializer.SerializeToUtf8Bytes(state));
            if(version==5)RetainedReplacementProfile.PrepareSharedRename(store);
        }
    }
    public static void Run(string temp, Action<bool,string> check)
    {
        var origin = new Uri("https://fixture.test");
        string Profile(TextPackStore s) => Path.Combine(s.StateDirectory,"retained-replacement-profile","profile.json");
        TextPackStore New(string name) {
            var s = new TextPackStore(Path.Combine(temp,name+"-root"),Path.Combine(temp,name+"-state"));
            AccountRootOwnership.Open(s,origin,"workspace","account");
            RetainedReplacementProfile.PrepareLocalHandoff(s); return s;
        }
        var store = New("rename-floor");
        var before = File.ReadAllBytes(Profile(store));
        var marker = JsonSerializer.Deserialize<RetainedReplacementProfile.Marker>(before)!;
        var folder = Path.GetDirectoryName(Profile(store))!;
        // Reader contract independent of the publisher: a fully retained v5
        // chain must be accepted; missing/tampered earlier records must refuse.
        File.WriteAllBytes(Path.Combine(folder,"profile-v4.json"),before);
        File.WriteAllBytes(Path.Combine(folder,"profile-v4-displaced.json"),before);
        File.WriteAllBytes(Profile(store),JsonSerializer.SerializeToUtf8Bytes(marker with {Version=5}));
        AccountRootOwnership.Open(store,origin,"workspace","account");
        check(JsonSerializer.Deserialize<RetainedReplacementProfile.Marker>(File.ReadAllBytes(Profile(store)))!.Version==5,"shared rename floor five reader accepts complete preserved chain");
        var stable = File.ReadAllBytes(Profile(store));
        RetainedReplacementProfile.PrepareLocalHandoff(store);
        check(File.ReadAllBytes(Profile(store)).SequenceEqual(stable),"local handoff preparation never downgrades floor five");
        var published = New("rename-publisher");
        var otherDevice=new TextPackStore(published.Root,Path.Combine(temp,"rename-other-device"));
        AccountRootOwnership.Open(otherDevice,origin,"workspace","account");
        RetainedReplacementProfile.PrepareLocalHandoff(otherDevice);
        var otherProfile=File.ReadAllBytes(Profile(otherDevice));
        var prior = File.ReadAllBytes(Profile(published));
        var ownerPath = Path.Combine(published.StateDirectory,AccountRootOwnership.FileName);
        var owner = File.ReadAllBytes(ownerPath);
        var pending = Path.Combine(published.StateDirectory,"saved-work-proof.bin");
        File.WriteAllText(pending,"existing pending bytes");
        RetainedReplacementProfile.PrepareSharedRename(published);
        var publishedFolder = Path.GetDirectoryName(Profile(published))!;
        check(File.ReadAllBytes(Path.Combine(publishedFolder,"profile-v4.json")).SequenceEqual(prior) && File.ReadAllBytes(Path.Combine(publishedFolder,"profile-v4-displaced.json")).SequenceEqual(prior),"shared rename publication retains exact prior and displaced profile");
        check(File.ReadAllBytes(ownerPath).SequenceEqual(owner) && File.ReadAllText(pending)=="existing pending bytes","shared rename publication preserves owner and pending work");
        AccountRootOwnership.Open(published,origin,"workspace","account");
        check(File.ReadAllBytes(Profile(otherDevice)).SequenceEqual(otherProfile),"floor five publication remains private to one device");
        if(OperatingSystem.IsWindows()) {
            published.EnsureFolders(["RenameFloorFolder"]);
            published.EnsureFolders(["renamefloorfolder"]);
            check(Directory.EnumerateDirectories(published.Root).Any(path=>Path.GetFileName(path)=="renamefloorfolder"),"folder spelling operation remains supported under floor five");
        }
        if(OperatingSystem.IsWindows()) using(var reader=new FileStream(Path.Combine(published.StateDirectory,"retained-replacement-profile.lock"),FileMode.Open,FileAccess.Read,FileShare.Read)) {
            RetainedReplacementProfile.PrepareSharedRename(published);
            check(true,"stable shared rename floor permits overlapping readers without republication");
        }
        foreach(var boundary in new[]{"sharedRenameProfilePreserved","sharedRenameProfileStaged","beforeSharedRenameProfilePublication","sharedRenameProfilePublished"}) {
            var interrupted=New("rename-interrupt-"+Guid.NewGuid().ToString("N"));
            var original=File.ReadAllBytes(Profile(interrupted));var threw=false;
            try {RetainedReplacementProfile.PrepareSharedRename(interrupted,point=>{if(point==boundary)throw new IOException("fixture interruption");});}catch(IOException){threw=true;}
            check(threw,"shared rename fixture interrupted at "+boundary);
            RetainedReplacementProfile.PrepareSharedRename(interrupted);
            check(File.ReadAllBytes(Path.Combine(Path.GetDirectoryName(Profile(interrupted))!,"profile-v4.json")).SequenceEqual(original),"shared rename retry preserves prior profile at "+boundary);
        }
        var invalid = File.ReadAllBytes(Path.Combine(publishedFolder,"profile-v3.json"));
        File.WriteAllText(Path.Combine(publishedFolder,"profile-v3.json"),"{}");
        var refused=false;try {AccountRootOwnership.Open(published,origin,"workspace","account");}catch(InvalidDataException){refused=true;}
        check(refused,"floor five validates complete earlier profile chain");
        File.WriteAllBytes(Path.Combine(publishedFolder,"profile-v3.json"),invalid);
        var unowned=new TextPackStore(Path.Combine(temp,"rename-unowned-root"),Path.Combine(temp,"rename-unowned-state"));
        refused=false;try{RetainedReplacementProfile.PrepareSharedRename(unowned);}catch(InvalidDataException){refused=true;}
        check(refused && !RetainedReplacementProfile.Exists(unowned.StateDirectory),"unowned state cannot publish saved move floor");
        var portableRoot=Path.Combine(temp,"rename-portable-root");
        var portable=new TextPackStore(portableRoot,Path.Combine(portableRoot,".texttext"));
        AccountRootOwnership.Open(portable,origin,"workspace","account");
        refused=false;try{RetainedReplacementProfile.PrepareSharedRename(portable);}catch(InvalidDataException){refused=true;}
        check(refused && !RetainedReplacementProfile.Exists(portable.StateDirectory),"portable in-root state cannot publish saved move floor");
    }
}
