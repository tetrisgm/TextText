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
        var markdown=TextPackStore.Markdown(bytes);
        var ordered=TextPackStore.WithDocument(bytes,markdown,"{\"schemaVersion\":1,\"content\":{\"title\":\"Same\",\"tags\":[\"one\",\"two\"]}}");
        var reordered=TextPackStore.WithDocument(bytes,markdown,"{ \"content\": { \"tags\": [\"one\", \"two\"], \"title\": \"Same\" }, \"schemaVersion\": 1 }");
        Check(TextPackStore.Equivalent(ordered,reordered),"document JSON formatting and object order do not create a sync conflict");
        var changed=TextPackStore.WithDocument(bytes,markdown,"{\"schemaVersion\":1,\"content\":{\"title\":\"Same\",\"tags\":[\"two\",\"one\"]}}");
        Check(!TextPackStore.Equivalent(ordered,changed),"document array order remains a meaningful difference");
        var duplicate=TextPackStore.WithDocument(bytes,markdown,"{\"schemaVersion\":1,\"content\":{\"title\":\"Different\",\"title\":\"Same\",\"tags\":[\"one\",\"two\"]}}");
        Check(!TextPackStore.Equivalent(ordered,duplicate),"duplicate JSON properties cannot conceal a document difference");
        Check(!TextPackStore.Equivalent(ordered,TextPackStore.WithDocument(reordered,markdown+" changed","{\"schemaVersion\":1,\"content\":{\"title\":\"Same\",\"tags\":[\"one\",\"two\"]}}")),"equivalent JSON never hides a direct Markdown edit");
        var snapshot="{\"schemaVersion\":1,\"content\":{}}";
        byte[] Metadata(string header) => TextPackStore.WithDocument(bytes,"---\ntextTextId: \"nested-id\"\n"+header+"---\nOriginal body",snapshot);
        Check(TextPackStore.ExtendsMetadata(Metadata("workspace: \"Workspace\"\n"),Metadata("")),"additive scalar metadata is eligible for conditional upload");
        Check(!TextPackStore.ExtendsMetadata(Metadata("workspace: \"Other\"\nextra: true\n"),Metadata("workspace: \"Workspace\"\n")),"changed existing metadata requires reconciliation");
        Check(!TextPackStore.ExtendsMetadata(Metadata("workspace: \"One\"\nworkspace: \"Two\"\n"),Metadata("")),"duplicate header fields cannot authorize metadata adoption");
        Check(!TextPackStore.ExtendsMetadata(Metadata("custom: |\n  multiline\n"),Metadata("")),"general YAML remains outside simple additive metadata adoption");
        Check(!TextPackStore.ExtendsMetadata(Metadata("visibility: \"public\"\n"),Metadata("")),"new authored metadata is not treated as generated projection data");
        Check(!TextPackStore.ExtendsMetadata(Metadata("excerpt: \"Authored subtitle\"\n"),Metadata("")),"a nonempty subtitle is a content change");
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
        var recovery=store.Preserve(bytes,"conflict");var recoveryDirectory=store.GetRecoveryDirectory();Check(Path.GetDirectoryName(recovery)==recoveryDirectory&&File.ReadAllBytes(recovery).SequenceEqual(bytes),"recovery location exposes only this workspace retained copies");
        var guarded=new TextPackStore(Path.Combine(temporaryRoot,"guarded-recovery"),Path.Combine(temporaryRoot,"guarded-state"));var outsideRecovery=Path.Combine(temporaryRoot,"outside-recovery");Directory.CreateDirectory(outsideRecovery);
        try {
            Directory.CreateSymbolicLink(Path.Combine(guarded.StateDirectory,"recovery"),outsideRecovery);
            try{_=guarded.GetRecoveryDirectory();throw new Exception("linked recovery directory accepted");}catch(IOException){Console.WriteLine("PASS recovery location rejects redirected directory");}
            Check(Directory.GetFileSystemEntries(outsideRecovery).Length==0,"recovery path validation leaves external directory untouched");
        }catch(UnauthorizedAccessException){Console.WriteLine("SKIP creating test symlink requires Windows developer mode");}
        var target=Path.Combine(temporaryRoot,"link-target");Directory.CreateDirectory(target);try{Directory.CreateSymbolicLink(store.Resolve("Linked"),target);Check(store.Scan().Count==1&&store.LastScanErrors.Any(x=>x.Path=="Linked"),"linked directory skipped with diagnostic");}catch(UnauthorizedAccessException){Console.WriteLine("SKIP creating test symlink requires Windows developer mode");}
    }
}
