using System.Text.Json;
using TextText.Core;
static class AccountRootOwnershipTests
{
    public static async Task Run(string temporary,Action<bool,string> assert) {
        var root=new TextPackStore(Path.Combine(temporary,"account-root"),Path.Combine(temporary,"account-root-state"));
        var origin=new Uri("https://texttext.test");
        AccountRootOwnership.Open(root,origin,"workspace","account-a");
        var marker=Path.Combine(root.StateDirectory,AccountRootOwnership.FileName);var owner=File.ReadAllBytes(marker);
        AccountRootOwnership.Open(root,origin,"workspace","account-a");
        var refused=false;try{AccountRootOwnership.Open(root,origin,"workspace","account-b");}catch(SharedAccountMismatchException){refused=true;}
        assert(refused&&File.ReadAllBytes(marker).SequenceEqual(owner),"root ownership survives absent sync state and refuses another account unchanged");
        refused=false;try{AccountRootOwnership.Open(root,origin,"another-workspace","account-a");}catch(SharedAccountMismatchException){refused=true;}
        assert(refused,"root ownership also fences workspace changes");
        var legacy=new TextPackStore(Path.Combine(temporary,"legacy-root"),Path.Combine(temporary,"legacy-root-state"));
        File.WriteAllText(Path.Combine(legacy.Root,"pending.txt"),"Retained original work");
        refused=false;try{AccountRootOwnership.Open(legacy,origin,"workspace","account-a");}catch(LegacyAccountStateException){refused=true;}
        assert(refused&&!File.Exists(Path.Combine(legacy.StateDirectory,AccountRootOwnership.FileName))&&File.ReadAllText(Path.Combine(legacy.Root,"pending.txt"))=="Retained original work","unbound nonempty root requires explicit adoption before ownership is written");
        var known=new TextPackStore(Path.Combine(temporary,"known-root"),Path.Combine(temporary,"known-root-state"));
        await new SyncEngine(known,new Test.Fake(),"account-a").SyncAsync();
        AccountRootOwnership.Open(known,origin,"workspace","account-a");
        assert(File.Exists(Path.Combine(known.StateDirectory,AccountRootOwnership.FileName)),"existing verified sync state can attest its unchanged root account");
        File.WriteAllText(Path.Combine(known.StateDirectory,AccountRootOwnership.PendingAdoption),"retained pending adoption");
        refused=false;try{AccountRootOwnership.Open(known,origin,"workspace","account-a");}catch(LegacyAccountStateException){refused=true;}
        assert(refused,"an interrupted adoption blocks even the verified account until recovery completes");
        var future=JsonSerializer.Deserialize<AccountRootOwnership.Owner>(owner)! with {Version=999};File.WriteAllBytes(marker,JsonSerializer.SerializeToUtf8Bytes(future));var saved=File.ReadAllBytes(marker);
        refused=false;try{AccountRootOwnership.Open(root,origin,"workspace","account-a");}catch(InvalidDataException){refused=true;}
        assert(refused&&File.ReadAllBytes(marker).SequenceEqual(saved),"future root ownership format refuses without repair or reset");
    }
}
