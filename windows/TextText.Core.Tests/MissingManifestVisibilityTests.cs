using System.IO.Compression;
using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using TextText.Core;

// Actual HTTP transport with controlled server-shaped full/filtered manifests.
// No authentication, server filesystem or physical fleet claim is made.
static class MissingManifestVisibilityTests {
    public static async Task Run(string temp,Action<bool,string> check) {
        const string id="d1111111-1111-4111-8111-111111111111",path="Notes/Visible.textpack";
        foreach(var fullAccess in new[]{true,false}) {
            using var memory=new MemoryStream();using(var zip=new ZipArchive(memory,ZipArchiveMode.Create,true))using(var writer=new StreamWriter(zip.CreateEntry("text.md").Open()))writer.Write("---\ntextTextId: \""+id+"\"\ntitle: Visible\n---\n\nRetained exact bytes");
            var bytes=memory.ToArray();var handler=new VisibilityHandler(id,path,bytes,fullAccess);using var http=new HttpClient(handler);
            var transport=new HttpSyncTransport(http,new Uri("https://missing-manifest.test"),"visibility-fixture",()=>Task.FromResult("fixture-not-a-credential"),ownerFallback:false);
            var suffix=Guid.NewGuid().ToString("N");var store=new TextPackStore(Path.Combine(temp,"missing-manifest-"+suffix),Path.Combine(temp,"missing-state-"+suffix));
            var sync=Test.NewSync(store,transport);await sync.SyncAsync();check(store.Read(path).SequenceEqual(bytes),"initial HTTP projection exact "+fullAccess);
            var statePath=Path.Combine(store.StateDirectory,"sync.json");string Baseline(){var state=JsonSerializer.Deserialize<SyncEngine.State>(File.ReadAllBytes(statePath))!;return JsonSerializer.Serialize(new{baseline=state.Items[id],outbox=state.Outbox});}
            var before=Baseline();handler.Hidden=true;await sync.SyncAsync();
            check(transport.Capabilities?.CanWrite(id,path,true)==false,"absent HTTP item grants no existing write authority "+fullAccess);
            check(transport.Capabilities?.CanCreate(path)==fullAccess,"owner creation permission is separate from absent existing authority "+fullAccess);
            check(Baseline()==before&&store.Read(path).SequenceEqual(bytes),"manifest absence retains baseline/outbox/projection "+fullAccess);
            await Test.NewSync(new TextPackStore(store.Root,store.StateDirectory),transport).SyncAsync();
            check(Baseline()==before&&handler.Writes==0,"restart never dispatches recreation for missing full/filtered item "+fullAccess);
        }
    }
    sealed class VisibilityHandler(string id,string path,byte[] bytes,bool fullAccess):HttpMessageHandler {
        public bool Hidden;public int Writes;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken cancellationToken) {
            if(request.RequestUri?.Host!="missing-manifest.test")throw new InvalidOperationException("Unexpected fixture host");
            if(request.Method!=HttpMethod.Get)Writes++;
            var revision=TextPackStore.Hash(bytes);var manifest=new{items=Hidden?Array.Empty<object>():new object[]{new{itemId=id,relativePath=path,revision,canEditContent=true}},tombstones=Array.Empty<object>(),folders=fullAccess?(Hidden?Array.Empty<string>():new[]{"Notes"}):new[]{"SharedEmpty"},fullAccess,canCreateContent=fullAccess,writableFolders=Array.Empty<string>()};
            var isManifest=request.RequestUri.AbsolutePath.EndsWith("/items",StringComparison.Ordinal);
            var response=new HttpResponseMessage(request.Method==HttpMethod.Get?HttpStatusCode.OK:HttpStatusCode.InternalServerError){RequestMessage=request,Content=new ByteArrayContent(isManifest?JsonSerializer.SerializeToUtf8Bytes(manifest):bytes)};
            if(!isManifest){response.Headers.ETag=new EntityTagHeaderValue("\""+revision+"\"");response.Headers.Add("X-TextText-Path",Uri.EscapeDataString(path));}
            return Task.FromResult(response);
        }
    }
}
