using System.IO.Compression;
using System.Text.Json.Nodes;
using TextText.Core;
static class AliasMutationTests
{
    static byte[] Pack(string value,string id="alias-item"){using var output=new MemoryStream();using(var zip=new ZipArchive(output,ZipArchiveMode.Create,true))using(var writer=new StreamWriter(zip.CreateEntry("text.md").Open()))writer.Write("---\ntextTextId: "+id+"\n---\n"+value);return output.ToArray();}
    static bool Refuses(Action action){try{action();return false;}catch(IOException){return true;}catch(InvalidDataException){return true;}}
    public static void Run(string temp,Action<bool,string> assert)
    {
        var before=Pack("before");var after=Pack("after");
        foreach(var actual in new[]{"caseprobe.textpack","CaseProbe.TEXTPACK"}) {
            var suffix=actual.EndsWith("TEXTPACK")?"upper-extension":"normal-extension";
            var store=new TextPackStore(Path.Combine(temp,"alias-write-"+suffix),Path.Combine(temp,"alias-write-state-"+suffix));store.Write(actual,before);var logical=suffix=="normal-extension"?"CaseProbe.textpack":"CASEPROBE.TEXTPACK";
            if(!File.Exists(store.Resolve(logical))){Console.WriteLine("SKIP alias mutation fixture requires case-insensitive directory");continue;}
            var written=store.Write(logical,after,TextPackStore.Hash(before));
            assert(Directory.GetFiles(store.Root).Any(path=>Path.GetFileName(path)==actual)&&!Directory.GetFiles(store.Root).Any(path=>Path.GetFileName(path)==logical)&&store.Read(actual).SequenceEqual(after),"write through a case alias preserves actual leaf spelling and document bytes "+suffix);
            if(OperatingSystem.IsWindows()) {
                var registry=new ReplacementRecoveryRegistry(store.Root,store.StateDirectory);var entry=registry.Entries().Single();var inspection=registry.Inspect(entry);
                assert(entry.Path==logical&&inspection.Recovery.Record.Filename==actual&&entry.RecoveryPath!.Contains(TextPackStore.Hash(System.Text.Encoding.UTF8.GetBytes(logical)),StringComparison.Ordinal),"alias replacement binds actual storage basename under original logical path hash "+suffix);
                var path=Path.Combine(store.StateDirectory,"replacement-index",entry.Operation.ToString("D")+".json");var json=JsonNode.Parse(File.ReadAllBytes(path))!;
                json["RecoveryPath"]=entry.RecoveryPath.Replace(TextPackStore.Hash(System.Text.Encoding.UTF8.GetBytes(logical)),TextPackStore.Hash(System.Text.Encoding.UTF8.GetBytes(actual)),StringComparison.Ordinal);File.WriteAllBytes(path,System.Text.Json.JsonSerializer.SerializeToUtf8Bytes(json));
                assert(Refuses(()=>registry.AssertReadable("alias-item")),"alias storage lookup refuses a different original path hash "+suffix);
            }
            var removing=new TextPackStore(Path.Combine(temp,"alias-remove-"+suffix),Path.Combine(temp,"alias-remove-state-"+suffix));removing.Write(actual,before);removing.Delete(logical,TextPackStore.Hash(before));
            var removal=new ReplacementRecoveryRegistry(removing.Root,removing.StateDirectory);var removed=removal.Entries().Single();var retained=removal.Inspect(removed);
            assert(!File.Exists(removing.Resolve(actual))&&retained.Prepared.SequenceEqual(before)&&retained.Displaced.SequenceEqual(before)&&retained.Recovery.Record.Filename==actual&&removed.Path==logical,"delete through case alias retains exact prepared and actual files with bound spelling "+suffix);
            File.WriteAllBytes(removing.Resolve(actual),before);File.WriteAllBytes(retained.Recovery.Displaced,after);
            var row=removing.ReplacementRecoveryList().Single();
            assert(!row.Resolved&&row.ResolutionBlocked is null&&row.CurrentPresent,"recreated original case alias is not misclassified as a relocated identity "+suffix);
            removing.ResolveReplacement(row.Id,row.Path,row.ItemId,row.CurrentHash,row.PreparedHash,row.DisplacedHash!,currentPresent:true,kind:"removal");
            assert(removing.ReplacementRecoveryList().Single().Resolved&&File.ReadAllBytes(removing.Resolve(actual)).SequenceEqual(before),"alias removal recovery keeps exact recreated bytes without renaming the current file "+suffix);
        }
        if(OperatingSystem.IsWindows()) {
            var store=new TextPackStore(Path.Combine(temp,"alias-distinct"),Path.Combine(temp,"alias-distinct-state"));var start=new System.Diagnostics.ProcessStartInfo("fsutil.exe"){UseShellExecute=false,RedirectStandardOutput=true,RedirectStandardError=true};foreach(var argument in new[]{"file","setCaseSensitiveInfo",store.Root,"enable"})start.ArgumentList.Add(argument);
            using var process=System.Diagnostics.Process.Start(start)!;process.StandardOutput.ReadToEnd();process.StandardError.ReadToEnd();process.WaitForExit();
            if(process.ExitCode==0) {
                var foreign=Pack("distinct","distinct-item");store.Write("CaseProbe.textpack",before);store.Write("caseprobe.textpack",foreign);
                store.Write("CaseProbe.textpack",after,TextPackStore.Hash(before));
                assert(store.Read("CaseProbe.textpack").SequenceEqual(after)&&store.Read("caseprobe.textpack").SequenceEqual(foreign),"exact existing case-sensitive filename never redirects to its distinct folded peer");
            }else Console.WriteLine("SKIP isolated case-sensitive alias peer capability is unavailable");
        }
    }
}
