using System.IO.Compression;
using System.Text.Json;
using System.Text.Json.Nodes;
using TextText.Core;
static class SharedCaseMoveTests
{
    static byte[] Pack(){using var output=new MemoryStream();using(var zip=new ZipArchive(output,ZipArchiveMode.Create,true))using(var writer=new StreamWriter(zip.CreateEntry("text.md").Open()))writer.Write("---\ntextTextId: test-1\n---\nshared case pending");return output.ToArray();}
    static bool Refuses(Action action){try{action();return false;}catch(IOException){return true;}catch(InvalidDataException){return true;}}
    static (TextPackStore Store,PackFile File,SharedCheckpoint Checkpoint,string Directory,byte[] Bytes) Setup(string temp,string name)
    {
        var store=new TextPackStore(Path.Combine(temp,"shared-case-"+name),Path.Combine(temp,"shared-case-"+name+"-state"));var bytes=Pack();var file=store.Write("Notes/CaseProbe.textpack",bytes);
        var directory=Path.Combine(store.StateDirectory,"shared-editing",file.ItemId);System.IO.Directory.CreateDirectory(directory);
        var journal=JsonSerializer.Serialize(new{version=1,epoch=3,seq=11,journalGeneration=7,revision=file.Hash,relativePath=file.Path,update="AAA=",pending=new[]{"AAA="},batch=new{operationId="retained-case-operation",updates=new[]{"AAA="}}});
        var checkpoint=new SharedCheckpoint(file.ItemId,file.Path,file.Hash,file.Hash,3,11,7,journal,true);
        File.WriteAllBytes(Path.Combine(directory,"checkpoint.json"),JsonSerializer.SerializeToUtf8Bytes(checkpoint));return(store,file,checkpoint,directory,bytes);
    }
    static bool JournalMatches(SharedCheckpoint before,SharedCheckpoint after,string path)
    {
        var expected=JsonNode.Parse(before.Journal)!;expected["relativePath"]=path;
        return before with{Path=path,Journal=after.Journal}==after&&JsonNode.DeepEquals(expected,JsonNode.Parse(after.Journal));
    }
    public static async Task Run(string temp,Action<bool,string> assert)
    {
        const string destination="Notes/caseprobe.textpack";
        {
            var test=Setup(temp,"active");using var editing=new SharedEditingStore(test.Store,Test.NewSync(test.Store,new Test.Fake()));var opened=await editing.OpenAsync(test.File.ItemId,test.File.Path,test.File.Hash);
            SharedCheckpoint? moved=null;var refused=Refuses(()=>moved=SharedEditingStore.RebaseProjection(test.Store,test.File.ItemId,destination));
            assert(!refused&&moved is not null,"active shared case-only projection rebases instead of treating its alias as an occupied destination");
            assert(JournalMatches(test.Checkpoint,moved!,destination),"shared case-only rebase preserves exact pending batch, epoch, sequence and generation except path");
            var saved=await editing.CheckpointAsync(opened.SessionToken,test.File.Hash,test.Bytes,test.Checkpoint);
            assert(saved.Path==destination&&saved.Hash==test.File.Hash,"active old-path checkpoint follows case-only projection without replacing bytes");
            using var rival=new SharedEditingStore(new TextPackStore(test.Store.Root,test.Store.StateDirectory),Test.NewSync(test.Store,new Test.Fake()));var rivalRefused=false;try{await rival.OpenAsync(test.File.ItemId,destination,saved.Hash);}catch(IOException){rivalRefused=true;}
            assert(rivalRefused,"shared case-only rebase retains the existing live document lease");
        }
        foreach(var afterMove in new[]{false,true}) {
            var test=Setup(temp,"restart-"+afterMove);var intent=Path.Combine(test.Directory,"move-intent.json");
            assert(Refuses(()=>SharedEditingStore.RebaseProjection(test.Store,test.File.ItemId,destination,interruptAfterIntent:!afterMove,interruptAfterMove:afterMove))&&File.Exists(intent),"shared case-only interrupted boundary retains durable move intent "+afterMove);
            using var reopened=new SharedEditingStore(new TextPackStore(test.Store.Root,test.Store.StateDirectory),Test.NewSync(test.Store,new Test.Fake()));var session=await reopened.OpenAsync(test.File.ItemId,test.File.Path,test.File.Hash);
            assert(session.Document.Path==destination&&session.Document.Hash==test.File.Hash&&JournalMatches(test.Checkpoint,session.Checkpoint!,destination)&&!File.Exists(intent),"shared case-only restart completes once and retains exact pending journal "+afterMove);
        }
        {
            var test=Setup(temp,"external");File.Move(test.Store.Resolve(test.File.Path),test.Store.Resolve(destination),overwrite:false);
            using var reopened=new SharedEditingStore(test.Store,Test.NewSync(test.Store,new Test.Fake()));var session=await reopened.OpenAsync(test.File.ItemId,test.File.Path,test.File.Hash);
            assert(session.Document.Path==destination&&JournalMatches(test.Checkpoint,session.Checkpoint!,destination),"shared pending reopen adopts exact external case-only spelling without replaying a rename");
        }
        {
            var test=Setup(temp,"external-active");using var editing=new SharedEditingStore(test.Store,Test.NewSync(test.Store,new Test.Fake()));var session=await editing.OpenAsync(test.File.ItemId,test.File.Path,test.File.Hash);
            File.Move(test.Store.Resolve(test.File.Path),test.Store.Resolve(destination),overwrite:false);
            var saved=await editing.CheckpointAsync(session.SessionToken,test.File.Hash,test.Bytes,test.Checkpoint);var checkpoint=JsonSerializer.Deserialize<SharedCheckpoint>(File.ReadAllBytes(Path.Combine(test.Directory,"checkpoint.json")))!;
            assert(saved.Path==destination&&saved.Hash==test.File.Hash&&JournalMatches(test.Checkpoint,checkpoint,destination),"active pending checkpoint adopts external case-only spelling without changing journal generation");
        }
        foreach(var field in new[]{"Version","UnknownFuture"}) {
            var test=Setup(temp,"future-"+field);assert(Refuses(()=>SharedEditingStore.RebaseProjection(test.Store,test.File.ItemId,destination,interruptAfterIntent:true)),"shared future-intent fixture retains interrupted case rename "+field);
            var path=Path.Combine(test.Directory,"move-intent.json");var value=JsonNode.Parse(File.ReadAllBytes(path))!;value[field]=2;var bytes=JsonSerializer.SerializeToUtf8Bytes(value);File.WriteAllBytes(path,bytes);
            var checkpoint=File.ReadAllBytes(Path.Combine(test.Directory,"checkpoint.json"));using var reopened=new SharedEditingStore(test.Store,Test.NewSync(test.Store,new Test.Fake()));var refused=false;
            try{await reopened.OpenAsync(test.File.ItemId,test.File.Path,test.File.Hash);}catch(Exception error)when(error is IOException or InvalidDataException){refused=true;}
            assert(refused&&File.ReadAllBytes(path).SequenceEqual(bytes)&&File.ReadAllBytes(Path.Combine(test.Directory,"checkpoint.json")).SequenceEqual(checkpoint),"unknown or future shared move intent refuses without clearing journal or intent "+field);
        }
    }
}
