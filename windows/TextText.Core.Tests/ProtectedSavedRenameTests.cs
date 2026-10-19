using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using TextText.Core;

static class ProtectedSavedRenameTests
{
    const string Item="fixture-item", Lifecycle="generation-a";
    static readonly string Root=new('c',64), Hash=new('b',64), Revision=new('a',64);
    static readonly ProtectedRenameScope Scope=new("https://protected-rename.test","fixture","fixture-account");
    static readonly ProtectedRenameRequest Request=new("11111111-1111-4111-8111-111111111111",Item,"Original.textpack","Local.textpack",Revision);
    static ProtectedSavedRename.Record Pending()=>ProtectedSavedRename.Pending(Root,Request,Scope,Hash,Lifecycle);
    static ProtectedRenameReceipt Receipt(string status="conflict",string? revision=null,bool deleted=false)=>
        new(Request,Scope,status,status=="moved"?Request.Destination:"Server.textpack",revision??Revision,deleted);
    static ProtectedSavedRename.Record Rejected()=>ProtectedSavedRename.Consume(Pending(),Receipt()).Rejected!;
    static ProtectedSavedRename.Record Stopped()=>ProtectedSavedRename.Stop(Rejected(),new("Local.textpack","Server.textpack",Lifecycle,Lifecycle));
    public static void Run(Action<bool,string> check)
    {
        CodecVectors(check);
        var pending=Pending();var raw=JsonSerializer.SerializeToUtf8Bytes(pending);
        var restored=JsonSerializer.Deserialize<ProtectedSavedRename.Record>(raw)!;
        check(restored==pending,"pending exact operation survives serialization/restart");
        check(Encoding.UTF8.GetString(raw).Contains("\"receipt\":null")&&Encoding.UTF8.GetString(raw).Contains("\"resolution\":null"),"durable schema writes explicit nullable proof fields");
        check(JsonSerializer.SerializeToUtf8Bytes(pending,new JsonSerializerOptions{PropertyNamingPolicy=JsonNamingPolicy.SnakeCaseLower}).SequenceEqual(raw),"record codec ignores outer serializer naming policy");
        var oversized=new Dictionary<string,ProtectedSavedRename.Record>();
        for(var index=0;index<1001;index++) {
            var item="fixture-"+index;
            var request=Request with{ItemId=item,OperationId=$"{index:x8}-1111-4111-8111-111111111111"};
            oversized[item]=ProtectedSavedRename.Pending(Root,request,Scope,Hash,Lifecycle);
        }
        ProtectedSavedRename.ValidateMap(oversized.Take(1000).ToDictionary(x=>x.Key,x=>x.Value),Root,Scope);
        check(true,"1000 retained moves remain within the shared map bound");
        Refuses(()=>ProtectedSavedRename.ValidateMap(oversized,Root,Scope),check,"1001 retained moves exceed the shared map bound");
        Refuses(()=>ProtectedSavedRename.Validate(pending,new string('d',64),Scope),check,"different root refuses retained operation");
        Refuses(()=>ProtectedSavedRename.Validate(pending,Root,Scope with{AccountId="other-account"}),check,"different principal refuses retained operation");
        Refuses(()=>ProtectedSavedRename.Validate(pending,Root,Scope with{WorkspaceId="other-workspace"}),check,"different workspace refuses retained operation");
        Refuses(()=>ProtectedSavedRename.Validate(pending with{Version=2},Root,Scope),check,"future version refuses");
        foreach(var mutate in new Action<JsonObject>[] {
            o=>o["future"]=true,o=>o.Remove("receipt"),o=>o["version"]=1.5,o=>o["phase"]="future",
            o=>o["request"]!["future"]=true,o=>o["scope"]!["future"]=true,o=>o["scope"]!["accountId"]=null,
            o=>o["request"]!["source"]="../Escape.textpack",o=>o["baselineHash"]=Hash+"\n",
            o=>o["request"]!["operationId"]=Request.OperationId.ToUpperInvariant().Replace("11111111","ABCDEFAB")
        }) {
            var obj=JsonNode.Parse(raw)!.AsObject();mutate(obj);
            Refuses(()=>JsonSerializer.Deserialize<ProtectedSavedRename.Record>(obj.ToJsonString()),check,"strict stored record rejects unknown/missing/invalid fields");
        }
        var duplicate=Encoding.UTF8.GetString(raw).Replace("\"version\":1","\"version\":1,\"version\":1");
        Refuses(()=>JsonSerializer.Deserialize<ProtectedSavedRename.Record>(duplicate),check,"duplicate durable fields refuse");
        foreach(var state in new[]{"{\"SharedRenames\":{},\"SharedRenames\":{}}","{\"a\":{\"x\":1,\"\\u0078\":2}}","{\"a\":1,}","{\"a\":\"\\ud800\"}"})
            Refuses(()=>ProtectedSavedRename.ValidateStateBytes(Encoding.UTF8.GetBytes(state)),check,"whole owner state preflight rejects duplicate/escaped duplicate/trailing comma/unpaired Unicode before default decoding");
        ProtectedSavedRename.ValidateStateBytes(Encoding.UTF8.GetBytes("{\"SharedRenames\":{},\"Other\":{\"nested\":[1,true,null]}}"));
        check(true,"whole state structural preflight preserves unrelated valid metadata");
        var moved=ProtectedSavedRename.Consume(pending,Receipt("moved"));
        check(moved.MovedRevision==Revision&&moved.Rejected is null,"only matching typed moved receipt completes command");
        Refuses(()=>ProtectedSavedRename.Consume(pending,Receipt("moved",new string('d',64))),check,"moved byte revision cannot change");
        Refuses(()=>ProtectedSavedRename.Consume(pending,Receipt() with{Scope=Scope with{AccountId="other-account"}}),check,"typed receipt from other principal refuses");
        Refuses(()=>ProtectedSavedRename.Consume(pending,Receipt() with{Request=Request with{OperationId="22222222-2222-4222-8222-222222222222"}}),check,"typed receipt from another immutable operation refuses");
        var rejected=Rejected();check(rejected.Phase==ProtectedSavedRename.Phase.TerminalRejected&&rejected.Receipt==Receipt(),"exact typed conflict enters retained terminal rejection");
        check(JsonSerializer.Deserialize<ProtectedSavedRename.Record>(JsonSerializer.Serialize(rejected))==rejected,"terminal typed proof survives restart");
        Refuses(()=>ProtectedSavedRename.Stop(pending,new("Local.textpack","Server.textpack",Lifecycle,Lifecycle)),check,"ambiguous pending command cannot be stopped");
        Refuses(()=>ProtectedSavedRename.Stop(rejected,new("Local.textpack","Server.textpack",Lifecycle,"other-generation")),check,"stop cannot cross restored generation");
        Refuses(()=>ProtectedSavedRename.Stop(ProtectedSavedRename.Consume(pending,Receipt(deleted:true)).Rejected!,new("Local.textpack","Server.textpack",Lifecycle,Lifecycle)),check,"deleted server target cannot fabricate stopped live paths");
        Refuses(()=>ProtectedSavedRename.Stop(ProtectedSavedRename.Consume(pending,Receipt() with{Revision=null}).Rejected!,new("Local.textpack","Server.textpack",Lifecycle,Lifecycle)),check,"missing server revision remains review only");
        var stopped=Stopped();var restarted=JsonSerializer.Deserialize<ProtectedSavedRename.Record>(JsonSerializer.Serialize(stopped))!;
        check(ProtectedSavedRename.StoppedFactsMatch(restarted,"Local.textpack","Server.textpack",Lifecycle,Lifecycle,true),"stopped exact paths/generations remain matching after restart");
        // The evidence matcher intentionally receives no text hash/revision.
        check(ProtectedSavedRename.StoppedFactsMatch(restarted,"Local.textpack","Server.textpack",Lifecycle,Lifecycle,true),"peer text edits do not invalidate path suppression evidence");
        check(!ProtectedSavedRename.StoppedFactsMatch(restarted,"Another.textpack","Server.textpack",Lifecycle,Lifecycle,true)&&
              !ProtectedSavedRename.StoppedFactsMatch(restarted,"Local.textpack","Server.textpack",Lifecycle,"restored",true)&&
              !ProtectedSavedRename.StoppedFactsMatch(restarted,"Local.textpack","Server.textpack",Lifecycle,Lifecycle,false),"new path/changed generation/duplicate identity cannot reuse stopped match");

        var existing=new Dictionary<string,ProtectedSavedRename.Record>{{Item,stopped}};
        var next=ProtectedSavedRename.Pending(Root,Request with{OperationId="22222222-2222-4222-8222-222222222222",Source="Server.textpack",Destination="Deliberate.textpack",BaseRevision=new string('d',64)},Scope,Hash,Lifecycle);
        var observation=new ProtectedSavedRename.Observation(Root,Scope,"Deliberate.textpack","Server.textpack",Lifecycle,Lifecycle,next.Request.BaseRevision,"Deliberate.textpack",true,true,true);
        var proof=new ProtectedSavedRename.ArchiveProof(Request.OperationId,Root,Scope,ProtectedSavedRename.ArchiveHash(stopped),true);
        Refuses(()=>ProtectedSavedRename.Replace(new(Root,Scope),existing,Item,stopped,next,observed:observation),check,"fresh intent requires durable prior receipt archive");
        foreach(var bad in new[]{proof with{Durable=false},proof with{RecordHash=new string('e',64)},proof with{OperationId=next.Request.OperationId},proof with{Scope=Scope with{AccountId="other-account"}}})
            Refuses(()=>ProtectedSavedRename.Replace(new(Root,Scope),existing,Item,stopped,next,archive:bad,observed:observation),check,"wrong or nondurable archive cannot replace terminal command");
        foreach(var stale in new[]{observation with{CheckpointReady=false},observation with{LocalUnique=false},observation with{OrganizePermitted=false},observation with{CheckpointPath="Old.textpack"},observation with{RemotePath="Other.textpack"},observation with{LocalLifecycle="restored"},observation with{RemoteRevision=Revision}})
            Refuses(()=>ProtectedSavedRename.Replace(new(Root,Scope),existing,Item,stopped,next,archive:proof,observed:stale),check,"fresh intent rejects stale authority/path/checkpoint/generation facts");
        var changed=ProtectedSavedRename.Replace(new(Root,Scope),existing,Item,stopped,next,archive:proof,observed:observation);
        check(changed[Item]==next&&existing[Item]==stopped,"pure replacement returns new state without mutating old record/dictionary");
        check(ProtectedSavedRename.ArchiveBytes(stopped).SequenceEqual(ProtectedSavedRename.ArchiveBytes(restarted)),"archive proof bytes deterministic across restart");
        Refuses(()=>ProtectedSavedRename.Replace(new(Root,Scope),existing,Item,stopped,null),check,"terminal record cannot disappear without accepted completion");
        var pendingMap=new Dictionary<string,ProtectedSavedRename.Record>{{Item,pending}};
        check(ProtectedSavedRename.Replace(new(Root,Scope),pendingMap,Item,pending,null,completion:Receipt("moved")).Count==0&&pendingMap.Count==1,"matching moved receipt permits proposed owner removal only");

        var legacy=new SyncEngine.Operation(Request.OperationId,"rename",Item,Request.Source,Request.Destination,Request.BaseRevision,Hash,null,Conflicted:true,Lifecycle:Lifecycle);
        var baseline=new SyncEngine.Baseline(Request.Source,Hash,Revision,Lifecycle:Lifecycle);
        var normalized=ProtectedSavedRename.NormalizeLegacy(legacy,baseline,Root,Scope,true);
        check(normalized.Record==pending&&normalized.LegacyNeedsReview,"legacy conflicted operation retains exact ID/request and ambiguous review status, never terminal proof");
        var unknown=ProtectedSavedRename.NormalizeLegacy(legacy with{Lifecycle=null},baseline,Root,Scope,true);
        check(unknown.Record is null&&unknown.LegacyNeedsReview&&unknown.RetainedLegacy.Lifecycle is null&&unknown.RetainedLegacy.Id==legacy.Id,"unknown legacy generation remains exact raw owner record, never inferred from current baseline");
        Refuses(()=>ProtectedSavedRename.NormalizeLegacy(legacy,baseline,Root,Scope,false),check,"legacy normalization requires verified floor5");
        var newerText=ProtectedSavedRename.NormalizeLegacy(legacy,baseline with{Hash=new string('e',64),Revision=new string('f',64)},Root,Scope,true);
        check(newerText.Record==pending&&newerText.RetainedLegacy.Hash==Hash&&newerText.Record!.Request.BaseRevision==Revision,"newer text ACK does not rewrite captured rename hash/revision or operation ID");
        var newerPath=ProtectedSavedRename.NormalizeLegacy(legacy,baseline with{Path="Server.textpack"},Root,Scope,true);
        check(newerPath.Record==pending&&newerPath.Record!.Request.Source==Request.Source,"current baseline path does not rewrite immutable saved rename source");
        var changedGeneration=ProtectedSavedRename.NormalizeLegacy(legacy,baseline with{Lifecycle="restored"},Root,Scope,true);
        var missingBaseline=ProtectedSavedRename.NormalizeLegacy(legacy,null,Root,Scope,true);
        check(changedGeneration.Record is null&&changedGeneration.LegacyNeedsReview&&changedGeneration.RetainedLegacy==legacy&&
              missingBaseline.Record is null&&missingBaseline.LegacyNeedsReview&&missingBaseline.RetainedLegacy==legacy,"unknown or changed current generation retains exact raw legacy review without blocking normalization of other items");
        check(legacy.Conflicted&&legacy.Id==Request.OperationId,"normalization never clears existing owner state");
    }
    static void CodecVectors(Action<bool,string> check) {
        var directory=new DirectoryInfo(Directory.GetCurrentDirectory());
        while(directory is not null&&!File.Exists(System.IO.Path.Combine(directory.FullName,"sync","fixtures","protected-rename-state.json")))directory=directory.Parent;
        var path=System.IO.Path.Combine(directory?.FullName??throw new IOException("Missing protected rename state vectors."),"sync","fixtures","protected-rename-state.json");
        using var vectors=JsonDocument.Parse(File.ReadAllBytes(path));
        var context=vectors.RootElement.GetProperty("context");var scopeValue=context.GetProperty("scope");
        var root=context.GetProperty("rootHash").GetString()!;
        var scope=new ProtectedRenameScope(scopeValue.GetProperty("origin").GetString()!,scopeValue.GetProperty("workspaceId").GetString()!,scopeValue.GetProperty("accountId").GetString());
        foreach(var vector in vectors.RootElement.GetProperty("cases").EnumerateArray()) {
            var accepted=false;
            try {var record=JsonSerializer.Deserialize<ProtectedSavedRename.Record>(vector.GetProperty("record"))!;ProtectedSavedRename.Validate(record,root,scope);accepted=true;}
            catch(Exception error)when(error is InvalidDataException or InvalidOperationException or JsonException or FormatException) { }
            check(accepted==vector.GetProperty("valid").GetBoolean(),"shared protected rename codec vector "+vector.GetProperty("name").GetString());
        }
        foreach(var section in new[]{"rawRecords","rawMaps"})foreach(var vector in vectors.RootElement.GetProperty(section).EnumerateArray()) {
            var accepted=false;var bytes=Encoding.UTF8.GetBytes(vector.GetProperty("json").GetString()!);
            try {
                if(section=="rawRecords")ProtectedSavedRename.DecodeRecord(bytes,new(root,scope));
                else ProtectedSavedRename.DecodeMap(bytes,new(root,scope));
                accepted=true;
            }catch(Exception error)when(error is InvalidDataException or InvalidOperationException or JsonException or FormatException) { }
            check(accepted==vector.GetProperty("valid").GetBoolean(),"shared protected rename "+section+" vector "+vector.GetProperty("name").GetString());
        }
    }
    static void Refuses(Action action,Action<bool,string> check,string message) {
        try{action();check(false,message);}catch(Exception error)when(error is InvalidDataException or InvalidOperationException or JsonException or FormatException){check(true,message);}
    }
}
