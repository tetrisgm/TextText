using TextText.Core;
using System.IO.Compression;
using System.Text;
using System.Text.Json;
static class Test
{
 static void Assert(bool condition,string label){if(!condition)throw new Exception(label);Console.WriteLine("PASS "+label);}
 static void Throws<T>(Action action,string label) where T:Exception {try{action();}catch(T){Console.WriteLine("PASS "+label);return;}throw new Exception(label);}
 static byte[] Pack(string body="hello",string id="test-1") {using var output=new MemoryStream();using(var zip=new ZipArchive(output,ZipArchiveMode.Create,true)){using(var w=new StreamWriter(zip.CreateEntry("text.md").Open()))w.Write("---\ntextTextId: \""+id+"\"\n---\n"+body);using(var w=new StreamWriter(zip.CreateEntry("unknown.bin").Open()))w.Write("opaque-original");}return output.ToArray();}
 static async Task Main(){var temporaryRoot=Path.GetTempPath();if(OperatingSystem.IsMacOS()&&temporaryRoot.StartsWith("/var/"))temporaryRoot="/private"+temporaryRoot;var temp=Path.Combine(temporaryRoot,"texttext-core-test-"+Guid.NewGuid());Directory.CreateDirectory(temp);try{
 var store=new TextPackStore(Path.Combine(temp,"workspace"),Path.Combine(temp,"device"));
 Throws<IOException>(()=>store.Resolve("../outside.textpack"),"reject traversal");Throws<IOException>(()=>store.Resolve("Notes/a.textpack:stream"),"reject alternate data streams");
 var folderStore=new TextPackStore(Path.Combine(temp,"folders"),Path.Combine(temp,"folder-device"));
 var folderRemote=new Fake{Folders=["Feeds","Research/Empty"]};
 await new SyncEngine(folderStore,folderRemote).SyncAsync();
 Assert(Directory.Exists(Path.Combine(folderStore.Root,"Research","Empty")),"sync materializes empty remote folders");
 folderRemote.Folders=[];await new SyncEngine(folderStore,folderRemote).SyncAsync();
 Assert(Directory.Exists(Path.Combine(folderStore.Root,"Feeds")),"omitted remote folder remains local");
 folderRemote.AuthoritativeFolders=["Feeds","Research","Research/Empty","Keep","UnknownParent","Placeholder"];
 folderRemote.Folders=folderRemote.AuthoritativeFolders;await new SyncEngine(folderStore,folderRemote).SyncAsync();
 File.WriteAllText(Path.Combine(folderStore.Root,"Keep","readme.txt"),"local content");
 Directory.CreateDirectory(Path.Combine(folderStore.Root,"UnknownParent","Local child"));
 File.WriteAllText(Path.Combine(folderStore.Root,".Placeholder.icloud"),"");
 folderRemote.AuthoritativeFolders=null;folderRemote.Folders=[];await new SyncEngine(folderStore,folderRemote).SyncAsync();
 Assert(Directory.Exists(Path.Combine(folderStore.Root,"Research","Empty")),"missing authoritative catalog preserves tracked folders");
 folderRemote.AuthoritativeFolders=["After","After/Empty"];folderRemote.Folders=folderRemote.AuthoritativeFolders;
 await new SyncEngine(folderStore,folderRemote).SyncAsync();
 Assert(!Directory.Exists(Path.Combine(folderStore.Root,"Research"))&&!Directory.Exists(Path.Combine(folderStore.Root,"Feeds")),"authoritative removed folder tree prunes empty directories after restart");
 Assert(Directory.Exists(Path.Combine(folderStore.Root,"After","Empty")),"new empty folder tree materializes");
 Assert(File.ReadAllText(Path.Combine(folderStore.Root,"Keep","readme.txt"))=="local content"&&Directory.Exists(Path.Combine(folderStore.Root,"UnknownParent","Local child")),"untracked content and empty descendants survive folder removal");
 Assert(Directory.Exists(Path.Combine(folderStore.Root,"Placeholder")),"provider placeholder prevents folder removal");
 File.Delete(Path.Combine(folderStore.Root,"Keep","readme.txt"));File.Delete(Path.Combine(folderStore.Root,".Placeholder.icloud"));
 await new SyncEngine(folderStore,folderRemote).SyncAsync();
 Assert(!Directory.Exists(Path.Combine(folderStore.Root,"Keep"))&&!Directory.Exists(Path.Combine(folderStore.Root,"Placeholder")),"retained catalog removals retry durably after content and provider blockage clear");
 Directory.CreateDirectory(Path.Combine(folderStore.Root,"Feeds"));
 foreach(var unsafePath in new[]{"../escape",".texttext/cache","Notes//bad","Fake.textpack/child"})Throws<IOException>(()=>folderStore.EnsureFolders([unsafePath]),"remote folder rejects "+unsafePath);
 File.WriteAllText(Path.Combine(folderStore.Root,"Occupied"),"keep");Throws<IOException>(()=>folderStore.EnsureFolders(["Occupied/child"]),"remote folder preserves existing file");
 Directory.CreateSymbolicLink(Path.Combine(folderStore.Root,"Linked"),Path.Combine(folderStore.Root,"Feeds"));Throws<IOException>(()=>folderStore.EnsureFolders(["Linked/child"]),"remote folder rejects symlink");
 File.WriteAllText(Path.Combine(folderStore.Root,".Pending.icloud"),"");Throws<IOException>(()=>folderStore.EnsureFolders(["Pending"]),"remote folder respects placeholder");
 folderRemote.Folders=["Occupied/child","Another empty"];folderRemote.Data=Pack("remote","folder-proof");folderRemote.Item=new("folder-proof","Notes/Folder-proof.textpack",TextPackStore.Hash(folderRemote.Data));
 var collisionSync=new SyncEngine(folderStore,folderRemote);await collisionSync.SyncAsync();Assert(File.Exists(folderStore.Resolve("Notes/Folder-proof.textpack"))&&Directory.Exists(Path.Combine(folderStore.Root,"Another empty"))&&collisionSync.Status.Error!=null,"folder collision does not block unrelated document convergence");
 folderStore.Delete("Notes/Folder-proof.textpack",TextPackStore.Hash(folderRemote.Data));
 var first=store.Write("Notes/Test.textpack",Pack());Assert(first.ItemId=="test-1","identity extraction");
 using(var fixture=JsonDocument.Parse(File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory,"workspace-binding.json"))))
 foreach(var example in fixture.RootElement.EnumerateArray()) {
 var fixtureRoot=Path.Combine(temp,"fixture-"+Guid.NewGuid());Directory.CreateDirectory(Path.Combine(fixtureRoot,".texttext"));
 File.WriteAllText(Path.Combine(fixtureRoot,".texttext","workspace-binding.json"),example.GetProperty("marker").GetRawText());
 var label="shared workspace binding fixture: "+example.GetProperty("name").GetString();
 if(example.GetProperty("valid").GetBoolean()) Assert(WorkspaceLocation.Validate(fixtureRoot,"https://texttext.app/","workspace-1")==fixtureRoot,label);
 else Throws<IOException>(()=>WorkspaceLocation.Validate(fixtureRoot,"https://texttext.app/","workspace-1"),label);
 }
 var macFolder=Path.Combine(temp,"mac-folder");Directory.CreateDirectory(Path.Combine(macFolder,".texttext","sync"));
 var macJournal=Path.Combine(macFolder,".texttext","sync","state.json");
 File.WriteAllText(macJournal,"{\"binding\":{\"origin\":\"https://TEXTTEXT.app\",\"workspaceId\":\"workspace-a\"},\"cursor\":900,\"outbox\":{}}");
 var originalMacJournal=File.ReadAllText(macJournal);
 Assert(WorkspaceLocation.Validate(macFolder,"https://texttext.app/","workspace-a")==macFolder,"Mac legacy binding canonicalizes origin");
 WorkspaceLocation.Bind(macFolder,"https://texttext.app/","workspace-a");
 Assert(File.ReadAllText(macJournal)==originalMacJournal,"Mac foreign cursor and outbox remain untouched");
 Throws<IOException>(()=>WorkspaceLocation.Validate(macFolder,"https://texttext.app","workspace-b"),"Mac legacy binding rejects other workspace");
 Assert(File.ReadAllText(Path.Combine(macFolder,".texttext","workspace-binding.json")).Contains("\"workspaceId\""),"portable binding uses shared camelCase schema");
 var interruptedBinding=Path.Combine(temp,"binding-interruptedBinding");Directory.CreateDirectory(Path.Combine(interruptedBinding,".texttext"));
 var interruptedBindingTemporary=Path.Combine(interruptedBinding,".texttext",".workspace-binding-interruptedBinding.tmp");File.WriteAllText(interruptedBindingTemporary,"{partial");
 WorkspaceLocation.Bind(interruptedBinding,"https://texttext.app/","workspace-a");
 Assert(File.Exists(interruptedBindingTemporary)&&WorkspaceLocation.HasBinding(interruptedBinding),"interruptedBinding marker temporary is ignored and preserved");
 WorkspaceLocation.Bind(interruptedBinding,"https://texttext.app/","workspace-a");
 Assert(Directory.GetFiles(Path.Combine(interruptedBinding,".texttext"),"*.tmp").Length==1,"marker publication cleans only its own temporary");
 var alternate=Path.Combine(temp,"alternate");Directory.CreateDirectory(alternate);
 WorkspaceLocation.Bind(alternate,"https://texttext.app/","workspace-a");
 Assert(WorkspaceLocation.Validate(alternate,"https://texttext.app/","workspace-a")==alternate,"workspace location validates saved binding");
 Throws<IOException>(()=>WorkspaceLocation.Validate(alternate,"https://texttext.app/","workspace-b"),"workspace location rejects other workspace");
 Throws<IOException>(()=>WorkspaceLocation.Validate(alternate,"https://other.example/","workspace-a"),"workspace location rejects other server");
 File.WriteAllText(Path.Combine(alternate,".texttext","workspace-binding.json"),"{bad");
 Throws<IOException>(()=>WorkspaceLocation.Validate(alternate,"https://texttext.app/","workspace-a"),"workspace location preserves corrupt binding");
 Assert(FileActivation.Resolve(store,Path.Combine(store.Root,"Notes","Test.textpack"))==first.Path,"activation resolves existing workspace pack");
 Throws<IOException>(()=>FileActivation.Resolve(store,Path.Combine(temp,"outside.textpack")),"activation rejects outside workspace");
 Throws<IOException>(()=>FileActivation.Resolve(store,"Notes/Test.textpack"),"activation rejects relative arguments");
 Throws<IOException>(()=>FileActivation.Resolve(store,Path.Combine(store.Root,"Notes","Test.md")),"activation rejects non TextPack arguments");
 Throws<FileNotFoundException>(()=>FileActivation.Resolve(store,Path.Combine(store.Root,"Notes","missing.textpack")),"activation rejects missing pack");
 Throws<FileChangedException>(()=>store.Write(first.Path,Pack("overwrite"),"stale"),"stale write rejected");
 var changed=store.UpdateMarkdown(first.Path,"---\ntextTextId: \"test-1\"\n---\nmodified",first.Hash);
 using(var zip=new ZipArchive(new MemoryStream(store.Read(first.Path))))using(var reader=new StreamReader(zip.GetEntry("unknown.bin")!.Open()))Assert(reader.ReadToEnd()=="opaque-original","opaque assets preserved");
 var transport=new Fake();var engine=new SyncEngine(store,transport);await engine.SyncAsync();Assert(transport.UploadCount==1,"initial upload");await engine.SyncAsync();Assert(transport.UploadCount==1,"idle pass has no uploads");
 var current=store.Describe(first.Path);store.UpdateMarkdown(first.Path,TextPackStore.Markdown(store.Read(first.Path))+"\nexternal",current.Hash);
 transport.FailAfterCommit=true;try{await engine.SyncAsync();throw new Exception("expected lost ACK");}catch(HttpRequestException){}
 var operations=transport.Operations.ToArray();await new SyncEngine(store,transport).SyncAsync(localChangesOnly:true);Assert(transport.Operations.Last()==operations.Last(),"lost ACK replays same durable operation ID");Assert(transport.UploadCount==2,"replay applies exactly once");
 current=store.Describe(first.Path);store.Rename(first.Path,"Notes/Renamed.textpack",current.Hash);await new SyncEngine(store,transport).SyncAsync();Assert(transport.Item!.RelativePath=="Notes/Renamed.textpack","rename sync survives engine restart");
 File.Move(store.Resolve("Notes/Renamed.textpack"),Path.Combine(temp,"evicted.textpack"));await engine.SyncAsync();Assert(transport.DeleteCount==0,"missing provider file is not deletion");File.Move(Path.Combine(temp,"evicted.textpack"),store.Resolve("Notes/Renamed.textpack"));
 current=store.Describe("Notes/Renamed.textpack");store.Delete(current.Path,current.Hash);await new SyncEngine(store,transport).SyncAsync();Assert(transport.DeleteCount==1,"explicit delete survives restart");Assert(Directory.GetFiles(Path.Combine(store.StateDirectory,"recovery"),"trash-*").Length==1,"delete preserves recoverable bytes");
 File.WriteAllText(Path.Combine(store.StateDirectory,"sync.json"),"{\"Version\":999}");try{await engine.SyncAsync();throw new Exception("future state accepted");}catch(InvalidDataException){}Assert(File.ReadAllText(Path.Combine(store.StateDirectory,"sync.json")).Contains("999"),"future state fails closed without rewriting");

 var other=new TextPackStore(Path.Combine(temp,"second"),Path.Combine(temp,"second-device"));var otherTransport=new Fake();var otherEngine=new SyncEngine(other,otherTransport);
 var seed=other.Write("Notes/Concurrent.textpack",Pack());await otherEngine.SyncAsync();
 other.UpdateMarkdown(seed.Path,TextPackStore.Markdown(other.Read(seed.Path))+" local",other.Describe(seed.Path).Hash);
 otherTransport.Data=Pack("remote");otherTransport.Item=otherTransport.Item! with{Revision=TextPackStore.Hash(otherTransport.Data)};
 await otherEngine.SyncAsync();Assert(otherEngine.Status.Error!=null,"conflict reports retained copies");
 Assert(TextPackStore.Markdown(other.Read(seed.Path)).EndsWith(" local"),"conflict preserves current local document");
 Assert(Directory.GetFiles(Path.Combine(other.StateDirectory,"recovery"),"remote-conflict-*").Length==1,"conflict preserves remote document");
 var resumed=new TextPackStore(Path.Combine(temp,"incoming"),Path.Combine(temp,"incoming-device"));var payload=Pack("downloaded");resumed.Write("Notes/Moved.textpack",payload);
 var state=new SyncEngine.State{PendingPull=new("test-1","Notes/Moved.textpack","Notes/Old.textpack","oldhash",TextPackStore.Hash(payload),Convert.ToBase64String(payload))};
 TextPackStore.AtomicWrite(Path.Combine(resumed.StateDirectory,"sync.json"),JsonSerializer.SerializeToUtf8Bytes(state));
 var resumedTransport=new Fake{Item=new("test-1","Notes/Moved.textpack",TextPackStore.Hash(payload)),Data=payload};await new SyncEngine(resumed,resumedTransport).SyncAsync(localChangesOnly:true);
 Assert(resumedTransport.UploadCount==0,"interrupted incoming apply resumes without reupload");
 var fenced=new TextPackStore(Path.Combine(temp,"fenced"),Path.Combine(temp,"fenced-device"));var ft=new Fake();var fe=new SyncEngine(fenced,ft);var ff=fenced.Write("Notes/Edit.textpack",Pack());await fe.SyncAsync();
 using(var lease=await fe.AcquireCollaborationAsync("test-1")){var updated=fenced.UpdateMarkdown(ff.Path,TextPackStore.Markdown(fenced.Read(ff.Path))+" collaborative",fenced.Describe(ff.Path).Hash);await fe.SyncAsync();Assert(ft.UploadCount==1,"active collaboration fences file upload");ft.Data=fenced.Read(ff.Path);ft.Item=ft.Item! with{Revision=updated.Hash};await fe.AcknowledgeCheckpointAsync("test-1",ff.Path,updated.Hash,updated.Hash);}
 await fe.SyncAsync();Assert(ft.UploadCount==1,"acknowledged checkpoint avoids duplicate upload");
 var encoded=Pack();using(var ms=new MemoryStream()) {using(var z=new ZipArchive(ms,ZipArchiveMode.Create,true))using(var original=new ZipArchive(new MemoryStream(encoded)))foreach(var e in original.Entries.Reverse()){var copy=z.CreateEntry(e.FullName,CompressionLevel.NoCompression);using var dst=copy.Open();using var src=e.Open();src.CopyTo(dst);}Assert(TextPackStore.Equivalent(encoded,ms.ToArray()),"ZIP encoding changes preserve logical equality");}
 var sharedTransport=new Fake();var sharedFiles=new TextPackStore(Path.Combine(temp,"shared"),Path.Combine(temp,"shared-device"));var initial=sharedFiles.Write("Notes/Shared.textpack",Pack());var sharedSync=new SyncEngine(sharedFiles,sharedTransport);await sharedSync.SyncAsync();
 using(var shared=new SharedEditingStore(sharedFiles,sharedSync)) {
 var firstSession=await shared.OpenAsync("test-1",initial.Path,sharedFiles.Describe(initial.Path).Hash);var secondSession=await shared.OpenAsync("test-1",initial.Path,firstSession.Document.Hash);shared.Close(firstSession.SessionToken);
 var content=Pack("shared-pending");var cp=new SharedCheckpoint("test-1",initial.Path,TextPackStore.Hash(content),sharedTransport.Item!.Revision,1,0,1,JsonSerializer.Serialize(new{version=1,epoch=1,seq=0,journalGeneration=1,revision=sharedTransport.Item.Revision,relativePath=initial.Path,update="AAA=",pending=new[]{"AAA="}}),true);
 await shared.CheckpointAsync(secondSession.SessionToken,secondSession.Document.Hash,content,cp);Assert(TextPackStore.Markdown(sharedFiles.Read(initial.Path)).EndsWith("shared-pending"),"late close cannot invalidate replacement session");
 try{await shared.CheckpointAsync(firstSession.SessionToken,secondSession.Document.Hash,content,cp);throw new Exception("stale session accepted");}catch(InvalidOperationException){}
 shared.Close(secondSession.SessionToken);await sharedSync.SyncAsync();Assert(sharedTransport.UploadCount==1,"pending journal fences file sync after close");
 using var restarted=new SharedEditingStore(sharedFiles,sharedSync);var recovered=await restarted.OpenAsync("test-1",initial.Path,sharedFiles.Describe(initial.Path).Hash);Assert(recovered.Checkpoint?.Journal==cp.Journal,"pending shared journal survives restart");
 var invalid=cp with{Version=99};try{await restarted.CheckpointAsync(recovered.SessionToken,recovered.Document.Hash,content,invalid);throw new Exception("future checkpoint accepted");}catch(InvalidDataException){}
 Assert(JsonSerializer.Deserialize<SharedCheckpoint>(File.ReadAllText(Path.Combine(sharedFiles.StateDirectory,"shared-editing","test-1","checkpoint.json")))!.Journal==cp.Journal,"unknown checkpoint version does not erase retained state");
 }
 var isolated=new TextPackStore(Path.Combine(temp,"isolated"),Path.Combine(temp,"isolated-device"));var many=new Many();var isolatedSync=new SyncEngine(isolated,many);
 var one=isolated.Write("Notes/One.textpack",Pack("one","one"));var two=isolated.Write("Notes/Two.textpack",Pack("two","two"));await isolatedSync.SyncAsync();
 isolated.UpdateMarkdown(one.Path,TextPackStore.Markdown(isolated.Read(one.Path))+" local",isolated.Describe(one.Path).Hash);isolated.UpdateMarkdown(two.Path,TextPackStore.Markdown(isolated.Read(two.Path))+" local",isolated.Describe(two.Path).Hash);
 many.Items["one"].Data=Pack("remote","one");many.Items["one"].Item=many.Items["one"].Item! with{Revision=TextPackStore.Hash(many.Items["one"].Data)};
 await isolatedSync.SyncAsync();Assert(many.Items["two"].UploadCount==2,"conflicting item does not block unrelated file sync");Assert(!await isolatedSync.IsReadyAsync("one")&&await isolatedSync.IsReadyAsync("two"),"readiness reflects per-item durability");
 using(var recoveryStore=new SharedEditingStore(sharedFiles,sharedSync)){var session=await recoveryStore.OpenAsync("test-1",initial.Path,sharedFiles.Describe(initial.Path).Hash);var recovery=sharedFiles.Write("Notes/Recovery.textpack",Pack("preserved shared edits","recovered-id"));await recoveryStore.RecoverAsync(session.SessionToken,recovery.Path,recovery.Hash);Assert(!SharedEditingStore.HasProtectedState(sharedFiles.StateDirectory,"test-1"),"explicit verified recovery releases protected journal");Assert(Directory.GetDirectories(Path.Combine(sharedFiles.StateDirectory,"shared-editing","test-1"),"archive-*").Length==1,"recovery archives previous shared journal");}
 var beforeCrash=sharedFiles.Describe(initial.Path);var crashBytes=Pack("crash-recovered");var crashRevision=sharedTransport.Item!.Revision;
 var crashCheckpoint=new SharedCheckpoint("test-1",initial.Path,TextPackStore.Hash(crashBytes),crashRevision,1,0,2,JsonSerializer.Serialize(new{version=1,epoch=1,seq=0,journalGeneration=2,revision=crashRevision,relativePath=initial.Path,update="AAA=",pending=new[]{"AAA="}}),true);
 TextPackStore.AtomicWrite(Path.Combine(sharedFiles.StateDirectory,"shared-editing","test-1","intent.json"),JsonSerializer.SerializeToUtf8Bytes(new{Version=1,BeforeHash=beforeCrash.Hash,Payload=Convert.ToBase64String(crashBytes),Checkpoint=crashCheckpoint}));
 using(var crashRecovery=new SharedEditingStore(sharedFiles,sharedSync)){var opened=await crashRecovery.OpenAsync("test-1",initial.Path,beforeCrash.Hash);Assert(opened.Document.Hash==TextPackStore.Hash(crashBytes)&&opened.Checkpoint?.Pending==true,"journal-first interrupted materialization resumes after restart");}
 var initialEquivalent=new TextPackStore(Path.Combine(temp,"equivalent"),Path.Combine(temp,"equivalent-device"));var eqBytes=Pack();var eqLocal=initialEquivalent.Write("Notes/Equal.textpack",eqBytes);byte[] differentlyEncoded;
 using(var stream=new MemoryStream()){using(var zip=new ZipArchive(stream,ZipArchiveMode.Create,true))using(var original=new ZipArchive(new MemoryStream(eqBytes)))foreach(var entry in original.Entries.Reverse()){using var to=zip.CreateEntry(entry.FullName,CompressionLevel.NoCompression).Open();using var from=entry.Open();from.CopyTo(to);}differentlyEncoded=stream.ToArray();}
 var eqTransport=new Fake{Data=differentlyEncoded,Item=new("test-1",eqLocal.Path,TextPackStore.Hash(differentlyEncoded))};var eqEngine=new SyncEngine(initialEquivalent,eqTransport);await eqEngine.SyncAsync();Assert(eqTransport.UploadCount==0&&await eqEngine.IsReadyAsync("test-1"),"equivalent initial archive adopts baseline without upload and is ready");Assert(await eqEngine.BaselineRevisionAsync("test-1")==TextPackStore.Hash(differentlyEncoded)&&initialEquivalent.Describe(eqLocal.Path).Hash==eqLocal.Hash,"equivalent archive tracks separate server revision and local hash");
 using(var replay=new SharedEditingStore(sharedFiles,sharedSync)){var opened=await replay.OpenAsync("test-1",initial.Path,sharedFiles.Describe(initial.Path).Hash);var checkpoint=opened.Checkpoint!;var result=await replay.CheckpointAsync(opened.SessionToken,opened.Document.Hash,sharedFiles.Read(initial.Path),checkpoint);Assert(result.Hash==opened.Document.Hash,"same generation checkpoint replay is idempotent");var oldJournal=System.Text.Json.Nodes.JsonNode.Parse(checkpoint.Journal)!;oldJournal["journalGeneration"]=checkpoint.JournalGeneration-1;try{await replay.CheckpointAsync(opened.SessionToken,result.Hash,sharedFiles.Read(initial.Path),checkpoint with{JournalGeneration=checkpoint.JournalGeneration-1,Journal=oldJournal.ToJsonString()});throw new Exception("old generation accepted");}catch(InvalidOperationException){}Assert(sharedFiles.Describe(initial.Path).Hash==result.Hash,"stale generation cannot rewrite shared projection");}
 var externalCurrent=sharedFiles.Describe(initial.Path);sharedFiles.UpdateMarkdown(initial.Path,TextPackStore.Markdown(sharedFiles.Read(initial.Path))+" external-agent",externalCurrent.Hash);
 using(var externalReopen=new SharedEditingStore(sharedFiles,sharedSync)){var opened=await externalReopen.OpenAsync("test-1",initial.Path,sharedFiles.Describe(initial.Path).Hash);Assert(opened.Checkpoint?.RetiredReason!=null&&opened.Checkpoint.Pending,"external edit retires pending journal instead of replaying stale content");Assert(TextPackStore.Markdown(sharedFiles.Read(initial.Path)).EndsWith(" external-agent"),"external content remains intact when old journal is retired");}
 var interrupted=new TextPackStore(Path.Combine(temp,"interrupted-external"),Path.Combine(temp,"interrupted-external-device"));var interruptedInitial=interrupted.Write("Notes/Changed.textpack",Pack("before"));var remoteIncoming=Pack("remote-after");interrupted.UpdateMarkdown(interruptedInitial.Path,TextPackStore.Markdown(interrupted.Read(interruptedInitial.Path))+" external",interruptedInitial.Hash);
 interrupted.Write("Notes/Other.textpack",Pack("other","other"));var incomingState=new SyncEngine.State{PendingPull=new("test-1",interruptedInitial.Path,interruptedInitial.Path,interruptedInitial.Hash,TextPackStore.Hash(remoteIncoming),Convert.ToBase64String(remoteIncoming))};TextPackStore.AtomicWrite(Path.Combine(interrupted.StateDirectory,"sync.json"),JsonSerializer.SerializeToUtf8Bytes(incomingState));var incomingTransport=new Many();incomingTransport.Items["test-1"]=new Fake{Data=remoteIncoming,Item=new("test-1",interruptedInitial.Path,TextPackStore.Hash(remoteIncoming))};var incomingEngine=new SyncEngine(interrupted,incomingTransport);await incomingEngine.SyncAsync();Assert(TextPackStore.Markdown(interrupted.Read(interruptedInitial.Path)).EndsWith(" external")&&incomingTransport.Items["other"].UploadCount==1,"external edit during interrupted pull preserves both versions and unrelated sync proceeds");
 var acknowledgedStore=new TextPackStore(Path.Combine(temp,"acknowledged-external"),Path.Combine(temp,"acknowledged-device"));var acknowledgedFile=acknowledgedStore.Write("Notes/Ack.textpack",Pack());var acknowledgedTransport=new Fake();var acknowledgedEngine=new SyncEngine(acknowledgedStore,acknowledgedTransport);await acknowledgedEngine.SyncAsync();
 using(var acknowledgedEditing=new SharedEditingStore(acknowledgedStore,acknowledgedEngine)){var opened=await acknowledgedEditing.OpenAsync("test-1",acknowledgedFile.Path,acknowledgedStore.Describe(acknowledgedFile.Path).Hash);var acknowledgedBytes=Pack("acknowledged");var revision=TextPackStore.Hash(acknowledgedBytes);var cp=new SharedCheckpoint("test-1",acknowledgedFile.Path,revision,revision,1,1,1,JsonSerializer.Serialize(new{version=1,epoch=1,seq=1,journalGeneration=1,revision,relativePath=acknowledgedFile.Path,update="AAA=",pending=Array.Empty<string>()}),false);acknowledgedTransport.Data=acknowledgedBytes;acknowledgedTransport.Item=acknowledgedTransport.Item! with{Revision=revision};await acknowledgedEditing.CheckpointAsync(opened.SessionToken,opened.Document.Hash,acknowledgedBytes,cp);}
 acknowledgedStore.UpdateMarkdown(acknowledgedFile.Path,TextPackStore.Markdown(acknowledgedStore.Read(acknowledgedFile.Path))+" agent",acknowledgedStore.Describe(acknowledgedFile.Path).Hash);await acknowledgedEngine.SyncAsync();using(var reopenedAck=new SharedEditingStore(acknowledgedStore,acknowledgedEngine)){var opened=await reopenedAck.OpenAsync("test-1",acknowledgedFile.Path,acknowledgedStore.Describe(acknowledgedFile.Path).Hash);Assert(opened.Checkpoint==null,"acknowledged stale journal archived after external edit without spurious recovery");}
 var tombstoneStore=new TextPackStore(Path.Combine(temp,"tombstone-conflict"),Path.Combine(temp,"tombstone-conflict-device"));var tombstoneTransport=new Many();var tombstoneEngine=new SyncEngine(tombstoneStore,tombstoneTransport);var doomed=tombstoneStore.Write("Notes/Doomed.textpack",Pack("doomed","doomed"));await tombstoneEngine.SyncAsync();tombstoneStore.UpdateMarkdown(doomed.Path,TextPackStore.Markdown(tombstoneStore.Read(doomed.Path))+" edited",tombstoneStore.Describe(doomed.Path).Hash);tombstoneTransport.Items["doomed"].Item=tombstoneTransport.Items["doomed"].Item! with{Revision="remote-changed"};tombstoneTransport.Items["doomed"].DownloadFailure=System.Net.HttpStatusCode.NotFound;tombstoneStore.Write("Notes/Survivor.textpack",Pack("survivor","survivor"));await tombstoneEngine.SyncAsync();Assert(tombstoneEngine.Status.Error!=null&&tombstoneTransport.Items["survivor"].UploadCount==1,"conflict with missing remote bytes fences only the affected item");
 var notifyStore=new TextPackStore(Path.Combine(temp,"ack-notify"),Path.Combine(temp,"ack-notify-state"));var notifyPack=notifyStore.Write("Notes/Notify.textpack",Pack("before","notify"));var notifyRemote=new Fake();var notifyEngine=new SyncEngine(notifyStore,notifyRemote);await notifyEngine.SyncAsync();var durableEvents=0;notifyEngine.DurabilityChanged+=()=>durableEvents++;
 notifyStore.UpdateMarkdown(notifyPack.Path,TextPackStore.Markdown(notifyStore.Read(notifyPack.Path))+" changed",notifyStore.Describe(notifyPack.Path).Hash);Assert(!await notifyEngine.IsReadyAsync("notify"),"changed file waits for upload acknowledgement");var fileEvents=0;notifyStore.Changed+=()=>fileEvents++;await notifyEngine.SyncAsync();Assert(await notifyEngine.IsReadyAsync("notify")&&durableEvents>0&&fileEvents==0,"own upload ACK emits durable readiness event without rewriting file");durableEvents=0;await notifyEngine.SyncAsync();Assert(durableEvents==0,"idle sync emits no durable change notification");
 var cadenceStore=new TextPackStore(Path.Combine(temp,"cadence"),Path.Combine(temp,"cadence-state"));var cadenceFile=cadenceStore.Write("Notes/Cadence.textpack",Pack("initial","cadence"));var cadenceRemote=new Fake();var cadenceEngine=new SyncEngine(cadenceStore,cadenceRemote);await cadenceEngine.SyncAsync(localChangesOnly:true);var initialManifests=cadenceRemote.ManifestCount;
 using(var fence=await cadenceEngine.AcquireCollaborationAsync("cadence")){for(var n=0;n<4;n++){cadenceStore.UpdateMarkdown(cadenceFile.Path,TextPackStore.Markdown(cadenceStore.Read(cadenceFile.Path))+" typed",cadenceStore.Describe(cadenceFile.Path).Hash);await cadenceEngine.SyncAsync(localChangesOnly:true);}Assert(cadenceRemote.ManifestCount==initialManifests,"protected typing wakeups make no cloud manifest requests");await cadenceEngine.SyncAsync();Assert(cadenceRemote.ManifestCount==initialManifests+1,"scheduled full pass still discovers remote changes during typing");}
 await cadenceEngine.SyncAsync(localChangesOnly:true);Assert(cadenceRemote.UploadCount==2&&cadenceRemote.ManifestCount==initialManifests+2,"unprotected dirty file still synchronizes on local wake");var afterDirty=cadenceRemote.ManifestCount;await cadenceEngine.SyncAsync(localChangesOnly:true);Assert(cadenceRemote.ManifestCount==afterDirty,"unchanged local wake does not poll cloud");
 cadenceStore.Rename(cadenceFile.Path,"Notes/CadenceRenamed.textpack",cadenceStore.Describe(cadenceFile.Path).Hash);await cadenceEngine.SyncAsync(localChangesOnly:true);Assert(cadenceRemote.Item!.RelativePath=="Notes/CadenceRenamed.textpack","local wake still uploads explicit rename");cadenceStore.Delete("Notes/CadenceRenamed.textpack",cadenceStore.Describe("Notes/CadenceRenamed.textpack").Hash);await cadenceEngine.SyncAsync(localChangesOnly:true);Assert(cadenceRemote.DeleteCount==1,"local wake still uploads explicit delete");
 var movedStore=new TextPackStore(Path.Combine(temp,"remote-folder-move"),Path.Combine(temp,"remote-folder-move-state"));
 var movedFile=movedStore.Write("Projects/One/Note.textpack",Pack("baseline","remote-folder-move"));var movedRemote=new Fake();var movedEngine=new SyncEngine(movedStore,movedRemote);await movedEngine.SyncAsync();
 var movedPath="Archive/One/Note.textpack";movedRemote.Item=movedRemote.Item! with{RelativePath=movedPath};
 movedStore.UpdateMarkdown(movedFile.Path,TextPackStore.Markdown(movedStore.Read(movedFile.Path))+"\nOffline agent edit",movedStore.Describe(movedFile.Path).Hash);
 await movedEngine.SyncAsync();
 Assert(movedEngine.Status.Error==null&&movedRemote.Item!.RelativePath==movedPath&&TextPackStore.Markdown(movedRemote.Data).Contains("Offline agent edit")&&!File.Exists(movedStore.Resolve(movedFile.Path))&&TextPackStore.Markdown(movedStore.Read(movedPath)).Contains("Offline agent edit"),"remote folder move carries concurrent local edits without reverting paths");
 var movedUploads=movedRemote.UploadCount;await new SyncEngine(movedStore,movedRemote).SyncAsync();Assert(movedRemote.UploadCount==movedUploads,"remote folder move remains converged after engine restart");
 var queuedStore=new TextPackStore(Path.Combine(temp,"queued-remote-move"),Path.Combine(temp,"queued-remote-move-state"));var queuedFile=queuedStore.Write("Before/Queued.textpack",Pack("baseline","queued-move"));var queuedRemote=new Fake{Folders=["Before","Before/Empty"],AuthoritativeFolders=["Before","Before/Empty"]};await new SyncEngine(queuedStore,queuedRemote).SyncAsync();
 queuedStore.UpdateMarkdown(queuedFile.Path,TextPackStore.Markdown(queuedStore.Read(queuedFile.Path))+"\nQueued offline edit",queuedStore.Describe(queuedFile.Path).Hash);queuedRemote.FailBeforeCommit=true;
 try{await new SyncEngine(queuedStore,queuedRemote).SyncAsync();throw new Exception("expected offline upload");}catch(HttpRequestException){}
 var queuedOperation=queuedRemote.Operations.Last();queuedRemote.Item=queuedRemote.Item! with{RelativePath="After/Queued.textpack"};queuedRemote.Folders=["After","After/Empty"];queuedRemote.AuthoritativeFolders=queuedRemote.Folders;
 queuedStore.UpdateMarkdown(queuedFile.Path,TextPackStore.Markdown(queuedStore.Read(queuedFile.Path))+" plus later edit",queuedStore.Describe(queuedFile.Path).Hash);
 var queuedEngine=new SyncEngine(queuedStore,queuedRemote);await queuedEngine.SyncAsync();
 Assert(queuedEngine.Status.Error==null&&queuedEngine.Status.Pending==0&&queuedRemote.Item!.RelativePath=="After/Queued.textpack"&&TextPackStore.Markdown(queuedRemote.Data).Contains("Queued offline edit plus later edit")&&!File.Exists(queuedStore.Resolve(queuedFile.Path)),"persisted upload follows remote folder move and preserves later local edits");
 Assert(!Directory.Exists(Path.Combine(queuedStore.Root,"Before"))&&Directory.Exists(Path.Combine(queuedStore.Root,"After","Empty")),"queued upload folder move prunes old tree only after preserving and uploading edits");
 Assert(queuedRemote.Operations.Last()!=queuedOperation,"retargeted upload uses a new payload-bound operation identity");
 var queuedUploads=queuedRemote.UploadCount;await new SyncEngine(queuedStore,queuedRemote).SyncAsync();Assert(queuedRemote.UploadCount==queuedUploads,"retargeted queued upload remains converged after restart");
 foreach(var ordering in new[]{"adoption-interrupted","remote-content-changed","permission-revoked","lost-ack"}) {
  var qStore=new TextPackStore(Path.Combine(temp,"queued-"+ordering),Path.Combine(temp,"queued-state-"+ordering));var qFile=qStore.Write("Before/Note.textpack",Pack("baseline","q-"+ordering));var qRemote=new Fake();await new SyncEngine(qStore,qRemote).SyncAsync();
  qStore.UpdateMarkdown(qFile.Path,TextPackStore.Markdown(qStore.Read(qFile.Path))+"\nQueued edit",qStore.Describe(qFile.Path).Hash);
  if(ordering=="lost-ack")qRemote.FailAfterCommit=true;else qRemote.FailBeforeCommit=true;
  try{await new SyncEngine(qStore,qRemote).SyncAsync();throw new Exception("expected interrupted upload");}catch(HttpRequestException){}
  qRemote.Item=qRemote.Item! with{RelativePath="After/Note.textpack"};
  if(ordering=="adoption-interrupted")qStore.Rename(qFile.Path,"After/Note.textpack",qStore.Describe(qFile.Path).Hash);
  if(ordering=="remote-content-changed"){qRemote.Data=Pack("different remote content","q-"+ordering);qRemote.Item=qRemote.Item with{Revision=TextPackStore.Hash(qRemote.Data)};}
  if(ordering=="permission-revoked")qRemote.Capabilities=new(false,false,[],new(){[qFile.ItemId]=false});
  var qEngine=new SyncEngine(qStore,qRemote);await qEngine.SyncAsync();
  if(ordering=="remote-content-changed")Assert(qEngine.Status.Pending==1&&qEngine.Status.Error!=null&&File.Exists(qStore.Resolve(qFile.Path))&&TextPackStore.Markdown(qRemote.Data).Contains("different remote content"),"queued move never rebases over changed remote content");
  else if(ordering=="permission-revoked")Assert(qEngine.Status.Pending==1&&File.Exists(qStore.Resolve(qFile.Path))&&qRemote.UploadCount==1,"queued move waits when fresh permissions deny the upload");
  else Assert(qEngine.Status.Pending==0&&qEngine.Status.Error==null&&File.Exists(qStore.Resolve("After/Note.textpack"))&&!File.Exists(qStore.Resolve(qFile.Path))&&TextPackStore.Markdown(qRemote.Data).Contains("Queued edit"),"queued move converges after "+ordering);
 }
 var activeMoveStore=new TextPackStore(Path.Combine(temp,"active-remote-move"),Path.Combine(temp,"active-remote-move-state"));var activeFile=activeMoveStore.Write("Before/Active.textpack",Pack("baseline","active-move"));var activeRemote=new Fake();var activeEngine=new SyncEngine(activeMoveStore,activeRemote);await activeEngine.SyncAsync();
 using(var lease=await activeEngine.AcquireCollaborationAsync(activeFile.ItemId)) {
  activeRemote.Item=activeRemote.Item! with{RelativePath="After/Active.textpack"};
  var projected=activeMoveStore.UpdateMarkdown(activeFile.Path,TextPackStore.Markdown(activeMoveStore.Read(activeFile.Path))+"\nShared edit",activeMoveStore.Describe(activeFile.Path).Hash);
  await activeEngine.SyncAsync();Assert(activeRemote.UploadCount==1&&File.Exists(activeMoveStore.Resolve(activeFile.Path))&&!File.Exists(activeMoveStore.Resolve("After/Active.textpack")),"remote move does not relocate or upload active shared editor projection");
  activeRemote.Data=activeMoveStore.Read(activeFile.Path);activeRemote.Item=activeRemote.Item with{Revision=projected.Hash};await activeEngine.AcknowledgeCheckpointAsync(activeFile.ItemId,activeFile.Path,projected.Hash,projected.Hash);
 }
 await activeEngine.SyncAsync();Assert(activeRemote.UploadCount==1&&File.Exists(activeMoveStore.Resolve("After/Active.textpack"))&&TextPackStore.Markdown(activeMoveStore.Read("After/Active.textpack")).Contains("Shared edit")&&!File.Exists(activeMoveStore.Resolve(activeFile.Path)),"acknowledged shared edit adopts moved path after editor release without duplicate upload");
 await new SyncEngine(activeMoveStore,activeRemote).SyncAsync();Assert(activeRemote.UploadCount==1,"released shared editor move stays converged across restart");
 var crashMoveStore=new TextPackStore(Path.Combine(temp,"remote-move-crash"),Path.Combine(temp,"remote-move-crash-state"));var crashMoveFile=crashMoveStore.Write("Before/Note.textpack",Pack("baseline","move-crash"));var crashMoveRemote=new Fake();await new SyncEngine(crashMoveStore,crashMoveRemote).SyncAsync();
 crashMoveRemote.Item=crashMoveRemote.Item! with{RelativePath="After/Note.textpack"};crashMoveStore.UpdateMarkdown(crashMoveFile.Path,TextPackStore.Markdown(crashMoveStore.Read(crashMoveFile.Path))+"\nDurable edit",crashMoveStore.Describe(crashMoveFile.Path).Hash);
 crashMoveStore.Rename(crashMoveFile.Path,"After/Note.textpack",crashMoveStore.Describe(crashMoveFile.Path).Hash);
 var crashMoveEngine=new SyncEngine(crashMoveStore,crashMoveRemote);await crashMoveEngine.SyncAsync();Assert(crashMoveEngine.Status.Error==null&&TextPackStore.Markdown(crashMoveRemote.Data).Contains("Durable edit"),"restart between remote path adoption and baseline save preserves local edits");
 await ReadinessTests.Run(temp);
 PackLayoutTests.Run(temp);
 await TransportTests.Run();
 await WorkspaceDirectoryTests.Run();
 var scopedStore=new TextPackStore(Path.Combine(temp,"scoped"),Path.Combine(temp,"scoped-state"));var scopedFile=scopedStore.Write("Notes/Scoped.textpack",Pack("before","scoped"));var scopedRemote=new Fake();var scopedEngine=new SyncEngine(scopedStore,scopedRemote);await scopedEngine.SyncAsync();
 scopedStore.Delete(scopedFile.Path,scopedFile.Hash);var visibleScoped=scopedRemote.Item;scopedRemote.Item=null;await scopedEngine.SyncAsync();
 Assert(scopedStore.Intent("scoped")?.Kind=="delete","scoped manifest absence retains pending local deletion intent");
 scopedRemote.Item=visibleScoped;scopedRemote.Capabilities=new(false,false,[],new(){{"scoped",false}});await scopedEngine.SyncAsync();await scopedEngine.SyncAsync();
 Assert(scopedRemote.DeleteCount==0&&scopedEngine.Status.Pending==1,$"role downgrade retains queued deletion without sending or spinning {scopedRemote.DeleteCount}/{scopedEngine.Status.Pending}");
 var persistedCapabilities=await new SyncEngine(scopedStore,scopedRemote).CapabilitiesAsync();Assert(persistedCapabilities?.Items["scoped"]==false,"permission snapshot survives restart offline");
 scopedRemote.Capabilities=new(true,true,[],new(){{"scoped",true}});await scopedEngine.SyncAsync();Assert(scopedRemote.DeleteCount==1,"restored permission resumes original durable deletion");
 var permissionStore=new TextPackStore(Path.Combine(temp,"permissions"),Path.Combine(temp,"permissions-state"));var knownPermission=permissionStore.Write("Notes/Known.textpack",Pack("known","known-permission"));var permissionRemote=new Fake();var permissionSync=new SyncEngine(permissionStore,permissionRemote);await permissionSync.SyncAsync();
 var capabilityNotifications=0;permissionSync.CapabilitiesChanged+=()=>capabilityNotifications++;
 permissionRemote.Item=null;permissionRemote.Capabilities=new(false,false,["Notes"],new());await permissionSync.SyncAsync();
 await permissionSync.SyncAsync();Assert(capabilityNotifications==1,"permission-only change notifies once and unchanged manifest remains quiet");
 var offlineNote=permissionStore.Write("Notes/Offline.textpack",Pack("draft","offline-new"));var outsideNote=permissionStore.Write("Other/Offline.textpack",Pack("draft","offline-outside"));
 var offlinePermissions=await new SyncEngine(permissionStore,permissionRemote).FilePermissionsAsync(permissionStore.Scan());
 Assert(offlinePermissions[offlineNote.ItemId]&&!offlinePermissions[knownPermission.ItemId]&&!offlinePermissions[outsideNote.ItemId],"offline new folder note editable while omitted known item and outside folder remain readonly");
 permissionRemote.Capabilities=new(true,true,[],new());await permissionSync.SyncAsync();var ownerDraft=permissionStore.Write("Notes/Owner.textpack",Pack("draft","owner-new"));
 Assert((await permissionSync.FilePermissionsAsync([ownerDraft]))[ownerDraft.ItemId],"owner can edit new offline note before first upload");
 var restoredStore=new TextPackStore(Path.Combine(temp,"restore-passive"),Path.Combine(temp,"restore-device"));var restoredFake=new Fake{Data=Pack("before"),Item=new("test-1","Notes/Restore.textpack","before")};var restoredEngine=new SyncEngine(restoredStore,restoredFake);await restoredEngine.SyncAsync();var beforeRestore=restoredStore.Describe("Notes/Restore.textpack");restoredStore.Delete(beforeRestore.Path,beforeRestore.Hash);
 var restoreStatePath=Path.Combine(restoredStore.StateDirectory,"sync.json");var staleDeleteState=JsonSerializer.Deserialize<SyncEngine.State>(File.ReadAllBytes(restoreStatePath))!;staleDeleteState.Outbox.Add(new("old-delete","delete","test-1",beforeRestore.Path,null,"before",beforeRestore.Hash,null));TextPackStore.AtomicWrite(restoreStatePath,JsonSerializer.SerializeToUtf8Bytes(staleDeleteState));
 var restoredBytes=Pack("restored");restoredFake.Data=restoredBytes;restoredFake.Item=new("test-1",beforeRestore.Path,TextPackStore.Hash(restoredBytes),Lifecycle:"restore-one");await restoredEngine.SyncAsync();Assert(TextPackStore.Markdown(restoredStore.Read(beforeRestore.Path)).Contains("restored")&&restoredFake.DeleteCount==0,"passive restore retires old local deletion and pulls same ID");
 await restoredEngine.ReconcileRestoredAsync("test-1",beforeRestore.Path,"restore-one");var wrongRestoreRejected=false;try{await restoredEngine.ReconcileRestoredAsync("test-1",beforeRestore.Path,"wrong");}catch(FileChangedException){wrongRestoreRejected=true;}Assert(wrongRestoreRejected,"native restore acknowledgment requires exact restored lifecycle");
 var migrationState=JsonSerializer.Deserialize<SyncEngine.State>(File.ReadAllBytes(restoreStatePath))!;migrationState.Items["test-1"]=migrationState.Items["test-1"] with{Lifecycle=null};TextPackStore.AtomicWrite(restoreStatePath,JsonSerializer.SerializeToUtf8Bytes(migrationState));
 var restoredNow=restoredStore.Describe(beforeRestore.Path);restoredStore.Delete(restoredNow.Path,restoredNow.Hash);await restoredEngine.SyncAsync();Assert(restoredFake.DeleteCount==1,"legacy null lifecycle with matching restored revision honors new deletion");
 byte[] LifecyclePack(string generation){using var output=new MemoryStream();output.Write(Pack("generation-"+generation));using(var zip=new ZipArchive(output,ZipArchiveMode.Update,true)){using var writer=new StreamWriter(zip.CreateEntry("texttext-lifecycle.json").Open());writer.Write(JsonSerializer.Serialize(new{version=1,generation}));}return output.ToArray();}
 foreach(var existing in new[]{false,true}) {
  var raced=new TextPackStore(Path.Combine(temp,"race-"+existing),Path.Combine(temp,"race-device-"+existing));var raceBytes=LifecyclePack("second");if(existing)raced.Write("Notes/Race.textpack",raceBytes);
  var raceFake=new Fake{Data=Pack("first"),Item=new("test-1","Notes/Race.textpack","old",Lifecycle:"first")};raceFake.BeforeDownload=()=>{raceFake.Data=raceBytes;raceFake.Item=new("test-1","Notes/Race.textpack",TextPackStore.Hash(raceBytes),Lifecycle:"second");};await new SyncEngine(raced,raceFake).SyncAsync();
  var raceState=JsonSerializer.Deserialize<SyncEngine.State>(File.ReadAllBytes(Path.Combine(raced.StateDirectory,"sync.json")))!;Assert(raceState.Items["test-1"].Lifecycle=="second","download race binds installed generation (existing="+existing+")");
 }
 var editRestore=new TextPackStore(Path.Combine(temp,"restore-edit"),Path.Combine(temp,"restore-edit-device"));var editFile=editRestore.Write("Notes/Edit.textpack",Pack("local pending"));editRestore.Write("Notes/Unrelated.textpack",Pack("unrelated","unrelated"));var editState=new SyncEngine.State();editState.Items["test-1"]=new(editFile.Path,editFile.Hash,"old");editState.Outbox.Add(new("old-edit","upload","test-1",editFile.Path,null,"old",editFile.Hash,Convert.ToBase64String(editRestore.Read(editFile.Path))));TextPackStore.AtomicWrite(Path.Combine(editRestore.StateDirectory,"sync.json"),JsonSerializer.SerializeToUtf8Bytes(editState));
 var editsRemote=new Many();editsRemote.Items["test-1"]=new Fake{Data=LifecyclePack("restored"),Item=new("test-1",editFile.Path,"new",Lifecycle:"restored")};await new SyncEngine(editRestore,editsRemote).SyncAsync();Assert(TextPackStore.Markdown(editRestore.Read(editFile.Path)).Contains("local pending")&&editsRemote.Items["unrelated"].UploadCount==1,"old-generation pending edit preserved while unrelated queue converges");
 Console.WriteLine("All native file and durable sync regression tests passed.");
 }finally{Directory.Delete(temp,true);}}
 sealed class Many:ISyncTransport {
  public Dictionary<string,Fake> Items=[];
  Fake Get(string id){if(!Items.TryGetValue(id,out var value))Items[id]=value=new();return value;}
  public Task<IReadOnlyList<RemoteItem>> ManifestAsync(CancellationToken cancellation=default)=>Task.FromResult<IReadOnlyList<RemoteItem>>(Items.Values.Where(x=>x.Item!=null).Select(x=>x.Item!).ToArray());
  public Task<RemotePack> DownloadAsync(string itemId,CancellationToken cancellation=default)=>Get(itemId).DownloadAsync(itemId,cancellation);
  public Task<string> UploadAsync(string itemId,string path,byte[] data,string? baseRevision,string operationId,CancellationToken cancellation=default)=>Get(itemId).UploadAsync(itemId,path,data,baseRevision,operationId,cancellation);
  public Task<string> RenameAsync(string itemId,string from,string to,string baseRevision,string operationId,CancellationToken cancellation=default)=>Get(itemId).RenameAsync(itemId,from,to,baseRevision,operationId,cancellation);
  public Task DeleteAsync(string itemId,string path,string baseRevision,string operationId,CancellationToken cancellation=default)=>Get(itemId).DeleteAsync(itemId,path,baseRevision,operationId,cancellation);
 }
 sealed class Fake:ISyncTransport{
  public WorkspaceCapabilities? Capabilities {get;set;}
  public IReadOnlyList<string> Folders {get;set;}=[];
  public IReadOnlyList<string>? AuthoritativeFolders {get;set;}
  public System.Net.HttpStatusCode? DownloadFailure;public RemoteItem? Item;public byte[] Data=[];public int UploadCount,DeleteCount,ManifestCount;public bool FailAfterCommit,FailBeforeCommit;public Action? BeforeDownload;public List<string> Operations=[];readonly Dictionary<string,string> receipts=[];
  public Task<IReadOnlyList<RemoteItem>> ManifestAsync(CancellationToken cancellation=default){ManifestCount++;return Task.FromResult<IReadOnlyList<RemoteItem>>(Item==null?[]:[Item]);}
  public Task<RemotePack> DownloadAsync(string itemId,CancellationToken cancellation=default){var hook=BeforeDownload;BeforeDownload=null;hook?.Invoke();if(DownloadFailure!=null)throw new HttpRequestException("Remote item unavailable.",null,DownloadFailure);return Task.FromResult(new RemotePack(Data,Item!.RelativePath,Item.Revision));}
  public Task<string> UploadAsync(string itemId,string path,byte[] data,string? baseRevision,string operationId,CancellationToken cancellation=default){Operations.Add(operationId);if(FailBeforeCommit){FailBeforeCommit=false;throw new HttpRequestException("offline before commit");}if(receipts.TryGetValue(operationId,out var old))return Task.FromResult(old);if(Item!=null&&(Item.Revision!=baseRevision||Item.RelativePath!=path))throw new SyncConflictException();Data=data;var revision=TextPackStore.Hash(data);Item=new(itemId,path,revision);receipts[operationId]=revision;UploadCount++;if(FailAfterCommit){FailAfterCommit=false;throw new HttpRequestException("ACK lost");}return Task.FromResult(revision);}
  public Task<string> RenameAsync(string itemId,string from,string to,string baseRevision,string operationId,CancellationToken cancellation=default){if(receipts.TryGetValue(operationId,out var old))return Task.FromResult(old);if(Item==null||Item.RelativePath!=from||Item.Revision!=baseRevision)throw new SyncConflictException();Item=Item with{RelativePath=to};receipts[operationId]=Item.Revision;return Task.FromResult(Item.Revision);}
  public Task DeleteAsync(string itemId,string path,string baseRevision,string operationId,CancellationToken cancellation=default){Item=Item! with{Deleted=true};DeleteCount++;return Task.CompletedTask;}
 }
}
