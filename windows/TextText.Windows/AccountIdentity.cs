using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.RegularExpressions;
namespace TextText.Windows;

/// <summary>Resolve a nonsecret stable principal once; an unchanged credential can reopen offline.
/// The caller owns credential replacement and uses a client with redirects disabled.</summary>
public static class AccountIdentity
{
    public static bool SameAccount(Account captured, Account current) =>
        captured.AccountId is not null && current.AccountId is not null
            ? captured.AccountId == current.AccountId : captured.AccountId == current.AccountId && captured.Token == current.Token;
    static string Valid(string? value) => value is not null && Regex.IsMatch(value,@"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\z")
        ? value : throw new InvalidDataException("Reconnect to verify this account. Saved work is unchanged.");
    public static async Task<string> ResolveAsync(HttpClient http,Uri origin,string token,string? cachedAccountId,CancellationToken ct=default)
    {
        ct.ThrowIfCancellationRequested();
        if(origin.Scheme!="https"||!string.IsNullOrEmpty(origin.UserInfo)||origin.Query.Length>0||origin.Fragment.Length>0||origin.AbsolutePath!="/")
            throw new InvalidDataException("Invalid account server origin.");
        if(cachedAccountId is not null)return Valid(cachedAccountId);
        async Task<JsonDocument> Read(string path)
        {
            using var request=new HttpRequestMessage(HttpMethod.Get,new Uri(origin,path));
            request.Headers.Authorization=new AuthenticationHeaderValue("Bearer",token);
            using var response=await http.SendAsync(request,HttpCompletionOption.ResponseHeadersRead,ct);
            if(!response.IsSuccessStatusCode)throw new HttpRequestException("Reconnect to verify this account. Saved work is unchanged.",null,response.StatusCode);
            if(response.RequestMessage?.RequestUri is { } actual && actual.GetLeftPart(UriPartial.Authority)!=origin.GetLeftPart(UriPartial.Authority))
                throw new InvalidDataException("Account response came from another server.");
            using var input=await response.Content.ReadAsStreamAsync(ct);using var output=new MemoryStream();
            var buffer=new byte[4096];int count;
            while((count=await input.ReadAsync(buffer,ct))>0){if(output.Length+count>65536)throw new InvalidDataException("Account response exceeds its limit.");output.Write(buffer,0,count);}
            return JsonDocument.Parse(output.ToArray());
        }
        using var home=await Read("/api/vault");
        if(home.RootElement.TryGetProperty("accountId",out var direct))return Valid(direct.GetString());
        if(!home.RootElement.TryGetProperty("workspaceId",out var workspace)||!Guid.TryParse(workspace.GetString(),out var id))
            throw new InvalidDataException("Account workspace could not be verified.");
        // The existing profile endpoint supports devices upgrading from a server
        // whose home discovery response did not yet include the actor ID.
        using var profile=await Read("/api/vault/"+id+"/account");
        return Valid(profile.RootElement.GetProperty("accountId").GetString());
    }
}
