using TextText.Core;
using TextText.Windows;

static class AccountBridgeTests
{
    public static async Task Run(string temporary,Action<bool,string> assert) {
        var root=Path.Combine(temporary,"bound-workspace");var state=Path.Combine(temporary,"bound-state");
        Directory.CreateDirectory(root);
        var aTransport=new StalledTransport();
        var aContext=new WorkspaceContext(root,"11111111-2222-3333-4444-555555555555",new Uri("https://texttext.test"),()=>Task.FromResult("fixture-a"),(_,_)=>Task.CompletedTask,AccountId:"account-a");
        using var a=new WindowsBridge(aContext,aTransport,state);
        await aTransport.ManifestStarted.Task.WaitAsync(TimeSpan.FromSeconds(3));
        var marker=Path.Combine(state,AccountRootOwnership.FileName);var saved=File.ReadAllBytes(marker);
        var bTransport=new StalledTransport();var refused=false;
        try{using var b=new WindowsBridge(aContext with {AccountId="account-b",TokenProvider=()=>Task.FromResult("fixture-b")},bTransport,state);}
        catch(SharedAccountMismatchException){refused=true;}
        assert(refused&&!bTransport.ManifestStarted.Task.IsCompleted&&File.ReadAllBytes(marker).SequenceEqual(saved),"production native bridge refuses another account before worker, listing or upload starts");
        aTransport.Release.TrySetResult();
    }
}
