using System.IO;
using System.Reflection;
using System.Text.Json;
using System.Windows;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using TextText.Windows;

static class LegacyDraftsTests
{
    static void Check(bool value,string label){if(!value)throw new Exception(label);Console.WriteLine("PASS "+label);}
    static async Task Until(Func<Task<bool>> check,CancellationToken ct) {
        using var deadline=CancellationTokenSource.CreateLinkedTokenSource(ct);deadline.CancelAfter(TimeSpan.FromSeconds(15));
        while(!await check())await Task.Delay(30,deadline.Token);
    }
    public static async Task RunAsync(string root,string receipts,CancellationToken ct) {
        var folder=Path.Combine(root,"legacy-reader");Directory.CreateDirectory(folder);
        var profile=Path.Combine(folder,"profile");var entry=Path.Combine(folder,"index.html");File.WriteAllText(entry,"<p>Isolated old profile</p>");
        var seed=new WebView2();var seedWindow=new Window{Content=seed,Width=500,Height=400,Title="Isolated previous TextText profile"};seedWindow.Show();
        LegacyDraftsWindow? viewer=null;
        try {
            var environment=await CoreWebView2Environment.CreateAsync(null,profile);await seed.EnsureCoreWebView2Async(environment);
            seed.CoreWebView2.SetVirtualHostNameToFolderMapping("texttext.local",folder,CoreWebView2HostResourceAccessKind.DenyCors);
            seed.CoreWebView2.Navigate("https://texttext.local/index.html");
            await Until(async()=>await seed.ExecuteScriptAsync("location.pathname==='/index.html'&&document.readyState==='complete'")=="true",ct);
            var raw=JsonSerializer.Serialize(new{draft=new{title="Native older draft",body="Retained WebView2 writing"}});
            var key="texttext:workspace-draft:v1:workspace:item";
            await seed.ExecuteScriptAsync("localStorage.setItem("+JsonSerializer.Serialize(key)+","+JsonSerializer.Serialize(raw)+");window.seedDone=false;const r=indexedDB.open('texttext-workspace-pool',2);r.onupgradeneeded=()=>r.result.createObjectStore('drafts');r.onsuccess=()=>{const db=r.result,t=db.transaction('drafts','readwrite');t.objectStore('drafts').put(JSON.parse(localStorage.getItem("+JsonSerializer.Serialize(key)+")),'workspace:item');t.oncomplete=()=>{db.close();window.seedDone=true}};");
            await Until(async()=>await seed.ExecuteScriptAsync("window.seedDone") == "true",ct);
            seedWindow.Close();seed.Dispose();
            viewer=new LegacyDraftsWindow(profile);viewer.Show();
            var view=(WebView2)typeof(LegacyDraftsWindow).GetField("view",BindingFlags.Instance|BindingFlags.NonPublic)!.GetValue(viewer)!;
            await Until(async()=>view.CoreWebView2 is not null&&await view.ExecuteScriptAsync("document.querySelector('#status')?.textContent.includes('2 saved records')") == "true",ct);
            Check(JsonSerializer.Deserialize<string>(await view.ExecuteScriptAsync("localStorage.getItem("+JsonSerializer.Serialize(key)+")"))==raw,"old WebView2 profile recovery retains exact local draft bytes");
            Check(await view.ExecuteScriptAsync("document.querySelectorAll('#records section').length") == "2","native recovery viewer reads old local and transactional copies");
            await view.ExecuteScriptAsync("window.networkDenied=false;fetch('https://unexpected.test/write').catch(()=>window.networkDenied=true)");
            await Until(async()=>await view.ExecuteScriptAsync("window.networkDenied") == "true",ct);
            Check(await view.ExecuteScriptAsync("document.body.innerText.includes('Retained WebView2 writing')") == "true","native recovery renders retained text with network submission blocked");
            using(var image=File.Create(Path.Combine(receipts,"older-drafts.png")))await view.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png,image);
        } finally {viewer?.Close();if(seedWindow.IsVisible)seedWindow.Close();seed.Dispose();}
    }
}
