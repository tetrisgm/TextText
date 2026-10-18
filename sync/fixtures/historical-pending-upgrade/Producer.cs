using System.IO.Compression;
using System.Text;
using System.Text.Json;
using TextText.Core;
using System.Text.Json.Nodes;
var fixture=args[0];var root=Path.Combine(fixture,"root");var state=Path.Combine(fixture,"state");
var store=new TextPackStore(root,state);var remote=new Remote(Path.Combine(fixture,"remote.json"));var sync=new SyncEngine(store,remote);
byte[] Pack(string id,string body){using var output=new MemoryStream();using(var zip=new ZipArchive(output,ZipArchiveMode.Create,true)){using(var writer=new StreamWriter(zip.CreateEntry("text.md").Open(),new UTF8Encoding(false))){writer.Write($"---\ntextTextId: \"{id}\"\n---\n{body}");}var doc=JsonNode.Parse(File.ReadAllText(Path.Combine(fixture,"document.json")))!;doc["content"]!["body"]=body;doc["content"]!["title"]=id;using(var writer=new StreamWriter(zip.CreateEntry("document.json").Open())){writer.Write(doc.ToJsonString());}using(var asset=zip.CreateEntry("assets/opaque.bin").Open()){asset.Write(new byte[]{0,7,255,3});}}return output.ToArray();}
var initial=store.Write("Notes/Queued.textpack",Pack("historical-queued","Original body"));await sync.SyncAsync();
var pending=Pack(initial.ItemId,"Retained historical pending body");store.Write(initial.Path,pending,initial.Hash);remote.Fail=true;
try{await sync.SyncAsync();throw new Exception("Expected actual old transport failure");}catch(HttpRequestException){}
var shared=store.Write("Notes/Shared.textpack",Pack("historical-shared","Original shared"));var projection=Pack(shared.ItemId,"Retained historical shared body");
var update=File.ReadAllText(Path.Combine(fixture,"update.txt")).Trim();
var journal=JsonSerializer.Serialize(new{version=1,epoch=3,seq=7,journalGeneration=11,revision=shared.Hash,relativePath=shared.Path,update,pending=new[]{update}});
using(var editing=new SharedEditingStore(store,sync)){
 var session=await editing.OpenAsync(shared.ItemId,shared.Path,shared.Hash);
 await editing.CheckpointAsync(session.SessionToken,shared.Hash,projection,new(shared.ItemId,shared.Path,TextPackStore.Hash(projection),shared.Hash,3,7,11,journal,true));editing.Close(session.SessionToken);
}
var saved=File.ReadAllBytes(Path.Combine(state,"sync.json"));var parsed=JsonSerializer.Deserialize<SyncEngine.State>(saved)!;var op=parsed.Outbox.Single();
if(op.ItemId!=initial.ItemId||op.Payload is null||!Convert.FromBase64String(op.Payload).SequenceEqual(pending))throw new Exception("Old outbox payload not produced");
using(var doc=JsonDocument.Parse(saved)){if(doc.RootElement.TryGetProperty("AccountId",out _))throw new Exception("Old source unexpectedly has account binding");}
var cpPath=Path.Combine(state,"shared-editing",shared.ItemId,"checkpoint.json");var cpBytes=File.ReadAllBytes(cpPath);var cp=JsonSerializer.Deserialize<SharedCheckpoint>(cpBytes)!;
if(cp.Epoch!=3||cp.Seq!=7||cp.JournalGeneration!=11||cp.Journal!=journal||!cp.Pending)throw new Exception("Old checkpoint metadata changed");
File.WriteAllBytes(Path.Combine(fixture,"before-sync.json"),saved);File.WriteAllBytes(Path.Combine(fixture,"before-checkpoint.json"),cpBytes);
File.WriteAllBytes(Path.Combine(fixture,"pending.textpack"),pending);File.WriteAllBytes(Path.Combine(fixture,"projection.textpack"),projection);
File.WriteAllText(Path.Combine(fixture,"expect.json"),JsonSerializer.Serialize(new{OperationId=op.Id,PayloadHash=TextPackStore.Hash(pending),CheckpointHash=TextPackStore.Hash(cpBytes),Journal=journal}));
Console.WriteLine("PASS untouched historical Core APIs produced an unbound real failed-upload outbox and pending shared checkpoint");
sealed class Remote(string file):ISyncTransport{
 readonly Dictionary<string,RemotePack> data=[];public bool Fail;
 public Task<IReadOnlyList<RemoteItem>> ManifestAsync(CancellationToken ct=default)=>Task.FromResult<IReadOnlyList<RemoteItem>>(data.Select(x=>new RemoteItem(x.Key,x.Value.RelativePath,x.Value.Revision)).ToArray());
 public Task<RemotePack> DownloadAsync(string id,CancellationToken ct=default)=>Task.FromResult(data[id]);
 public Task<string> UploadAsync(string id,string path,byte[] bytes,string? revision,string operation,CancellationToken ct=default){if(Fail)throw new HttpRequestException("Fixture offline");var hash=TextPackStore.Hash(bytes);data[id]=new(bytes,path,hash);File.WriteAllText(file,JsonSerializer.Serialize(data));return Task.FromResult(hash);}
 public Task<string> RenameAsync(string id,string from,string to,string revision,string operation,CancellationToken ct=default)=>throw new Exception("Unexpected rename");
 public Task DeleteAsync(string id,string path,string revision,string operation,CancellationToken ct=default)=>throw new Exception("Unexpected deletion");
}
