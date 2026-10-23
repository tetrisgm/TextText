using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
namespace TextText.Windows;

// Stages owner review only. Feed fetch, approval, mutation and audit stay server-owned.
internal sealed class WindowsFeedProposal(WorkspaceContext captured,HttpClient http,Func<bool> isCurrent)
{
    void RequireAuthority(CancellationToken ct) {
        ct.ThrowIfCancellationRequested();
        if(!isCurrent() || string.IsNullOrEmpty(captured.AccountId))throw new InvalidOperationException("The account or workspace changed. Start a new folder task.");
        if(captured.Origin.Scheme!="https"||captured.Origin.UserInfo.Length!=0||captured.Origin.AbsolutePath!="/"||captured.Origin.Query.Length!=0||captured.Origin.Fragment.Length!=0)
            throw new InvalidDataException("Invalid account origin.");
    }
    public async Task<string> StageAsync(string folder,JsonElement arguments,string operationId,CancellationToken ct) {
        RequireAuthority(ct);
        if(string.IsNullOrWhiteSpace(folder)||string.IsNullOrEmpty(operationId)||arguments.ValueKind!=JsonValueKind.Object||
            arguments.EnumerateObject().Any(p=>p.Name is not("url" or "name"))||
            !arguments.TryGetProperty("url",out var url)||url.ValueKind!=JsonValueKind.String||
            arguments.TryGetProperty("name",out var name)&&name.ValueKind!=JsonValueKind.String)
            throw new InvalidDataException("Provide a feed URL and an optional name.");
        var command=new Dictionary<string,object?> { ["url"]=url.GetString(),["parent_path"]=folder,["idempotency_key"]=operationId };
        if(arguments.TryGetProperty("name",out name))command["name"]=name.GetString();
        var token=await captured.TokenProvider();RequireAuthority(ct);
        var endpoint=new Uri(captured.Origin,"/api/agent/commands");
        using var request=new HttpRequestMessage(HttpMethod.Post,endpoint) {
            Content=new StringContent(JsonSerializer.Serialize(new{name="proposal:add_feed",arguments=command,expectedWorkspaceId=captured.WorkspaceId}),Encoding.UTF8,"application/json") };
        request.Headers.Authorization=new AuthenticationHeaderValue("Bearer",token);
        request.Headers.TryAddWithoutValidation("X-TextText-Agent-Name","TextText Windows assistant");
        request.Headers.TryAddWithoutValidation("X-TextText-Agent-Intent","Stage a feed for owner review");
        using var response=await http.SendAsync(request,HttpCompletionOption.ResponseHeadersRead,ct);
        RequireAuthority(ct);
        if(response.RequestMessage?.RequestUri!=endpoint||!response.IsSuccessStatusCode)throw new IOException("The feed proposal could not be staged. Your files are unchanged.");
        using var input=await response.Content.ReadAsStreamAsync(ct);using var bytes=new MemoryStream();var buffer=new byte[4096];int count;
        while((count=await input.ReadAsync(buffer,ct))>0){if(bytes.Length+count>1024*1024)throw new InvalidDataException("Proposal response exceeds its limit.");bytes.Write(buffer,0,count);}
        RequireAuthority(ct);
        using var result=JsonDocument.Parse(bytes.ToArray());
        if(result.RootElement.TryGetProperty("isError",out var error)&&error.ValueKind==JsonValueKind.True)
            throw new IOException("The feed proposal could not be staged.");
        JsonElement details;
        if(result.RootElement.TryGetProperty("structuredContent",out var structured))details=structured;
        else {
            if(!result.RootElement.TryGetProperty("content",out var content)||content.ValueKind!=JsonValueKind.Array)
                throw new InvalidDataException("The proposal response is missing its review details.");
            var text=content.EnumerateArray().FirstOrDefault(value=>value.ValueKind==JsonValueKind.Object&&value.TryGetProperty("type",out var type)&&type.GetString()=="text");
            if(text.ValueKind!=JsonValueKind.Object||!text.TryGetProperty("text",out var payload)||payload.ValueKind!=JsonValueKind.String)
                throw new InvalidDataException("The proposal response is missing its review details.");
            using var parsed=JsonDocument.Parse(payload.GetString()!);details=parsed.RootElement.Clone();
        }
        if(details.ValueKind!=JsonValueKind.Object||!details.TryGetProperty("approvalRequired",out var approval)||approval.ValueKind!=JsonValueKind.True||
            !details.TryGetProperty("proposalId",out var id)||id.ValueKind!=JsonValueKind.String||string.IsNullOrWhiteSpace(id.GetString())||
            !details.TryGetProperty("reviewUrl",out var link)||link.ValueKind!=JsonValueKind.String||!Uri.TryCreate(link.GetString(),UriKind.Absolute,out var review)||review.Scheme!="https"||review.UserInfo.Length!=0||
            !details.TryGetProperty("message",out var message)||message.ValueKind!=JsonValueKind.String||string.IsNullOrWhiteSpace(message.GetString()))
            throw new InvalidDataException("The proposal response is missing its review details.");
        return JsonSerializer.Serialize(new{approvalRequired=true,proposalId=id.GetString(),reviewUrl=review.AbsoluteUri,message=message.GetString()});
    }
}
