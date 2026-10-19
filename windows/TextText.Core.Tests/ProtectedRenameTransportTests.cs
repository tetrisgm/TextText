using System.Net;
using System.Text;
using System.Text.Json;
using TextText.Core;

static class ProtectedRenameTransportTests
{
    static readonly ProtectedRenameRequest Command=new("11111111-1111-4111-8111-111111111111","fixture-item","Old.textpack","New.textpack",new string('a',64));
    sealed class Handler(Func<HttpRequestMessage,Task<HttpResponseMessage>> send):HttpMessageHandler {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken ct) {
            var response=await send(request);response.RequestMessage??=request;return response;
        }
    }
    sealed class BodySwitchContent(byte[] bytes,Action beforeRead):HttpContent {
        protected override async Task SerializeToStreamAsync(Stream stream,System.Net.TransportContext? context) {beforeRead();await stream.WriteAsync(bytes);}
        protected override bool TryComputeLength(out long length){length=bytes.Length;return true;}
    }
    static Dictionary<string,object?> Body(bool moved=true)=>new(){["status"]=moved?"moved":"conflict",["itemId"]=Command.ItemId,["relativePath"]=moved?Command.Destination:"Other.textpack",["revision"]=Command.BaseRevision};
    static byte[] Bytes(object body)=>JsonSerializer.SerializeToUtf8Bytes(body);
    public static async Task Run(Action<bool,string> check)
    {
        var scope=new ProtectedRenameScope("https://protected-rename.test","fixture","fixture-account");
        foreach(var status in new[]{200,409}) {
            var requestCount=0;
            using var client=new HttpClient(new Handler(async request=>{
                requestCount++;
                check(request.Method==HttpMethod.Patch&&request.RequestUri!.AbsolutePath=="/api/vault/fixture/items/fixture-item","protected rename uses existing authenticated PATCH endpoint");
                check(request.Headers.GetValues("X-TextText-Operation-Id").Single()==Command.OperationId&&request.Headers.GetValues("If-Match").Single()=="\""+Command.BaseRevision+"\""&&request.Headers.GetValues("X-TextText-Base-Path").Single()==Uri.EscapeDataString(Command.Source),"protected rename retains immutable CAS command headers");
                using var body=JsonDocument.Parse(await request.Content!.ReadAsByteArrayAsync());
                check(body.RootElement.GetProperty("relativePath").GetString()==Command.Destination,"protected rename preserves destination");
                return new((HttpStatusCode)status){Content=new ByteArrayContent(Bytes(Body(status==200)))};
            }));
            var transport=new HttpSyncTransport(client,new(scope.Origin),scope.WorkspaceId,scope.AccountId!,()=>Task.FromResult(new SyncAccountCredential("fixture-not-a-credential",scope.AccountId!)));
            var receipt=await transport.ProtectedRenameAsync(Command);
            check(receipt.Request==Command&&receipt.Scope==scope&&receipt.Status==(status==200?"moved":"conflict")&&requestCount==1,"typed receipt binds exact originating command and transport scope");
        }
        var retired=Body(false);retired["revision"]=null;retired["deleted"]=true;
        var terminal=HttpSyncTransport.ParseProtectedRename(Command,scope,409,Bytes(retired));
        check(terminal.Deleted&&terminal.Revision is null,"typed conflict accepts explicit tombstone and null revision");
        Refuses(()=>HttpSyncTransport.ParseProtectedRename(Command,scope with{AccountId=null},200,Bytes(Body())),check,"nil owner cannot mint terminal protected receipt");
        var ownerlessRequests=0;
        using(var client=new HttpClient(new Handler(_=>{ownerlessRequests++;throw new Exception("Ownerless send must not occur");}))) {
            var transport=new HttpSyncTransport(client,new(scope.Origin),scope.WorkspaceId,()=>Task.FromResult("fixture-not-a-credential"));
            try{await transport.ProtectedRenameAsync(Command);check(false,"ownerless transport refuses");}
            catch(SharedAccountMismatchException){check(ownerlessRequests==0,"ownerless protected move refuses before network");}
        }
        foreach(var change in new Dictionary<string,object?>[]{
            new(){["future"]=true},new(){["status"]="deleted"},new(){["Status"]="moved"},new(){["itemId"]="other"},
            new(){["relativePath"]="Other.textpack"},new(){["relativePath"]="../Escape.textpack"},new(){["revision"]=new string('b',64)},new(){["revision"]=null},new(){["deleted"]=false}
        }) {
            var body=Body();foreach(var entry in change)body[entry.Key]=entry.Value;
            Refuses(()=>HttpSyncTransport.ParseProtectedRename(Command,scope,200,Bytes(body)),check,"malformed/mismatched moved receipt remains ambiguous");
        }
        foreach(var flag in new object[]{false,1,"true"}) {
            var body=Body(false);body["deleted"]=flag;
            Refuses(()=>HttpSyncTransport.ParseProtectedRename(Command,scope,409,Bytes(body)),check,"deleted is optional true only");
        }
        foreach(var revision in new[]{Command.BaseRevision+"\n",Command.BaseRevision.ToUpperInvariant()}) {
            var body=Body(false);body["revision"]=revision;
            Refuses(()=>HttpSyncTransport.ParseProtectedRename(Command,scope,409,Bytes(body)),check,"noncanonical hash refuses");
        }
        var duplicate=Encoding.UTF8.GetBytes("{\"status\":\"moved\",\"status\":\"moved\",\"itemId\":\"fixture-item\",\"relativePath\":\"New.textpack\",\"revision\":\""+Command.BaseRevision+"\"}");
        Refuses(()=>HttpSyncTransport.ParseProtectedRename(Command,scope,200,duplicate),check,"duplicate receipt keys refuse");
        Refuses(()=>HttpSyncTransport.ParseProtectedRename(Command,scope,200,Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(Bytes(Body()))[..^1]+",}")),check,"trailing comma refuses");
        Refuses(()=>HttpSyncTransport.ParseProtectedRename(Command,scope,200,new byte[16385]),check,"oversize receipt refuses before JSON parse");
        foreach(var status in new[]{201,204,401,403,409,412,500}) {
            using var client=new HttpClient(new Handler(_=>Task.FromResult(new HttpResponseMessage((HttpStatusCode)status){Content=new StringContent("{\"error\":\"conflict\"}")})));
            var transport=new HttpSyncTransport(client,new(scope.Origin),scope.WorkspaceId,scope.AccountId!,()=>Task.FromResult(new SyncAccountCredential("fixture-not-a-credential",scope.AccountId!)));
            try{await transport.ProtectedRenameAsync(Command);check(false,"generic HTTP response rejected");}
            catch(Exception error)when(error is InvalidDataException or JsonException or HttpRequestException){check(error is not SyncConflictException,"generic HTTP error is not terminal rename conflict");}
        }
        var principal="fixture-account";
        using(var client=new HttpClient(new Handler(_=>{
            principal="different-account";
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK){Content=new ByteArrayContent(Bytes(Body()))});
        }))) {
            var transport=new HttpSyncTransport(client,new(scope.Origin),scope.WorkspaceId,scope.AccountId!,()=>Task.FromResult(new SyncAccountCredential("fixture-not-a-credential",principal)));
            try{await transport.ProtectedRenameAsync(Command);check(false,"changed principal rejected");}catch(SharedAccountMismatchException){check(true,"principal change during response refuses receipt");}
        }
        principal="fixture-account";
        using(var client=new HttpClient(new Handler(_=>Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK){Content=new BodySwitchContent(Bytes(Body()),()=>principal="different-account")})))) {
            var transport=new HttpSyncTransport(client,new(scope.Origin),scope.WorkspaceId,scope.AccountId!,()=>Task.FromResult(new SyncAccountCredential("fixture-not-a-credential",principal)));
            try{await transport.ProtectedRenameAsync(Command);check(false,"body-time principal change rejected");}catch(SharedAccountMismatchException){check(true,"principal is revalidated after response body read");}
        }
        using(var client=new HttpClient(new Handler(_=>Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK){Content=new ByteArrayContent(Bytes(Body())),RequestMessage=new(HttpMethod.Patch,"https://other.test/api/vault/fixture/items/fixture-item")})))) {
            var transport=new HttpSyncTransport(client,new(scope.Origin),scope.WorkspaceId,scope.AccountId!,()=>Task.FromResult(new SyncAccountCredential("fixture-not-a-credential",scope.AccountId!)));
            try{await transport.ProtectedRenameAsync(Command);check(false,"redirected receipt rejected");}catch(InvalidDataException){check(true,"receipt cannot cross originating endpoint");}
        }
        using(var client=new HttpClient(new Handler(_=>throw new HttpRequestException("fixture lost reply")))) {
            var transport=new HttpSyncTransport(client,new(scope.Origin),scope.WorkspaceId,scope.AccountId!,()=>Task.FromResult(new SyncAccountCredential("fixture-not-a-credential",scope.AccountId!)));
            try{await transport.ProtectedRenameAsync(Command);check(false,"lost reply rejected");}catch(HttpRequestException){check(true,"lost reply has no fabricated terminal receipt");}
        }
    }
    static void Refuses(Action action,Action<bool,string> check,string name) {
        try{action();check(false,name);}catch(Exception error)when(error is InvalidDataException or JsonException){check(true,name);}
    }
}
