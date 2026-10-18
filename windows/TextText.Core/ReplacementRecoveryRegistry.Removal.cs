using System.Text.Json;
namespace TextText.Core;

public sealed partial class ReplacementRecoveryRegistry
{
    internal string CaptureLeasePath(Guid operation)=>Path.Combine(stateDirectory,"replacement-capture-leases",operation.ToString("D")+".lock");
    internal IDisposable AcquireCaptureLease(Guid operation)=>RetainedFileReplacement.AcquireLease(CaptureLeasePath(operation));
    IDisposable RequireCaptureLease(Guid operation){try{return AcquireCaptureLease(operation);}catch(IOException){throw new RetainedFileReplacement.RequiredException(operation);}}
    internal IReadOnlyList<(string Path,byte[] Bytes)> RemovalIdentityMatches(Entry entry,bool strict=false)
    {
        var result=new List<(string,byte[])>();var visited=0;var authoritative=RetainedFileMove.ExistingPhysicalLeaf(Target(entry));
        void Visit(string parent) {
            RetainedFileReplacement.CheckPath(parent);
            foreach(var full in Directory.EnumerateFileSystemEntries(parent)) {
                if(Path.GetFileName(full).StartsWith('.'))continue;
                if(full==authoritative)continue;
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
    internal (FileIntent Intent,byte[] Bytes) RequireBoundDeletionMarker(string itemId)
    {
        var bytes=RetainedFileReplacement.Read(Path.Combine(stateDirectory,"intent-"+itemId+".json"),8192);
        try {
            RetainedFileReplacement.JsonFields(bytes,["Kind","ItemId","Path","Hash","Destination","OperationId"],["Kind","ItemId","Path","Hash","OperationId"]);
            var intent=JsonSerializer.Deserialize<FileIntent>(bytes)??throw new InvalidDataException("Invalid deletion marker.");
            if(intent.Kind!="delete"||intent.ItemId!=itemId||intent.OperationId is null||!Guid.TryParseExact(intent.OperationId,"D",out var operation)||operation==Guid.Empty||!RetainedFileReplacement.ValidHash(intent.Hash))throw new InvalidDataException("An existing deletion marker is not bound to a known operation.");
            return(intent,bytes);
        } catch(JsonException error){throw new InvalidDataException("Invalid deletion marker.",error);}
    }
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
        if(restored)removalObservation?.Invoke("restorationObserved");
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
                if(existing?.Kind=="delete") {
                    var bound=RequireBoundDeletionMarker(entry.ItemId);
                    if(Guid.Parse(bound.Intent.OperationId!)==entry.Operation&&bound.Intent.Path==entry.Path&&bound.Intent.Hash==entry.ExpectedHash&&RetainedFileReplacement.Read(marker,8192).SequenceEqual(bound.Bytes))File.Delete(marker);
                }
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
            if(existing?.Kind=="delete") {
                var bound=RequireBoundDeletionMarker(entry.ItemId);var prior=Guid.Parse(bound.Intent.OperationId!);
                if(prior!=entry.Operation) {
                    var other=Entries(entry.ItemId).SingleOrDefault(item=>item.Operation==prior)??throw new InvalidDataException("The other deletion marker has no registry operation.");
                    if(other.Kind!="removal"||other.UserDeletion!=true||other.DeletionMarkerPublished!=true||other.DeletionIntentCancelled==true||other.Path!=bound.Intent.Path||other.ExpectedHash!=bound.Intent.Hash||RetainedFileReplacement.ExistsNoFollow(Target(other)))throw new InvalidDataException("The other deletion marker cannot prove completion.");
                    var proof=RecoveryFor(other);
                    if(other.Resolution is {} consent){if(consent.CurrentPresent!=false||consent.CurrentHash is not null)throw new InvalidDataException("The other deletion was not consented as absent.");}
                    else if(proof.Record.State!="completed")throw new InvalidDataException("The other deletion is incomplete.");
                    AssertEntryReadable(other,persist:false);
                    if(!RetainedFileReplacement.Read(marker,8192).SequenceEqual(bound.Bytes)||RetainedFileReplacement.ExistsNoFollow(Target(entry))||RetainedFileReplacement.ExistsNoFollow(Target(other)))throw new FileChangedException();
                    SaveEntry(latest with{DeletionIntentCancelled=true,SupersededBy=other.Operation});return;
                }
                if(bound.Intent.Path!=entry.Path||bound.Intent.Hash!=entry.ExpectedHash)throw new InvalidDataException("Deletion marker scope changed.");
                SaveEntry(latest with{DeletionMarkerPublished=true});return;
            }
            if(existing?.Kind!="rename")throw new InvalidDataException("Unknown pending file intent cannot be replaced.");
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
