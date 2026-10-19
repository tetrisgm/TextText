using System.IO;
using System.Text.Json;
using System.Text.Json.Nodes;
using TextText.Core;

// These calls execute the packaged page in real WebView2, not a model host.
static class MirrorAdditionalPolicyTests
{
    static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive = true };
    static readonly (string Method,string File)[] Policies = [
        ("binaryQueue","queue-vectors.json"), ("sharedPath","shared-path-vectors.json"),
        ("tombstone","tombstone-vectors.json"), ("savedRename","saved-rename-vectors.json"),
        ("queuedUploadPath","queued-upload-path-vectors.json"), ("folder","folder-vectors.json")];

    static JsonElement[] Vectors(string fixture,string file,bool binaryOnly=false) {
        using var data=JsonDocument.Parse(File.ReadAllText(Path.Combine(fixture,file)));
        return data.RootElement.EnumerateArray().Where(x=>!binaryOnly || x.GetProperty("observed").TryGetProperty("lane",out var lane)&&lane.GetString()=="binary").Select(x=>x.Clone()).ToArray();
    }
    static async Task<string> Execute(MirrorPolicy policy,string method,JsonElement observed,CancellationToken ct) => method switch {
        "binaryQueue" => JsonSerializer.Serialize(await policy.QueueAsync(observed.Deserialize<MirrorQueueObservation>(Json)!,ct),Json),
        "sharedPath" => JsonSerializer.Serialize(await policy.SharedPathAsync(observed.Deserialize<MirrorSharedPathObservation>(Json)!,ct),Json),
        "tombstone" => JsonSerializer.Serialize(await policy.TombstoneAsync(observed.Deserialize<MirrorTombstoneObservation>(Json)!,ct),Json),
        "savedRename" => JsonSerializer.Serialize(await policy.SavedRenameAsync(observed.Deserialize<MirrorSavedRenameObservation>(Json)!,ct),Json),
        "folder" => JsonSerializer.Serialize(await policy.FolderAsync(observed.Deserialize<MirrorFolderObservation>(Json)!,ct),Json),
        "queuedUploadPath" => JsonSerializer.Serialize(await policy.QueuedUploadPathAsync(observed.Deserialize<MirrorQueuedUploadPathObservation>(Json)!,ct),Json),
        _ => throw new InvalidOperationException("Unknown isolated policy test")
    };
    public static async Task VectorsAsync(MirrorPolicy policy,string fixture,string phase,CancellationToken ct) {
        var count=0;
        foreach(var (method,file) in Policies) foreach(var vector in Vectors(fixture,file,method=="binaryQueue")) {
            var actual=JsonNode.Parse(await Execute(policy,method,vector.GetProperty("observed"),ct));
            if(!JsonNode.DeepEquals(actual,JsonNode.Parse(vector.GetProperty("decision").GetRawText())))
                throw new Exception($"{phase} {method} vector failed: {vector.GetProperty("name").GetString()}");
            count++;
        }
        Console.WriteLine($"PASS actual WebView2 additional vectors {phase}: {count}");
    }
    public static async Task RefusalsAsync(string fixture,string digest,Func<string,CancellationToken,Task<string>> evaluate,Func<Task> navigate,CancellationToken ct) {
        var scope=new MirrorScope("account-a","workspace","additional-refusals");
        var count=0;
        foreach(var (method,file) in Policies) {
            var observed=Vectors(fixture,file,method=="binaryQueue")[0].GetProperty("observed");
            var rpc=method=="binaryQueue"?"queue":method;
            foreach(var field in new[]{"scope","requestId","observed","digest","pageId","generation","action","version","changed-observed"}.Concat(method=="binaryQueue"?[]:new[]{"unknown-envelope","unknown-observed"})) {
                var bad=new MirrorPolicy(digest,scope,async(script,token)=>{
                    var raw=await evaluate(script,token);
                    if(!script.Contains("."+rpc+"("))return raw;
                    var changed=JsonNode.Parse(raw)!.AsObject();
                    if(field=="action")changed["decision"]=JsonSerializer.SerializeToNode(new {action="invented"});
                    else if(field=="unknown-envelope")changed["future"]=true;
                    else if(field=="unknown-observed")changed["observed"]!["future"]=true;
                    else if(field=="changed-observed") {
                        var values=changed["observed"]!.AsObject();
                        var key=values.First().Key;
                        values[key]=values[key] is JsonValue value&&value.TryGetValue<bool>(out var flag)?JsonValue.Create(!flag):JsonValue.Create("forged-observation");
                    }
                    else if(field is "generation" or "version")changed[field]=-1;
                    else changed[field]="invalid";
                    return changed.ToJsonString();
                });
                var refused=false;
                try { await Execute(bad,method,observed,ct); }
                catch(Exception error) when(error is IOException or JsonException or InvalidOperationException) { refused=true; }
                if(!refused)throw new Exception($"Accepted forged {method} {field}");
                count++;
            }
            var stale=new MirrorPolicy(digest,scope,evaluate);
            await Execute(stale,method,observed,ct);
            await navigate();
            var reloaded=false;
            try { await Execute(stale,method,observed,ct); } catch(IOException) { reloaded=true; }
            if(!reloaded)throw new Exception($"Reloaded {method} adapter silently rebound");
            count++;
        }
        Console.WriteLine($"PASS actual WebView2 additional forged/reload refusals: {count}");
    }
}
