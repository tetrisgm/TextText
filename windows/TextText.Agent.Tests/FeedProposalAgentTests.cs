using System.Collections.Concurrent;
using System.Text.Json;
using TextText.Windows;
static class FeedProposalAgentTests {
static string S(JsonElement value,string key)=>value.TryGetProperty(key,out var p)&&p.ValueKind==JsonValueKind.String?p.GetString()!:"";
static void Check(bool yes,string message){if(!yes)throw new Exception(message);}
static async Task Until(Func<bool> predicate){for(var i=0;i<200;i++){if(predicate())return;await Task.Delay(10);}throw new Exception("Timed out");}
public static async Task Run(){
var scratch=Path.Combine(Path.GetTempPath(),"texttext-feed-agent-runtime-"+Guid.NewGuid());Directory.CreateDirectory(scratch);
var executable=Environment.ProcessPath!;
string[] Prefix()=>Path.GetFileNameWithoutExtension(executable)=="dotnet"?[typeof(WindowsAgent).Assembly.Location,"--fake"]:["--fake"];
foreach(var scenario in new[]{"folder-feed","folder-feed-disabled","folder-feed-root","item-feed","folder-feed-cancel"}) {
 var events=new ConcurrentQueue<JsonElement>();var stages=0;var entered=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
 using var agent=new WindowsAgent(scratch,"captured-workspace",(_,value)=>{events.Enqueue(JsonSerializer.SerializeToElement(value));return Task.CompletedTask;},async(path,folder,tool,input,operation,ct)=>{
  if(tool!="propose_feed")return "read fixture";
  Check(folder&&path=="Feeds"&&Guid.TryParse(operation,out _),"proposal lost captured folder or host operation");entered.TrySetResult();
  if(scenario=="folder-feed-cancel")await Task.Delay(1000,ct);
  ct.ThrowIfCancellationRequested();Interlocked.Increment(ref stages);return "Review proposal https://fixture.test/review/1";
 },executable,Prefix(),allowFeedProposals:scenario!="folder-feed-disabled");
 await agent.DispatchAsync("agentStatus",JsonSerializer.SerializeToElement(new{}),default);
 await agent.DispatchAsync("agentSend",JsonSerializer.SerializeToElement(new{taskId=scenario,scope=scenario=="item-feed"?"item":"folder",path=scenario=="item-feed"?"Note.textpack":"",folderPath=scenario=="folder-feed-root"?"":"Feeds",prompt=scenario}),default);
 if(scenario=="folder-feed-cancel") {await entered.Task.WaitAsync(TimeSpan.FromSeconds(3));await agent.DispatchAsync("agentCancel",JsonSerializer.SerializeToElement(new{taskId=scenario}),default);await Task.Delay(50);Check(stages==0,"cancelled proposal completed");}
 else {await Until(()=>events.Any(e=>S(e,"type")=="turn-completed"));Check(stages==(scenario=="folder-feed"?1:0),"runtime proposal scope failed");Check(events.Any(e=>S(e,"text")== (scenario=="folder-feed"?"tool-accepted":"tool-denied")),"runtime acknowledgement scope");}
 await agent.DispatchAsync("agentDisconnect",JsonSerializer.SerializeToElement(new{}),default);Console.WriteLine("PASS native runtime "+scenario);
}
Console.WriteLine("RETAINED_PRIVATE_FIXTURE "+scratch);
}
}
