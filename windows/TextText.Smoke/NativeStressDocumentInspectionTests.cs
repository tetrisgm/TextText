using System.IO;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

static class NativeStressDocumentInspectionTests
{
    internal static async Task RunAsync(WebView2 view,string temp,string receipts,CancellationToken ct)
    {
        await view.EnsureCoreWebView2Async(await CoreWebView2Environment.CreateAsync(null,Path.Combine(temp,"inspection-profile")));
        var loaded=new TaskCompletionSource();view.NavigationCompleted+=(_,e)=>{if(e.IsSuccess)loaded.TrySetResult();else loaded.TrySetException(new Exception("Controlled navigation failed"));};
        view.NavigateToString("<!doctype html><div aria-label='Edit item' data-ai-item-id='item'><textarea aria-label='Subtitle'></textarea><div aria-label='Document body'>Body</div></div>");await loaded.Task.WaitAsync(ct);
        var checks=new List<string>();
        async Task Check(bool ok,string name){if(!ok)throw new Exception("Inspection assertion: "+name);checks.Add(name);await Task.CompletedTask;}
        string Doc(string? subtitle)=>"{\"version\":1,\"content\":{\"title\":\"Title\",\"body\":\"Body\""+(subtitle is null?"":",\"subtitle\":"+subtitle)+"},\"presentation\":{\"template\":{\"id\":\"texttext.article\",\"version\":1}}}";
        async Task Set(string doc,string input="")=>await view.ExecuteScriptAsync("window.doc="+doc+";window.texttextDocumentInspection={version:1,read:k=>window.doc};document.querySelector('textarea').value="+JsonSerializer.Serialize(input));
        await Set(Doc(null));
        await Check(await view.ExecuteScriptAsync("window.doc.content.subtitle===document.querySelector('textarea').value")=="false","original absent subtitle comparison RED");
        foreach(var (name,value,input) in new[]{("absent",(string?)null,""),("empty","\"\"",""),("string","\"Subtitle\"","Subtitle")})
        {
            var original=Doc(value);await Set(original,input);var raw=await view.ExecuteScriptAsync(NativeStressDocumentInspection.Script("item","workspace"));using var d=JsonDocument.Parse(raw);NativeStressDocumentInspection.Validate(d.RootElement,"Title");
            await Check(await view.ExecuteScriptAsync("JSON.stringify(window.doc)===JSON.stringify("+original+")")=="true",name+" snapshot unchanged");
            await Check((d.RootElement.GetProperty("content").TryGetProperty("subtitle",out _))==(value is not null),name+" field presence retained");
            await Check(NativeStressDocumentInspection.Field(d.RootElement.GetProperty("content"),"subtitle")==input,name+" field input comparison");
        }
        foreach(var invalid in new[]{"null","1","false","{}","[]"})
        {
            await Set(Doc(invalid));await Check(await view.ExecuteScriptAsync(NativeStressDocumentInspection.Script("item","workspace"))=="null","UI refuses "+invalid);
            using var d=JsonDocument.Parse(Doc(invalid));bool refused=false;try{NativeStressDocumentInspection.Validate(d.RootElement,"Title");}catch{refused=true;}await Check(refused,"native refuses "+invalid);
        }
        await Set(Doc(null));await Check(await view.ExecuteScriptAsync(NativeStressDocumentInspection.Script("foreign","workspace"))=="null","foreign item refused");
        foreach(var replacement in new[]{Doc(null).Replace("Title","Wrong"),Doc(null).Replace("texttext.article","texttext.note"),Doc(null).Replace("\"body\":\"Body\"","\"body\":null")})
        {using var d=JsonDocument.Parse(replacement);bool refused=false;try{NativeStressDocumentInspection.Validate(d.RootElement,"Title");}catch{refused=true;}await Check(refused,"title/template/body guard retained");}
        await Set(Doc(null),"different");await Check(await view.ExecuteScriptAsync(NativeStressDocumentInspection.Script("item","workspace"))=="null","subtitle mismatch refused");
        await Set(Doc(null).Replace("\"Body\"","\"Different\""));await Check(await view.ExecuteScriptAsync(NativeStressDocumentInspection.Script("item","workspace"))=="null","body mismatch refused");
        await File.WriteAllTextAsync(Path.Combine(receipts,"document-inspection.json"),JsonSerializer.Serialize(new{ok=true,controlled=true,checks}));Console.WriteLine("PASS controlled WebView2 inspection "+checks.Count+" checks");
    }
}
