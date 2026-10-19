using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace TextText.Core;

/// Incarnation observation only. Parsing cannot grant authority or certify an
/// absent marker; that requires fresh authenticated transport/native evidence.
[JsonConverter(typeof(MirrorGeneration.Converter))]
public sealed record MirrorGeneration(string Kind,string? Generation=null)
{
    public static readonly MirrorGeneration Unknown=new("unknown");
    public static readonly MirrorGeneration ObservedAbsent=new("observed-absent");
    public bool Known=>Kind!="unknown";
    public string? Lifecycle=>Kind=="present"?Generation:null;
    public bool Matches(MirrorGeneration other){Validate(this);Validate(other);return Known&&other.Known&&this==other;}
    public static MirrorGeneration FromLegacy(string? value)=>value is null?Unknown:Present(value);
    public static MirrorGeneration Present(string value){var result=new MirrorGeneration("present",value);Validate(result);return result;}
    public static void Validate(MirrorGeneration value) {
        if(value is null)throw new InvalidDataException("Invalid mirror generation.");
        if(value.Kind is "unknown" or "observed-absent"){if(value.Generation is not null)throw new InvalidDataException("Unexpected generation value.");return;}
        if(value.Kind!="present"||value.Generation is not {Length:>0} text||text.Any(c=>c<32||c==127))throw new InvalidDataException("Invalid mirror generation.");
        try{if(new UTF8Encoding(false,true).GetByteCount(text)>512)throw new InvalidDataException("Generation exceeds bound.");}catch(EncoderFallbackException){throw new InvalidDataException("Invalid generation Unicode.");}
    }
    public sealed class Converter:JsonConverter<MirrorGeneration> {
        public override bool HandleNull=>true;
        public override MirrorGeneration Read(ref Utf8JsonReader reader,Type type,JsonSerializerOptions options) {
            using var doc=JsonDocument.ParseValue(ref reader);var value=doc.RootElement;
            if(value.ValueKind!=JsonValueKind.Object||!value.TryGetProperty("kind",out var kind)||kind.ValueKind!=JsonValueKind.String)throw new InvalidDataException("Invalid generation object.");
            var names=value.EnumerateObject().Select(p=>p.Name).Order(StringComparer.Ordinal).ToArray();
            var present=kind.GetString()=="present";
            if(!names.SequenceEqual(present?new[]{"generation","kind"}:new[]{"kind"}))throw new InvalidDataException("Invalid generation fields.");
            string? generation=null;
            if(present){var field=value.GetProperty("generation");if(field.ValueKind!=JsonValueKind.String)throw new InvalidDataException("Invalid generation string.");generation=field.GetString();}
            var result=new MirrorGeneration(kind.GetString()!,generation);Validate(result);return result;
        }
        public override void Write(Utf8JsonWriter writer,MirrorGeneration value,JsonSerializerOptions options){Validate(value);writer.WriteStartObject();writer.WriteString("kind",value.Kind);if(value.Kind=="present")writer.WriteString("generation",value.Generation);writer.WriteEndObject();}
    }
}

public sealed record RemoteManifestGenerationEvidence(ProtectedRenameScope Scope,RemoteItem Item,string ManifestHash,MirrorGeneration Generation);

internal static class MirrorGenerationManifest
{
    static InvalidDataException Invalid()=>new("Authenticated generation manifest unavailable.");
    static bool Digest(string? text)=>text is {Length:64}&&text.All(c=>c is >= '0' and <= '9' or >= 'a' and <= 'f');
    static bool SafePath(string text)=>text.Length>0&&Encoding.UTF8.GetByteCount(text)<=1024&&text.EndsWith(".textpack",StringComparison.OrdinalIgnoreCase)&&!text.Any(c=>c<32||c==127||c is '\\' or ':')&&text.Split('/').All(p=>p is not("" or "." or ".."));
    static void Fields(JsonElement value,IEnumerable<string> allowed){if(value.ValueKind!=JsonValueKind.Object||value.EnumerateObject().Any(p=>!allowed.Contains(p.Name,StringComparer.Ordinal)))throw Invalid();}
    static bool Boolean(JsonElement value,string name){var field=value.GetProperty(name);if(field.ValueKind is not(JsonValueKind.True or JsonValueKind.False))throw Invalid();return field.GetBoolean();}
    public static RemoteManifestGenerationEvidence? Parse(byte[] bytes,string itemId,ProtectedRenameScope scope) {
        if(bytes.Length>16*1024*1024||scope.AccountId is null)throw Invalid();
        ProtectedSavedRename.ValidateStateBytes(bytes);
        using var doc=JsonDocument.Parse(bytes);var root=doc.RootElement;
        Fields(root,["items","tombstones","folders","problems","revision","fullAccess","canCreateContent","writableFolders","manifestRevision","syncCapabilities"]);
        var items=root.GetProperty("items");var tombstones=root.GetProperty("tombstones");var problems=root.GetProperty("problems");var folders=root.GetProperty("folders");var writable=root.GetProperty("writableFolders");
        if(items.ValueKind!=JsonValueKind.Array||tombstones.ValueKind!=JsonValueKind.Array||problems.ValueKind!=JsonValueKind.Array||folders.ValueKind!=JsonValueKind.Array||writable.ValueKind!=JsonValueKind.Array||items.GetArrayLength()+tombstones.GetArrayLength()>40000||
           root.GetProperty("revision").ValueKind!=JsonValueKind.String||!Digest(root.GetProperty("revision").GetString())||folders.EnumerateArray().Any(v=>v.ValueKind!=JsonValueKind.String||string.IsNullOrEmpty(v.GetString()))||writable.EnumerateArray().Any(v=>v.ValueKind!=JsonValueKind.String))throw Invalid();
        if(!Boolean(root,"fullAccess")||!Boolean(root,"canCreateContent")||problems.GetArrayLength()!=0)return null;
        var ids=new HashSet<string>(StringComparer.Ordinal);var paths=new HashSet<string>(StringComparer.Ordinal);JsonElement? selected=null;
        foreach(var entry in items.EnumerateArray().Concat(tombstones.EnumerateArray())) {
            if(entry.ValueKind!=JsonValueKind.Object||!entry.TryGetProperty("itemId",out var id)||id.ValueKind!=JsonValueKind.String||!System.Text.RegularExpressions.Regex.IsMatch(id.GetString()!,@"\A[A-Za-z0-9][A-Za-z0-9_-]{0,127}\z")||!ids.Add(id.GetString()!))throw Invalid();
        }
        foreach(var entry in items.EnumerateArray()) {
            if(!entry.TryGetProperty("relativePath",out var path)||path.ValueKind!=JsonValueKind.String||!SafePath(path.GetString()!)||!paths.Add(path.GetString()!.Normalize(NormalizationForm.FormC).ToLowerInvariant())||entry.TryGetProperty("deleted",out _)&&Boolean(entry,"deleted"))throw Invalid();
            if(entry.GetProperty("itemId").GetString()==itemId)selected=entry;
        }
        if(selected is not {} item)return null;
        Fields(item,["itemId","relativePath","revision","canEditContent","lifecycle","restoreFromRevision","deleted"]);
        if(!Boolean(item,"canEditContent")||item.GetProperty("revision").ValueKind!=JsonValueKind.String||!Digest(item.GetProperty("revision").GetString()))throw Invalid();
        MirrorGeneration generation;
        if(item.TryGetProperty("lifecycle",out var lifecycle)||item.TryGetProperty("restoreFromRevision",out _)) {
            if(lifecycle.ValueKind!=JsonValueKind.String||!item.TryGetProperty("restoreFromRevision",out var restored)||restored.ValueKind!=JsonValueKind.String||!Digest(restored.GetString()))throw Invalid();
            generation=MirrorGeneration.Present(lifecycle.GetString()!);
        } else generation=MirrorGeneration.ObservedAbsent;
        var remote=JsonSerializer.Deserialize<RemoteItem>(item,new JsonSerializerOptions{PropertyNameCaseInsensitive=true})??throw Invalid();
        return new(scope,remote,TextPackStore.Hash(bytes),generation);
    }
}
