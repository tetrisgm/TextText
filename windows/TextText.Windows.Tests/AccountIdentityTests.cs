using System.Net;
using System.Net.Http.Json;
using TextText.Windows;

static class AccountIdentityTests
{
    sealed class Handler(Func<HttpRequestMessage,HttpResponseMessage> send):HttpMessageHandler
    { protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken ct)=>Task.FromResult(send(request)); }
    static HttpResponseMessage Json(object value)=>new(HttpStatusCode.OK){Content=JsonContent.Create(value)};
    public static async Task Run(Action<bool,string> assert)
    {
        var old=System.Text.Json.JsonSerializer.Deserialize<Account>("{\"Token\":\"fixture\",\"WorkspaceId\":\"workspace\",\"Name\":\"Saved\"}")!;
        assert(old.AccountId is null && old.Token=="fixture" && old.Name=="Saved","legacy credential remains readable without inventing an account identity");
        var verified=old with {AccountId="account-a"};
        assert(System.Text.Json.JsonSerializer.Deserialize<Account>(System.Text.Json.JsonSerializer.Serialize(verified))==verified,"verified credential round trip preserves its stable account identity");
        assert(AccountIdentity.SameAccount(verified,verified with {Token="renewed"}) && !AccountIdentity.SameAccount(verified,verified with {AccountId="account-b"}),"native window identity allows verified renewal and refuses account replacement");
        assert(!AccountIdentity.SameAccount(old,old with {Token="other"}),"unbound legacy credentials cannot infer account identity from a replacement token");
        var calls=0;var authenticated=true;var origin=new Uri("https://texttext.test");
        using var current=new HttpClient(new Handler(request=>{calls++;authenticated&=request.Headers.Authorization?.Scheme=="Bearer"&&request.Headers.Authorization.Parameter=="fixture";return Json(new{accountId="account-a"});}));
        assert(await AccountIdentity.ResolveAsync(current,origin,"fixture",null)=="account-a"&&calls==1&&authenticated,"native identity uses authenticated stable actor discovery");
        var workspace=Guid.NewGuid();calls=0;
        using var legacy=new HttpClient(new Handler(request=>{calls++;return request.RequestUri!.AbsolutePath=="/api/vault"?Json(new{workspaceId=workspace}):request.RequestUri.AbsolutePath=="/api/vault/"+workspace+"/account"?Json(new{accountId="account-a"}):new(HttpStatusCode.NotFound);}));
        assert(await AccountIdentity.ResolveAsync(legacy,origin,"fixture",null)=="account-a"&&calls==2,"native identity upgrades through the existing account profile endpoint");
        using var offline=new HttpClient(new Handler(_=>throw new Exception("Offline cache made a network request")));
        assert(await AccountIdentity.ResolveAsync(offline,origin,"renewed-same-account","account-a")=="account-a","cached principal reopens offline without deriving identity from a token");
        using var cancelled=new CancellationTokenSource();cancelled.Cancel();var stopped=false;
        try{await AccountIdentity.ResolveAsync(offline,origin,"fixture","account-a",cancelled.Token);}catch(OperationCanceledException){stopped=true;}
        assert(stopped,"cancelled identity discovery cannot enable a retired opening");
        using var invalid=new HttpClient(new Handler(_=>Json(new{accountId="../untrusted"})));var refused=false;
        try{await AccountIdentity.ResolveAsync(invalid,origin,"fixture",null);}catch(InvalidDataException){refused=true;}
        assert(refused,"malformed stable identity is refused without a credential fallback");
        refused=false;
        try{await AccountIdentity.ResolveAsync(offline,new Uri("https://texttext.test/unexpected"),"fixture","account-a");}catch(InvalidDataException){refused=true;}
        assert(refused,"cached identity cannot enable a non-origin server URL");
        refused=false;
        try{await AccountIdentity.ResolveAsync(offline,origin,"fixture","account-a\n");}catch(InvalidDataException){refused=true;}
        assert(refused,"cached identity rejects a trailing line break");
        using var denied=new HttpClient(new Handler(_=>new(HttpStatusCode.Unauthorized)));refused=false;
        try{await AccountIdentity.ResolveAsync(denied,origin,"fixture",null);}catch(HttpRequestException){refused=true;}
        assert(refused,"unverified credentials do not acquire an account identity");
    }
}
