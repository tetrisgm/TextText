using System.Text.Json;
namespace TextText.Core;

public sealed partial class ReplacementRecoveryRegistry
{
    internal string CaptureLeasePath(Guid operation)=>Path.Combine(stateDirectory,"replacement-capture-leases",operation.ToString("D")+".lock");
    internal IDisposable AcquireCaptureLease(Guid operation)=>RetainedFileReplacement.AcquireLease(CaptureLeasePath(operation));
    IDisposable RequireCaptureLease(Guid operation){try{return AcquireCaptureLease(operation);}catch(IOException){throw new RetainedFileReplacement.RequiredException(operation);}}
    internal IReadOnlyList<(string Path,byte[] Bytes)> RemovalIdentityMatches(Entry entry,bool strict=false)
    {
        var result=new List<(string,byte[])>();var visited=0;
        void Visit(string parent) {
            RetainedFileReplacement.CheckPath(parent);
            foreach(var full in Directory.EnumerateFileSystemEntries(parent)) {
                if(Path.GetFileName(full).StartsWith('.'))continue;
                if(Path.GetRelativePath(root,full).Replace('\\','/')==entry.Path)continue;
                if(++visited>20000)throw new InvalidDataException("Too many files to inspect removal safely.");
                try{RetainedFileReplacement.CheckPath(full);}catch(IOException)when(!strict){continue;}
                if(Directory.Exists(full)){Visit(full);continue;}
                if(!full.EndsWith(".textpack",StringComparison.OrdinalIgnoreCase))continue;
                try {var bytes=RetainedFileReplacement.Read(full);if(TextPackStore.Identity(bytes)==entry.ItemId)result.Add((Path.GetRelativePath(root,full).Replace('\\','/'),bytes));}
                catch(Exception error)when(!strict&&error is IOException or InvalidDataException or JsonException){}
            }
        }
        Visit(root);return result;
    }
    internal byte[]? RemovalCurrent(Entry entry,bool refuseRelocation=true)
    {
        Validate(entry);if(entry.Kind!="removal")throw new InvalidDataException("Not a retained removal.");
        var target=Target(entry);var present=RetainedFileReplacement.ExistsNoFollow(target);
        var matches=RemovalIdentityMatches(entry,strict:refuseRelocation).ToArray();
        if(refuseRelocation&&matches.Length!=0)throw new InvalidDataException("A duplicate or relocated document prevents removal recovery. Keep all files and resolve the ambiguity first.");
        return present?RetainedFileReplacement.Read(target):null;
    }
    internal bool RemovalHasCapturedInode(Entry entry)=>RetainedFileReplacement.ExistsNoFollow(RecoveryFor(entry).Displaced);
    RetainedFileReplacement.Recovery? CancelRenamedUncaptured(Entry entry,RetainedFileReplacement.Recovery recovery)
    {
        if(entry.Kind!="removal"||recovery.Record.State!="pending"||RetainedFileReplacement.ExistsNoFollow(recovery.Displaced)||RetainedFileReplacement.ExistsNoFollow(Target(entry)))return null;
        var matches=RemovalIdentityMatches(entry,strict:true);
        if(matches.Count==0)return null;
        if(matches.Count!=1||TextPackStore.Hash(matches[0].Bytes)!=entry.ExpectedHash)throw new RetainedFileReplacement.RequiredException(entry.Operation);
        if(RetainedFileReplacement.ExistsNoFollow(Target(entry)))throw new FileChangedException();
        return RetainedFileRemoval.CancelUncaptured(recovery,Path.Combine(root,matches[0].Path));
    }
    void SaveEntry(Entry entry) {Validate(entry);Invalidate();RetainedFileReplacement.SaveJson(Path.Combine(directory,entry.Operation.ToString("D")+".json"),entry);Invalidate();}
    internal void MarkDeletionConsumed(FileIntent intent)
    {
        if(intent.OperationId is null)return;
        if(!Guid.TryParseExact(intent.OperationId,"D",out var operation))throw new InvalidDataException("Invalid removal marker operation.");
        var entry=Entries(intent.ItemId).SingleOrDefault(item=>item.Operation==operation)??throw new InvalidDataException("Removal marker registry is unavailable.");
        if(entry.Kind!="removal"||entry.UserDeletion!=true||entry.Path!=intent.Path||entry.ExpectedHash!=intent.Hash||intent.Kind!="delete")throw new InvalidDataException("Removal marker does not match its operation.");
        if(entry.DeletionMarkerPublished!=true)SaveEntry(entry with{DeletionMarkerPublished=true});
    }
    void RestoreDeletionMarker(Entry entry,RetainedFileReplacement.Recovery recovery)
    {
        if(entry.Kind!="removal"||entry.UserDeletion!=true||entry.DeletionMarkerPublished==true||entry.DeletionIntentCancelled==true)return;
        var current=RetainedFileReplacement.ExistsNoFollow(Target(entry));
        var matches=RemovalIdentityMatches(entry);
        if(matches.Count>1)throw new InvalidDataException("Duplicate document identity prevents removal publication.");
        var restored=current||matches.Count==1;
        using var publication=TextPackStore.DeletionPublication(stateDirectory);
        var latest=Entries(entry.ItemId).Single(item=>item.Operation==entry.Operation);
        if(latest.DeletionMarkerPublished==true||latest.DeletionIntentCancelled==true)return;
        var marker=Path.Combine(stateDirectory,"intent-"+entry.ItemId+".json");
        current=RetainedFileReplacement.ExistsNoFollow(Target(entry));matches=RemovalIdentityMatches(entry);
        if(matches.Count>1)throw new InvalidDataException("Duplicate document identity prevents removal publication.");
        restored=current||matches.Count==1;
        if(restored) {
            SaveEntry(latest with{DeletionIntentCancelled=true});
            if(File.Exists(marker)) {
                var existing=JsonSerializer.Deserialize<FileIntent>(RetainedFileReplacement.Read(marker,8192));
                if(existing?.OperationId==entry.Operation.ToString("D"))File.Delete(marker);
            }
            return;
        }
        if(RetainedFileReplacement.ExistsNoFollow(Target(entry))||RemovalIdentityMatches(entry).Count!=0)return;
        if(entry.Resolution is {} resolution) {if(resolution.CurrentPresent!=false||resolution.CurrentHash is not null)return;}
        else if(recovery.Record.State!="completed")return;
        var inspection=Inspect(latest);var destination=Path.Combine(stateDirectory,"recovery");Directory.CreateDirectory(destination);RetainedFileReplacement.CheckPath(destination);
        foreach(var bytes in new[]{inspection.Prepared,inspection.Displaced}) {
            var saved=Path.Combine(destination,"trash-"+entry.Operation.ToString("D")+"-"+TextPackStore.Hash(bytes)+".textpack");
            if(File.Exists(saved)){if(!RetainedFileReplacement.Read(saved).SequenceEqual(bytes))throw new FileChangedException();}
            else RetainedFileReplacement.Create(saved,bytes);
        }
        var verified=Inspect(latest);Validate(latest);
        if(verified.PreparedHash!=inspection.PreparedHash||verified.DisplacedHash!=inspection.DisplacedHash||RetainedFileReplacement.ExistsNoFollow(Target(entry))||RemovalIdentityMatches(entry).Count!=0)throw new FileChangedException();
        if(File.Exists(marker)) {
            var existing=JsonSerializer.Deserialize<FileIntent>(RetainedFileReplacement.Read(marker,8192));
            if(existing?.OperationId is {} prior&&prior!=entry.Operation.ToString("D"))throw new RetainedFileReplacement.RequiredException(entry.Operation);
        }
        RetainedFileReplacement.SaveJson(marker,new FileIntent("delete",entry.ItemId,entry.Path,entry.ExpectedHash,OperationId:entry.Operation.ToString("D")));
        removalObservation?.Invoke("markerWritten");
        SaveEntry(latest with{DeletionMarkerPublished=true});
    }
    internal sealed record UncapturedInspection(Entry Entry,RetainedFileReplacement.Recovery Recovery,byte[] Prepared,RetainedFileReplacement.Stamp? PreparedStamp);
    internal UncapturedInspection InspectUncaptured(Entry entry)
    {
        Validate(entry);var recovery=RecoveryFor(entry);
        if(entry.Kind!="removal"||recovery.Record.Kind!="removal"||recovery.Record.State is not ("pending" or "cancelled")||RetainedFileReplacement.ExistsNoFollow(recovery.Displaced)||recovery.Record.ExpectedHash!=entry.ExpectedHash||recovery.Record.PreparedHash!=entry.PreparedHash)throw new InvalidDataException("Deletion has already captured an inode or changed scope.");
        var before=RetainedFileReplacement.Fingerprint(recovery.Prepared);var bytes=RetainedFileReplacement.Read(recovery.Prepared);
        if(TextPackStore.Hash(bytes)!=entry.PreparedHash||before!=RetainedFileReplacement.Fingerprint(recovery.Prepared))throw new FileChangedException();
        return new(entry,recovery,bytes,before);
    }
    internal void CancelUncapturedDeletion(Guid operation,string path,string itemId,string preparedHash,bool currentPresent,string? currentHash,Action? beforeAcknowledge=null)
    {
        using var lease=RequireCaptureLease(operation);
        var entry=Entries(itemId).SingleOrDefault(item=>item.Operation==operation)??throw new InvalidDataException("Unknown deletion operation.");
        if(entry.Kind!="removal"||entry.Path!=path||entry.ItemId!=itemId||entry.PreparedHash!=preparedHash)throw new InvalidDataException("Deletion cancellation scope changed.");
        var inspection=InspectUncaptured(entry);
        void Verify() {var bytes=RemovalCurrent(entry);if((bytes is not null)!=currentPresent||(bytes is null?null:TextPackStore.Hash(bytes))!=currentHash)throw new FileChangedException();}
        Verify();var current=RemovalCurrent(entry);var destination=Path.Combine(stateDirectory,"recovery","uncaptured-"+operation.ToString("D"));Directory.CreateDirectory(destination);RetainedFileReplacement.CheckPath(destination);
        foreach(var bytes in current is null?new[]{inspection.Prepared}:new[]{inspection.Prepared,current}) {
            var saved=Path.Combine(destination,TextPackStore.Hash(bytes)+".textpack");
            if(File.Exists(saved)){if(!RetainedFileReplacement.Read(saved).SequenceEqual(bytes))throw new FileChangedException();}else RetainedFileReplacement.Create(saved,bytes);
        }
        var latest=InspectUncaptured(entry);Verify();Validate(entry);
        if(!inspection.Prepared.SequenceEqual(latest.Prepared))throw new FileChangedException();
        beforeAcknowledge?.Invoke();
        var receipt=new UncapturedCancellation(preparedHash,currentHash,currentPresent,latest.PreparedStamp);
        SaveEntry(entry with{UncapturedCancellation=receipt,DeletionIntentCancelled=entry.UserDeletion==true?true:entry.DeletionIntentCancelled});
        removalObservation?.Invoke("uncapturedCancellationPreserved");
        RetainedFileReplacement.SaveJson(Path.Combine(latest.Recovery.Directory,"manifest.json"),latest.Recovery.Record with{State="cancelled"});
    }

}
