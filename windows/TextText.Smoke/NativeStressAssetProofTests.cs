using System.IO;
using System.Text;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using TextText.Core;

static class NativeStressAssetProofTests
{
    internal static async Task RunAsync(WebView2 view,string temp,string receipts,CancellationToken ct)
    {
        var directory=Environment.GetEnvironmentVariable("TEXTTEXT_ASSET_INSPECTION_FIXTURE") ?? throw new IOException("Explicit genuine schema fixture required.");
        if(!Path.IsPathFullyQualified(directory))throw new IOException("Absolute fixture required.");
        var html=File.ReadAllBytes(Path.Combine(directory,"inspection.html"));
        using var manifest=JsonDocument.Parse(File.ReadAllBytes(Path.Combine(directory,"manifest.json")));
        if(manifest.RootElement.GetProperty("version").GetInt32()!=1||manifest.RootElement.GetProperty("testOnly").ValueKind!=JsonValueKind.True||
            manifest.RootElement.GetProperty("htmlSha256").GetString()!=TextPackStore.Hash(html))throw new IOException("Genuine schema fixture hash changed.");
        await view.EnsureCoreWebView2Async(await CoreWebView2Environment.CreateAsync(null,Path.Combine(temp,"asset-proof-profile")));
        var loaded=new TaskCompletionSource();
        void Done(object? sender,CoreWebView2NavigationCompletedEventArgs e){if(e.IsSuccess)loaded.TrySetResult();else loaded.TrySetException(new IOException("Controlled fixture navigation failed."));}
        view.NavigationCompleted+=Done;
        try{view.NavigateToString(new UTF8Encoding(false,true).GetString(html));await loaded.Task.WaitAsync(ct);}finally{view.NavigationCompleted-=Done;}
        var checks=new List<string>();
        async Task Check(string script,string name){if(await view.ExecuteScriptAsync(script)!="true")throw new Exception("Asset inspection: "+name);checks.Add(name);}
        await Check("window.assetInspectionFixtureReady===true&&window.texttextDocumentInspection?.version===1","actual product registrar loaded");
        await Check("(()=>{const f=window.assetInspectionFixture,d=window.texttextDocumentInspection.read(f.item);return d.content.title==='Title'&&!Object.hasOwn(d.content,'subtitle')})()","complete validated snapshot preserves absence");
        var inspected=await view.ExecuteScriptAsync(NativeStressDocumentInspection.Script("e1111111-1111-4111-8111-111111111111","fixture-workspace"));
        using(var parsed=JsonDocument.Parse(inspected)) NativeStressDocumentInspection.Validate(parsed.RootElement,"Title");
        checks.Add("existing native selected-document script consumes genuine schema API");
        foreach(var invalid in new[]{"d.content.fields=[]","d.content.tags=[5]","d.content.assets=[{id:'a',kind:'image',src:5}]","d.presentation.theme={unknown:true}"}) {
            await Check("(()=>{const f=window.assetInspectionFixture;f.reset();const d=f.raw();"+invalid+";f.setRaw(d);try{window.texttextDocumentInspection.read(f.item);return false}catch{return true}})()","real full-schema hidden field refused");
        }
        const string raw="{\"2\":1.0,\"10\":-0,\"a\":1e-7,\"content\":{\"title\":\"café/漢字\",\"body\":\"Body\"}}";
        var encoded=await view.ExecuteScriptAsync(AssetProofObservation.CanonicalScript(raw));
        if(JsonSerializer.Deserialize<string>(encoded)!="{\"2\":1,\"10\":0,\"a\":1e-7,\"content\":{\"body\":\"Body\",\"title\":\"café/漢字\"}}")throw new Exception("ECMAScript canonical parity failed.");
        checks.Add("actual WebView2 numeric/integer-key/Unicode canonical parity");
        await File.WriteAllTextAsync(Path.Combine(receipts,"asset-inspection.json"),JsonSerializer.Serialize(new{ok=true,controlled=true,fullSchemaModule=true,checks}));
        Console.WriteLine("PASS controlled WebView2 asset inspection "+checks.Count+" checks");
    }
}
