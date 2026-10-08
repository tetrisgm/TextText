using System.Net;
using System.Text;
using TextText.Core;
static class WorkspaceDirectoryTests
{
    const string Id="11111111-1111-4111-8111-111111111111";
    sealed class Handler:HttpMessageHandler {
        public bool Revoked;public int Calls;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken ct) {
            Calls++;if(request.Headers.Authorization?.Parameter!="isolated-test")throw new Exception("Credential missing");
            var listing=request.RequestUri!.AbsolutePath=="/api/vault/workspaces";
            return Task.FromResult(new HttpResponseMessage(!listing&&Revoked?HttpStatusCode.Forbidden:HttpStatusCode.OK){Content=new StringContent(listing?$"{{\"workspaces\":[{{\"id\":\"{Id}\",\"name\":\"Shared\",\"access\":\"scoped\"}}]}}":"{\"items\":[]}",Encoding.UTF8,"application/json")});
        }
    }
    public static async Task Run() {
        var handler=new Handler();using var http=new HttpClient(handler);var directory=new WorkspaceDirectory(http,new Uri("https://example.test"),()=>Task.FromResult("isolated-test"));
        var selected=await directory.AuthorizeAsync(Id);if(selected.Access!="scoped"||handler.Calls!=2)throw new Exception("Selected workspace must reauthorize manifest");
        handler.Revoked=true;try{await directory.AuthorizeAsync(Id);throw new Exception("Revocation accepted");}catch(IOException){}
        var calls=handler.Calls;try{await directory.AuthorizeAsync("../foreign");throw new Exception("Unsafe identifier accepted");}catch(IOException){}
        if(calls!=handler.Calls)throw new Exception("Unsafe identifier reached network");
        Console.WriteLine("PASS workspace discovery and selected manifest authorization remain separate");
        var permissions=new WorkspaceCapabilities(false,false,["Shared"],new(){{"editable",true},{"reader",false}});
        if(!permissions.CanWrite("editable","Other/file",true)||permissions.CanWrite("reader","Shared/file",true)||permissions.CanWrite("hidden","Shared/file",true)||!permissions.CanWrite("new","Shared/file",false)||permissions.CanWrite("new","Shared-other/file",false))throw new Exception("Capability boundary failed");
        Console.WriteLine("PASS exact item permissions override folder creation and missing visibility denies writes");
    }
}
