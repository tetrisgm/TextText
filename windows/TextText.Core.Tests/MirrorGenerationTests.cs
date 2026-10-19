using System.Text.Json;
using TextText.Core;

static class MirrorGenerationTests
{
    public static async Task PolicyVectors(Action<bool,string> check) {
        var root=new DirectoryInfo(AppContext.BaseDirectory);while(root is not null&&!Directory.Exists(Path.Combine(root.FullName,"sync","fixtures")))root=root.Parent;
        if(root is null)throw new IOException("Generation fixture checkout missing.");
        var json=new JsonSerializerOptions{PropertyNamingPolicy=JsonNamingPolicy.CamelCase};
        foreach(var vector in JsonDocument.Parse(File.ReadAllBytes(Path.Combine(root.FullName,"sync","fixtures","mirror-generation.json"))).RootElement.EnumerateArray()) {
            var left=vector.GetProperty("left").Deserialize<MirrorGeneration>()!;var right=vector.GetProperty("right").Deserialize<MirrorGeneration>()!;
            check(left.Matches(right)==vector.GetProperty("same").GetBoolean(),"serialized generation vector: "+vector.GetProperty("name").GetString());
        }
        foreach(var vector in JsonDocument.Parse(File.ReadAllBytes(Path.Combine(root.FullName,"sync","fixtures","mirror-generation-rename.json"))).RootElement.EnumerateArray()) {
            var observed=vector.GetProperty("observed").Deserialize<MirrorSavedRenameObservation>(json)!;
            check(await NativePolicyTestHost.Create().SavedRenameAsync(observed)==vector.GetProperty("decision").Deserialize<MirrorSavedRenameDecision>(json),"native typed-generation policy vector: "+vector.GetProperty("name").GetString());
        }
    }
    public static void Run(Action<bool,string> check) {
        void Refuses(Action action,string label) {try {action();check(false,label);}catch(InvalidDataException){check(true,label);}catch(JsonException){check(true,label);}}
        check(!MirrorGeneration.Unknown.Matches(MirrorGeneration.Unknown),"unknown generation never matches itself");
        check(MirrorGeneration.ObservedAbsent.Matches(MirrorGeneration.ObservedAbsent),"observed absence matches exact observed absence");
        check(!MirrorGeneration.ObservedAbsent.Matches(MirrorGeneration.Present("a")),"absence never equals a present generation");
        check(MirrorGeneration.Present("a").Matches(MirrorGeneration.Present("a")),"present generation matches exact value");
        check(!MirrorGeneration.Present("a").Matches(MirrorGeneration.Present("A")),"generation comparison preserves case");
        foreach(var raw in new[]{"null","{}","{\"kind\":\"future\"}","{\"kind\":\"unknown\",\"generation\":null}","{\"kind\":\"present\",\"generation\":null}","{\"kind\":\"present\",\"generation\":\"\"}","{\"kind\":\"unknown\",\"kind\":\"unknown\"}"})
            Refuses(()=>JsonSerializer.Deserialize<MirrorGeneration>(raw),"strict generation shape refuses "+raw);
        Refuses(()=>MirrorGeneration.Present(new string('a',513)),"generation UTF8 bound enforced");
        Refuses(()=>MirrorGeneration.Present("a\n"),"generation ASCII controls refused");
        Refuses(()=>MirrorGeneration.Present("\ud800"),"generation invalid Unicode refused");
        var scope=new ProtectedRenameScope("https://fixture.invalid","workspace","account");var root=new string('a',64);var hash=new string('b',64);
        var request=new ProtectedRenameRequest("11111111-1111-4111-8111-111111111111","item","Old.textpack","New.textpack",hash);
        var saved=ProtectedSavedRename.Pending(root,request,scope,hash,MirrorGeneration.ObservedAbsent);
        var bytes=JsonSerializer.SerializeToUtf8Bytes(saved);
        check(ProtectedSavedRename.DecodeRecord(bytes,new(root,scope))==saved,"v2 absent immutable request survives restart");
        check(!System.Text.Encoding.UTF8.GetString(bytes).Contains("lifecycle"),"v2 durable shape does not synthesize legacy lifecycle");
        var receipt=new ProtectedRenameReceipt(request,scope,"conflict","Peer.textpack",hash,false);
        var stopped=ProtectedSavedRename.Stop(ProtectedSavedRename.Consume(saved,receipt).Rejected!,new("New.textpack","Peer.textpack",null,null,MirrorGeneration.ObservedAbsent,MirrorGeneration.ObservedAbsent));
        check(ProtectedSavedRename.StoppedFactsMatch(stopped,"New.textpack","Peer.textpack",MirrorGeneration.ObservedAbsent,MirrorGeneration.ObservedAbsent,true),"v2 stopped exact known generations match");
        check(!ProtectedSavedRename.StoppedFactsMatch(stopped,"New.textpack","Peer.textpack",(string?)null,(string?)null,true),"legacy nil facts cannot authorize v2 stopped record");
        Refuses(()=>ProtectedSavedRename.Pending(root,request,scope,hash,MirrorGeneration.Unknown),"unknown generation never becomes a durable v2 request");
    }
}
