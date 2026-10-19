using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace TextText.Core;

/// Identity fence independent of projection names and edit receipts. All calls
/// must run under the store's existing mutation gate.
public sealed partial class ReplacementRecoveryRegistry
{
    public sealed record Resolution(string? CurrentHash, string PreparedHash, string DisplacedHash,
        RetainedFileReplacement.Stamp? PreparedStamp = null, RetainedFileReplacement.Stamp? DisplacedStamp = null,bool? CurrentPresent=null);
    public sealed record UncapturedCancellation(string PreparedHash,string? CurrentHash,bool CurrentPresent,RetainedFileReplacement.Stamp? PreparedStamp=null);
    public sealed record MoveConsent(string PreparedHash,string? DisplacedHash,bool Captured,bool CurrentPresent,string? CurrentHash,bool SourcePresent,string? SourceHash);
    public sealed record Entry(int Version, Guid Operation, string RootHash, string? OwnerHash, string ItemId,
        string Path, string ExpectedHash, string PreparedHash, Resolution? Resolution = null,string? RecoveryPath=null,string? Kind=null,bool? UserDeletion=null,bool? DeletionMarkerPublished=null,bool? DeletionIntentCancelled=null,UncapturedCancellation? UncapturedCancellation=null,Guid? SupersededBy=null,string? SourcePath=null,MoveConsent? MoveResolution=null,bool? CaseOnly=null);
    public sealed record Inspection(Entry Entry, RetainedFileReplacement.Recovery Recovery, byte[] Prepared, byte[] Displaced,
        RetainedFileReplacement.Stamp? PreparedStamp, RetainedFileReplacement.Stamp? DisplacedStamp)
    {
        public string PreparedHash => TextPackStore.Hash(Prepared);
        public string DisplacedHash => TextPackStore.Hash(Displaced);
    }
    // Private records use atomic publication. The directory generation indexes
    // identity membership; selected records still verify actual file stamps,
    // schema, root and principal. Arbitrary external in-place reassignment of an
    // unrelated private record is outside this contract. Portable runs do not cache.
    static readonly object cacheGate = new();
    static readonly Dictionary<string,(RetainedFileReplacement.Stamp Stamp,Dictionary<string,List<string>> Items)> indexes = new(StringComparer.Ordinal);
    static readonly Dictionary<string,(RetainedFileReplacement.Stamp Stamp,Entry Entry)> records = new(StringComparer.Ordinal);
    readonly string root, stateDirectory, directory, rootHash;
    readonly Action<string>? removalObservation;
    public ReplacementRecoveryRegistry(string root, string stateDirectory,Action<string>? removalObservation=null)
    {
        this.removalObservation=removalObservation;
        var fullRoot = Path.GetFullPath(root);
        this.root = fullRoot.TrimEnd(Path.DirectorySeparatorChar);
        this.stateDirectory = Path.GetFullPath(stateDirectory);
        directory = Path.Combine(this.stateDirectory, "replacement-index");
        rootHash = TextPackStore.Hash(Encoding.UTF8.GetBytes(fullRoot));
        RetainedFileReplacement.CheckPath(this.root); RetainedFileReplacement.CheckPath(directory);
    }
    string? OwnerHash()
    {
        AccountRootOwnership.RequireNoAdoption(stateDirectory);
        var owner = Path.Combine(stateDirectory, AccountRootOwnership.FileName);
        if (!File.Exists(owner)) {
            if (RetainedReplacementProfile.Exists(stateDirectory)) throw new InvalidDataException("Retained replacement ownership is missing.");
            return null;
        }
        var bytes = RetainedFileReplacement.Read(owner, 8192);
        var parsed = JsonSerializer.Deserialize<AccountRootOwnership.Owner>(bytes) ?? throw new InvalidDataException("Invalid replacement ownership.");
        if (parsed.RootHash != rootHash) throw new InvalidDataException("Replacement ownership does not match this root.");
        if (parsed.Version == 2 || parsed.Version==1&&RetainedReplacementProfile.HasPublishedMarker(stateDirectory)) RetainedReplacementProfile.Verify(stateDirectory, parsed, rootHash);
        else if(parsed.Version != 1) throw new InvalidDataException("Unsupported replacement owner.");
        return RetainedReplacementProfile.PrincipalHash(parsed);
    }
    string Target(Entry entry,ISet<string>? verified=null)
    {
        if (entry.Path.Length > 4096 || !entry.Path.EndsWith(".textpack", StringComparison.OrdinalIgnoreCase) || entry.Path.Contains('\\') || entry.Path.Contains(':') ||
            entry.Path.Split('/').Any(part => part.Length == 0 || part.StartsWith('.') || part.EndsWith(' ') || part.EndsWith('.')))
            throw new InvalidDataException("Invalid replacement path.");
        var target = Path.GetFullPath(Path.Combine(root, entry.Path));
        if (!target.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Replacement leaves workspace.");
        RetainedFileReplacement.CheckPath(target,verified); return target;
    }
    void Validate(Entry entry,bool verifyOwner=true,bool validatePaths=true,ISet<string>? verified=null)
    {
        if (entry.Version != 1 || entry.Kind is not (null or "removal" or "move") || entry.Kind is ("removal" or "move")&&entry.ExpectedHash!=entry.PreparedHash || entry.UserDeletion==true&&entry.Kind!="removal" || (entry.DeletionMarkerPublished==true||entry.DeletionIntentCancelled==true)&&(entry.Kind!="removal"||entry.UserDeletion!=true) || entry.Operation == Guid.Empty || entry.RootHash != rootHash || verifyOwner&&entry.OwnerHash != OwnerHash() ||
            !ValidItemId(entry.ItemId) ||
            !RetainedFileReplacement.ValidHash(entry.ExpectedHash) || !RetainedFileReplacement.ValidHash(entry.PreparedHash))
            throw new InvalidDataException("Replacement registry scope cannot be verified.");
        if((entry.Kind=="move")!=(entry.SourcePath is not null)||entry.SourcePath==entry.Path||entry.Kind!="move"&&entry.MoveResolution is not null)throw new InvalidDataException("Invalid move registry scope.");
        if(entry.CaseOnly is not null&&(entry.Kind!="move"||entry.CaseOnly!=true)||entry.CaseOnly==true&&!RetainedFileMove.CaseOnlyPaths(entry.SourcePath!,entry.Path))throw new InvalidDataException("Invalid case-only move registry.");
        if(entry.SourcePath is not null)_=Target(entry with{Path=entry.SourcePath},verified);
        if(entry.MoveResolution is {} move)ValidateMoveConsent(entry,move);
        if(validatePaths){_ = Target(entry,verified);if(entry.RecoveryPath is not null)_=RecoveryLocation(entry,verified);}
        if(entry.SupersededBy is {} superseded&&(superseded==Guid.Empty||superseded==entry.Operation||entry.Kind!="removal"||entry.UserDeletion!=true||entry.DeletionIntentCancelled!=true))throw new InvalidDataException("Invalid superseded deletion receipt.");
        if(entry.UncapturedCancellation is {} cancellation&&(entry.Kind!="removal"||cancellation.PreparedHash!=entry.PreparedHash||(cancellation.CurrentPresent?cancellation.CurrentHash is null||!RetainedFileReplacement.ValidHash(cancellation.CurrentHash):cancellation.CurrentHash is not null)))throw new InvalidDataException("Invalid uncaptured deletion cancellation.");
        if (entry.Resolution is { } resolution && ((resolution.CurrentPresent==false ? entry.Kind!="removal"||resolution.CurrentHash is not null : resolution.CurrentHash is null||!RetainedFileReplacement.ValidHash(resolution.CurrentHash)) ||
            !RetainedFileReplacement.ValidHash(resolution.PreparedHash) || !RetainedFileReplacement.ValidHash(resolution.DisplacedHash)))
            throw new InvalidDataException("Invalid replacement resolution.");
    }
    string RecoveryLocation(Entry entry,ISet<string>? verified=null)
    {
        var relative=entry.RecoveryPath??throw new InvalidDataException("Missing retained location.");
        if(relative.Length>4096||!relative.StartsWith(".texttext/retained-replacements/",StringComparison.Ordinal)||relative.Contains('\\')||relative.Contains(':')||relative.Split('/').Any(part=>part is "" or "." or ".."))throw new InvalidDataException("Invalid retained replacement location.");
        var full=Path.GetFullPath(Path.Combine(root,relative));
        if(!full.StartsWith(root+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("Retained replacement leaves workspace.");
        var expected=RetainedFileReplacement.OperationDirectory(Target(entry,verified),entry.Operation,Path.Combine(root,".texttext","retained-replacements",TextPackStore.Hash(Encoding.UTF8.GetBytes(entry.Path))));
        if(full!=expected) {
            var recoveryRoot=Path.Combine(root,".texttext","retained-replacements",TextPackStore.Hash(Encoding.UTF8.GetBytes(entry.Path)));
            if(Path.GetFileName(full)!=entry.Operation.ToString("D")||Path.GetDirectoryName(Path.GetDirectoryName(full))!=Path.Combine(recoveryRoot,".texttext-replacements"))throw new InvalidDataException("Retained replacement location does not match its original path and operation.");
            var recovery=RetainedFileReplacement.InspectDirectory(full,Path.GetFileName(entry.Path),entry.Operation,verified,allowCaseAlias:true);
            var physical=Path.Combine(Path.GetDirectoryName(Target(entry,verified))!,recovery.Record.Filename);
            if(full!=RetainedFileReplacement.OperationDirectory(physical,entry.Operation,recoveryRoot))throw new InvalidDataException("Retained replacement basename changed.");
        }
        RetainedFileReplacement.CheckPath(full,verified);return full;
    }
    public (byte[] Bytes,bool NeedsAdoption) BindForAdoption(byte[] bytes,string filename,AccountRootOwnership.Owner owner)
    {
        if(bytes.Length>16384)throw new InvalidDataException("Replacement registry exceeds adoption bounds.");
        CheckFields(bytes);
        var entry=JsonSerializer.Deserialize<Entry>(bytes)??throw new InvalidDataException("Invalid replacement adoption record.");
        Validate(entry,verifyOwner:false);
        if(filename!=entry.Operation.ToString("D")+".json"||owner.RootHash!=rootHash)throw new InvalidDataException("Replacement adoption scope changed.");
        var principal=RetainedReplacementProfile.PrincipalHash(owner);
        if(entry.OwnerHash is not null&&entry.OwnerHash!=principal)throw new SharedAccountMismatchException();
        var recovery=RecoveryFor(entry);
        if(recovery.Record.CaseOnly!=entry.CaseOnly||recovery.Record.SourcePath!=entry.SourcePath||recovery.Record.Kind!=entry.Kind||recovery.Record.ExpectedHash!=entry.ExpectedHash||recovery.Record.PreparedHash!=entry.PreparedHash)throw new InvalidDataException("Retained replacement manifest differs from its registry.");
        return entry.OwnerHash==principal?(bytes,false):(JsonSerializer.SerializeToUtf8Bytes(entry with{OwnerHash=principal}),true);
    }
    static string[] RecordPaths(string directory) => Directory.GetFileSystemEntries(directory).Where(name=>!Path.GetFileName(name).StartsWith('.')).ToArray();
    static string PathKey(string path)=>"\0path:"+(OperatingSystem.IsWindows()?path.ToUpperInvariant():path);
    static bool SameMovePath(string? first,string? second)=>string.Equals(first,second,OperatingSystem.IsWindows()?StringComparison.OrdinalIgnoreCase:StringComparison.Ordinal);
    string[] IndexedPaths(string? itemId)
    {
        if(itemId is null || !OperatingSystem.IsWindows())return RecordPaths(directory);
        for(var attempt=0;attempt<3;attempt++) {
            var generation=RetainedFileReplacement.Fingerprint(directory)??throw new IOException("Cannot verify replacement registry directory.");
            lock(cacheGate)if(indexes.TryGetValue(directory,out var cached)&&cached.Stamp==generation)
                return cached.Items.TryGetValue(itemId,out var selected)?selected.ToArray():[];
            var paths=RecordPaths(directory);var items=new Dictionary<string,List<string>>(StringComparer.Ordinal);
            foreach(var path in paths) {
                var bytes=RetainedFileReplacement.Read(path,16384);
                using var parsed=JsonDocument.Parse(bytes);
                if(parsed.RootElement.ValueKind!=JsonValueKind.Object||!parsed.RootElement.TryGetProperty("ItemId",out var field)||field.ValueKind!=JsonValueKind.String||field.GetString() is not {} identity||!ValidItemId(identity))
                    throw new InvalidDataException("Replacement registry identity cannot be indexed.");
                if(!items.TryGetValue(identity,out var values))items[identity]=values=[];
                values.Add(path);
                if(parsed.RootElement.TryGetProperty("Kind",out var kind)&&kind.ValueKind==JsonValueKind.String&&kind.GetString()=="move") {
                    foreach(var name in new[]{"Path","SourcePath"}) {
                        if(!parsed.RootElement.TryGetProperty(name,out var member)||member.ValueKind!=JsonValueKind.String)throw new InvalidDataException("Move paths cannot be indexed.");
                        var key=PathKey(member.GetString()!);if(!items.TryGetValue(key,out var members))items[key]=members=[];if(members.Count==0||members[^1]!=path)members.Add(path);
                    }
                }
            }
            if(generation!=RetainedFileReplacement.Fingerprint(directory))continue;
            lock(cacheGate) {
                if(indexes.Count>=32)indexes.Clear();
                indexes[directory]=(generation,items);
            }
            return items.TryGetValue(itemId,out var result)?result.ToArray():[];
        }
        throw new FileChangedException();
    }
    static bool ValidItemId(string value) => value.Length is >0 and <=128 && char.IsAsciiLetterOrDigit(value[0]) && value.All(character=>char.IsAsciiLetterOrDigit(character)||character is '_' or '-');
    public IReadOnlyList<Entry> Entries(string? itemId=null)=>ReadEntries(itemId,new HashSet<string>(StringComparer.Ordinal));
    IReadOnlyList<Entry> ReadEntries(string? itemId,ISet<string> verified,string? movePath=null)
    {
        RetainedFileReplacement.CheckPath(directory,verified);
        var ownerHash=OwnerHash();
        if (!Directory.Exists(directory)) return [];
        var result = new List<Entry>();
        var validatedTargets=new HashSet<string>(StringComparer.Ordinal);
        foreach (var name in IndexedPaths(movePath is null?itemId:PathKey(movePath))) {
            var stamp=RetainedFileReplacement.Fingerprint(name,ancestorsVerified:true);Entry entry;
            lock(cacheGate)entry=stamp is not null&&records.TryGetValue(name,out var cached)&&cached.Stamp==stamp?cached.Entry:null!;
            if(entry is null) {
                var bytes=RetainedFileReplacement.Read(name,16384);CheckFields(bytes);
                entry=JsonSerializer.Deserialize<Entry>(bytes)??throw new InvalidDataException("Invalid replacement registry.");
                if(stamp!=RetainedFileReplacement.Fingerprint(name,ancestorsVerified:true))throw new FileChangedException();
                if(stamp is not null)lock(cacheGate){if(records.Count>=4096)records.Clear();records[name]=(stamp,entry);}
            }
            if (Path.GetFileName(name) != entry.Operation.ToString("D") + ".json" || OperatingSystem.IsWindows()&&(itemId is not null&&entry.ItemId!=itemId||movePath is not null&&(entry.Kind!="move"||!SameMovePath(entry.Path,movePath)&&!SameMovePath(entry.SourcePath,movePath)))) throw new InvalidDataException("Replacement registry name or identity mismatch.");
            Validate(entry,verifyOwner:false,validatePaths:validatedTargets.Add(entry.Path+"\0"+entry.RecoveryPath+(entry.RecoveryPath is null?"":"\0"+entry.Operation.ToString("D"))),verified:verified);
            if(entry.OwnerHash!=ownerHash)throw new InvalidDataException("Replacement registry owner changed.");
            if((itemId is null||entry.ItemId==itemId)&&(movePath is null||entry.Kind=="move"&&(SameMovePath(entry.Path,movePath)||SameMovePath(entry.SourcePath,movePath))))result.Add(entry);
        }
        return result;
    }
    static void CheckFields(byte[] bytes)
    {
        RetainedFileReplacement.JsonFields(bytes,["Version","Operation","RootHash","OwnerHash","ItemId","Path","ExpectedHash","PreparedHash","Resolution","RecoveryPath","Kind","UserDeletion","DeletionMarkerPublished","DeletionIntentCancelled","UncapturedCancellation","SupersededBy","SourcePath","MoveResolution","CaseOnly"],["Version","Operation","RootHash","OwnerHash","ItemId","Path","ExpectedHash","PreparedHash"]);
        using var parsed=JsonDocument.Parse(bytes);
        if(parsed.RootElement.TryGetProperty("MoveResolution",out var move)&&move.ValueKind!=JsonValueKind.Null)
            RetainedFileReplacement.JsonFields(Encoding.UTF8.GetBytes(move.GetRawText()),["PreparedHash","DisplacedHash","Captured","CurrentPresent","CurrentHash","SourcePresent","SourceHash"],["PreparedHash","DisplacedHash","Captured","CurrentPresent","CurrentHash","SourcePresent","SourceHash"]);
        if(parsed.RootElement.TryGetProperty("UncapturedCancellation",out var cancellation)&&cancellation.ValueKind!=JsonValueKind.Null)
            RetainedFileReplacement.JsonFields(System.Text.Encoding.UTF8.GetBytes(cancellation.GetRawText()),["PreparedHash","CurrentHash","CurrentPresent","PreparedStamp"],["PreparedHash","CurrentHash","CurrentPresent"]);
        if(parsed.RootElement.TryGetProperty("Resolution",out var resolution)&&resolution.ValueKind!=JsonValueKind.Null)
            RetainedFileReplacement.JsonFields(System.Text.Encoding.UTF8.GetBytes(resolution.GetRawText()),["CurrentHash","PreparedHash","DisplacedHash","PreparedStamp","DisplacedStamp","CurrentPresent"],["CurrentHash","PreparedHash","DisplacedHash"]);
    }
    void Invalidate() { lock(cacheGate)indexes.Remove(directory); }
    public void Register(Guid operation, string itemId, string path, string expectedHash, string preparedHash,string? recoveryDirectory=null,string? kind=null,bool userDeletion=false,string? sourcePath=null,bool caseOnly=false)
    {
        var entry = new Entry(1, operation, rootHash, OwnerHash(), itemId, path, expectedHash, preparedHash,
            RecoveryPath:recoveryDirectory is null?null:Path.GetRelativePath(root,recoveryDirectory).Replace('\\','/'),Kind:kind,UserDeletion:userDeletion?true:null,SourcePath:sourcePath,CaseOnly:caseOnly?true:null);
        Validate(entry); Directory.CreateDirectory(directory); RetainedFileReplacement.CheckPath(directory);
        Invalidate();
        RetainedFileReplacement.SaveJson(Path.Combine(directory, operation.ToString("D") + ".json"), entry, creating: true);
        Invalidate();
    }
    // Private diagnostic seam: caller has already attested exact owner/root.
    // Existing production validation remains owner-verifying by default.
    Dictionary<string,string> ReadCompletedHistory(string principalHash)=>ReadCompletedHistoryForItem(principalHash,null);
    internal Dictionary<string,string> ReadCompletedHistoryForItem(string principalHash,string? itemId)
    {
        if(!RetainedFileReplacement.ValidHash(principalHash))throw new InvalidDataException("Invalid attested principal.");
        Dictionary<string,string> Snapshot()
        {
            RetainedFileReplacement.CheckPath(directory);
            var result=new Dictionary<string,string>(StringComparer.Ordinal);
            if(!Directory.Exists(directory)){if(File.Exists(directory))throw new InvalidDataException("Invalid recovery directory.");return result;}
            result["present"]="1";
            var count=0;var total=0;var verified=new HashSet<string>(StringComparer.Ordinal);
            foreach(var file in Directory.EnumerateFileSystemEntries(directory)) {
                if(++count>1000)throw new InvalidDataException("Recovery metadata limit exceeded.");
                var name=Path.GetFileName(file);
                if(!Guid.TryParseExact(Path.GetFileNameWithoutExtension(name),"D",out var id)||name!=id.ToString("D")+".json")throw new InvalidDataException("Unknown recovery metadata.");
                var bytes=RetainedFileReplacement.Read(file,16384);ProtectedSavedRename.ValidateStateBytes(bytes);total+=bytes.Length;
                if(total>16*1024*1024)throw new InvalidDataException("Recovery metadata limit exceeded.");
                CheckFields(bytes);var entry=JsonSerializer.Deserialize<Entry>(bytes)??throw new InvalidDataException("Invalid recovery metadata.");
                Validate(entry,verifyOwner:false,verified:verified);
                if(entry.Operation!=id||entry.OwnerHash!=principalHash)throw new InvalidDataException("Recovery principal changed.");
                // Unrelated entries retain their existing native recovery lane.
                // Their index schemas/owner still validate; never inspect or
                // classify another item's retained operation here.
                if(itemId is not null&&entry.ItemId!=itemId)continue;
                var original=Target(entry,verified);
                var exact=entry.RecoveryPath is not null?RecoveryLocation(entry,verified):RetainedFileReplacement.OperationDirectory(original,id);
                // Never call RecoveryFor: its missing-pointer branch searches for relocation.
                var retained=RetainedFileReplacement.InspectDirectory(exact,Path.GetFileName(entry.Path),id,verified,allowCaseAlias:entry.RecoveryPath is not null);
                var prepared=RetainedFileReplacement.Fingerprint(retained.Prepared);
                var displaced=RetainedFileReplacement.Fingerprint(retained.Displaced);
                if(retained.Record.State!="completed"||retained.Record.ExpectedHash!=entry.ExpectedHash||retained.Record.PreparedHash!=entry.PreparedHash||
                    retained.Record.Kind!=entry.Kind||retained.Record.CaseOnly!=entry.CaseOnly||retained.Record.SourcePath!=entry.SourcePath||
                    prepared is null||displaced is null||retained.Record.PreparedStamp!=prepared||retained.Record.DisplacedStamp!=displaced)
                    throw new InvalidDataException("Recovery history is not already completed and stable.");
                if(entry.Resolution is {} resolution&&(resolution.PreparedStamp!=prepared||resolution.DisplacedStamp!=displaced))throw new InvalidDataException("Recovery resolution changed.");
                var manifest=RetainedFileReplacement.Read(Path.Combine(exact,"manifest.json"),16384);ProtectedSavedRename.ValidateStateBytes(manifest);total+=manifest.Length;
                if(total>16*1024*1024)throw new InvalidDataException("Recovery metadata limit exceeded.");
                var prefix=id.ToString("D");result[prefix+"/index"]=TextPackStore.Hash(bytes);result[prefix+"/manifest"]=TextPackStore.Hash(manifest);
                result[prefix+"/prepared"]=TextPackStore.Hash(JsonSerializer.SerializeToUtf8Bytes(prepared));result[prefix+"/displaced"]=TextPackStore.Hash(JsonSerializer.SerializeToUtf8Bytes(displaced));
            }
            return result;
        }
        var first=Snapshot();var second=Snapshot();
        if(first.Count!=second.Count||first.Any(p=>!second.TryGetValue(p.Key,out var value)||value!=p.Value))throw new InvalidDataException("Recovery history changed during observation.");
        return first;
    }
    public Inspection Inspect(Entry entry)
    {
        Validate(entry);
        var recovery = RecoveryFor(entry);
        if (recovery.Record.CaseOnly!=entry.CaseOnly||recovery.Record.SourcePath!=entry.SourcePath||recovery.Record.Kind!=entry.Kind||recovery.Record.ExpectedHash != entry.ExpectedHash || recovery.Record.PreparedHash != entry.PreparedHash)
            throw new InvalidDataException("Replacement registry and manifest disagree.");
        var preparedStamp = RetainedFileReplacement.Fingerprint(recovery.Prepared);
        var displacedStamp = RetainedFileReplacement.Fingerprint(recovery.Displaced);
        var prepared = RetainedFileReplacement.Read(recovery.Prepared);
        if (TextPackStore.Hash(prepared) != entry.PreparedHash) throw new InvalidDataException("Prepared replacement changed.");
        var displaced = RetainedFileReplacement.Read(recovery.Displaced);
        if (preparedStamp != RetainedFileReplacement.Fingerprint(recovery.Prepared) || displacedStamp != RetainedFileReplacement.Fingerprint(recovery.Displaced)) throw new FileChangedException();
        return new(entry, recovery, prepared, displaced, preparedStamp, displacedStamp);
    }
    RetainedFileReplacement.Recovery RecoveryFor(Entry entry,ISet<string>? verified=null)
    {
        if(entry.RecoveryPath is not null)return RetainedFileReplacement.InspectDirectory(RecoveryLocation(entry,verified),Path.GetFileName(entry.Path),entry.Operation,verified,allowCaseAlias:true);
        var original=Target(entry,verified);var directory=RetainedFileReplacement.OperationDirectory(original,entry.Operation);
        if(Directory.Exists(directory))return RetainedFileReplacement.InspectDirectory(directory,Path.GetFileName(original),entry.Operation,verified);
        // A raw folder rename moves its hidden retained inode directory too.
        // Search only directories, bound work, and require a unique operation.
        var matches=new List<string>();var visited=0;
        void Visit(string parent) {
            RetainedFileReplacement.CheckPath(parent);
            foreach(var child in Directory.EnumerateDirectories(parent)) {
                if(++visited>20000)throw new InvalidDataException("Too many directories to locate retained recovery safely.");
                RetainedFileReplacement.CheckPath(child);
                if(Path.GetFileName(child)==".texttext-replacements") {
                    var candidate=Path.Combine(child,TextPackStore.Hash(Encoding.UTF8.GetBytes(Path.GetFileName(original))),entry.Operation.ToString("D"));
                    if(Directory.Exists(candidate))matches.Add(candidate);
                } else if(!Path.GetFileName(child).StartsWith('.'))Visit(child);
            }
        }
        Visit(root);
        if(matches.Count!=1)throw new RetainedFileReplacement.RequiredException(entry.Operation);
        return RetainedFileReplacement.InspectDirectory(matches[0],Path.GetFileName(original),entry.Operation,verified);
    }
    public void AssertReadable(string? itemId)
    {
        var verified=new HashSet<string>(StringComparer.Ordinal);
        foreach(var entry in ReadEntries(itemId,verified))AssertEntryReadableCore(entry,true,verified);
    }
    public void AssertEntryReadable(Entry entry,bool persist=true)
    {
        var verified=new HashSet<string>(StringComparer.Ordinal);
        Validate(entry,verified:verified);
        AssertEntryReadableCore(entry,persist,verified);
    }
    void AssertEntryReadableCore(Entry entry,bool persist,ISet<string> verified)
    {
        if(entry.Kind=="move"){AssertMoveReadable(entry,persist);return;}
        RetainedFileReplacement.Recovery recovery;
        try {recovery=RecoveryFor(entry,verified);}
        catch(FileNotFoundException){throw new RetainedFileReplacement.RequiredException(entry.Operation);}
        catch(DirectoryNotFoundException){throw new RetainedFileReplacement.RequiredException(entry.Operation);}
        using var captureLease=persist&&entry.Kind=="removal"&&entry.Resolution is null&&recovery.Record.State=="pending"?RequireCaptureLease(entry.Operation):null;
        if(captureLease is not null)recovery=RecoveryFor(entry,verified);
        if(recovery.Record.CaseOnly!=entry.CaseOnly||recovery.Record.SourcePath!=entry.SourcePath||recovery.Record.Kind!=entry.Kind||recovery.Record.ExpectedHash!=entry.ExpectedHash||recovery.Record.PreparedHash!=entry.PreparedHash)throw new InvalidDataException("Replacement manifest mismatch.");
        if(entry.UncapturedCancellation is not null) {
            var uncaptured=InspectUncaptured(entry);
            if(persist&&uncaptured.Recovery.Record.State!="cancelled")RetainedFileReplacement.SaveJson(Path.Combine(uncaptured.Recovery.Directory,"manifest.json"),uncaptured.Recovery.Record with{State="cancelled"});
            return;
        }
        if(entry.Resolution is {} resolution) {
            if(RetainedFileReplacement.Unchanged(recovery.Prepared,resolution.PreparedStamp)&&RetainedFileReplacement.Unchanged(recovery.Displaced,resolution.DisplacedStamp)){if(persist)RestoreDeletionMarker(entry,recovery);return;}
            var inspection=Inspect(entry);
            if(inspection.PreparedHash==resolution.PreparedHash&&inspection.DisplacedHash==resolution.DisplacedHash){if(persist)RestoreDeletionMarker(entry,recovery);return;}
            throw new RetainedFileReplacement.RequiredException(entry.Operation);
        }
        var classified=(persist?CancelRenamedUncaptured(entry,recovery):null)??RetainedFileReplacement.Classify(recovery,Path.Combine(Path.GetDirectoryName(Target(entry,verified))!,recovery.Record.Filename),persist,verified);
        if(classified.Record.State is not ("completed" or "cancelled"))throw new RetainedFileReplacement.RequiredException(entry.Operation);
        if(persist)RestoreDeletionMarker(entry,classified);
    }
    public IReadOnlyList<string> Export(Inspection inspection)
    {
        Validate(inspection.Entry);
        var destination = Path.Combine(stateDirectory, "recovery", "replacement-" + inspection.Entry.Operation.ToString("D"));
        RetainedFileReplacement.CheckPath(destination); Directory.CreateDirectory(destination); RetainedFileReplacement.CheckPath(destination);
        var result = new List<string>();
        foreach (var bytes in new[] { inspection.Prepared, inspection.Displaced }) {
            var file = Path.Combine(destination, TextPackStore.Hash(bytes) + ".textpack");
            if (File.Exists(file)) {
                if (!RetainedFileReplacement.Read(file).SequenceEqual(bytes)) throw new FileChangedException();
            } else RetainedFileReplacement.Create(file, bytes);
            result.Add(file);
        }
        return result;
    }
    public void ResolveKeepCurrent(Guid operation, string itemId, string visiblePath, Resolution observed,Action? beforeAcknowledge=null)
    {
        var entry = Entries().SingleOrDefault(entry => entry.Operation == operation) ?? throw new InvalidDataException("Unknown retained replacement.");
        using var captureLease=entry.Kind=="removal"?RequireCaptureLease(entry.Operation):null;
        if (entry.ItemId != itemId) throw new InvalidDataException("Replacement identity mismatch.");
        var visible = Target(entry with { Path = visiblePath });
        void Verify(Inspection inspection) {
            var bytes = RetainedFileReplacement.ExistsNoFollow(visible)?RetainedFileReplacement.Read(visible):null;
            if (inspection.PreparedHash != observed.PreparedHash || inspection.DisplacedHash != observed.DisplacedHash ||
                (bytes is not null)!=(observed.CurrentPresent??true) || (bytes is null?null:TextPackStore.Hash(bytes)) != observed.CurrentHash || entry.Kind!="removal"&&(bytes is null||TextPackStore.Identity(bytes) != itemId)) throw new FileChangedException();
        }
        var first = Inspect(entry); Verify(first); _ = Export(first);
        var latest = Inspect(entry); Verify(latest); Validate(entry);
        beforeAcknowledge?.Invoke();
        Invalidate();
        RetainedFileReplacement.SaveJson(Path.Combine(directory, operation.ToString("D") + ".json"), entry with {
            Resolution = observed with { PreparedStamp = latest.PreparedStamp, DisplacedStamp = latest.DisplacedStamp } });
        Invalidate();
        RestoreDeletionMarker(entry with{Resolution=observed},latest.Recovery);
    }
}
