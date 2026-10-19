using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace TextText.Core;

/// Pure values inside the existing SyncEngine state. This class never writes a
/// journal, allocates an operation ID, sends a request, or changes a file.
public static class ProtectedSavedRename
{
    public enum Phase { Pending, TerminalRejected, Stopped }
    public sealed record Context(string RootHash,ProtectedRenameScope Scope);
    public sealed record Resolution(string LocalPath,string RemotePath,string? LocalLifecycle,string? RemoteLifecycle,
        MirrorGeneration? LocalGeneration=null,MirrorGeneration? RemoteGeneration=null);
    [JsonConverter(typeof(RecordConverter))]
    public sealed record Record(int Version,string RootHash,ProtectedRenameRequest Request,ProtectedRenameScope Scope,
        string BaselineHash,string? Lifecycle,Phase Phase,ProtectedRenameReceipt? Receipt,Resolution? Resolution,MirrorGeneration? Generation=null) {
        public MirrorGeneration ObservedGeneration=>Version==1?MirrorGeneration.FromLegacy(Lifecycle):Generation??MirrorGeneration.Unknown;
    }
    public sealed record Observation(string RootHash,ProtectedRenameScope Scope,string LocalPath,string RemotePath,
        string? LocalLifecycle,string? RemoteLifecycle,string RemoteRevision,string CheckpointPath,
        bool CheckpointReady,bool LocalUnique,bool OrganizePermitted,MirrorGeneration? LocalGeneration=null,MirrorGeneration? RemoteGeneration=null);
    public sealed record ArchiveProof(string OperationId,string RootHash,ProtectedRenameScope Scope,string RecordHash,bool Durable);
    public sealed record Outcome(string? MovedRevision,Record? Rejected);
    public sealed record Normalization(Record? Record,bool LegacyNeedsReview,SyncEngine.Operation RetainedLegacy);

    static InvalidDataException Invalid()=>new("Invalid retained protected file move.");
    static InvalidOperationException Changed()=>new("The retained protected file move changed.");
    static bool Digest(string? value)=>value is {Length:64}&&value.All(c=>c is >= '0' and <= '9' or >= 'a' and <= 'f');
    static bool Text(string? value,int maximum)=>value is {Length:>0}&&Encoding.UTF8.GetByteCount(value)<=maximum&&
        !value.Any(c=>c<32||c==127)&&ValidUnicode(value);
    static bool ValidUnicode(string value) {
        for(var index=0;index<value.Length;index++)if(char.IsSurrogate(value[index])) {
            if(!char.IsHighSurrogate(value[index])||index+1>=value.Length||!char.IsLowSurrogate(value[++index]))return false;
        }
        return true;
    }
    static bool Segment(string? value)=>value is not null&&System.Text.RegularExpressions.Regex.IsMatch(value,@"\A[A-Za-z0-9][A-Za-z0-9_-]{0,127}\z");
    static bool Path(string? value)=>Text(value,1024)&&value!.EndsWith(".textpack",StringComparison.OrdinalIgnoreCase)&&
        !value.Any(c=>c is '\\' or ':')&&value.Split('/').All(part=>part is not("" or "." or ".."));
    static void ValidateScope(ProtectedRenameScope scope) {
        if(scope is null||!Segment(scope.AccountId)||!Segment(scope.WorkspaceId)||
           !Uri.TryCreate(scope.Origin,UriKind.Absolute,out var origin)||
           !(origin.Scheme=="https"||origin.Scheme=="http"&&new[]{"localhost","127.0.0.1","::1"}.Contains(origin.DnsSafeHost,StringComparer.Ordinal))||origin.AbsolutePath!="/"||
           !string.IsNullOrEmpty(origin.Query)||!string.IsNullOrEmpty(origin.Fragment)||!string.IsNullOrEmpty(origin.UserInfo)||
           origin.GetLeftPart(UriPartial.Authority)!=scope.Origin)throw Invalid();
    }
    public static void Validate(Record record,string rootHash,ProtectedRenameScope scope) {
        ValidateScope(scope);
        if(record is null||record.Request is null||record.Version is not(1 or 2)||!Digest(rootHash)||record.RootHash!=rootHash||record.Scope!=scope||
           !Digest(record.BaselineHash)||!Digest(record.Request.BaseRevision)||
           !Guid.TryParseExact(record.Request.OperationId,"D",out var operation)||operation.ToString("D")!=record.Request.OperationId||
           !Segment(record.Request.ItemId)||!Path(record.Request.Source)||!Path(record.Request.Destination)||record.Request.Source==record.Request.Destination)throw Invalid();
        if(record.Version==1) {
            if(!Text(record.Lifecycle,512)||record.Generation is not null)throw Invalid();
        } else {
            if(record.Lifecycle is not null||record.Generation is null)throw Invalid();
            MirrorGeneration.Validate(record.Generation);if(!record.Generation.Known)throw Invalid();
        }
        if(record.Phase==Phase.Pending) {
            if(record.Receipt is not null||record.Resolution is not null)throw Invalid();
            return;
        }
        if(record.Phase is not(Phase.TerminalRejected or Phase.Stopped))throw Invalid();
        var receipt=record.Receipt;
        if(receipt is null||receipt.Request!=record.Request||receipt.Scope!=scope||receipt.Status!="conflict"||
           !Path(receipt.RelativePath)||receipt.Revision is not null&&!Digest(receipt.Revision))throw Invalid();
        if(record.Phase==Phase.TerminalRejected) {
            if(record.Resolution is not null)throw Invalid();
            return;
        }
        var resolution=record.Resolution;
        if(resolution is null||receipt.Deleted||receipt.Revision is null||!Path(resolution.LocalPath)||!Path(resolution.RemotePath)||
           resolution.RemotePath!=receipt.RelativePath)throw Invalid();
        if(record.Version==1) {
            if(resolution.LocalLifecycle!=record.Lifecycle||resolution.RemoteLifecycle!=record.Lifecycle||resolution.LocalGeneration is not null||resolution.RemoteGeneration is not null)throw Invalid();
        } else if(resolution.LocalLifecycle is not null||resolution.RemoteLifecycle is not null||resolution.LocalGeneration is null||resolution.RemoteGeneration is null||
                  !record.ObservedGeneration.Matches(resolution.LocalGeneration)||!record.ObservedGeneration.Matches(resolution.RemoteGeneration))throw Invalid();
    }
    public static void ValidateMap(IReadOnlyDictionary<string,Record> records,string rootHash,ProtectedRenameScope scope) {
        if(records.Count>1000)throw Invalid();
        var operations=new HashSet<string>(StringComparer.Ordinal);
        foreach(var pair in records) {
            Validate(pair.Value,rootHash,scope);
            if(pair.Key!=pair.Value.Request.ItemId||!operations.Add(pair.Value.Request.OperationId))throw Invalid();
        }
    }
    public static Record DecodeRecord(byte[] bytes,Context context) {
        if(bytes.Length>32768)throw Invalid();
        var record=JsonSerializer.Deserialize<Record>(bytes)??throw Invalid();
        Validate(record,context.RootHash,context.Scope);return record;
    }
    public static Dictionary<string,Record> DecodeMap(byte[] bytes,Context context) {
        if(bytes.Length>32768*1000)throw Invalid();
        using var document=JsonDocument.Parse(bytes);var result=ReadMap(document.RootElement);
        ValidateMap(result,context.RootHash,context.Scope);return result;
    }
    /// The existing owner must call this before deserializing its entire State,
    /// otherwise duplicate top-level map properties could erase earlier work.
    public static void ValidateStateBytes(byte[] bytes) {
        if(bytes.Length>90*1024*1024)throw Invalid();
        using var document=JsonDocument.Parse(bytes,new JsonDocumentOptions{MaxDepth=32});
        var tokens=0;
        void Visit(JsonElement value) {
            if(++tokens>1000000)throw Invalid();
            if(value.ValueKind==JsonValueKind.Object) {
                var names=new HashSet<string>(StringComparer.Ordinal);
                foreach(var property in value.EnumerateObject()) {
                    if(++tokens>1000000||!names.Add(property.Name))throw Invalid();Visit(property.Value);
                }
            } else if(value.ValueKind==JsonValueKind.Array)foreach(var child in value.EnumerateArray())Visit(child);
            else if(value.ValueKind==JsonValueKind.String)_=value.GetString();
        }
        Visit(document.RootElement);
    }
    static Dictionary<string,Record> ReadMap(JsonElement value) {
        if(value.ValueKind!=JsonValueKind.Object)throw Invalid();
        var result=new Dictionary<string,Record>(StringComparer.Ordinal);
        foreach(var property in value.EnumerateObject()) {
            if(result.Count>=1000||!result.TryAdd(property.Name,JsonSerializer.Deserialize<Record>(property.Value)??throw Invalid()))throw Invalid();
        }
        if(result.Count>0)ValidateMap(result,result.First().Value.RootHash,result.First().Value.Scope);
        return result;
    }
    /// Apply to the future existing-State property before decoding: a default
    /// Dictionary converter would erase duplicate item keys before validation.
    public sealed class MapConverter:JsonConverter<Dictionary<string,Record>> {
        public override bool HandleNull=>true;
        public override Dictionary<string,Record> Read(ref Utf8JsonReader reader,Type type,JsonSerializerOptions options) {
            using var document=JsonDocument.ParseValue(ref reader);return ReadMap(document.RootElement);
        }
        public override void Write(Utf8JsonWriter writer,Dictionary<string,Record> value,JsonSerializerOptions options) {
            if(value is null)throw Invalid();
            if(value.Count>0)ValidateMap(value,value.First().Value.RootHash,value.First().Value.Scope);
            writer.WriteStartObject();foreach(var pair in value.OrderBy(x=>x.Key,StringComparer.Ordinal)) {
                writer.WritePropertyName(pair.Key);JsonSerializer.Serialize(writer,pair.Value);
            }writer.WriteEndObject();
        }
    }
    public static Record Pending(string rootHash,ProtectedRenameRequest request,ProtectedRenameScope scope,string baselineHash,string lifecycle) {
        var record=new Record(1,rootHash,request,scope,baselineHash,lifecycle,Phase.Pending,null,null);
        Validate(record,rootHash,scope);return record;
    }
    public static Record Pending(string rootHash,ProtectedRenameRequest request,ProtectedRenameScope scope,string baselineHash,MirrorGeneration generation) {
        var record=new Record(2,rootHash,request,scope,baselineHash,null,Phase.Pending,null,null,generation);
        Validate(record,rootHash,scope);return record;
    }
    /// Legacy flags are not authenticated rejection receipts. The existing
    /// owner must retain the old ambiguous record/review status until its exact
    /// request can be replayed or inspected; normalization never clears it.
    public static Normalization NormalizeLegacy(SyncEngine.Operation operation,SyncEngine.Baseline? baseline,
        string rootHash,ProtectedRenameScope scope,bool floor5Verified) {
        ValidateScope(scope);
        if(!floor5Verified||!Digest(rootHash)||operation.Kind!="rename"||operation.Payload is not null||operation.Destination is null||operation.Revision is null||
           !Digest(operation.Hash)||!Digest(operation.Revision)||
           !Guid.TryParseExact(operation.Id,"D",out var id)||id.ToString("D")!=operation.Id||!Segment(operation.ItemId)||!Path(operation.Path)||!Path(operation.Destination)||operation.Path==operation.Destination)throw Invalid();
        // Unknown saved generation stays in the existing legacy owner field.
        // A current baseline/remote lifecycle cannot retroactively supply it.
        if(operation.Lifecycle is null||baseline?.Lifecycle!=operation.Lifecycle)return new(null,true,operation);
        // The original request is immutable. Text ACKs may legitimately change
        // the current baseline hash/revision, and a path ACK may advance its
        // path, while a lost rename reply still retains this old operation.
        var command=new ProtectedRenameRequest(operation.Id,operation.ItemId,operation.Path,operation.Destination,operation.Revision);
        return new(Pending(rootHash,command,scope,operation.Hash,operation.Lifecycle),operation.Conflicted,operation);
    }
    public static Outcome Consume(Record record,ProtectedRenameReceipt receipt) {
        Validate(record,record.RootHash,record.Scope);
        if(record.Phase!=Phase.Pending||receipt.Request!=record.Request||receipt.Scope!=record.Scope)throw Changed();
        if(receipt.Status=="moved") {
            if(receipt.RelativePath!=record.Request.Destination||receipt.Revision!=record.Request.BaseRevision||receipt.Deleted)throw Invalid();
            return new(record.Request.BaseRevision,null);
        }
        if(receipt.Status!="conflict")throw Invalid();
        var rejected=record with{Phase=Phase.TerminalRejected,Receipt=receipt};
        Validate(rejected,record.RootHash,record.Scope);return new(null,rejected);
    }
    public static Record Stop(Record record,Resolution resolution) {
        Validate(record,record.RootHash,record.Scope);
        if(record.Phase!=Phase.TerminalRejected)throw Changed();
        var stopped=record with{Phase=Phase.Stopped,Resolution=resolution};
        Validate(stopped,record.RootHash,record.Scope);return stopped;
    }
    /// Native evidence guard only, not an admission decision. The packaged
    /// shared policy must own suppression/replay/staging eligibility.
    public static bool StoppedFactsMatch(Record record,string localPath,string remotePath,string? localLifecycle,string? remoteLifecycle,bool unique) {
        Validate(record,record.RootHash,record.Scope);
        return record.Version==1&&record.Phase==Phase.Stopped&&unique&&record.Resolution is {} resolution&&
            resolution.LocalPath==localPath&&resolution.RemotePath==remotePath&&resolution.LocalLifecycle==localLifecycle&&resolution.RemoteLifecycle==remoteLifecycle;
    }
    /// Caller supplies facts freshly revalidated under its existing lease.
    /// Peer text revisions are deliberately absent from suppression matching.
    public static void ValidateFreshReplacement(Record stopped,Record replacement,Observation observed) {
        Validate(stopped,stopped.RootHash,stopped.Scope);Validate(replacement,stopped.RootHash,stopped.Scope);
        if(stopped.Phase!=Phase.Stopped||replacement.Phase!=Phase.Pending||stopped.Resolution is not {} resolution||
           replacement.Request.ItemId!=stopped.Request.ItemId||replacement.Request.OperationId==stopped.Request.OperationId||
           observed.RootHash!=stopped.RootHash||observed.Scope!=stopped.Scope||!observed.CheckpointReady||!observed.LocalUnique||!observed.OrganizePermitted||
           observed.CheckpointPath!=observed.LocalPath||observed.LocalPath==resolution.LocalPath||observed.RemotePath!=resolution.RemotePath||
           !FreshGenerationMatches(stopped,replacement,observed)||
           replacement.Request.Destination!=observed.LocalPath||replacement.Request.Source!=observed.RemotePath||replacement.Request.BaseRevision!=observed.RemoteRevision)throw Changed();
    }
    static bool FreshGenerationMatches(Record stopped,Record replacement,Observation observed) {
        if(stopped.Version!=replacement.Version)return false;
        if(stopped.Version==1)return observed.LocalGeneration is null&&observed.RemoteGeneration is null&&
            observed.LocalLifecycle==stopped.Lifecycle&&observed.RemoteLifecycle==stopped.Lifecycle&&replacement.Lifecycle==stopped.Lifecycle;
        return observed.LocalLifecycle is null&&observed.RemoteLifecycle is null&&observed.LocalGeneration is {} local&&observed.RemoteGeneration is {} remote&&
            stopped.ObservedGeneration.Matches(local)&&stopped.ObservedGeneration.Matches(remote)&&stopped.ObservedGeneration.Matches(replacement.ObservedGeneration);
    }
    public static bool StoppedFactsMatch(Record record,string localPath,string remotePath,MirrorGeneration local,MirrorGeneration remote,bool unique) {
        Validate(record,record.RootHash,record.Scope);
        return record.Phase==Phase.Stopped&&unique&&record.Resolution is {} resolution&&resolution.LocalPath==localPath&&resolution.RemotePath==remotePath&&
            record.ObservedGeneration.Matches(local)&&record.ObservedGeneration.Matches(remote);
    }
    public static byte[] ArchiveBytes(Record record) {
        using var document=JsonDocument.Parse(JsonSerializer.SerializeToUtf8Bytes(record));
        using var output=new MemoryStream();using(var writer=new Utf8JsonWriter(output))WriteSorted(writer,document.RootElement);
        return output.ToArray();
    }
    static void WriteSorted(Utf8JsonWriter writer,JsonElement value) {
        if(value.ValueKind==JsonValueKind.Object) {
            writer.WriteStartObject();
            foreach(var property in value.EnumerateObject().OrderBy(x=>x.Name,StringComparer.Ordinal)) {
                writer.WritePropertyName(property.Name);WriteSorted(writer,property.Value);
            }
            writer.WriteEndObject();
        } else value.WriteTo(writer);
    }
    public static string ArchiveHash(Record record)=>Convert.ToHexStringLower(SHA256.HashData(ArchiveBytes(record)));
    /// Returns a proposed state value only. The existing owner must first
    /// durably create-only archive ArchiveBytes(expected), obtain the proof,
    /// then revalidate its live observations before persisting this result.
    public static Dictionary<string,Record> Replace(Context context,IReadOnlyDictionary<string,Record> current,string itemId,Record? expected,Record? replacement,
        ProtectedRenameReceipt? completion=null,ArchiveProof? archive=null,Observation? observed=null) {
        if(current.GetValueOrDefault(itemId)!=expected||expected is null&&replacement is null)throw Changed();
        var basis=expected??replacement!;Validate(basis,context.RootHash,context.Scope);ValidateMap(current,context.RootHash,context.Scope);
        if(itemId!=basis.Request.ItemId)throw Invalid();
        if(expected is not null&&replacement is not null) {
            Validate(replacement,basis.RootHash,basis.Scope);
            if(expected.Request==replacement.Request) {
                if(expected.Version!=replacement.Version||expected.Generation!=replacement.Generation||expected.BaselineHash!=replacement.BaselineHash||expected.Lifecycle!=replacement.Lifecycle||
                   expected.Phase==Phase.TerminalRejected&&replacement.Receipt!=expected.Receipt||
                   !(expected==replacement||expected.Phase==Phase.Pending&&replacement.Phase==Phase.TerminalRejected||expected.Phase==Phase.TerminalRejected&&replacement.Phase==Phase.Stopped))throw Changed();
            } else {
                if(observed is null)throw Changed();ValidateFreshReplacement(expected,replacement,observed);
                if(archive is null||!archive.Durable||archive.OperationId!=expected.Request.OperationId||archive.RootHash!=expected.RootHash||
                   archive.Scope!=expected.Scope||archive.RecordHash!=ArchiveHash(expected))throw new InvalidDataException("The prior file move receipt must be durably archived first.");
            }
        } else if(expected is not null) {
            if(completion is null||Consume(expected,completion).MovedRevision is null)throw Changed();
        } else if(replacement!.Phase!=Phase.Pending)throw Changed();
        var result=new Dictionary<string,Record>(current,StringComparer.Ordinal);
        if(replacement is null)result.Remove(itemId);else result[itemId]=replacement;
        ValidateMap(result,basis.RootHash,basis.Scope);return result;
    }

    static void Keys(JsonElement value,params string[] keys) {
        if(value.ValueKind!=JsonValueKind.Object||!value.EnumerateObject().Select(x=>x.Name).Order(StringComparer.Ordinal).SequenceEqual(keys.Order(StringComparer.Ordinal)))throw Invalid();
    }
    static string String(JsonElement value,string name)=>value.GetProperty(name).ValueKind==JsonValueKind.String?value.GetProperty(name).GetString()!:throw Invalid();
    static string? NullableString(JsonElement value,string name)=>value.GetProperty(name).ValueKind==JsonValueKind.Null?null:String(value,name);
    static ProtectedRenameRequest Request(JsonElement value) {
        Keys(value,"operationId","itemId","source","destination","baseRevision");
        return new(String(value,"operationId"),String(value,"itemId"),String(value,"source"),String(value,"destination"),String(value,"baseRevision"));
    }
    static ProtectedRenameScope Scope(JsonElement value) {
        Keys(value,"origin","workspaceId","accountId");return new(String(value,"origin"),String(value,"workspaceId"),String(value,"accountId"));
    }
    static ProtectedRenameReceipt Receipt(JsonElement value) {
        Keys(value,"request","scope","status","relativePath","revision","deleted");
        var flag=value.GetProperty("deleted");if(flag.ValueKind is not(JsonValueKind.True or JsonValueKind.False))throw Invalid();
        return new(Request(value.GetProperty("request")),Scope(value.GetProperty("scope")),String(value,"status"),String(value,"relativePath"),NullableString(value,"revision"),flag.GetBoolean());
    }
    static Resolution ResolutionValue(JsonElement value,int version) {
        if(version==2) {
            Keys(value,"localPath","remotePath","localGeneration","remoteGeneration");
            return new(String(value,"localPath"),String(value,"remotePath"),null,null,JsonSerializer.Deserialize<MirrorGeneration>(value.GetProperty("localGeneration")),JsonSerializer.Deserialize<MirrorGeneration>(value.GetProperty("remoteGeneration")));
        }
        Keys(value,"localPath","remotePath","localLifecycle","remoteLifecycle");
        return new(String(value,"localPath"),String(value,"remotePath"),String(value,"localLifecycle"),String(value,"remoteLifecycle"));
    }
    public sealed class RecordConverter:JsonConverter<Record>
    {
        public override bool HandleNull=>true;
        public override Record Read(ref Utf8JsonReader reader,Type type,JsonSerializerOptions options) {
            using var document=JsonDocument.ParseValue(ref reader);var value=document.RootElement;
            if(Encoding.UTF8.GetByteCount(value.GetRawText())>32768)throw Invalid();
            var version=value.GetProperty("version").GetInt32();
            Keys(value,"version","rootHash","request","scope","baselineHash",version==2?"generation":"lifecycle","phase","receipt","resolution");
            var phase=String(value,"phase") switch{"pending"=>Phase.Pending,"terminal-rejected"=>Phase.TerminalRejected,"stopped"=>Phase.Stopped,_=>throw Invalid()};
            var record=new Record(value.GetProperty("version").GetInt32(),String(value,"rootHash"),Request(value.GetProperty("request")),Scope(value.GetProperty("scope")),
                String(value,"baselineHash"),version==2?null:String(value,"lifecycle"),phase,value.GetProperty("receipt").ValueKind==JsonValueKind.Null?null:Receipt(value.GetProperty("receipt")),
                value.GetProperty("resolution").ValueKind==JsonValueKind.Null?null:ResolutionValue(value.GetProperty("resolution"),version),
                version==2?JsonSerializer.Deserialize<MirrorGeneration>(value.GetProperty("generation")):null);
            Validate(record,record.RootHash,record.Scope);return record;
        }
        public override void Write(Utf8JsonWriter writer,Record value,JsonSerializerOptions options) {
            Validate(value,value.RootHash,value.Scope);
            // Explicit field names and nulls make the stored schema independent
            // of the surrounding State serializer's options.
            if(value.Version==2) {
                JsonSerializer.Serialize(writer,new {version=2,rootHash=value.RootHash,
                    request=new{operationId=value.Request.OperationId,itemId=value.Request.ItemId,source=value.Request.Source,destination=value.Request.Destination,baseRevision=value.Request.BaseRevision},
                    scope=new{origin=value.Scope.Origin,workspaceId=value.Scope.WorkspaceId,accountId=value.Scope.AccountId},baselineHash=value.BaselineHash,generation=value.Generation,
                    phase=value.Phase switch{Phase.Pending=>"pending",Phase.TerminalRejected=>"terminal-rejected",_=>"stopped"},receipt=ReceiptValue(value.Receipt),
                    resolution=value.Resolution is {} r2?new{localPath=r2.LocalPath,remotePath=r2.RemotePath,localGeneration=r2.LocalGeneration,remoteGeneration=r2.RemoteGeneration}:null});
                return;
            }
            var data=new {version=value.Version,rootHash=value.RootHash,request=new{operationId=value.Request.OperationId,itemId=value.Request.ItemId,source=value.Request.Source,destination=value.Request.Destination,baseRevision=value.Request.BaseRevision},
                scope=new{origin=value.Scope.Origin,workspaceId=value.Scope.WorkspaceId,accountId=value.Scope.AccountId},baselineHash=value.BaselineHash,lifecycle=value.Lifecycle,
                phase=value.Phase switch{Phase.Pending=>"pending",Phase.TerminalRejected=>"terminal-rejected",_=>"stopped"},receipt=ReceiptValue(value.Receipt),
                resolution=value.Resolution is {} r?new{localPath=r.LocalPath,remotePath=r.RemotePath,localLifecycle=r.LocalLifecycle,remoteLifecycle=r.RemoteLifecycle}:null};
            JsonSerializer.Serialize(writer,data);
        }
        static object? ReceiptValue(ProtectedRenameReceipt? value)=>value is null?null:new{
            request=new{operationId=value.Request.OperationId,itemId=value.Request.ItemId,source=value.Request.Source,destination=value.Request.Destination,baseRevision=value.Request.BaseRevision},
            scope=new{origin=value.Scope.Origin,workspaceId=value.Scope.WorkspaceId,accountId=value.Scope.AccountId},status=value.Status,relativePath=value.RelativePath,revision=value.Revision,deleted=value.Deleted};
    }
}
