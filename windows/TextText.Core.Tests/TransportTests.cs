using System.Net;
using System.Text;
using TextText.Core;
static class TransportTests
{
    static void Check(bool condition,string name){if(!condition)throw new Exception(name);Console.WriteLine("PASS "+name);}
    sealed class Handler(Func<HttpRequestMessage,Task<HttpResponseMessage>> action):HttpMessageHandler {protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken ct)=>action(request);}
    static HttpResponseMessage Json(string text,HttpStatusCode status=HttpStatusCode.OK)=>new(status){Content=new StringContent(text,Encoding.UTF8,"application/json")};
    public static async Task Run()
    {
        var path="Bookmarks/A name # % ü.textpack";var calls=0;
        using(var client=new HttpClient(new Handler(async request=>{
            Check(request.RequestUri!.AbsoluteUri=="https://sync.example/api/vault/workspace-1/items/item-1","Oracle item endpoint");
            Check(request.Headers.Authorization?.Scheme=="Bearer"&&request.Headers.Authorization.Parameter=="test-token","bearer transport header");
            Check(request.Headers.GetValues("X-TextText-Operation-Id").Single()=="operation-1","stable mutation operation header");
            if(request.Method==HttpMethod.Put){Check(request.Headers.GetValues("X-TextText-Path").Single()==Uri.EscapeDataString(path),"path is percent encoded exactly once");Check(request.Headers.GetValues("X-TextText-Edit-Origin").Single()=="local-file","direct-file edit origin");Check((await request.Content!.ReadAsByteArrayAsync()).SequenceEqual(new byte[]{1,2,3}),"PUT preserves binary body");Check(request.Content.Headers.ContentType!.MediaType=="application/octet-stream","PUT content type");Check(request.Headers.GetValues(calls==0?"If-None-Match":"If-Match").Single()==(calls==0?"*":"\"revision-1\""),"conditional create/update header");}
            else {Check(request.Headers.GetValues("X-TextText-Base-Path").Single()==Uri.EscapeDataString(path),"rename/delete path header");Check(request.Headers.GetValues("If-Match").Single()=="\"revision-1\"","rename/delete conditional revision");if(request.Method==HttpMethod.Patch)Check((await request.Content!.ReadAsStringAsync()).Contains("relativePath"),"PATCH rename JSON body");else Check(request.Method==HttpMethod.Delete,"DELETE method");}
            calls++;return Json("{\"revision\":\"revision-2\"}");
        }))) {var transport=new HttpSyncTransport(client,new("https://sync.example"),"workspace-1",()=>Task.FromResult("test-token"));await transport.UploadAsync("item-1",path,[1,2,3],null,"operation-1");await transport.UploadAsync("item-1",path,[1,2,3],"revision-1","operation-1");await transport.RenameAsync("item-1",path,"Notes/Renamed.textpack","revision-1","operation-1");await transport.DeleteAsync("item-1",path,"revision-1","operation-1");}
        var manifests=0;
        using(var client=new HttpClient(new Handler(request=>{
            if(manifests++==0){var response=Json("{\"fullAccess\":false,\"canCreateContent\":false,\"writableFolders\":[\"Notes\"],\"folders\":[\"Feeds\"],\"items\":[{\"itemId\":\"one\",\"canEditContent\":false,\"relativePath\":\"Notes/One.textpack\",\"revision\":\"abc\"}],\"tombstones\":[{\"itemId\":\"two\",\"relativePath\":\"Notes/Two.textpack\",\"revision\":\"def\"}]}");response.Headers.TryAddWithoutValidation("ETag","\"manifest-1\"");return Task.FromResult(response);}
            Check(request.Headers.GetValues("If-None-Match").Single()=="\"manifest-1\"","manifest uses conditional cache");return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotModified));
        }))) {var transport=new HttpSyncTransport(client,new("https://sync.example"),"workspace-1",()=>Task.FromResult("test-token"));var first=await transport.ManifestAsync();var second=await transport.ManifestAsync();Check(transport.Folders.SequenceEqual(new[]{"Feeds"}),"manifest folder cache survives304");Check(transport.AuthoritativeFolders==null,"scoped manifest is not removal authority");Check(transport.Capabilities is {FullAccess:false,CanCreateContent:false} && !transport.Capabilities.Items["one"] && transport.Capabilities.CanCreate("Notes/New.textpack"),"304 preserves authoritative scoped permissions");Check(first.SequenceEqual(second)&&second.Count==2&&second[1].Deleted,"304 retains manifest and tombstones");}
        var attempts=0;var tokenReads=0;
        using(var client=new HttpClient(new Handler(request=>{attempts++;Check(request.Headers.Authorization!.Parameter==(attempts==1?"old-token":"new-token"),"401 retry uses renewed token");return Task.FromResult(attempts==1?Json("{}",HttpStatusCode.Unauthorized):Json("{\"items\":[]}"));}))) {var transport=new HttpSyncTransport(client,new("https://sync.example"),"workspace-1",()=>Task.FromResult(++tokenReads==1?"old-token":"new-token"));await transport.ManifestAsync();Check(attempts==2,"credential renewal retries once");}
        attempts=0;tokenReads=0;
        using(var client=new HttpClient(new Handler(request=>{attempts++;return Task.FromResult(Json("{}",HttpStatusCode.Unauthorized));}))) {var transport=new HttpSyncTransport(client,new("https://sync.example"),"workspace-1",()=>Task.FromResult("fresh-"+(++tokenReads)));try{await transport.ManifestAsync();throw new Exception("repeated401 accepted");}catch(HttpRequestException error){Check(error.StatusCode==HttpStatusCode.Unauthorized&&attempts==2,"repeated401 stops after one renewed retry");}}
        foreach(var status in new[]{HttpStatusCode.Unauthorized,HttpStatusCode.Forbidden,HttpStatusCode.TooManyRequests}) {
            attempts=0;
            using var client=new HttpClient(new Handler(request=>{attempts++;return Task.FromResult(Json("do-not-log-response-secret",status));}));
            var transport=new HttpSyncTransport(client,new("https://sync.example"),"workspace-1",()=>Task.FromResult("test-token"));
            try{await transport.ManifestAsync();throw new Exception("HTTP failure accepted as empty manifest");}catch(HttpRequestException error){Check(error.StatusCode==status&&!error.Message.Contains("test-token")&&!error.Message.Contains("secret"),"HTTP "+(int)status+" remains an error without credential/body exposure");}
            Check(attempts==1,"unchanged credentials/status do not spin");
        }
        var forbiddenCalls=0;
        using(var client=new HttpClient(new Handler(request=>{forbiddenCalls++;return Task.FromResult(forbiddenCalls==1?Json("{}",HttpStatusCode.TooManyRequests):Json("{\"items\":[]}"));}))) {var transport=new HttpSyncTransport(client,new("https://sync.example"),"workspace-1",()=>Task.FromResult("test-token"));try{await transport.ManifestAsync();}catch(HttpRequestException){}Check((await transport.ManifestAsync()).Count==0&&forbiddenCalls==2,"429 can retry on next scheduled pass");}
        using(var client=new HttpClient(new Handler(request=>{var response=new HttpResponseMessage(HttpStatusCode.OK){Content=new ByteArrayContent([4,5,6])};response.Headers.TryAddWithoutValidation("ETag","\"download-hash\"");response.Headers.TryAddWithoutValidation("X-TextText-Path",Uri.EscapeDataString(path));return Task.FromResult(response);}))) {var transport=new HttpSyncTransport(client,new("https://sync.example"),"workspace-1",()=>Task.FromResult("test-token"));var pack=await transport.DownloadAsync("one");Check(pack.RelativePath==path&&pack.Revision=="download-hash"&&pack.Data.SequenceEqual(new byte[]{4,5,6}),"download decodes path/revision and preserves bytes");}
    }
}
