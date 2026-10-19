using System.Net;
using System.Text;
using System.Text.Json;
using TextText.Core;

static class GenerationTransportTests
{
    static readonly string Revision=new('a',64);
    static string Manifest(string extra="")=>"{\"items\":[{\"itemId\":\"item\",\"relativePath\":\"Notes/Item.textpack\",\"revision\":\""+Revision+"\",\"canEditContent\":true"+extra+"}],\"tombstones\":[],\"folders\":[\"Notes\"],\"problems\":[],\"revision\":\""+Revision+"\",\"fullAccess\":true,\"canCreateContent\":true,\"writableFolders\":[]}";
    public static async Task Run(Action<bool,string> check) {
        var handler=new Handler();using var http=new HttpClient(handler);var transport=new HttpSyncTransport(http,new("https://generation.test"),"workspace","account",()=>Task.FromResult(new SyncAccountCredential("fixture-only-token","account")));
        handler.Body=Manifest();await transport.ManifestAsync();
        var evidence=await transport.GenerationEvidenceAsync("item");
        check(evidence?.Generation==MirrorGeneration.ObservedAbsent&&evidence.Scope.AccountId=="account","fresh owner-bound complete manifest proves omitted generation fields");
        check(handler.LastRequest?.Headers.IfNoneMatch.Count==0&&handler.LastRequest?.Headers.Authorization?.Scheme=="Bearer"&&handler.LastRequest?.Headers.GetValues("X-TextText-Account").Single()=="account","generation request bypasses cached ETag while retaining account headers");
        foreach(var extra in new[]{",\"lifecycle\":null",",\"restoreFromRevision\":null",",\"lifecycle\":\"g\"",",\"lifecycle\":\"g\",\"lifecycle\":\"g\""}) {
            handler.Body=Manifest(extra);var refused=false;try{await transport.GenerationEvidenceAsync("item");}catch(InvalidDataException){refused=true;}check(refused,"partial/null/duplicate generation cannot become observed absence");
        }
        handler.Body=Manifest(",\"lifecycle\":\"g\",\"restoreFromRevision\":\""+Revision+"\"");
        check((await transport.GenerationEvidenceAsync("item"))?.Generation==MirrorGeneration.Present("g"),"complete explicit generation remains present");
        handler.Body=Manifest();handler.Status=HttpStatusCode.NotModified;var stale=false;try{await transport.GenerationEvidenceAsync("item");}catch(InvalidDataException){stale=true;}check(stale,"304 never authorizes absent generation");
        handler.Status=HttpStatusCode.OK;
        using var legacyHttp=new HttpClient(new Handler{Body=Manifest()});var legacy=new HttpSyncTransport(legacyHttp,new("https://generation.test"),"workspace",()=>Task.FromResult("fixture-only-token"));
        check(await legacy.GenerationEvidenceAsync("item") is null,"legacy token-only transport has no absence authority");
        handler.Body=Manifest().Replace("\"fullAccess\":true","\"fullAccess\":false");
        check(await transport.GenerationEvidenceAsync("item") is null,"filtered manifest never supplies generation absence authority");
    }
    sealed class Handler:HttpMessageHandler {
        public string Body=Manifest();public HttpStatusCode Status=HttpStatusCode.OK;public HttpRequestMessage? LastRequest;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken ct) {
            LastRequest=request;var response=new HttpResponseMessage(Status){RequestMessage=request,Content=new ByteArrayContent(Encoding.UTF8.GetBytes(Body))};response.Headers.ETag=new("\"cached-manifest\"");return Task.FromResult(response);
        }
    }
}
