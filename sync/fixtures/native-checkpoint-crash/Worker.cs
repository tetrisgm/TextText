using System.IO.Compression;using System.Text;using System.Text.Json;using System.Text.Json.Nodes;using TextText.Core;
var fixture=Path.GetFullPath(args[0]);var mode=args[1];var nonce=args[2];var action=args[3];
if(File.ReadAllText(Path.Combine(fixture,"fixture-nonce"))!=nonce||!Path.GetFileName(fixture).StartsWith("case-",StringComparison.Ordinal))throw new Exception("Unowned fixture");
var store=new TextPackStore(Path.Combine(fixture,"root"),Path.Combine(fixture,"state"));var origin=new Uri("https://checkpoint-crash.test");AccountRootOwnership.Open(store,origin,"fixture","fixture-account");var remote=new Remote(fixture);var sync=new SyncEngine(store,remote,"fixture-account",NativePolicyTestHost.Create("fixture-account"));
void Check(bool ok,string label){if(!ok)throw new Exception(label);Console.WriteLine("PASS "+label);}
const string path="Notes/Crash.textpack";const string id="checkpoint-crash";var cpDirectory=Path.Combine(store.StateDirectory,"shared-editing",id);
if(action=="worker"){
 byte[] Pack(string body){var doc=JsonNode.Parse(File.ReadAllText(Path.Combine(fixture,"document.json")))!;doc["content"]!["title"]="Checkpoint crash fixture";doc["content"]!["body"]=body;using var output=new MemoryStream();using(var zip=new ZipArchive(output,ZipArchiveMode.Create,true)){using(var text=new StreamWriter(zip.CreateEntry("text.md").Open(),new UTF8Encoding(false))){text.Write($"---\ntextTextId: {id}\n---\n{body}");}using(var canonical=new StreamWriter(zip.CreateEntry("document.json").Open())){canonical.Write(doc.ToJsonString());}using(var asset=zip.CreateEntry("assets/exact.bin").Open()){asset.Write(new byte[]{0,7,255,3,44});}}return output.ToArray();}
 var original=store.Write(path,Pack("Original"));await sync.SyncAsync();var initialUploads=remote.Uploads;
 using var editing=new SharedEditingStore(store,sync,"fixture-account");var session=await editing.OpenAsync(id,path,original.Hash);
 var bytes=Pack("Accepted durable checkpoint Unicode 終 ☃");var pending=mode!="queued-ack";var revision=pending?original.Hash:TextPackStore.Hash(bytes);
 // This controlled transport models the collaboration server having accepted
 // these exact bytes before a clean local checkpoint, not a real server gate.
 if(!pending)remote.AcceptAcknowledgedCheckpoint(id,path,bytes);
 remote.Hold=true;var traffic=sync.SyncAsync();await remote.Reached.Task.WaitAsync(TimeSpan.FromSeconds(5));
 var update=File.ReadAllText(Path.Combine(fixture,"update.txt")).Trim();var journal=JsonSerializer.Serialize(new{version=1,accountId="fixture-account",epoch=4,seq=6,journalGeneration=9,revision,relativePath=path,update,pending=pending?new[]{update}:Array.Empty<string>()});
 var checkpoint=new SharedCheckpoint(id,path,TextPackStore.Hash(bytes),revision,4,6,9,journal,pending);
 var accepted=await editing.CheckpointAsync(session.SessionToken,original.Hash,bytes,checkpoint);
 Check(accepted.Hash==checkpoint.ProjectedHash,"production CheckpointAsync returned exact accepted projection");
 var ack=Path.Combine(cpDirectory,"acknowledge.json");Check(File.Exists(ack)==!pending,"queued acknowledgement presence matches real sync gate overlap");
 if(mode=="after-close")editing.Close(session.SessionToken);
 File.WriteAllBytes(Path.Combine(fixture,"accepted.textpack"),bytes);File.WriteAllBytes(Path.Combine(fixture,"accepted-checkpoint.json"),File.ReadAllBytes(Path.Combine(cpDirectory,"checkpoint.json")));
 if(File.Exists(ack))File.WriteAllBytes(Path.Combine(fixture,"accepted-ack.json"),File.ReadAllBytes(ack));
 File.WriteAllText(Path.Combine(fixture,"expected.json"),JsonSerializer.Serialize(new{Hash=accepted.Hash,Revision=revision,Pending=pending,InitialUploads=initialUploads}));
 Console.WriteLine("READY "+JsonSerializer.Serialize(new{pid=Environment.ProcessId,nonce,mode,returned=true,generation=9,sessionReleased=mode=="after-close",queuedAcknowledgement=File.Exists(ack)}));Console.Out.Flush();await Task.Delay(Timeout.Infinite);
}else if(action=="reopen"){
 var expected=JsonNode.Parse(File.ReadAllText(Path.Combine(fixture,"expected.json")))!;var hash=expected["Hash"]!.GetValue<string>();var pending=expected["Pending"]!.GetValue<bool>();
 Check(store.Read(path).SequenceEqual(File.ReadAllBytes(Path.Combine(fixture,"accepted.textpack"))),"process-killed accepted projection and opaque assets exact");
 Check(File.ReadAllBytes(Path.Combine(cpDirectory,"checkpoint.json")).SequenceEqual(File.ReadAllBytes(Path.Combine(fixture,"accepted-checkpoint.json"))),"process-killed accepted journal bytes exact before replay");
 var ack=Path.Combine(cpDirectory,"acknowledge.json");if(!pending)Check(File.ReadAllBytes(ack).SequenceEqual(File.ReadAllBytes(Path.Combine(fixture,"accepted-ack.json"))),"queued ACK bytes survived actual process kill");
 await sync.SyncAsync();Check(!File.Exists(ack),"fresh process completes queued baseline acknowledgement replay");
 Check(remote.Uploads==expected["InitialUploads"]!.GetValue<int>(),"recovery sends no duplicate/unintended file upload");
 var state=JsonSerializer.Deserialize<SyncEngine.State>(File.ReadAllBytes(Path.Combine(store.StateDirectory,"sync.json")))!;
 if(!pending)Check(state.Items[id].Hash==hash&&state.Items[id].Revision==expected["Revision"]!.GetValue<string>(),"ACK baseline persisted with exact accepted projection and acknowledged revision");
 using var editing=new SharedEditingStore(store,sync,"fixture-account");var session=await editing.OpenAsync(id,path,hash);var cp=session.Checkpoint;
 Check(cp is not null&&cp.Epoch==4&&cp.Seq==6&&cp.JournalGeneration==9&&cp.ProjectedHash==hash&&cp.Pending==pending,"fresh session recovers accepted epoch/seq/generation and pending semantics");
 Check(File.ReadAllBytes(Path.Combine(cpDirectory,"checkpoint.json")).SequenceEqual(File.ReadAllBytes(Path.Combine(fixture,"accepted-checkpoint.json"))),"reopen does not rewrite accepted journal");editing.Close(session.SessionToken);
 Console.WriteLine("RECOVERED "+mode);
}else throw new Exception("Unknown action");
sealed class Remote:ISyncTransport{
 readonly string file;readonly string counts;readonly Dictionary<string,RemotePack> data;public int Uploads;public bool Hold;public TaskCompletionSource Reached=new(TaskCreationOptions.RunContinuationsAsynchronously);
 public Remote(string fixture){file=Path.Combine(fixture,"remote.json");counts=Path.Combine(fixture,"uploads.txt");data=File.Exists(file)?JsonSerializer.Deserialize<Dictionary<string,RemotePack>>(File.ReadAllText(file))!:[];Uploads=File.Exists(counts)?int.Parse(File.ReadAllText(counts)):0;}
 public WorkspaceCapabilities? Capabilities=>new(true,true,[],new(){["checkpoint-crash"]=true});
 public async Task<IReadOnlyList<RemoteItem>> ManifestAsync(CancellationToken ct=default){if(Hold){Reached.TrySetResult();await Task.Delay(Timeout.Infinite,ct);}return data.Select(x=>new RemoteItem(x.Key,x.Value.RelativePath,x.Value.Revision)).ToArray();}
 public Task<RemotePack> DownloadAsync(string id,CancellationToken ct=default)=>Task.FromResult(data[id]);
 public void AcceptAcknowledgedCheckpoint(string id,string path,byte[] bytes){data[id]=new(bytes,path,TextPackStore.Hash(bytes));File.WriteAllText(file,JsonSerializer.Serialize(data));}
 public Task<string> UploadAsync(string id,string path,byte[] bytes,string? revision,string operation,CancellationToken ct=default){Uploads++;File.WriteAllText(counts,Uploads.ToString());AcceptAcknowledgedCheckpoint(id,path,bytes);return Task.FromResult(TextPackStore.Hash(bytes));}
 public Task<RemoteBinaryManifest> BinaryManifestAsync(string id,CancellationToken ct=default)=>Task.FromResult(new RemoteBinaryManifest(data[id].Revision,BinaryEntryPacks.Assets(data[id].Data).Values.Select(x=>new RemoteBinaryEntry(x.Path,x.Sha256,x.Bytes.Length)).ToArray()));
 public Task<byte[]> BinaryReadAsync(string id,string path,CancellationToken ct=default)=>Task.FromResult(BinaryEntryPacks.Assets(data[id].Data)[path].Bytes);
 public Task<string> RenameAsync(string id,string from,string to,string revision,string operation,CancellationToken ct=default)=>throw new Exception("Unexpected rename");
 public Task DeleteAsync(string id,string path,string revision,string operation,CancellationToken ct=default)=>throw new Exception("Unexpected deletion");
}
