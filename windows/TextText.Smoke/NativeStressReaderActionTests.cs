using System.IO;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

static class NativeStressReaderActionTests
{
    internal static async Task RunAsync(WebView2 view, string temp, string receipts, CancellationToken ct)
    {
        var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(temp,"reader-action-profile"));
        await view.EnsureCoreWebView2Async(environment);
        var checks = new List<string>();
        async Task Load(string html)
        {
            var loaded = new TaskCompletionSource();
            void Done(object? sender, CoreWebView2NavigationCompletedEventArgs e)
            { if(e.IsSuccess) loaded.TrySetResult(); else loaded.TrySetException(new Exception("Controlled navigation failed.")); }
            view.NavigationCompleted += Done;
            try { view.NavigateToString("<!doctype html><html><body>"+html+"<script>window.clicks=0;window.originalBody=document.querySelector('[aria-label=\"Document body\"]');document.querySelectorAll('button').forEach(b=>b.onclick=()=>{window.clicks++;window.originalBody.contentEditable='true'})</script></body></html>"); await loaded.Task.WaitAsync(ct); }
            finally { view.NavigationCompleted -= Done; }
        }
        async Task AssertScript(string script, string name)
        { if(await view.ExecuteScriptAsync(script)!="true") throw new Exception("Reader action assertion: "+name); checks.Add(name); }
        const string body="<div aria-label='Document body' contenteditable='false'>Existing text</div>";
        const string note="<div class='vault-note-display'><div class='vault-note-display-actions'><button aria-label='Edit card'>Edit</button></div></div>";
        const string story="<div class='vault-story-display'><div class='vault-story-display-actions'><button type='button'>Edit story</button></div></div>";
        await Load(story+body);
        var originalArticleReady=await view.ExecuteScriptAsync("!!document.querySelector('button[aria-label=\"Edit card\"]') || !!document.querySelector('[aria-label=\"Document body\"]')?.isContentEditable");
        if(originalArticleReady!="false") throw new Exception("Original article refusal was not reproduced.");
        Console.WriteLine("RED original card-only selector refuses actual-shaped article reader");
        foreach(var (name,markup) in new[]{("note",note),("article",story)})
        {
            await Load(markup+body);
            await AssertScript(NativeStressReaderAction.Ready,name+" ready");
            await AssertScript("window.clicks===0",name+" readiness does not click");
            await AssertScript(NativeStressReaderAction.Activate,name+" activates");
            await AssertScript("window.clicks===1&&window.originalBody===document.querySelector('[aria-label=\"Document body\"]')&&window.originalBody.isContentEditable",name+" existing DOM entered once");
            await AssertScript(NativeStressReaderAction.Activate,name+" already editing ready");
            await AssertScript("window.clicks===1",name+" no repeat click");
        }
        var refused=new Dictionary<string,string>{
            ["absent"]="",["unrelated"]="<button>Edit story</button>",
            ["disabled"]=story.Replace("type='button'","disabled"),
            ["aria-disabled"]=story.Replace("type='button'","aria-disabled='true'"),
            ["hidden"]=story.Replace("class='vault-story-display'","class='vault-story-display' hidden"),
            ["inert"]=story.Replace("class='vault-story-display'","class='vault-story-display' inert"),
            ["invisible"]=story.Replace("type='button'","style='visibility:hidden'"),
            ["ambiguous"]=story+note};
        foreach(var (name,markup) in refused)
        {
            await Load(markup+body);
            await AssertScript("!("+NativeStressReaderAction.Ready+")",name+" refuses readiness");
            await AssertScript("!("+NativeStressReaderAction.Activate+")",name+" refuses activation");
            await AssertScript("window.clicks===0&&!window.originalBody.isContentEditable",name+" preserves reader");
        }
        await Load(body.Replace("'false'","'true'"));
        await AssertScript(NativeStressReaderAction.Activate,"existing editor ready without reader action");
        await AssertScript("window.clicks===0","existing editor no click");
        await File.WriteAllTextAsync(Path.Combine(receipts,"reader-action.json"),JsonSerializer.Serialize(new{ok=true,controlled=true,checks}));
        Console.WriteLine("PASS controlled WebView2 reader action "+checks.Count+" checks");
    }
}
