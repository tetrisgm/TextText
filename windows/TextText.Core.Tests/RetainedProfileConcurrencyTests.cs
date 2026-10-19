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
    }
}
