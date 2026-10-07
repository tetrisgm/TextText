using System.IO.Compression;
using System.Text;
using TextText.Core;
static class PackLayoutTests
{
    static void Check(bool condition,string label){if(!condition)throw new Exception(label);Console.WriteLine("PASS "+label);}
    static byte[] Nested(bool ambiguous=false) {
        using var output=new MemoryStream();using(var zip=new ZipArchive(output,ZipArchiveMode.Create,true)) {
            foreach(var prefix in ambiguous?new[]{"First/","Second/"}:new[]{"Existing/"}) {
                using(var writer=new StreamWriter(zip.CreateEntry(prefix+"text.md").Open()))writer.Write("---\ntextTextId: \"nested-id\"\n---\nOriginal body");
                using(var writer=new StreamWriter(zip.CreateEntry(prefix+"document.json").Open()))writer.Write("{\"schemaVersion\":1,\"content\":{}}");
                using(var writer=new StreamWriter(zip.CreateEntry(prefix+"assets/opaque.bin").Open()))writer.Write("untouched");
            }
            using(var writer=new StreamWriter(zip.CreateEntry("outside.dat").Open()))writer.Write("outside");
        }return output.ToArray();
    }
    public static void Run(string temporaryRoot) {
        var bytes=Nested();Check(TextPackStore.Identity(bytes)=="nested-id"&&TextPackStore.DocumentPrefix(bytes)=="Existing/","single enclosing folder resolves document identity");
        var store=new TextPackStore(Path.Combine(temporaryRoot,"nested"),Path.Combine(temporaryRoot,"nested-state"));var file=store.Write("Notes/Existing.textpack",bytes);
        file=store.UpdateMarkdown(file.Path,TextPackStore.Markdown(bytes)+" edited",file.Hash);Check(TextPackStore.Markdown(store.Read(file.Path)).EndsWith(" edited"),"nested Markdown edit targets original prefix");
        var updated=TextPackStore.WithDocument(store.Read(file.Path),TextPackStore.Markdown(store.Read(file.Path))+" shared","{\"schemaVersion\":1,\"content\":{\"type\":\"doc\"}}");
        using(var zip=new ZipArchive(new MemoryStream(updated))) {
            Check(zip.GetEntry("text.md")==null&&zip.GetEntry("document.json")==null&&zip.GetEntry("Existing/document.json")!=null,"shared edit preserves nested document layout");
            using var opaque=new StreamReader(zip.GetEntry("Existing/assets/opaque.bin")!.Open());using var outside=new StreamReader(zip.GetEntry("outside.dat")!.Open());Check(opaque.ReadToEnd()=="untouched"&&outside.ReadToEnd()=="outside","nested and external opaque entries preserved");
        }
        try{_=TextPackStore.Identity(Nested(true));throw new Exception("ambiguous nested documents accepted");}catch(InvalidDataException){Console.WriteLine("PASS ambiguous enclosing folders rejected");}
        File.WriteAllBytes(store.Resolve("Notes/Incomplete.textpack"),[1,2,3]);var scanned=store.Scan();Check(scanned.Count==1&&store.LastScanErrors.Any(x=>x.Path=="Notes/Incomplete.textpack"),"malformed pack is diagnosed without hiding healthy file");
        File.WriteAllBytes(store.Resolve("Notes/Duplicate.textpack"),store.Read(file.Path));scanned=store.Scan();Check(scanned.Count==0&&store.LastScanErrors.Count(x=>x.Reason.Contains("Duplicate"))==2,"all copies of ambiguous identity are excluded and diagnosed");
        File.Delete(store.Resolve("Notes/Duplicate.textpack"));File.Delete(store.Resolve("Notes/Incomplete.textpack"));Check(store.Scan().Count==1&&store.LastScanErrors.Count==0,"scan diagnostics clear after files recover");
        var target=Path.Combine(temporaryRoot,"link-target");Directory.CreateDirectory(target);try{Directory.CreateSymbolicLink(store.Resolve("Linked"),target);Check(store.Scan().Count==1&&store.LastScanErrors.Any(x=>x.Path=="Linked"),"linked directory skipped with diagnostic");}catch(UnauthorizedAccessException){Console.WriteLine("SKIP creating test symlink requires Windows developer mode");}
    }
}
