using System.IO.Compression;
using System.Text.Json;
using System.Text.Json.Nodes;
using TextText.Core;

static class RetainedReplacementAdoptionTests
{
    static byte[] Pack(string value) {
        using var output=new MemoryStream();using(var archive=new ZipArchive(output,ZipArchiveMode.Create,true))
        using(var writer=new StreamWriter(archive.CreateEntry("text.md").Open()))writer.Write("---\ntextTextId: \"adopt-retained\"\n---\n"+value);
        return output.ToArray();
    }
    public static void Run(string temp,Action<bool,string> check)
    {
        foreach(var fault in new[]{"intent","applied","future","foreign","unknown-field"}) {
            var root=Path.Combine(temp,"replacement-adoption-"+fault);var store=new TextPackStore(root,Path.Combine(temp,"replacement-adoption-state-"+fault));
            byte[] expected=Pack("baseline"),prepared=Pack("accepted prepared"),displaced=Pack("raced external");
            var file=store.Write("Note.textpack",prepared);var operation=Guid.NewGuid();
            var registry=new ReplacementRecoveryRegistry(store.Root,store.StateDirectory);
            registry.Register(operation,file.ItemId,file.Path,TextPackStore.Hash(expected),TextPackStore.Hash(prepared));
            var directory=RetainedFileReplacement.OperationDirectory(store.Resolve(file.Path),operation);Directory.CreateDirectory(directory);
            RetainedFileReplacement.Create(Path.Combine(directory,"prepared"),prepared);RetainedFileReplacement.Create(Path.Combine(directory,"displaced"),displaced);
            RetainedFileReplacement.SaveJson(Path.Combine(directory,"manifest.json"),new RetainedFileReplacement.Manifest(1,operation,"Note.textpack",TextPackStore.Hash(expected),TextPackStore.Hash(prepared),"conflict"),creating:true);
            var relative="replacement-index/"+operation.ToString("D")+".json";var index=Path.Combine(store.StateDirectory,relative);
            if(fault is "future" or "foreign" or "unknown-field") {
                var json=JsonNode.Parse(File.ReadAllBytes(index))!;
                if(fault=="future")json["Version"]=2;
                if(fault=="foreign")json["OwnerHash"]=new string('e',64);
                if(fault=="unknown-field")json["futureScope"]="must be preserved";
                File.WriteAllText(index,json.ToJsonString());var before=File.ReadAllBytes(index);var refused=false;
                try{AccountStateAdoption.AdoptAfterExplicitReview(store,new Uri("https://texttext.app"),"workspace","account-a");}
                catch(Exception error)when(error is IOException or InvalidDataException or SharedAccountMismatchException){refused=true;}
                check(refused&&File.ReadAllBytes(index).SequenceEqual(before)&&!File.Exists(Path.Combine(store.StateDirectory,AccountRootOwnership.PendingAdoption)),"replacement adoption refuses "+fault+" without rewriting original index");
                continue;
            }
            var original=File.ReadAllBytes(index);var phase=fault=="intent"?"intent":"applied:"+relative;
            try{AccountStateAdoption.AdoptAfterExplicitReview(store,new Uri("https://texttext.app"),"workspace","account-a",step=>{if(step==phase)throw new IOException("interrupted adoption");});}
            catch(IOException){}
            var result=AccountStateAdoption.AdoptAfterExplicitReview(new TextPackStore(root,store.StateDirectory),new Uri("https://texttext.app"),"workspace","account-a");
            check(result.RecoveryDirectory is not null&&File.ReadAllBytes(Path.Combine(result.RecoveryDirectory,"before",relative)).SequenceEqual(original),"replacement adoption "+fault+" retains exact unowned registry bytes across restart");
            var entry=registry.Entries().Single();
            check(entry.OwnerHash is not null&&File.ReadAllBytes(Path.Combine(directory,"prepared")).SequenceEqual(prepared)&&File.ReadAllBytes(Path.Combine(directory,"displaced")).SequenceEqual(displaced),"replacement adoption binds verified principal without changing retained versions");
            var blocked=false;try{registry.AssertReadable(file.ItemId);}catch(RetainedFileReplacement.RequiredException){blocked=true;}
            check(blocked,"explicit account adoption does not implicitly resolve replacement content");
            store.ResolveReplacement(operation.ToString("D"),file.Path,file.ItemId,TextPackStore.Hash(prepared),TextPackStore.Hash(prepared),TextPackStore.Hash(displaced));
            check(store.Read(file.Path).SequenceEqual(prepared),"explicit content recovery remains available after account adoption");
        }
    }
}
