namespace TextText.Core;

public sealed partial class ReplacementRecoveryRegistry
{
    internal sealed record MoveInspection(Entry Entry,RetainedFileReplacement.Recovery Recovery,byte[] Prepared,byte[]? Displaced,byte[]? Current,byte[]? Source,string? Blocked)
    {public bool Captured=>Displaced is not null;}
    static string? MoveHash(byte[]? bytes)=>bytes is null?null:TextPackStore.Hash(bytes);
    static bool PresenceHash(bool present,string? hash)=>present?hash is not null&&RetainedFileReplacement.ValidHash(hash):hash is null;
    static void ValidateMoveConsent(Entry entry,MoveConsent consent)
    {
        if(consent.PreparedHash!=entry.PreparedHash||!PresenceHash(consent.Captured,consent.DisplacedHash)||!PresenceHash(consent.CurrentPresent,consent.CurrentHash)||!PresenceHash(consent.SourcePresent,consent.SourceHash))throw new InvalidDataException("Invalid move resolution receipt.");
    }
    byte[]? MoveBytes(string path)
    {
        using var parents=RetainedFileReplacement.PinParents(path);
        return RetainedFileReplacement.ExistsNoFollow(path)?RetainedFileReplacement.ReadVerified(path):null;
    }
    internal void AssertPathReadable(string path)
    {
        var verified=new HashSet<string>(StringComparer.Ordinal);
        foreach(var entry in ReadEntries(null,verified,path))AssertMoveReadable(entry,true);
    }
    IReadOnlyList<string> MoveIdentityMatches(Entry entry,bool strict)
    {
        var matches=new List<string>();var visited=0;
        void Visit(string parent){
            RetainedFileReplacement.CheckPath(parent);
            foreach(var full in Directory.EnumerateFileSystemEntries(parent)) {
                if(Path.GetFileName(full).StartsWith('.'))continue;
                var relative=Path.GetRelativePath(root,full).Replace('\\','/');
                if(SameMovePath(relative,entry.Path)||SameMovePath(relative,entry.SourcePath))continue;
                if(++visited>20000)throw new InvalidDataException("Too many files to inspect move identity safely.");
                try{RetainedFileReplacement.CheckPath(full);}catch(IOException)when(!strict){continue;}
                if(Directory.Exists(full)){Visit(full);continue;}
                if(!full.EndsWith(".textpack",StringComparison.OrdinalIgnoreCase))continue;
                try {var bytes=MoveBytes(full)!;if(TextPackStore.Identity(bytes)==entry.ItemId)matches.Add(relative);}
                catch(Exception error)when(!strict&&error is IOException or InvalidDataException or System.Text.Json.JsonException or System.Text.DecoderFallbackException){}
            }
        }
        Visit(root);return matches;
    }
    static bool MoveExpectedIdentity(byte[]? bytes,string itemId)
    {
        if(bytes is null)return false;
        try{return TextPackStore.Identity(bytes)==itemId;}
        catch(Exception error)when(error is IOException or InvalidDataException or System.Text.Json.JsonException or System.Text.DecoderFallbackException){return false;}
    }
    internal MoveInspection InspectMove(Entry entry,bool strict=false)
    {
        Validate(entry);if(entry.Kind!="move"||entry.SourcePath is null)throw new InvalidDataException("Not a retained move.");
        var recovery=RecoveryFor(entry);
        if(recovery.Record.Kind!="move"||recovery.Record.SourcePath!=entry.SourcePath||recovery.Record.PreparedHash!=entry.PreparedHash||recovery.Record.ExpectedHash!=entry.ExpectedHash)throw new InvalidDataException("Move manifest scope changed.");
        var prepared=MoveBytes(recovery.Prepared)??throw new InvalidDataException("Move baseline is missing.");if(TextPackStore.Hash(prepared)!=entry.PreparedHash)throw new InvalidDataException("Move baseline changed.");
        var displaced=MoveBytes(recovery.Displaced);var current=MoveBytes(Target(entry));var source=MoveBytes(Target(entry with{Path=entry.SourcePath}));
        var matches=MoveIdentityMatches(entry,strict);
        var identities=matches.Count+(MoveExpectedIdentity(current,entry.ItemId)?1:0)+(MoveExpectedIdentity(source,entry.ItemId)?1:0);
        var blocked=matches.Count>0||identities>1?"A duplicate or relocated document prevents move resolution. Keep all files and resolve the ambiguity first.":null;
        return new(entry,recovery,prepared,displaced,current,source,blocked);
    }
    internal void AssertMoveReadable(Entry entry,bool persist)
    {
        var recovery=RecoveryFor(entry);
        if(recovery.Record.Kind!="move"||recovery.Record.SourcePath!=entry.SourcePath||recovery.Record.PreparedHash!=entry.PreparedHash||recovery.Record.ExpectedHash!=entry.ExpectedHash)throw new InvalidDataException("Move manifest scope changed.");
        var prepared=MoveBytes(recovery.Prepared)??throw new InvalidDataException("Move baseline is missing.");
        if(TextPackStore.Hash(prepared)!=entry.PreparedHash)throw new RetainedFileReplacement.RequiredException(entry.Operation);
        var displaced=MoveBytes(recovery.Displaced);
        if(entry.MoveResolution is {} resolution) {
            if(MoveHash(displaced)!=resolution.DisplacedHash)throw new RetainedFileReplacement.RequiredException(entry.Operation);
            return;
        }
        if(recovery.Record.State=="completed") {
            if(MoveHash(displaced)!=entry.ExpectedHash)throw new RetainedFileReplacement.RequiredException(entry.Operation);
            return;
        }
        if(recovery.Record.State=="cancelled"){if(displaced is not null)throw new RetainedFileReplacement.RequiredException(entry.Operation);return;}
        if(!persist)throw new RetainedFileReplacement.RequiredException(entry.Operation);
        using var lease=RequireCaptureLease(entry.Operation);
        var inspection=InspectMove(entry);
        if(inspection.Blocked is not null)throw new RetainedFileReplacement.RequiredException(entry.Operation);
        if(inspection.Displaced is null&&inspection.Current is null&&MoveHash(inspection.Source)==entry.ExpectedHash) {
            RetainedFileReplacement.SaveJson(Path.Combine(recovery.Directory,"manifest.json"),recovery.Record with{State="cancelled"});return;
        }
        if(inspection.Source is null&&MoveHash(inspection.Current)==entry.ExpectedHash) {
            if(inspection.Displaced is null)RetainedFileReplacement.Create(recovery.Displaced,inspection.Current!);
            else if(MoveHash(inspection.Displaced)!=entry.ExpectedHash)throw new RetainedFileReplacement.RequiredException(entry.Operation);
            var after=InspectMove(entry);if(after.Source is not null||MoveHash(after.Current)!=entry.ExpectedHash||after.Blocked is not null)throw new RetainedFileReplacement.RequiredException(entry.Operation);
            RetainedFileReplacement.SaveJson(Path.Combine(recovery.Directory,"manifest.json"),recovery.Record with{State="completed"});return;
        }
        throw new RetainedFileReplacement.RequiredException(entry.Operation);
    }
    static MoveConsent ObserveMove(MoveInspection inspection)=>new(TextPackStore.Hash(inspection.Prepared),MoveHash(inspection.Displaced),inspection.Captured,inspection.Current is not null,MoveHash(inspection.Current),inspection.Source is not null,MoveHash(inspection.Source));
    internal void ResolveMove(Guid operation,string path,string sourcePath,string itemId,MoveConsent observed,Action? beforeAcknowledge)
    {
        var entry=Entries(itemId).SingleOrDefault(entry=>entry.Operation==operation)??throw new InvalidDataException("Unknown move.");
        if(entry.Kind!="move"||entry.Path!=path||entry.SourcePath!=sourcePath||entry.ItemId!=itemId)throw new FileChangedException();
        using var lease=RequireCaptureLease(operation);using var parents=RetainedFileReplacement.PinParents(Target(entry),Target(entry with{Path=sourcePath}));
        ValidateMoveConsent(entry,observed);
        void Check(MoveInspection inspection){if(inspection.Blocked is not null)throw new InvalidDataException(inspection.Blocked);if(ObserveMove(inspection)!=observed)throw new FileChangedException();}
        var inspection=InspectMove(entry,strict:true);Check(inspection);
        var destination=Path.Combine(stateDirectory,"recovery","replacement-"+operation.ToString("D"));Directory.CreateDirectory(destination);RetainedFileReplacement.CheckPath(destination);
        foreach(var bytes in new[]{inspection.Prepared,inspection.Displaced,inspection.Current,inspection.Source}) {
            if(bytes is null)continue;var filename=Path.Combine(destination,TextPackStore.Hash(bytes)+".textpack");
            if(File.Exists(filename)){if(!RetainedFileReplacement.Read(filename).SequenceEqual(bytes))throw new FileChangedException();}else RetainedFileReplacement.Create(filename,bytes);
        }
        Check(InspectMove(entry,strict:true));beforeAcknowledge?.Invoke();Check(InspectMove(entry,strict:true));
        SaveEntry(entry with{MoveResolution=observed});
    }
}
