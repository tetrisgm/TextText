using System.Net;
using System.Text;
using System.Text.Json;
using TextText.Windows;
static class WindowsFeedProposalTests {
public static async Task Run(Action<bool,string> Check) {
var reviewDetails=new{approvalRequired=true,proposalId="proposal-1",reviewUrl="https://fixture.test/proposals/proposal-1",message="Staged for owner review. Nothing has been changed."};
var productionReply=JsonSerializer.Serialize(new{content=new[]{new{type="text",text=JsonSerializer.Serialize(reviewDetails)}},structuredContent=reviewDetails});
var current=true;var requests=0;JsonElement body=default;Uri? target=null;string? auth=null;
var handler=new Handler(async(request,ct)=>{requests++;target=request.RequestUri;auth=request.Headers.Authorization?.Scheme;body=JsonDocument.Parse(await request.Content!.ReadAsStringAsync(ct)).RootElement.Clone();return new(HttpStatusCode.OK){RequestMessage=request,Content=new StringContent(productionReply)};});
using var http=new HttpClient(handler);
var context=new WorkspaceContext("C:/fixture","captured-workspace",new Uri("https://fixture.test"),()=>Task.FromResult("fixture-token"),(_,_)=>Task.CompletedTask,AccountId:"captured-account");
var adapter=new WindowsFeedProposal(context,http,()=>current);
var feedArgs=JsonSerializer.SerializeToElement(new{url="https://feed.test/rss",name="Exact name"});
var result=await adapter.StageAsync("Feeds/Chosen",feedArgs,"stable-operation",default);
Check(JsonDocument.Parse(result).RootElement.GetProperty("reviewUrl").GetString()==reviewDetails.reviewUrl,"production-shaped response preserves owner review URL and approval state");
Check(target==new Uri("https://fixture.test/api/agent/commands")&&auth=="Bearer","only captured account server receives authenticated proposal");
Check(body.GetProperty("name").GetString()=="proposal:add_feed"&&body.GetProperty("expectedWorkspaceId").GetString()==context.WorkspaceId,"proposal endpoint binds expected captured workspace");
Check(body.GetProperty("arguments").GetProperty("parent_path").GetString()=="Feeds/Chosen"&&body.GetProperty("arguments").GetProperty("idempotency_key").GetString()=="stable-operation","captured folder and stable task operation cannot be model-selected");
async Task Refused(JsonElement input,string label){var before=requests;try{await adapter.StageAsync("Feeds/Chosen",input,"stable",default);Check(false,label);}catch(InvalidDataException){Check(requests==before,label);}}
await Refused(JsonSerializer.SerializeToElement(new{url="https://feed.test/rss",parent_path="Other"}),"model folder override rejected before transport");
await Refused(JsonSerializer.SerializeToElement(new{url="https://feed.test/rss",expectedWorkspaceId="other"}),"model workspace override rejected before transport");
await Refused(JsonSerializer.SerializeToElement(new{url="https://feed.test/rss",name=5}),"malformed optional name rejected before transport");
current=false;var count=requests;try{await adapter.StageAsync("Feeds",feedArgs,"stable",default);Check(false,"obsolete context refused");}catch(InvalidOperationException){Check(requests==count,"obsolete context refused before request");}current=true;
using(var cancelled=new CancellationTokenSource()){cancelled.Cancel();try{await adapter.StageAsync("Feeds",feedArgs,"stable",cancelled.Token);Check(false,"cancelled request refused");}catch(OperationCanceledException){Check(requests==count,"cancelled request dispatches nothing");}}
handler.Callback=async(request,ct)=>{await Task.Yield();current=false;return new(HttpStatusCode.OK){RequestMessage=request,Content=new StringContent("{\"message\":\"late result\"}")};};
try{await adapter.StageAsync("Feeds",feedArgs,"stable",default);Check(false,"late result fenced");}catch(InvalidOperationException){Check(true,"late response after context retirement is not published");}
current=true;
var schemaNames=WindowsFeedProposal.WorkspaceCommands;
// Same envelope/descriptor fields as GET /api/agent/commands; schemas are opaque and must survive unchanged.
var schemaDescriptors=schemaNames.Concat(new[]{"delete_item"}).Select(name=>new{name,title=name,description="Canonical command schema",inputSchema=new{type="object",properties=new{item_id=new{type="string"}},required=new[]{"item_id"},additionalProperties=false},approvalRequired=true,invocation="texttext propose "+name+" --args '{...}'"}).ToArray();
var discoveryReply=JsonSerializer.Serialize(new{commands=Array.Empty<object>(),proposals=schemaDescriptors,note="Run one with: texttext do <name> --args '{...}'"});
handler.Callback=(request,ct)=>{requests++;target=request.RequestUri;Check(request.Method==HttpMethod.Get&&request.Content is null&&request.Headers.Authorization?.Scheme=="Bearer","workspace discovery is authenticated read-only GET");return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK){RequestMessage=request,Content=new StringContent(discoveryReply)});};
var discovery=JsonDocument.Parse(await adapter.WorkspaceToolAsync("describe_workspace_proposals","",JsonSerializer.SerializeToElement(new{}),"discovery",default));
Check(discovery.RootElement.GetRawText()==JsonSerializer.Serialize(schemaDescriptors.Take(5)),"root discovery preserves all five canonical descriptors and excludes other commands");
handler.Callback=(request,ct)=>Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK){RequestMessage=request,Content=new StringContent("{\"proposals\":[]}")});
try{await adapter.WorkspaceToolAsync("describe_workspace_proposals","",JsonSerializer.SerializeToElement(new{}),"key",default);Check(false,"incomplete discovery refused");}catch(InvalidDataException){Check(true,"incomplete discovery refused");}
handler.Callback=async(request,ct)=>{requests++;body=JsonDocument.Parse(await request.Content!.ReadAsStringAsync(ct)).RootElement.Clone();return new(HttpStatusCode.OK){RequestMessage=request,Content=new StringContent(productionReply)};};
foreach(var command in schemaNames){
 var proposal=await adapter.WorkspaceToolAsync("propose_workspace_change","",JsonSerializer.SerializeToElement(new{command,argumentsJSON="{\"item_id\":\"captured-item\",\"expected_hash\":\"exact-hash\"}"}),"stable-native-key",default);
 Check(body.GetProperty("name").GetString()=="proposal:"+command&&body.GetProperty("expectedWorkspaceId").GetString()=="captured-workspace"&&body.GetProperty("arguments").GetProperty("idempotency_key").GetString()=="stable-native-key"&&JsonDocument.Parse(proposal).RootElement.GetProperty("approvalRequired").GetBoolean(),"workspace proposal preserves command, captured authority, native retry key and review receipt");
}
foreach(var invalid in new[]{new{command="delete_item",argumentsJSON="{}"},new{command=schemaNames[0],argumentsJSON="[]"},new{command=schemaNames[0],argumentsJSON="{\"idempotency_key\":\"model\"}"}}){
 var before=requests;try{await adapter.WorkspaceToolAsync("propose_workspace_change","",JsonSerializer.SerializeToElement(invalid),"key",default);Check(false,"invalid workspace proposal refused");}catch(InvalidDataException){Check(requests==before,"invalid workspace proposal refused before transport");}
}
try{await adapter.WorkspaceToolAsync("describe_workspace_proposals","Notes",JsonSerializer.SerializeToElement(new{}),"key",default);Check(false,"non-root workspace discovery refused");}catch(InvalidDataException){Check(true,"non-root workspace discovery refused");}
current=false;
try{await adapter.WorkspaceToolAsync("describe_workspace_proposals","",JsonSerializer.SerializeToElement(new{}),"key",default);Check(false,"retired workspace discovery refused");}catch(InvalidOperationException){Check(true,"retired workspace discovery refused");}
current=true;
handler.Callback=(request,ct)=>Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK){RequestMessage=request,Content=new StringContent(JsonSerializer.Serialize(new{content=new[]{new{type="text",text=JsonSerializer.Serialize(reviewDetails)}}}))});
Check(JsonDocument.Parse(await adapter.StageAsync("Feeds",feedArgs,"stable",default)).RootElement.GetProperty("proposalId").GetString()=="proposal-1","MCP text-content fallback preserves review receipt");
foreach(var malformed in new[]{"{\"message\":\"old fabricated shape\"}","{\"structuredContent\":{\"approvalRequired\":true,\"proposalId\":\"id\",\"message\":\"missing URL\"}}","{\"isError\":true,\"content\":[{\"type\":\"text\",\"text\":\"failure\"}]}"}) {
 handler.Callback=(request,ct)=>Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK){RequestMessage=request,Content=new StringContent(malformed)});
 var refused=false;try{await adapter.StageAsync("Feeds",feedArgs,"stable",default);}catch(Exception error) when(error is IOException or InvalidDataException){refused=true;}
 Check(refused,"missing review receipt or MCP error cannot become a successful proposal");
}
}
sealed class Handler(Func<HttpRequestMessage,CancellationToken,Task<HttpResponseMessage>> send):HttpMessageHandler {public Func<HttpRequestMessage,CancellationToken,Task<HttpResponseMessage>> Callback=send;protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken ct)=>Callback(request,ct);}


}
