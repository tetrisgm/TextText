using System.IO;
using System.Windows;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

static class SharedOwnerTests
{
    public static async Task RunAsync(string root, CancellationToken ct)
    {
        var fixture = Environment.GetEnvironmentVariable("TEXTTEXT_SESSION_OWNER_BUNDLE");
        if (string.IsNullOrEmpty(fixture)) { Console.WriteLine("SKIP shared owner: explicit browser fixture not supplied"); return; }
        if (!File.Exists(Path.Combine(fixture, "app.js"))) throw new Exception("Missing shared owner browser fixture");
        var view = new WebView2();
        var window = new Window { Title = "Isolated shared ownership fixture", Width = 800, Height = 600, Content = view };
        window.Show();
        async Task Until(string expression) {
            using var bounded = CancellationTokenSource.CreateLinkedTokenSource(ct); bounded.CancelAfter(TimeSpan.FromSeconds(15));
            while (await view.ExecuteScriptAsync(expression) != "true") await Task.Delay(25, bounded.Token);
        }
        void Check(bool value, string label) { if (!value) throw new Exception(label); Console.WriteLine("PASS " + label); }
        try {
            var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(root, "shared-owner-profile"));
            await view.EnsureCoreWebView2Async(environment);
            view.CoreWebView2.SetVirtualHostNameToFolderMapping("texttext.local", fixture, CoreWebView2HostResourceAccessKind.DenyCors);
            view.CoreWebView2.Navigate("https://texttext.local/index.html");
            await Until("typeof window.edit==='function'");
            await view.ExecuteScriptAsync("window.ready=false;window.open('a').then(async()=>{await window.handles.a.session.client.retry();window.pause('a');window.hold=true;window.edit('a',' WebView retained');window.ready=true})");
            await Until("window.ready&&window.waiting");
            await view.ExecuteScriptAsync("window.done=null;window.release('a').then(value=>window.done=value)");
            Check(await view.ExecuteScriptAsync("window.closes") == "0", "WebView2 retains native lease during pending checkpoint");
            await view.ExecuteScriptAsync("window.reopened=false;window.open('b').then(()=>window.reopened=true)");
            await Until("window.reopened");
            Check(await view.ExecuteScriptAsync("window.same('a','b')") == "true", "WebView2 reacquires the same pending document owner");
            await view.ExecuteScriptAsync("window.hold=false;window.resume()");
            await Until("window.done!==null");
            await view.ExecuteScriptAsync("window.finalSaved=false;window.pause('b');window.release('b').then(value=>window.finalSaved=value)");
            await Until("window.finalSaved");
            Check(await view.ExecuteScriptAsync("window.saved()==='Original WebView retained'&&window.closes===1") == "true", "WebView2 commits retained text before one final native lease release");
        } finally { window.Close(); view.Dispose(); }
    }
}
