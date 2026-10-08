using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
namespace TextText.Core;
public sealed class HttpSyncTransport : ISyncTransport
{
    readonly HttpClient http; readonly Uri endpoint; readonly Func<Task<string>> token; string? etag; IReadOnlyList<RemoteItem> cached=[];
    static readonly JsonSerializerOptions Json=new(){PropertyNameCaseInsensitive=true};
    public HttpSyncTransport(HttpClient http,Uri origin,string workspaceId,Func<Task<string>> tokenProvider) {
        if(origin.Scheme!="https" || !string.IsNullOrEmpty(origin.UserInfo) || origin.AbsolutePath!="/" || !string.IsNullOrEmpty(origin.Query) || !System.Text.RegularExpressions.Regex.IsMatch(workspaceId,@"^[A-Za-z0-9_-]+$")) throw new ArgumentException("Invalid sync binding.");
        this.http=http;token=tokenProvider;endpoint=new(origin,"api/vault/"+workspaceId+"/items");
    }
    async Task<HttpResponseMessage> Send(Func<HttpRequestMessage> create,CancellationToken ct) {
        var credential=await token();
        for(var attempt=0;;attempt++) {
            using var request=create();request.Headers.Authorization=new("Bearer",credential);
            var response=await http.SendAsync(request,HttpCompletionOption.ResponseHeadersRead,ct);
            if(response.StatusCode==HttpStatusCode.Unauthorized && attempt==0) {var fresh=await token();if(fresh!=credential){response.Dispose();credential=fresh;continue;}}
            if(response.StatusCode is HttpStatusCode.Conflict or HttpStatusCode.PreconditionFailed) {response.Dispose();throw new SyncConflictException();}
            if(!response.IsSuccessStatusCode && response.StatusCode!=HttpStatusCode.NotModified) {var code=response.StatusCode;response.Dispose();throw new HttpRequestException("Sync request failed ("+(int)code+").",null,code);}
            return response;
        }
    }
    static async Task<byte[]> Bytes(HttpResponseMessage response,CancellationToken ct) {
        if(response.Content.Headers.ContentLength>64*1024*1024)throw new InvalidDataException("Remote file too large.");
        using var output=new MemoryStream();using var input=await response.Content.ReadAsStreamAsync(ct);var buffer=new byte[65536];int count;
        while((count=await input.ReadAsync(buffer,ct))>0){if(output.Length+count>64*1024*1024)throw new InvalidDataException("Remote file too large.");output.Write(buffer,0,count);}return output.ToArray();
    }
    public IReadOnlyList<string> Folders {get;private set;}=[];
    sealed record Manifest(RemoteItem[] Items,RemoteItem[]? Tombstones,string[]? Folders);
    public async Task<IReadOnlyList<RemoteItem>> ManifestAsync(CancellationToken cancellation=default) {
        using var response=await Send(()=>{var r=new HttpRequestMessage(HttpMethod.Get,endpoint);if(etag!=null)r.Headers.TryAddWithoutValidation("If-None-Match",etag);return r;},cancellation);
        if(response.StatusCode==HttpStatusCode.NotModified)return cached;
        var manifest=JsonSerializer.Deserialize<Manifest>(await Bytes(response,cancellation),Json)??throw new InvalidDataException("Invalid manifest.");
        Folders=manifest.Folders??[];
        cached=manifest.Items.Concat((manifest.Tombstones??[]).Select(x=>x with{Deleted=true})).ToArray();etag=response.Headers.ETag?.ToString();return cached;
    }
    Uri Item(string id)=>new(endpoint+"/"+Uri.EscapeDataString(id));
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
    public async Task DeleteAsync(string itemId,string path,string baseRevision,string operationId,CancellationToken cancellation=default){using var response=await Send(()=>{var r=new HttpRequestMessage(HttpMethod.Delete,Item(itemId));r.Headers.Add("X-TextText-Base-Path",Uri.EscapeDataString(path));Match(r,baseRevision,operationId);return r;},cancellation);}
}
