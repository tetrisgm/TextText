using System.IO;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Reflection;
using System.Windows;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using TextText.Core;
using TextText.Windows;

static class MirrorPolicyTests
{
    public static async Task RunAsync(string root, CancellationToken ct)
    {
        var fixture = Environment.GetEnvironmentVariable("TEXTTEXT_MIRROR_POLICY_BUNDLE");
        if(string.IsNullOrEmpty(fixture)) { Console.WriteLine("SKIP mirror policy: explicit bundle not supplied"); return; }
        using var manifest = JsonDocument.Parse(File.ReadAllText(Path.Combine(fixture,"mirror-policy.json")));
        using var vectors = JsonDocument.Parse(File.ReadAllText(Path.Combine(fixture,"vectors.json")));
        using var schedules = JsonDocument.Parse(File.ReadAllText(Path.Combine(fixture,"schedule-vectors.json")));
        using var queues = JsonDocument.Parse(File.ReadAllText(Path.Combine(fixture,"queue-vectors.json")));
        using var lifecycles = JsonDocument.Parse(File.ReadAllText(Path.Combine(fixture,"lifecycle-vectors.json")));
        var json = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
        var view = new WebView2();
        var window = new MainWindow { Title="Isolated policy host",Width=700,Height=500,Content=view };
        MainWindowCloseTests.RemoveProductionLoaded(window);
        typeof(MainWindow).GetField("web",BindingFlags.Instance|BindingFlags.NonPublic)!.SetValue(window,view);
        window.Show();
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
            foreach(var vector in schedules.RootElement.EnumerateArray()) {
                var result=await policy.ScheduleAsync(vector.GetProperty("observed").Deserialize<MirrorScheduleObservation>(json)!,ct);
                if(result!=vector.GetProperty("decision").Deserialize<MirrorScheduleDecision>(json))throw new Exception("Schedule vector failed: "+vector.GetProperty("name"));
            }
            foreach(var vector in queues.RootElement.EnumerateArray()) {
                var result=await policy.QueueAsync(vector.GetProperty("observed").Deserialize<MirrorQueueObservation>(json)!,ct);
                var expected=vector.GetProperty("decision").Deserialize<MirrorQueueDecision>(json)!;
                if(result.HasMore!=expected.HasMore || !result.OperationIds.SequenceEqual(expected.OperationIds))throw new Exception("Queue vector failed: "+vector.GetProperty("name"));
            }
            foreach(var vector in lifecycles.RootElement.EnumerateArray()) {
                var result=await policy.LifecycleAsync(vector.GetProperty("observed").Deserialize<MirrorLifecycleObservation>(json)!,ct);
                if(result!=vector.GetProperty("decision").Deserialize<MirrorLifecycleDecision>(json))throw new Exception("Lifecycle vector failed: "+vector.GetProperty("name"));
            }
            var first=vectors.RootElement[0].GetProperty("observed").Deserialize<MirrorObservation>(json)!;
            window.Hide();await policy.DecideAsync(first,ct);
            foreach(var vector in schedules.RootElement.EnumerateArray()) {
                var result=await policy.ScheduleAsync(vector.GetProperty("observed").Deserialize<MirrorScheduleObservation>(json)!,ct);
                if(result!=vector.GetProperty("decision").Deserialize<MirrorScheduleDecision>(json))throw new Exception("Hidden schedule vector failed");
            }
            foreach(var vector in queues.RootElement.EnumerateArray()) {
                var result=await policy.QueueAsync(vector.GetProperty("observed").Deserialize<MirrorQueueObservation>(json)!,ct);
                var expected=vector.GetProperty("decision").Deserialize<MirrorQueueDecision>(json)!;
                if(result.HasMore!=expected.HasMore || !result.OperationIds.SequenceEqual(expected.OperationIds))throw new Exception("Queue vector failed: "+vector.GetProperty("name"));
            }
            foreach(var vector in lifecycles.RootElement.EnumerateArray()) {
                var result=await policy.LifecycleAsync(vector.GetProperty("observed").Deserialize<MirrorLifecycleObservation>(json)!,ct);
                if(result!=vector.GetProperty("decision").Deserialize<MirrorLifecycleDecision>(json))throw new Exception("Lifecycle vector failed: "+vector.GetProperty("name"));
            }
            foreach(var field in new[]{"scope","requestId","observed","digest","pageId","disposition"}) {
                var bad=new MirrorPolicy(manifest.RootElement.GetProperty("digest").GetString()!,new("account-a","workspace","connection-a"),async(script,token)=>{
                    var raw=await view.ExecuteScriptAsync(script).WaitAsync(token);
                    if(!script.Contains(".evaluate("))return raw;
                    var changed=JsonNode.Parse(raw)!;changed[field]="invalid";return changed.ToJsonString();
                });
                var rejected=false;try{await bad.DecideAsync(first,ct);}catch(Exception e) when(e is IOException or JsonException or InvalidOperationException){rejected=true;}
                if(!rejected)throw new Exception("Accepted forged policy "+field);
            }
            foreach(var field in new[]{"scope","requestId","observed","digest","pageId","unknown-id","duplicate-id","reordered-id","over-budget"}) {
                var bad=new MirrorPolicy(manifest.RootElement.GetProperty("digest").GetString()!,new("account-a","workspace","connection-a"),async(script,token)=>{
                    var raw=await view.ExecuteScriptAsync(script).WaitAsync(token);
                    if(!script.Contains(".queue("))return raw;
                    var changed=JsonNode.Parse(raw)!;
                    if(field.EndsWith("-id") || field=="over-budget") {
                        string[] ids=field=="unknown-id"?["unknown"]:field=="duplicate-id"?["a","a"]:field=="reordered-id"?["b","a"]:["a","b"];
                        changed["decision"]=JsonSerializer.SerializeToNode(new MirrorQueueDecision(ids,false),new JsonSerializerOptions{PropertyNamingPolicy=JsonNamingPolicy.CamelCase});
                    } else changed[field]="invalid";
                    return changed.ToJsonString();
                });
                var refusedQueue=false;
                try{await bad.QueueAsync(new([new("a",false,false,false,true),new("b",false,false,false,true)],field=="reordered-id"?2:1),ct);}
                catch(Exception e)when(e is IOException or JsonException or InvalidOperationException){refusedQueue=true;}
                if(!refusedQueue)throw new Exception("Accepted forged queue "+field);
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
            // Invoke the production factory without loading credentials or a
            // real workspace. The native gate must await the page's readiness.
            var ready=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var make=typeof(MainWindow).GetMethod("CreateMirrorPolicy",BindingFlags.Instance|BindingFlags.NonPublic)!;
            var production=(MirrorPolicy)make.Invoke(window,[view,new Account("isolated-not-a-token",Guid.NewGuid().ToString(),"Fixture","account-a"),ready.Task])!;
            var waiting=production.ReadyAsync(ct);await Task.Delay(30,ct);
            if(waiting.IsCompleted)throw new Exception("Production policy skipped page readiness");
            ready.SetResult();await waiting;
            foreach(var vector in vectors.RootElement.EnumerateArray()) {
                var result=await production.DecideAsync(vector.GetProperty("observed").Deserialize<MirrorObservation>(json)!,ct);
                if(result.ToString().ToLowerInvariant()!=vector.GetProperty("disposition").GetString())throw new Exception("Production policy factory returned wrong action");
            }
            production.Retire();
            Console.WriteLine("PASS production MainWindow policy factory waits for readiness and executes packaged decisions");
            await MirrorEngineTests.RunAsync(root,hook=>new MirrorPolicy(manifest.RootElement.GetProperty("digest").GetString()!,new("account-a","workspace",Guid.NewGuid().ToString()),async(script,token)=>{
                if(script.Contains(".evaluate(")){hook.Calls++;var before=hook.Before;hook.Before=null;if(before is not null)await before();}
                return await view.ExecuteScriptAsync(script).WaitAsync(token);
            }),Navigate,ct);
            await MirrorScheduleTests.RunAsync(root,()=>new MirrorPolicy(manifest.RootElement.GetProperty("digest").GetString()!,new("account-a","schedule-workspace",Guid.NewGuid().ToString()),
                (script,token)=>view.Dispatcher.InvokeAsync(()=>view.ExecuteScriptAsync(script)).Task.Unwrap().WaitAsync(token)),ct);
        } finally {MainWindowCloseTests.ForceClose(window);view.Dispose();}
    }
}
