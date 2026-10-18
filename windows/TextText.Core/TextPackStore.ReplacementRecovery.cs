namespace TextText.Core;

public sealed partial class TextPackStore
{
    ReplacementRecoveryRegistry Replacements => new(Root, StateDirectory);
    public void AssertReplacementReadable(string? itemId) { lock(gate) Replacements.AssertReadable(itemId); }
    public void ValidateReplacementRegistry() { lock(gate) _=Replacements.Entries(); }
    public bool ReplacementBlocked(string itemId)
    {
        try {AssertReplacementReadable(itemId);return false;}catch(RetainedFileReplacement.RequiredException){return true;}
    }
    public IReadOnlyDictionary<string,Guid> ReplacementBlockedItems()
    {
        lock(gate) {
            var result=new Dictionary<string,Guid>();
            foreach(var entry in Replacements.Entries()) {
                try{Replacements.AssertEntryReadable(entry);}catch(RetainedFileReplacement.RequiredException error){result[entry.ItemId]=error.Operation;}
            }
            return result;
        }
    }
    public sealed record ReplacementRecoveryEntry(string Id, string Path, string ItemId, string CurrentHash, string PreparedHash, string DisplacedHash, string SavedAt,bool Resolved=false);
    public sealed record ReplacementRecoveryFile(string Path, string Hash, string ItemId, byte[] Data, bool Opaque=false, string? ParseError=null);
    ReplacementRecoveryFile ReplacementVisible(ReplacementRecoveryRegistry.Entry entry)
    {
        ReplacementRecoveryFile? found=null;var inspected=0;
        void Visit(string directory) {
            CheckLinks(directory);
            foreach(var path in Directory.EnumerateFileSystemEntries(directory)) {
                if(System.IO.Path.GetFileName(path).StartsWith('.'))continue;
                CheckLinks(path);
                if(Directory.Exists(path)){Visit(path);continue;}
                if(!path.EndsWith(".textpack",StringComparison.OrdinalIgnoreCase))continue;
                if(++inspected>20000)throw new InvalidDataException("Too many files to inspect recovery safely.");
                byte[] bytes;string identity;
                try {bytes=ReadProjection(path);identity=Identity(bytes);}
                catch(Exception error)when(error is IOException or InvalidDataException or UnauthorizedAccessException){continue;}
                if(identity!=entry.ItemId)continue;
                if(found is not null)throw new InvalidDataException("Duplicate document identity prevents recovery. Keep both files and resolve the duplicate first.");
                found=new(System.IO.Path.GetRelativePath(Root,path).Replace('\\','/'),Hash(bytes),identity,bytes);
            }
        }
        Visit(Root);return found??throw new RetainedFileReplacement.RequiredException(entry.Operation);
    }
    public IReadOnlyList<ReplacementRecoveryEntry> ReplacementRecoveryList()
    {
        lock(gate) {
            var result=new List<ReplacementRecoveryEntry>();
            foreach(var entry in Replacements.Entries()) {
                var resolved=false;
                try {Replacements.AssertEntryReadable(entry,persist:false);if(entry.Resolution is null)continue;resolved=true;}catch(RetainedFileReplacement.RequiredException){}
                var inspection=Replacements.Inspect(entry);
                var visible=ReplacementVisible(entry);
                result.Add(new(entry.Operation.ToString("D"),visible.Path,entry.ItemId,visible.Hash,inspection.PreparedHash,inspection.DisplacedHash,
                    Directory.GetCreationTimeUtc(inspection.Recovery.Directory).ToString("O"),resolved));
            }
            return result;
        }
    }
    public ReplacementRecoveryFile ReplacementRecoveryRead(string id,string version)
    {
        lock(gate) {
            if(!Guid.TryParseExact(id,"D",out var operation))throw new InvalidDataException("Invalid replacement identity.");
            var entry=Replacements.Entries().SingleOrDefault(entry=>entry.Operation==operation)??throw new InvalidDataException("Unknown replacement.");
            var inspection=Replacements.Inspect(entry);var visible=ReplacementVisible(entry);
            var bytes=version switch{"current"=>visible.Data,"prepared"=>inspection.Prepared,"displaced"=>inspection.Displaced,_=>throw new InvalidDataException("Unknown replacement version.")};
            string identity;
            try {identity=Identity(bytes);}
            catch(Exception error)when(version=="displaced"&&error is IOException or InvalidDataException or System.Text.Json.JsonException) {
                return new(visible.Path,Hash(bytes),"",bytes,true,"This retained file cannot be opened as a TextText document. Download its exact bytes for recovery.");
            }
            if(version!="displaced"&&identity!=entry.ItemId)throw new InvalidDataException("Retained replacement identity changed.");
            return new(visible.Path,Hash(bytes),identity,bytes);
        }
    }
    public void ResolveReplacement(string id,string path,string itemId,string currentHash,string preparedHash,string displacedHash,Action? beforeAcknowledge=null)
    {
        lock(gate) {
            if(!Guid.TryParseExact(id,"D",out var operation))throw new InvalidDataException("Invalid replacement identity.");
            var entry=Replacements.Entries().SingleOrDefault(entry=>entry.Operation==operation)??throw new InvalidDataException("Unknown replacement.");
            var visible=ReplacementVisible(entry);
            if(visible.Path!=path||visible.ItemId!=itemId||visible.Hash!=currentHash)throw new FileChangedException();
            Replacements.ResolveKeepCurrent(operation,itemId,path,new(currentHash,preparedHash,displacedHash),beforeAcknowledge);
        }
        Changed?.Invoke();
    }
}
