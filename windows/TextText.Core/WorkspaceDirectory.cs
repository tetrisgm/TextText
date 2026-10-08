using System.Net.Http.Headers;
using System.Text.Json;
namespace TextText.Core;

public sealed record AvailableWorkspace(string Id, string Name, string Access);
/// Discovery is never an authorization cache. Opening repeats discovery and an
/// authoritative selected manifest read using the captured account credential.
public sealed class WorkspaceDirectory(HttpClient http, Uri origin, Func<Task<string>> token)
{
    public async Task<IReadOnlyList<AvailableWorkspace>> ListAsync(CancellationToken ct = default)
    {
        using var response = await Get("/api/vault/workspaces", ct);
        using var json = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
        var rows = json.RootElement.GetProperty("workspaces");
        if (rows.ValueKind != JsonValueKind.Array || rows.GetArrayLength() > 1000) throw new IOException("Workspace list is invalid.");
        var result = new List<AvailableWorkspace>(); var ids = new HashSet<string>();
        foreach (var row in rows.EnumerateArray()) {
            var id = row.GetProperty("id").GetString()!; var name = row.GetProperty("name").GetString()!; var access = row.GetProperty("access").GetString()!;
            if (!Guid.TryParseExact(id,"D",out _) || !ids.Add(id) || string.IsNullOrWhiteSpace(name) || name.Length > 500 || access is not ("owner" or "workspace" or "scoped")) throw new IOException("Workspace list is invalid.");
            result.Add(new(id,name,access));
        }
        return result;
    }
    public async Task<AvailableWorkspace> AuthorizeAsync(string id, CancellationToken ct = default)
    {
        if (!Guid.TryParseExact(id,"D",out _)) throw new IOException("Invalid workspace.");
        var selected = (await ListAsync(ct)).SingleOrDefault(row => row.Id == id) ?? throw new UnauthorizedAccessException("This workspace is no longer available.");
        using var response = await Get($"/api/vault/{id}/items",ct);
        // Reading the body ensures late network failures cannot count as readiness.
        using var manifest = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
        if (!manifest.RootElement.TryGetProperty("items",out var items) || items.ValueKind != JsonValueKind.Array) throw new IOException("Workspace response is invalid.");
        return selected;
    }
    private async Task<HttpResponseMessage> Get(string path,CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get,new Uri(origin,path));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer",await token());
        request.Headers.CacheControl = new CacheControlHeaderValue { NoCache = true, NoStore = true };
        var response = await http.SendAsync(request,ct);
        if (!response.IsSuccessStatusCode) { var status=response.StatusCode;response.Dispose();throw new IOException($"Workspace access could not be checked ({(int)status})."); }
        return response;
    }
}
