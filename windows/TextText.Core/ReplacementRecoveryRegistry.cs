using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace TextText.Core;

/// Identity fence independent of projection names and edit receipts. All calls
/// must run under the store's existing mutation gate.
public sealed class ReplacementRecoveryRegistry
{
    public sealed record Resolution(string CurrentHash, string PreparedHash, string DisplacedHash,
        RetainedFileReplacement.Stamp? PreparedStamp = null, RetainedFileReplacement.Stamp? DisplacedStamp = null);
    public sealed record Entry(int Version, Guid Operation, string RootHash, string? OwnerHash, string ItemId,
        string Path, string ExpectedHash, string PreparedHash, Resolution? Resolution = null,string? RecoveryPath=null);
    public sealed record Inspection(Entry Entry, RetainedFileReplacement.Recovery Recovery, byte[] Prepared, byte[] Displaced,
        RetainedFileReplacement.Stamp? PreparedStamp, RetainedFileReplacement.Stamp? DisplacedStamp)
    {
        public string PreparedHash => TextPackStore.Hash(Prepared);
        public string DisplacedHash => TextPackStore.Hash(Displaced);
    }
    readonly string root, stateDirectory, directory, rootHash;
    public ReplacementRecoveryRegistry(string root, string stateDirectory)
    {
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
    string Target(Entry entry)
    {
        if (entry.Path.Length > 4096 || !entry.Path.EndsWith(".textpack", StringComparison.Ordinal) || entry.Path.Contains('\\') || entry.Path.Contains(':') ||
            entry.Path.Split('/').Any(part => part.Length == 0 || part.StartsWith('.') || part.EndsWith(' ') || part.EndsWith('.')))
            throw new InvalidDataException("Invalid replacement path.");
        var target = Path.GetFullPath(Path.Combine(root, entry.Path));
        if (!target.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Replacement leaves workspace.");
        RetainedFileReplacement.CheckPath(target); return target;
    }
    void Validate(Entry entry,bool verifyOwner=true)
    {
        if (entry.Version != 1 || entry.Operation == Guid.Empty || entry.RootHash != rootHash || verifyOwner&&entry.OwnerHash != OwnerHash() ||
            !Regex.IsMatch(entry.ItemId, @"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\z") ||
            !RetainedFileReplacement.ValidHash(entry.ExpectedHash) || !RetainedFileReplacement.ValidHash(entry.PreparedHash))
            throw new InvalidDataException("Replacement registry scope cannot be verified.");
        _ = Target(entry);
        if(entry.RecoveryPath is not null)_=RecoveryLocation(entry);
        if (entry.Resolution is { } resolution && (!RetainedFileReplacement.ValidHash(resolution.CurrentHash) ||
            !RetainedFileReplacement.ValidHash(resolution.PreparedHash) || !RetainedFileReplacement.ValidHash(resolution.DisplacedHash)))
            throw new InvalidDataException("Invalid replacement resolution.");
    }
    string RecoveryLocation(Entry entry)
    {
        var relative=entry.RecoveryPath??throw new InvalidDataException("Missing retained location.");
        if(relative.Length>4096||!relative.StartsWith(".texttext/retained-replacements/",StringComparison.Ordinal)||relative.Contains('\\')||relative.Contains(':')||relative.Split('/').Any(part=>part is "" or "." or ".."))throw new InvalidDataException("Invalid retained replacement location.");
        var full=Path.GetFullPath(Path.Combine(root,relative));
        if(!full.StartsWith(root+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("Retained replacement leaves workspace.");
        var expected=RetainedFileReplacement.OperationDirectory(Target(entry),entry.Operation,Path.Combine(root,".texttext","retained-replacements",TextPackStore.Hash(Encoding.UTF8.GetBytes(entry.Path))));
        if(full!=expected)throw new InvalidDataException("Retained replacement location does not match its original path and operation.");
        RetainedFileReplacement.CheckPath(full);return full;
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
        if(recovery.Record.ExpectedHash!=entry.ExpectedHash||recovery.Record.PreparedHash!=entry.PreparedHash)throw new InvalidDataException("Retained replacement manifest differs from its registry.");
        return entry.OwnerHash==principal?(bytes,false):(JsonSerializer.SerializeToUtf8Bytes(entry with{OwnerHash=principal}),true);
    }
    public IReadOnlyList<Entry> Entries()
    {
        RetainedFileReplacement.CheckPath(directory);
        if (!Directory.Exists(directory)) {
            if(RetainedReplacementProfile.Exists(stateDirectory))_=OwnerHash();
            return [];
        }
        var ownerHash=OwnerHash();
        var names = Directory.GetFileSystemEntries(directory);
        if (names.Length > 4096) throw new InvalidDataException("Too many retained replacements.");
        var result = new List<Entry>();
        foreach (var name in names.Where(name => !Path.GetFileName(name).StartsWith('.'))) {
            var bytes=RetainedFileReplacement.Read(name,16384);
            CheckFields(bytes);
            var entry = JsonSerializer.Deserialize<Entry>(bytes) ?? throw new InvalidDataException("Invalid replacement registry.");
            if (Path.GetFileName(name) != entry.Operation.ToString("D") + ".json") throw new InvalidDataException("Replacement registry name mismatch.");
            Validate(entry,verifyOwner:false);
            if(entry.OwnerHash!=ownerHash)throw new InvalidDataException("Replacement registry owner changed.");
            result.Add(entry);
        }
        return result;
    }
    static void CheckFields(byte[] bytes)
    {
        RetainedFileReplacement.JsonFields(bytes,["Version","Operation","RootHash","OwnerHash","ItemId","Path","ExpectedHash","PreparedHash","Resolution","RecoveryPath"],["Version","Operation","RootHash","OwnerHash","ItemId","Path","ExpectedHash","PreparedHash"]);
        using var parsed=JsonDocument.Parse(bytes);
        if(parsed.RootElement.TryGetProperty("Resolution",out var resolution)&&resolution.ValueKind!=JsonValueKind.Null)
            RetainedFileReplacement.JsonFields(System.Text.Encoding.UTF8.GetBytes(resolution.GetRawText()),["CurrentHash","PreparedHash","DisplacedHash","PreparedStamp","DisplacedStamp"],["CurrentHash","PreparedHash","DisplacedHash"]);
    }
    public void Register(Guid operation, string itemId, string path, string expectedHash, string preparedHash,string? recoveryDirectory=null)
    {
        var entry = new Entry(1, operation, rootHash, OwnerHash(), itemId, path, expectedHash, preparedHash,
            RecoveryPath:recoveryDirectory is null?null:Path.GetRelativePath(root,recoveryDirectory).Replace('\\','/'));
        Validate(entry); Directory.CreateDirectory(directory); RetainedFileReplacement.CheckPath(directory);
        RetainedFileReplacement.SaveJson(Path.Combine(directory, operation.ToString("D") + ".json"), entry, creating: true);
    }
    public Inspection Inspect(Entry entry)
    {
        Validate(entry);
        var recovery = RecoveryFor(entry);
        if (recovery.Record.ExpectedHash != entry.ExpectedHash || recovery.Record.PreparedHash != entry.PreparedHash)
            throw new InvalidDataException("Replacement registry and manifest disagree.");
        var preparedStamp = RetainedFileReplacement.Fingerprint(recovery.Prepared);
        var displacedStamp = RetainedFileReplacement.Fingerprint(recovery.Displaced);
        var prepared = RetainedFileReplacement.Read(recovery.Prepared);
        if (TextPackStore.Hash(prepared) != entry.PreparedHash) throw new InvalidDataException("Prepared replacement changed.");
        var displaced = RetainedFileReplacement.Read(recovery.Displaced);
        if (preparedStamp != RetainedFileReplacement.Fingerprint(recovery.Prepared) || displacedStamp != RetainedFileReplacement.Fingerprint(recovery.Displaced)) throw new FileChangedException();
        return new(entry, recovery, prepared, displaced, preparedStamp, displacedStamp);
    }
    RetainedFileReplacement.Recovery RecoveryFor(Entry entry)
    {
        if(entry.RecoveryPath is not null)return RetainedFileReplacement.InspectDirectory(RecoveryLocation(entry),Path.GetFileName(entry.Path),entry.Operation);
        var original=Target(entry);var directory=RetainedFileReplacement.OperationDirectory(original,entry.Operation);
        if(Directory.Exists(directory))return RetainedFileReplacement.Inspect(original,entry.Operation);
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
        return RetainedFileReplacement.InspectDirectory(matches[0],Path.GetFileName(original),entry.Operation);
    }
    public void AssertReadable(string? itemId)
    {
        foreach(var entry in Entries().Where(entry=>itemId is null||entry.ItemId==itemId))AssertEntryReadable(entry);
    }
    public void AssertEntryReadable(Entry entry,bool persist=true)
    {
        Validate(entry);
        RetainedFileReplacement.Recovery recovery;
        try {recovery=RecoveryFor(entry);}
        catch(FileNotFoundException){throw new RetainedFileReplacement.RequiredException(entry.Operation);}
        catch(DirectoryNotFoundException){throw new RetainedFileReplacement.RequiredException(entry.Operation);}
        if(recovery.Record.ExpectedHash!=entry.ExpectedHash||recovery.Record.PreparedHash!=entry.PreparedHash)throw new InvalidDataException("Replacement manifest mismatch.");
        if(entry.Resolution is {} resolution) {
            if(RetainedFileReplacement.Unchanged(recovery.Prepared,resolution.PreparedStamp)&&RetainedFileReplacement.Unchanged(recovery.Displaced,resolution.DisplacedStamp))return;
            var inspection=Inspect(entry);
            if(inspection.PreparedHash==resolution.PreparedHash&&inspection.DisplacedHash==resolution.DisplacedHash)return;
            throw new RetainedFileReplacement.RequiredException(entry.Operation);
        }
        if(RetainedFileReplacement.Classify(recovery,Target(entry),persist).Record.State!="completed")throw new RetainedFileReplacement.RequiredException(entry.Operation);
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
        if (entry.ItemId != itemId) throw new InvalidDataException("Replacement identity mismatch.");
        var visible = Target(entry with { Path = visiblePath });
        void Verify(Inspection inspection) {
            var bytes = RetainedFileReplacement.Read(visible);
            if (inspection.PreparedHash != observed.PreparedHash || inspection.DisplacedHash != observed.DisplacedHash ||
                TextPackStore.Hash(bytes) != observed.CurrentHash || TextPackStore.Identity(bytes) != itemId) throw new FileChangedException();
        }
        var first = Inspect(entry); Verify(first); _ = Export(first);
        var latest = Inspect(entry); Verify(latest); Validate(entry);
        beforeAcknowledge?.Invoke();
        RetainedFileReplacement.SaveJson(Path.Combine(directory, operation.ToString("D") + ".json"), entry with {
            Resolution = observed with { PreparedStamp = latest.PreparedStamp, DisplacedStamp = latest.DisplacedStamp } });
    }
}
