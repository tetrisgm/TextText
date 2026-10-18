using System.Text.Json;
using System.Text.Json.Nodes;
using TextText.Core;
var fixture=args[0];var phase=args[1];var store=new TextPackStore(Path.Combine(fixture,"root"),Path.Combine(fixture,"state"));var remote=new Remote(fixture);
var origin=new Uri("https://historical-upgrade.test");var statePath=Path.Combine(store.StateDirectory,"sync.json");const string cpRelative="shared-editing/historical-shared/checkpoint.json";var cpPath=Path.Combine(store.StateDirectory,cpRelative);
var expected=JsonNode.Parse(File.ReadAllText(Path.Combine(fixture,"expect.json")))!;var operation=expected["OperationId"]!.GetValue<string>();
void Check(bool ok,string label){if(!ok)throw new Exception(label);Console.WriteLine("PASS "+label);}
bool Refuses(Action action){try{action();return false;}catch(Exception e)when(e is LegacyAccountStateException or SharedAccountMismatchException or InvalidDataException){return true;}}
var before=File.ReadAllBytes(Path.Combine(fixture,"before-sync.json"));var beforeCheckpoint=File.ReadAllBytes(Path.Combine(fixture,"before-checkpoint.json"));
void PendingIntact(){Check(File.ReadAllBytes(Path.Combine(store.Root,"Notes/Queued.textpack")).SequenceEqual(File.ReadAllBytes(Path.Combine(fixture,"pending.textpack")))&&File.ReadAllBytes(Path.Combine(store.Root,"Notes/Shared.textpack")).SequenceEqual(File.ReadAllBytes(Path.Combine(fixture,"projection.textpack"))),"exact pending pack/opaque asset bytes retained");}
if(phase=="interrupt"){
 Check(Refuses(()=>AccountRootOwnership.Open(store,origin,"fixture","account-a")),"current account factory refuses actual historical unbound state");
 Check(Refuses(()=>{_=new SyncEngine(store,remote,"account-a",NativePolicyTestHost.Create("account-a"));}),"current sync refuses historical state before transport replay");
 Check(remote.Requests==0&&File.ReadAllBytes(statePath).SequenceEqual(before)&&File.ReadAllBytes(cpPath).SequenceEqual(beforeCheckpoint),"unbound refusal makes zero RPC and preserves original metadata exactly");
 var interrupted=false;try{AccountStateAdoption.AdoptAfterExplicitReview(store,origin,"fixture","account-a",step=>{if(step=="applied:"+cpRelative)throw new Interrupted();});}catch(Interrupted){interrupted=true;}
 Check(interrupted&&File.Exists(Path.Combine(store.StateDirectory,AccountRootOwnership.PendingAdoption)),"explicit historical adoption interrupted after checkpoint application with durable intent");
 Check(Refuses(()=>store.Read("Notes/Queued.textpack")),"ordinary current read stays fenced until interrupted adoption completes");PendingIntact();Check(remote.Requests==0,"interrupted adoption makes no transport request");
}else if(phase=="resume"){
 Check(Refuses(()=>AccountStateAdoption.AdoptAfterExplicitReview(store,origin,"fixture","account-b")),"foreign principal cannot resume recorded historical adoption");
 var result=AccountStateAdoption.AdoptAfterExplicitReview(store,origin,"fixture","account-a");Check(result.RecoveryDirectory is not null&&!result.AlreadyBound,"fresh process resumes exact recorded account adoption");
 Check(File.ReadAllBytes(Path.Combine(result.RecoveryDirectory!,"before","sync.json")).SequenceEqual(before)&&File.ReadAllBytes(Path.Combine(result.RecoveryDirectory!,"before",cpRelative)).SequenceEqual(beforeCheckpoint),"original historical sync/checkpoint bytes archived exactly");
 var state=JsonSerializer.Deserialize<SyncEngine.State>(File.ReadAllBytes(statePath))!;var cp=JsonSerializer.Deserialize<SharedCheckpoint>(File.ReadAllBytes(cpPath))!;
 Check(state.AccountId=="account-a"&&state.Outbox.Single().Id==operation&&TextPackStore.Hash(Convert.FromBase64String(state.Outbox.Single().Payload!))==expected["PayloadHash"]!.GetValue<string>(),"adoption retains exact historical operation ID and payload with explicit principal binding");
 var journal=JsonNode.Parse(cp.Journal)!;Check(journal["accountId"]!.GetValue<string>()=="account-a","shared pending journal explicitly binds reviewed principal");journal.AsObject().Remove("accountId");
 Check(JsonNode.DeepEquals(journal,JsonNode.Parse(expected["Journal"]!.GetValue<string>()))&&cp.Epoch==3&&cp.Seq==7&&cp.JournalGeneration==11&&cp.Pending,"historical shared update/pending bytes and epoch/seq/generation remain unchanged");
 PendingIntact();Check(Refuses(()=>{_=new SyncEngine(store,remote,"account-b",NativePolicyTestHost.Create("account-b"));})&&remote.Requests==0,"foreign principal cannot replay adopted historical queue");
 var sync=new SyncEngine(store,remote,"account-a",NativePolicyTestHost.Create("account-a"));await sync.SyncAsync();
 Check(remote.Uploads==1&&remote.LastOperation==operation&&remote.LastHash==expected["PayloadHash"]!.GetValue<string>(),"controlled current replay accepts exact historical pending operation and payload once");
 using var editor=new SharedEditingStore(store,sync,"account-a");var pack=store.Describe("Notes/Shared.textpack");var reopened=await editor.OpenAsync(pack.ItemId,pack.Path,pack.Hash);Check(reopened.Checkpoint?.Pending==true&&reopened.Checkpoint.JournalGeneration==11&&reopened.Checkpoint.Epoch==3&&reopened.Checkpoint.Seq==7,"current shared session reopens retained historical pending checkpoint");editor.Close(reopened.SessionToken);
}else if(phase=="reopen"){
 AccountRootOwnership.Open(store,origin,"fixture","account-a");var sync=new SyncEngine(store,remote,"account-a",NativePolicyTestHost.Create("account-a"));await sync.SyncAsync();Check(remote.Uploads==1&&remote.LastOperation==operation,"fresh process does not duplicate acknowledged historical upload");PendingIntact();
}else throw new Exception("Unknown phase");
sealed class Interrupted:IOException;
sealed class Remote:ISyncTransport{
 readonly string receipt;readonly string dataFile;readonly Dictionary<string,RemotePack> data;public int Requests;public int Uploads;public string? LastOperation;public string? LastHash;
 public Remote(string fixture){dataFile=Path.Combine(fixture,"remote.json");receipt=Path.Combine(fixture,"replay.json");data=JsonSerializer.Deserialize<Dictionary<string,RemotePack>>(File.ReadAllText(dataFile))!;if(File.Exists(receipt)){var saved=JsonNode.Parse(File.ReadAllText(receipt))!;Uploads=saved["Uploads"]!.GetValue<int>();LastOperation=saved["LastOperation"]!.GetValue<string>();LastHash=saved["LastHash"]!.GetValue<string>();}}
 public WorkspaceCapabilities? Capabilities=>new(true,true,[],new(){["historical-queued"]=true,["historical-shared"]=true});
 public Task<IReadOnlyList<RemoteItem>> ManifestAsync(CancellationToken ct=default){Requests++;return Task.FromResult<IReadOnlyList<RemoteItem>>(data.Select(x=>new RemoteItem(x.Key,x.Value.RelativePath,x.Value.Revision)).ToArray());}
 public Task<RemotePack> DownloadAsync(string id,CancellationToken ct=default){Requests++;return Task.FromResult(data[id]);}
 public Task<string> UploadAsync(string id,string path,byte[] bytes,string? revision,string operation,CancellationToken ct=default){Requests++;if(id!="historical-queued"||data[id].Revision!=revision)throw new Exception("Unexpected replay");Uploads++;LastOperation=operation;LastHash=TextPackStore.Hash(bytes);data[id]=new(bytes,path,LastHash);File.WriteAllText(dataFile,JsonSerializer.Serialize(data));File.WriteAllText(receipt,JsonSerializer.Serialize(new{Uploads,LastOperation,LastHash}));return Task.FromResult(LastHash);}
 public Task<string> RenameAsync(string id,string from,string to,string revision,string operation,CancellationToken ct=default)=>throw new Exception("Unexpected rename");
 public Task DeleteAsync(string id,string path,string revision,string operation,CancellationToken ct=default)=>throw new Exception("Unexpected delete");
}
