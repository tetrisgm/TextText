using System.IO;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Windows;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using TextText.Core;

static class MirrorPolicyTests
{
    public static async Task RunAsync(string root, CancellationToken ct)
    {
        var fixture = Environment.GetEnvironmentVariable("TEXTTEXT_MIRROR_POLICY_BUNDLE");
        if(string.IsNullOrEmpty(fixture)) { Console.WriteLine("SKIP mirror policy: explicit bundle not supplied"); return; }
        using var manifest = JsonDocument.Parse(File.ReadAllText(Path.Combine(fixture,"mirror-policy.json")));
        using var vectors = JsonDocument.Parse(File.ReadAllText(Path.Combine(fixture,"vectors.json")));
        var json = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
        var view = new WebView2();
        var window = new Window { Title="Isolated policy host",Width=700,Height=500,Content=view }; window.Show();
        try {
            var environment = await CoreWebView2Environment.CreateAsync(null,Path.Combine(root,"mirror-policy-profile"));
            await view.EnsureCoreWebView2Async(environment);
            view.CoreWebView2.SetVirtualHostNameToFolderMapping("texttext.local",fixture,CoreWebView2HostResourceAccessKind.DenyCors);
            async Task Navigate() {
                var done = new TaskCompletionSource();
                void Finished(object? sender,CoreWebView2NavigationCompletedEventArgs e) { if(e.IsSuccess)done.TrySetResult();else done.TrySetException(new Exception("Policy navigation failed")); }
                view.CoreWebView2.NavigationCompleted += Finished;
                try {view.CoreWebView2.Navigate("https://texttext.local/policy-fixture.html");await done.Task.WaitAsync(TimeSpan.FromSeconds(10),ct);}
                finally {view.CoreWebView2.NavigationCompleted -= Finished;}
            }
            await Navigate();
            var policy = new MirrorPolicy(manifest.RootElement.GetProperty("digest").GetString()!,new("account-a","workspace","connection-a"),
                (script,token)=>view.ExecuteScriptAsync(script).WaitAsync(token));
            foreach(var vector in vectors.RootElement.EnumerateArray()) {
                var observation=vector.GetProperty("observed").Deserialize<MirrorObservation>(json)!;
                var result=await policy.DecideAsync(observation,ct);
                if(result.ToString().ToLowerInvariant()!=vector.GetProperty("disposition").GetString())throw new Exception("Policy vector failed: "+vector.GetProperty("name"));
            }
            var first=vectors.RootElement[0].GetProperty("observed").Deserialize<MirrorObservation>(json)!;
            window.Hide();await policy.DecideAsync(first,ct);
            foreach(var field in new[]{"scope","requestId","observed","digest","pageId","disposition"}) {
                var bad=new MirrorPolicy(manifest.RootElement.GetProperty("digest").GetString()!,new("account-a","workspace","connection-a"),async(script,token)=>{
                    var raw=await view.ExecuteScriptAsync(script).WaitAsync(token);
                    if(!script.Contains(".evaluate("))return raw;
                    var changed=JsonNode.Parse(raw)!;changed[field]="invalid";return changed.ToJsonString();
                });
                var rejected=false;try{await bad.DecideAsync(first,ct);}catch(Exception e) when(e is IOException or JsonException or InvalidOperationException){rejected=true;}
                if(!rejected)throw new Exception("Accepted forged policy "+field);
            }
            var next=new MirrorPolicy(manifest.RootElement.GetProperty("digest").GetString()!,new("account-b","other","connection-b"),
                (script,token)=>view.ExecuteScriptAsync(script).WaitAsync(token));
            await next.DecideAsync(first,ct);
            var refused=false;try{await policy.DecideAsync(first,ct);}catch(IOException){refused=true;}
            if(!refused)throw new Exception("Old connection survived workspace/account change");
            await Navigate();
            refused=false;try{await next.DecideAsync(first,ct);}catch(IOException){refused=true;}
            if(!refused)throw new Exception("Old policy adapter adopted a reloaded page");
            Console.WriteLine("PASS actual WebView2 packaged policy: all shared vectors without editor, hidden window, reload fenced");
        } finally {window.Close();view.Dispose();}
    }
}
