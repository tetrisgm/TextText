namespace TextText.Core;

public sealed partial class TextPackStore
{
    ReplacementRecoveryRegistry Replacements => new(Root, StateDirectory,RemovalObservationForTesting);
    public void AssertReplacementReadable(string? itemId) { lock(gate) {AssertFolderRenameReadable();Replacements.AssertReadable(itemId);} }
    public void ValidateReplacementRegistry() { lock(gate) _=Replacements.Entries(); }
    public bool ReplacementBlocked(string itemId)
    {
        try {AssertReplacementReadable(itemId);return false;}catch(RetainedFileReplacement.RequiredException){return true;}catch(FolderCaseRename.RequiredException){return true;}
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
    public sealed record ReplacementRecoveryEntry(string Id, string Path, string ItemId, string? CurrentHash, string PreparedHash, string? DisplacedHash, string SavedAt,bool Resolved=false,string Kind="replacement",bool CurrentPresent=true,bool Captured=true,string? ResolutionBlocked=null,string? SourcePath=null,bool? SourcePresent=null,string? SourceHash=null);
    public sealed record ReplacementRecoveryFile(string Path, string? Hash, string ItemId, byte[]? Data, bool Opaque=false, string? ParseError=null,bool Absent=false);
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
    ReplacementRecoveryFile RecoveryCurrent(ReplacementRecoveryRegistry.Entry entry,bool strict=false)
    {
        if(entry.Kind!="removal")return ReplacementVisible(entry);
        var bytes=Replacements.RemovalCurrent(entry,refuseRelocation:strict);
        if(bytes is null)return new(entry.Path,null,entry.ItemId,null,Absent:true);
        try{return new(entry.Path,Hash(bytes),Identity(bytes),bytes);}
        catch(Exception error)when(error is IOException or InvalidDataException or System.Text.Json.JsonException){return new(entry.Path,Hash(bytes),"",bytes,true,"This current file cannot be opened as a TextText document. Download its exact bytes for recovery.");}
    }
    public IReadOnlyList<ReplacementRecoveryEntry> ReplacementRecoveryList()
    {
        lock(gate) {
            var result=new List<ReplacementRecoveryEntry>();
            foreach(var entry in Replacements.Entries()) {
                if(entry.Kind=="move") {var move=Replacements.InspectMove(entry);var moveResolved=entry.MoveResolution is not null;
                    var readable=true;try{Replacements.AssertMoveReadable(entry,false);}catch(RetainedFileReplacement.RequiredException){readable=false;moveResolved=false;}
                    if(!moveResolved&&readable&&move.Recovery.Record.State is "completed" or "cancelled")continue;
                    result.Add(new(entry.Operation.ToString("D"),entry.Path,entry.ItemId,move.Current is null?null:Hash(move.Current),entry.PreparedHash,move.Displaced is null?null:Hash(move.Displaced),Directory.GetCreationTimeUtc(move.Recovery.Directory).ToString("O"),moveResolved,"move",move.Current is not null,move.Captured,move.Blocked,entry.SourcePath,move.Source is not null,move.Source is null?null:Hash(move.Source)));continue;}
                if(entry.Kind=="removal"&&!Replacements.RemovalHasCapturedInode(entry)) {
                    var uncaptured=Replacements.InspectUncaptured(entry);
                    if(uncaptured.Recovery.Record.State=="cancelled"&&entry.UncapturedCancellation is null)continue;
                    var current=RecoveryCurrent(entry);var blocked=Replacements.RemovalIdentityMatches(entry).Any(pair=>pair.Path!=entry.Path)?"A duplicate or relocated document prevents resolution. Keep all files and resolve the ambiguity first.":null;
                    result.Add(new(entry.Operation.ToString("D"),entry.Path,entry.ItemId,current.Hash,entry.PreparedHash,null,Directory.GetCreationTimeUtc(uncaptured.Recovery.Directory).ToString("O"),entry.UncapturedCancellation is not null,"removal",!current.Absent,false,blocked));continue;
                }
                var resolved=false;
                try {Replacements.AssertEntryReadable(entry,persist:false);if(entry.Kind=="removal"&&!Replacements.RemovalHasCapturedInode(entry))continue;if(entry.Resolution is null){if(entry.Kind=="removal"&&entry.UserDeletion==true)resolved=entry.DeletionMarkerPublished==true||entry.DeletionIntentCancelled==true;else continue;}else resolved=true;}catch(RetainedFileReplacement.RequiredException){}
                var inspection=Replacements.Inspect(entry);
                var visible=RecoveryCurrent(entry);
                var resolutionBlocked=entry.Kind=="removal"&&Replacements.RemovalIdentityMatches(entry).Any(pair=>pair.Path!=entry.Path)?"A duplicate or relocated document prevents resolution. Keep all files and resolve the ambiguity first.":null;
                result.Add(new(entry.Operation.ToString("D"),visible.Path,entry.ItemId,visible.Hash,inspection.PreparedHash,inspection.DisplacedHash,
                    Directory.GetCreationTimeUtc(inspection.Recovery.Directory).ToString("O"),resolved,entry.Kind??"replacement",!visible.Absent,true,resolutionBlocked));
            }
            return result;
        }
    }
    public ReplacementRecoveryFile ReplacementRecoveryRead(string id,string version)
    {
        lock(gate) {
            if(!Guid.TryParseExact(id,"D",out var operation))throw new InvalidDataException("Invalid replacement identity.");
            var entry=Replacements.Entries().SingleOrDefault(entry=>entry.Operation==operation)??throw new InvalidDataException("Unknown replacement.");
            if(entry.Kind=="move") {
                var move=Replacements.InspectMove(entry);var moveBytes=version switch{"current"=>move.Current,"source"=>move.Source,"prepared"=>move.Prepared,"displaced"=>move.Displaced,_=>throw new InvalidDataException("Unknown move version.")};
                var selectedPath=version=="source"?entry.SourcePath!:entry.Path;
                if(moveBytes is null)return new(selectedPath,null,entry.ItemId,null,Absent:true);
                try{var moveIdentity=Identity(moveBytes);if(version=="prepared"&&moveIdentity!=entry.ItemId)throw new InvalidDataException("Move baseline identity changed.");return new(selectedPath,Hash(moveBytes),moveIdentity,moveBytes);}
                catch(Exception error)when(version!="prepared"&&error is IOException or InvalidDataException or System.Text.Json.JsonException or System.Text.DecoderFallbackException){return new(selectedPath,Hash(moveBytes),"",moveBytes,true,"This retained file cannot be opened as a TextText document. Download its exact bytes for recovery.");}
            }
            var visible=RecoveryCurrent(entry);
            if(entry.Kind=="removal"&&!Replacements.RemovalHasCapturedInode(entry)) {
                var uncaptured=Replacements.InspectUncaptured(entry);
                if(version=="current")return visible;
                if(version=="displaced")return new(entry.Path,null,entry.ItemId,null,Absent:true);
                if(version!="prepared")throw new InvalidDataException("Unknown replacement version.");
                return new(entry.Path,entry.PreparedHash,Identity(uncaptured.Prepared),uncaptured.Prepared);
            }
            var inspection=Replacements.Inspect(entry);
            if(version=="current"&&visible.Absent)return visible;
            var bytes=version switch{"current"=>visible.Data!,"prepared"=>inspection.Prepared,"displaced"=>inspection.Displaced,_=>throw new InvalidDataException("Unknown replacement version.")};
            string identity;
            try {identity=Identity(bytes);}
            catch(Exception error)when((version=="displaced"||entry.Kind=="removal"&&version=="current")&&error is IOException or InvalidDataException or System.Text.Json.JsonException) {
                return new(visible.Path,Hash(bytes),"",bytes,true,"This retained file cannot be opened as a TextText document. Download its exact bytes for recovery.");
            }
            if(version!="displaced"&&!(entry.Kind=="removal"&&version=="current")&&identity!=entry.ItemId)throw new InvalidDataException("Retained replacement identity changed.");
            return new(visible.Path,Hash(bytes),identity,bytes);
        }
    }
    public void ResolveReplacement(string id,string path,string itemId,string? currentHash,string preparedHash,string displacedHash,Action? beforeAcknowledge=null,bool currentPresent=true,string kind="replacement")
    {
        lock(gate) {
            if(!Guid.TryParseExact(id,"D",out var operation))throw new InvalidDataException("Invalid replacement identity.");
            var entry=Replacements.Entries().SingleOrDefault(entry=>entry.Operation==operation)??throw new InvalidDataException("Unknown replacement.");
            var visible=RecoveryCurrent(entry,strict:true);
            if(entry.ItemId!=itemId||(entry.Kind??"replacement")!=kind||visible.Path!=path||!visible.Absent!=currentPresent||visible.Hash!=currentHash)throw new FileChangedException();
            Replacements.ResolveKeepCurrent(operation,itemId,path,new(currentHash,preparedHash,displacedHash,CurrentPresent:currentPresent),beforeAcknowledge);
        }
        Changed?.Invoke();
    }
    public void ResolveMove(string id,string path,string sourcePath,string itemId,string preparedHash,string? displacedHash,bool captured,bool currentPresent,string? currentHash,bool sourcePresent,string? sourceHash,Action? beforeAcknowledge=null)
    {
        lock(gate){if(!Guid.TryParseExact(id,"D",out var operation))throw new InvalidDataException("Invalid move identity.");Replacements.ResolveMove(operation,path,sourcePath,itemId,new(preparedHash,displacedHash,captured,currentPresent,currentHash,sourcePresent,sourceHash),beforeAcknowledge);}
        Changed?.Invoke();
    }
    public void CancelUncapturedDeletion(string id,string path,string itemId,string preparedHash,bool currentPresent,string? currentHash,Action? beforeAcknowledge=null)
    {
        lock(gate) {
            if(!Guid.TryParseExact(id,"D",out var operation))throw new InvalidDataException("Invalid deletion identity.");
            Replacements.CancelUncapturedDeletion(operation,path,itemId,preparedHash,currentPresent,currentHash,beforeAcknowledge);
        }
        Changed?.Invoke();
    }

}
