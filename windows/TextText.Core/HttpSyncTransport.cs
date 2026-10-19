using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
namespace TextText.Core;
public sealed record SyncAccountCredential(string Token,string AccountId);
public sealed record ProtectedRenameRequest(string OperationId,string ItemId,string Source,string Destination,string BaseRevision);
public sealed record ProtectedRenameScope(string Origin,string WorkspaceId,string? AccountId);
public sealed record ProtectedRenameReceipt(ProtectedRenameRequest Request,ProtectedRenameScope Scope,string Status,string RelativePath,string? Revision,bool Deleted);
public sealed class HttpSyncTransport : ISyncTransport
{
    readonly bool ownerFallback; readonly HttpClient http; readonly Uri endpoint; readonly Func<Task<string>> token; string? etag; IReadOnlyList<RemoteItem> cached=[];
    readonly SemaphoreSlim credentialGate=new(1,1);
    readonly Func<Task<SyncAccountCredential>>? verifiedCredentials;
    readonly string? accountId;
    string? pinnedLegacyToken;
    static readonly JsonSerializerOptions Json=new(){PropertyNameCaseInsensitive=true};
    public HttpSyncTransport(HttpClient http,Uri origin,string workspaceId,Func<Task<string>> tokenProvider,bool ownerFallback = true) {
        if(origin.Scheme!="https" || !string.IsNullOrEmpty(origin.UserInfo) || origin.AbsolutePath!="/" || !string.IsNullOrEmpty(origin.Query) || !System.Text.RegularExpressions.Regex.IsMatch(workspaceId,@"^[A-Za-z0-9_-]+$")) throw new ArgumentException("Invalid sync binding.");
        this.ownerFallback=ownerFallback;this.http=http;token=tokenProvider;endpoint=new(origin,"api/vault/"+workspaceId+"/items");
    }
    public HttpSyncTransport(HttpClient http,Uri origin,string workspaceId,string accountId,Func<Task<SyncAccountCredential>> credentials,bool ownerFallback=true)
        : this(http,origin,workspaceId,()=>Task.FromResult(""),ownerFallback) {
        if(!System.Text.RegularExpressions.Regex.IsMatch(accountId,@"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\z"))throw new ArgumentException("Invalid account identity.");
        this.accountId=accountId;verifiedCredentials=credentials;
    }
    async Task<string> Credential(CancellationToken ct) {
        if(verifiedCredentials is not null) {
            var credential=await verifiedCredentials();ct.ThrowIfCancellationRequested();
            if(credential.AccountId!=accountId)throw new SharedAccountMismatchException();
            return credential.Token;
        }
        await credentialGate.WaitAsync(ct);
        try {
            var current=await token();ct.ThrowIfCancellationRequested();
            if(pinnedLegacyToken is null)pinnedLegacyToken=current;
            else if(current!=pinnedLegacyToken)throw new SharedAccountMismatchException();
            return current;
        } finally {credentialGate.Release();}
    }
    async Task<HttpResponseMessage> Send(Func<HttpRequestMessage> create,CancellationToken ct,bool protectedRename=false) {
        var credential=await Credential(ct);
        for(var attempt=0;;attempt++) {
            using var request=create();request.Headers.Authorization=new("Bearer",credential);
            if(accountId is not null)request.Headers.TryAddWithoutValidation("X-TextText-Account",accountId);
            var response=await http.SendAsync(request,HttpCompletionOption.ResponseHeadersRead,ct);
            if(response.StatusCode==HttpStatusCode.Unauthorized && attempt==0 && verifiedCredentials is not null) {
                string fresh;
                try {fresh=await Credential(ct);}catch {response.Dispose();throw;}
                if(fresh!=credential){response.Dispose();credential=fresh;continue;}
            }
            if(!protectedRename && (response.StatusCode is HttpStatusCode.Conflict or HttpStatusCode.PreconditionFailed)) {response.Dispose();throw new SyncConflictException();}
            if(!response.IsSuccessStatusCode && response.StatusCode!=HttpStatusCode.NotModified && !(protectedRename&&response.StatusCode==HttpStatusCode.Conflict)) {var code=response.StatusCode;response.Dispose();throw new HttpRequestException("Sync request failed ("+(int)code+").",null,code);}
            try { _=await Credential(ct); } catch {response.Dispose();throw;}
            return response;
        }
    }
    static async Task<byte[]> Bytes(HttpResponseMessage response,CancellationToken ct,int maximum=64*1024*1024) {
        if(response.Content.Headers.ContentLength>maximum)throw new InvalidDataException("Remote file too large.");
        using var output=new MemoryStream();using var input=await response.Content.ReadAsStreamAsync(ct);var buffer=new byte[65536];int count;
        while((count=await input.ReadAsync(buffer,ct))>0){if(output.Length+count>maximum)throw new InvalidDataException("Remote file too large.");output.Write(buffer,0,count);}return output.ToArray();
    }
    public IReadOnlyList<string> Folders {get;private set;}=[];
    public IReadOnlyList<string>? AuthoritativeFolders {get;private set;}
    public WorkspaceCapabilities? Capabilities {get;private set;}
    public string? ManifestRevision {get;private set;}
    public bool SupportsFolderCaseMoves {get;private set;}
    public ProtectedRenameScope? ProtectedRenameBinding=>accountId is null?null:new(endpoint.GetLeftPart(UriPartial.Authority),endpoint.Segments[^2].TrimEnd('/'),accountId);
    sealed record Manifest(RemoteItem[] Items,RemoteItem[]? Tombstones,string[]? Folders,bool? FullAccess,bool? CanCreateContent,string[]? WritableFolders,string? ManifestRevision,string[]? SyncCapabilities);
    public async Task<IReadOnlyList<RemoteItem>> ManifestAsync(CancellationToken cancellation=default) {
        using var response=await Send(()=>{var r=new HttpRequestMessage(HttpMethod.Get,endpoint);if(etag!=null)r.Headers.TryAddWithoutValidation("If-None-Match",etag);return r;},cancellation);
        if(response.StatusCode==HttpStatusCode.NotModified)return cached;
        var manifest=JsonSerializer.Deserialize<Manifest>(await Bytes(response,cancellation),Json)??throw new InvalidDataException("Invalid manifest.");
        Folders=manifest.Folders??[];
        ManifestRevision=manifest.ManifestRevision;SupportsFolderCaseMoves=manifest.SyncCapabilities?.Contains("folder-case-moves-v1",StringComparer.Ordinal)==true;
        AuthoritativeFolders=manifest.Folders!=null&&manifest.FullAccess==true&&manifest.CanCreateContent==true?Folders:null;
        cached=manifest.Items.Concat((manifest.Tombstones??[]).Select(x=>x with{Deleted=true})).ToArray();
        Capabilities=new(manifest.FullAccess??ownerFallback,manifest.CanCreateContent??ownerFallback,manifest.WritableFolders??[],cached.ToDictionary(item=>item.ItemId,item=>item.CanEditContent??ownerFallback));
        etag=response.Headers.ETag?.ToString();return cached;
    }
    // This deliberately bypasses cached manifest/ETag state. Omitted generation
    // fields become evidence only on a fresh, strict, authenticated full reply.
    public async Task<RemoteManifestGenerationEvidence?> GenerationEvidenceAsync(string itemId,CancellationToken cancellation=default) {
        if(verifiedCredentials is null||ProtectedRenameBinding is not {} binding)return null;
        using var response=await Send(()=>new HttpRequestMessage(HttpMethod.Get,endpoint),cancellation);
        if(response.StatusCode!=HttpStatusCode.OK)throw new InvalidDataException("Fresh generation manifest required.");
        if(response.RequestMessage?.RequestUri!=endpoint)throw new InvalidDataException("Generation manifest endpoint changed.");
        var bytes=await Bytes(response,cancellation,16*1024*1024);
        _=await Credential(cancellation);
        return MirrorGenerationManifest.Parse(bytes,itemId,binding);
    }
    public async Task<FolderCaseMoveReceipt> MoveFolderCaseAsync(FolderCaseMoveRequest request,CancellationToken cancellation=default) {
        using var response=await Send(()=>new HttpRequestMessage(HttpMethod.Post,new Uri(endpoint,"folder-case-moves")){Content=new StringContent(JsonSerializer.Serialize(request,FolderWireJson),Encoding.UTF8,"application/json")},cancellation);
        return JsonSerializer.Deserialize<FolderCaseMoveReceipt>(await Bytes(response,cancellation),Json)??throw new InvalidDataException("Invalid folder move receipt.");
    }
    public async Task<FolderCaseRecoveryReply> RecoverFolderCaseAsync(FolderCaseMoveRequest command,bool cancel,string? inspection,CancellationToken cancellation=default) {
        var payload=cancel?JsonSerializer.Serialize(new{action="cancel",command,inspection,consent=true},FolderWireJson):JsonSerializer.Serialize(new{action="inspect",command},FolderWireJson);
        using var response=await Send(()=>new HttpRequestMessage(HttpMethod.Post,new Uri(endpoint,"folder-case-moves/recovery")){Content=new StringContent(payload,Encoding.UTF8,"application/json")},cancellation);
        var bytes=await Bytes(response,cancellation);using var parsed=JsonDocument.Parse(bytes);if(parsed.RootElement.ValueKind!=JsonValueKind.Object||!parsed.RootElement.TryGetProperty("state",out var stateField)||stateField.ValueKind!=JsonValueKind.String)throw new InvalidDataException("Invalid folder recovery response state.");var state=stateField.GetString();
        string[] fields=state switch{"completed"=>["state","requestHash","result"],"review"=>["state","operationId","requestHash","source","destination","inspection","manifestRevision","folders","items"],"cancelled"=>["state","operationId","requestHash","source","destination","inspection","manifestRevision"],_=>throw new InvalidDataException("Unsupported folder recovery response.")};
        RetainedFileReplacement.JsonFields(bytes,fields,fields);
        return JsonSerializer.Deserialize<FolderCaseRecoveryReply>(bytes,Json)??throw new InvalidDataException("Invalid folder recovery response.");
    }
    static readonly JsonSerializerOptions FolderWireJson=new(){PropertyNamingPolicy=JsonNamingPolicy.CamelCase};
    Uri Item(string id)=>new(endpoint+"/"+Uri.EscapeDataString(id));
    Uri Binary(string id)=>new(Item(id)+"/binary");
    public async Task<RemoteBinaryManifest> BinaryManifestAsync(string itemId,CancellationToken cancellation=default) {
        using var response=await Send(()=>new(HttpMethod.Get,Binary(itemId)),cancellation);
        var manifest=JsonSerializer.Deserialize<RemoteBinaryManifest>(await Bytes(response,cancellation),Json)??throw new InvalidDataException("Invalid binary manifest.");
        if(!System.Text.RegularExpressions.Regex.IsMatch(manifest.Revision,@"^[a-f0-9]{64}$") || manifest.Entries is null || manifest.Entries.Length>10000 ||
           manifest.Entries.Any(x=>!x.Path.StartsWith("assets/",StringComparison.Ordinal)||x.Size<0||x.Size>64*1024*1024||!System.Text.RegularExpressions.Regex.IsMatch(x.Sha256,@"^[a-f0-9]{64}$")))
            throw new InvalidDataException("Invalid binary manifest.");
        return manifest;
    }
    public async Task<byte[]> BinaryReadAsync(string itemId,string entryPath,CancellationToken cancellation=default) {
        if(!entryPath.StartsWith("assets/",StringComparison.Ordinal)||entryPath.Contains("..",StringComparison.Ordinal)||entryPath.Contains('\\')||entryPath.Length>512)throw new InvalidDataException("Invalid binary entry path.");
        using var response=await Send(()=>new(HttpMethod.Get,new Uri(Binary(itemId)+"?entry="+Uri.EscapeDataString(entryPath))),cancellation);
        return await Bytes(response,cancellation);
    }
    public async Task<string> BinaryPatchAsync(string itemId,string operationId,string entryPath,string? expectedHash,string? expectedLifecycle,byte[]? bytes,CancellationToken cancellation=default) {
        if(bytes?.Length>16*1024*1024)throw new InvalidDataException("Binary entry too large.");
        return await Mutation(()=>new HttpRequestMessage(HttpMethod.Patch,Binary(itemId)) { Content=new StringContent(JsonSerializer.Serialize(new {
            operationId,entryPath,expectedHash,expectedLifecycle,bytesBase64=bytes==null?null:Convert.ToBase64String(bytes),
        }),Encoding.UTF8,"application/json") },cancellation);
    }
    public async Task<RemotePack> DownloadAsync(string itemId,CancellationToken cancellation=default) {
        using var response=await Send(()=>new(HttpMethod.Get,Item(itemId)),cancellation);
        var revision=response.Headers.ETag?.Tag.Trim('"')??throw new InvalidDataException("Missing revision.");
        var path=Uri.UnescapeDataString(response.Headers.GetValues("X-TextText-Path").Single());return new(await Bytes(response,cancellation),path,revision);
    }
    static void Match(HttpRequestMessage r,string? revision,string operationId){r.Headers.TryAddWithoutValidation(revision==null?"If-None-Match":"If-Match",revision==null?"*":"\""+revision+"\"");r.Headers.Add("X-TextText-Operation-Id",operationId);}
    sealed record Receipt(string Revision);
    async Task<string> Mutation(Func<HttpRequestMessage> request,CancellationToken ct){using var r=await Send(request,ct);return (JsonSerializer.Deserialize<Receipt>(await Bytes(r,ct),Json)??throw new InvalidDataException("Invalid receipt.")).Revision;}
    public Task<string> UploadAsync(string itemId,string path,byte[] data,string? baseRevision,string operationId,CancellationToken cancellation=default)=>Mutation(()=>{
        var r=new HttpRequestMessage(HttpMethod.Put,Item(itemId)){Content=new ByteArrayContent(data)};r.Content.Headers.ContentType=new("application/octet-stream");r.Headers.Add("X-TextText-Path",Uri.EscapeDataString(path));r.Headers.Add("X-TextText-Edit-Origin","local-file");Match(r,baseRevision,operationId);return r;
    },cancellation);
    public Task<string> RenameAsync(string itemId,string from,string to,string baseRevision,string operationId,CancellationToken cancellation=default)=>Mutation(()=>{
        var r=new HttpRequestMessage(HttpMethod.Patch,Item(itemId)){Content=new StringContent(JsonSerializer.Serialize(new{relativePath=to}),Encoding.UTF8,"application/json")};r.Headers.Add("X-TextText-Base-Path",Uri.EscapeDataString(from));Match(r,baseRevision,operationId);return r;
    },cancellation);
    /// Only a strictly validated endpoint receipt can resolve a protected move.
    /// Generic conflicts and lost replies remain ambiguous to its caller.
    public async Task<ProtectedRenameReceipt> ProtectedRenameAsync(ProtectedRenameRequest command,CancellationToken cancellation=default) {
        ValidateProtectedRename(command);
        if(accountId is null)throw new SharedAccountMismatchException();
        using var response=await Send(()=>{
            var request=new HttpRequestMessage(HttpMethod.Patch,Item(command.ItemId)) {
                Content=new StringContent(JsonSerializer.Serialize(new{relativePath=command.Destination}),Encoding.UTF8,"application/json")
            };
            request.Headers.Add("X-TextText-Base-Path",Uri.EscapeDataString(command.Source));
            Match(request,command.BaseRevision,command.OperationId);return request;
        },cancellation,protectedRename:true);
        if(response.RequestMessage?.RequestUri!=Item(command.ItemId))throw new InvalidDataException("Protected move response changed endpoint.");
        var bytes=await Bytes(response,cancellation,16384);
        _=await Credential(cancellation);
        var scope=new ProtectedRenameScope(endpoint.GetLeftPart(UriPartial.Authority),endpoint.Segments[^2].TrimEnd('/'),accountId);
        return ParseProtectedRename(command,scope,(int)response.StatusCode,bytes);
    }
    static bool RenameDigest(string? value)=>value is {Length:64}&&value.All(c=>c is >= '0' and <= '9' or >= 'a' and <= 'f');
    static bool RenamePath(string? value) {
        if(value is not {Length:>0 and <=1024}||!value.EndsWith(".textpack",StringComparison.OrdinalIgnoreCase)||
           value.Any(c=>c is '\\' or ':' || char.IsControl(c))||value.Split('/').Any(part=>part is "" or "." or ".."))return false;
        for(var index=0;index<value.Length;index++)if(char.IsSurrogate(value[index])) {
            if(!char.IsHighSurrogate(value[index])||index+1>=value.Length||!char.IsLowSurrogate(value[++index]))return false;
        }
        return true;
    }
    static void ValidateProtectedRename(ProtectedRenameRequest command) {
        static bool Segment(string value)=>System.Text.RegularExpressions.Regex.IsMatch(value,@"\A[A-Za-z0-9][A-Za-z0-9_-]{0,127}\z");
        if(!Segment(command.OperationId)||!Segment(command.ItemId)||!RenamePath(command.Source)||!RenamePath(command.Destination)||!RenameDigest(command.BaseRevision))throw new InvalidDataException("Invalid protected move command.");
    }
    public static ProtectedRenameReceipt ParseProtectedRename(ProtectedRenameRequest command,ProtectedRenameScope scope,int status,byte[] bytes) {
        ValidateProtectedRename(command);
        if(scope.AccountId is null||!System.Text.RegularExpressions.Regex.IsMatch(scope.AccountId,@"\A[A-Za-z0-9][A-Za-z0-9_-]{0,127}\z")||
           !Uri.TryCreate(scope.Origin,UriKind.Absolute,out var origin)||origin.Scheme!="https"||origin.AbsolutePath!="/"||!string.IsNullOrEmpty(origin.UserInfo)||!string.IsNullOrEmpty(origin.Query)||!string.IsNullOrEmpty(origin.Fragment)||
           !System.Text.RegularExpressions.Regex.IsMatch(scope.WorkspaceId,@"\A[A-Za-z0-9_-]+\z"))throw new InvalidDataException("Verified protected move ownership is required.");
        if(bytes.Length>16384||status is not(200 or 409))throw new InvalidDataException("Ambiguous protected move response.");
        using var document=JsonDocument.Parse(bytes);var value=document.RootElement;
        if(value.ValueKind!=JsonValueKind.Object)throw new InvalidDataException("Invalid protected move receipt.");
        var properties=value.EnumerateObject().ToArray();
        var expected=new[]{"status","itemId","relativePath","revision"};
        var deleted=value.TryGetProperty("deleted",out var deletion);
        if(deleted)expected=[..expected,"deleted"];
        if(properties.Length!=expected.Length||!properties.Select(x=>x.Name).Order(StringComparer.Ordinal).SequenceEqual(expected.Order(StringComparer.Ordinal)))throw new InvalidDataException("Unknown protected move receipt field.");
        string? Text(string name)=>value.GetProperty(name).ValueKind==JsonValueKind.String?value.GetProperty(name).GetString():null;
        var resultStatus=Text("status");var path=Text("relativePath");var revision=Text("revision");
        if(Text("itemId")!=command.ItemId||!RenamePath(path)||
           (status==200?(resultStatus!="moved"||path!=command.Destination||revision!=command.BaseRevision||deleted):
             (resultStatus!="conflict"||value.GetProperty("revision").ValueKind is not(JsonValueKind.Null or JsonValueKind.String)||revision is not null&&!RenameDigest(revision)||deleted&&deletion.ValueKind!=JsonValueKind.True)))throw new InvalidDataException("Mismatched protected move receipt.");
        return new(command,scope,resultStatus!,path!,revision,deleted);
    }
    public async Task DeleteAsync(string itemId,string path,string baseRevision,string operationId,CancellationToken cancellation=default){using var response=await Send(()=>{var r=new HttpRequestMessage(HttpMethod.Delete,Item(itemId));r.Headers.Add("X-TextText-Base-Path",Uri.EscapeDataString(path));Match(r,baseRevision,operationId);return r;},cancellation);}
}
