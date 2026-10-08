using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text.Json;
using System.Text;
using System.Text.Encodings.Web;
using TextText.Windows;

if(args.Contains("app-server")) { await Fake(args.Contains("--login")); return; }
static string S(JsonElement value,string key) => value.TryGetProperty(key,out var p) && p.ValueKind == JsonValueKind.String ? p.GetString()! : "";
static async Task Fake(bool login)
{
    Console.InputEncoding = new UTF8Encoding(false); Console.OutputEncoding = new UTF8Encoding(false);
    var logged = !login; var unicode = false;
    const string Unicode = "“Café” 日本語 🧪";
    async Task Send(object value) { await Console.Out.WriteLineAsync(JsonSerializer.Serialize(value,new JsonSerializerOptions { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping })); await Console.Out.FlushAsync(); }
    while(await Console.In.ReadLineAsync() is { } line) {
        var data = JsonDocument.Parse(line).RootElement; var method = S(data,"method");
        if(method == "") { if(data.TryGetProperty("result",out var result)) { var success = result.GetProperty("success").GetBoolean(); await Send(new { method = "item/completed",@params = new { threadId = "thread",item = new { type = "agentMessage",phase = "final_answer",text = unicode ? (result.GetProperty("contentItems")[0].GetProperty("text").GetString() == Unicode ? Unicode : "unicode-return-corrupted") : success ? "tool-accepted" : "tool-denied" } } }); await Send(new { method = "turn/completed",@params = new { threadId = "thread",turn = new { status = "completed" } } }); } continue; }
        if(!data.TryGetProperty("id",out var id)) continue;
        var p = data.GetProperty("params");
        switch(method) {
          case "initialize":
            if(!p.GetProperty("capabilities").GetProperty("experimentalApi").GetBoolean()) throw new Exception("Missing experimental flag");
            await Send(new { id,result = new {} }); break;
          case "account/read": await Send(new { id,result = new { account = logged ? new { type = "chatgpt",email = "fixture@example.test" } : null } }); break;
          case "account/login/start":
            await Send(new { id,result = new { loginId = "valid",authUrl = "https://auth.openai.com/fixture" } });
            // Tests intercept browser launch through a harmless injected callback.
            await Task.Delay(30); await Send(new { method = "account/login/completed",@params = new { loginId = "wrong",success = true } });
            await Task.Delay(200); logged = true; await Send(new { method = "account/login/completed",@params = new { loginId = "valid",success = true } }); break;
          case "config/read": await Send(new { id,result = new { config = new { mcp_servers = new { unexpected = new { enabled = true } } } } }); break;
          case "thread/start":
            if(S(p,"sandbox") != "read-only" || p.GetProperty("dynamicTools")[0].GetProperty("name").GetString() != "texttext" || p.GetProperty("config").GetProperty("mcp_servers").GetProperty("unexpected").GetProperty("enabled").GetBoolean()) throw new Exception("Unsafe thread config");
            await Send(new { id,result = new { thread = new { id = "thread" } } }); break;
          case "turn/start":
            var prompt = p.GetProperty("input")[0].GetProperty("text").GetString(); unicode = prompt == Unicode;
            var input = p.GetProperty("input");
            if(prompt == "accept" && (input.GetArrayLength() != 2 || S(input[1],"type") != "image" || S(input[1],"url") != "data:image/jpeg;base64,/9j/AA==")) throw new Exception("Selected photo input missing or changed");
            if(prompt != "accept" && input.GetArrayLength() != 1) throw new Exception("Photo leaked into another task");
            await Send(new { id,result = new { turn = new { id = "turn" } } });
            await Send(new { method = "item/completed",@params = new { threadId = "obsolete",item = new { type = "agentMessage",phase = "final_answer",text = "stale-leak" } } });
            await Send(new { id = 42,method = "item/tool/call",@params = new { threadId = "thread",@namespace = "texttext",tool = "write_file",arguments = new { path = prompt == "deny" ? "Other.textpack" : "Note.textpack",hash = "hash",markdown = unicode ? Unicode : "new" } } }); break;
          case "turn/interrupt": await Send(new { id,result = new {} }); break;
          case "account/logout": await Send(new { id,result = new {} }); break;
        }
    }
}
static void Check(bool condition,string message) { if(!condition) throw new Exception(message); }
static async Task Until(Func<bool> predicate) { for(var i=0;i<200;i++) { if(predicate()) return; await Task.Delay(10); } throw new Exception("Timed out"); }
var flush = new RendererFlushGuard();
string FlushId(string script) { var start = script.IndexOf("{id:",StringComparison.Ordinal)+4; var end = script.IndexOf(",method:",start,StringComparison.Ordinal); return JsonSerializer.Deserialize<string>(script[start..end])!; }
string? issuedId = null;
var pendingFlush = flush.FlushAsync(script => { issuedId = FlushId(script); return Task.CompletedTask; });
Check(!pendingFlush.IsCompleted,"Closing did not wait for durable renderer acknowledgement");
Check(!flush.Accept("other-window",true),"Flush accepted another window acknowledgement");
Check(!await flush.FlushAsync(_ => Task.CompletedTask),"Concurrent destructive transition accepted");
Check(flush.Accept(issuedId!,true),"Flush acknowledgement rejected"); Check(await pendingFlush,"Durable flush was not accepted");
Check(!await flush.FlushAsync(script => { flush.Accept(FlushId(script),false); return Task.CompletedTask; }),"Failed save allowed close");
Check(!await flush.FlushAsync(_ => Task.CompletedTask,TimeSpan.FromMilliseconds(10)),"Timeout allowed close");
Console.WriteLine("PASS renderer flush waits, fences acknowledgements and keeps failed saves open");
var scratch = Path.Combine(Path.GetTempPath(),"texttext-agent-test-"+Guid.NewGuid()); Directory.CreateDirectory(scratch);
var executable = Environment.ProcessPath!;
var processName = Path.GetFileNameWithoutExtension(executable);
var originalProcesses = Process.GetProcessesByName(processName).Length;
string[] Prefix(bool login = false) => (Path.GetFileNameWithoutExtension(executable) == "dotnet" ? new[] { typeof(WindowsAgent).Assembly.Location,"--fake" } : new[] { "--fake" }).Concat(login ? new[]{"--login"} : []).ToArray();
try {
  foreach(var scenario in new[]{"deny","accept","cancel","unicode"}) {
    var events = new ConcurrentQueue<JsonElement>(); var writes = 0; var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    using var agent = new WindowsAgent(scratch,"fixture",(_,value) => { events.Enqueue(JsonSerializer.SerializeToElement(value)); return Task.CompletedTask; },async (_,tool,arguments,ct) => {
      if(tool == "write_file") { entered.TrySetResult(); if(scenario == "cancel") await Task.Delay(1000,ct); ct.ThrowIfCancellationRequested(); Interlocked.Increment(ref writes); } if(scenario=="unicode" && tool=="write_file") { Check(S(arguments,"markdown")=="“Café” 日本語 🧪","Literal UTF8 tool arguments corrupted"); return "“Café” 日本語 🧪"; } return "ok";
    },executable,Prefix());
    await agent.DispatchAsync("agentStatus",JsonSerializer.SerializeToElement(new {}),default);
    Check(JsonSerializer.SerializeToElement(agent.Status).GetProperty("state").GetString()=="ready","Saved account was not restored by status");
    await agent.DispatchAsync("agentConnect",JsonSerializer.SerializeToElement(new {}),default);
    Check(JsonSerializer.SerializeToElement(agent.Status).GetProperty("state").GetString()=="ready","Connection failed");
    if(scenario == "accept") {
      foreach(var invalid in new[] { "https://example.test/image.jpg", "data:image/jpeg;base64,bm90LWpwZWc=", "data:image/jpeg;base64," + new string('A',1_000_000) }) {
        var rejected = false;
        try { await agent.DispatchAsync("agentSend",JsonSerializer.SerializeToElement(new { taskId = "bad",path = "Note.textpack",prompt = "accept",imageUrl = invalid }),default); }
        catch(InvalidOperationException) { rejected = true; }
        Check(rejected,"Unbounded or external photo accepted");
      }
    }
    await agent.DispatchAsync("agentSend",JsonSerializer.SerializeToElement(new { taskId = scenario,path = "Note.textpack",prompt = scenario=="unicode" ? "“Café” 日本語 🧪" : scenario,imageUrl = scenario == "accept" ? "data:image/jpeg;base64,/9j/AA==" : "" }),default);
    if(scenario=="cancel") { await entered.Task.WaitAsync(TimeSpan.FromSeconds(2)); await agent.DispatchAsync("agentCancel",JsonSerializer.SerializeToElement(new { taskId = scenario }),default); await Task.Delay(100); Check(writes==0,"Late write escaped cancellation"); }
    else { await Until(() => events.Any(e => S(e,"type")=="turn-completed")); Check(writes==(scenario!="deny"?1:0),"Scope failed"); Check(events.Any(e => S(e,"text")== (scenario=="unicode"?"“Café” 日本語 🧪":scenario=="accept"?"tool-accepted":"tool-denied")),"Tool acknowledgement missing"); }
    Check(!events.Any(e => S(e,"text")=="stale-leak"),"Stale task notification escaped");
    await agent.DispatchAsync("agentDisconnect",JsonSerializer.SerializeToElement(new {}),default);
    Check(JsonSerializer.SerializeToElement(agent.Status).GetProperty("state").GetString()=="disconnected","Process shutdown failed");
    Console.WriteLine("PASS agent "+scenario);
  }
  var loginEvents = new ConcurrentQueue<JsonElement>(); var browserLaunches = 0;
  using(var agent = new WindowsAgent(scratch,"fixture-login",(_,value) => { loginEvents.Enqueue(JsonSerializer.SerializeToElement(value)); return Task.CompletedTask; },(_,_,_,_) => Task.FromResult("ok"),executable,Prefix(true),_ => Interlocked.Increment(ref browserLaunches))) {
    await agent.DispatchAsync("agentStatus",JsonSerializer.SerializeToElement(new {}),default);
    await agent.DispatchAsync("agentStatus",JsonSerializer.SerializeToElement(new {}),default);
    Check(JsonSerializer.SerializeToElement(agent.Status).GetProperty("state").GetString()=="disconnected","Signed-out restoration should remain disconnected");
    Check(browserLaunches==0,"Status restoration opened OAuth");
    Check(loginEvents.Count(e => S(e,"state")=="connecting")==1,"Repeated signed-out status restarted the runtime");
    Console.WriteLine("PASS lazy account restore, signed-out polling and no automatic OAuth");
    await agent.DispatchAsync("agentConnect",JsonSerializer.SerializeToElement(new {}),default);
    Check(browserLaunches==1,"Explicit Connect did not open OAuth exactly once");
    await Task.Delay(90);
    Check(JsonSerializer.SerializeToElement(agent.Status).GetProperty("state").GetString()=="connecting","Foreign login callback accepted");
    await Until(() => JsonSerializer.SerializeToElement(agent.Status).GetProperty("state").GetString()=="ready");
    await agent.DispatchAsync("agentDisconnect",JsonSerializer.SerializeToElement(new {}),default);
    Console.WriteLine("PASS login callback identity fence");
  }
  await Until(() => Process.GetProcessesByName(processName).Length <= originalProcesses);
  Console.WriteLine("PASS no leaked app-server process");
} finally { Directory.Delete(scratch,true); }
