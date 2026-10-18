namespace TextText.Core;

/// The moved inode remains visible. The observed destination is an immutable
/// snapshot, never represented as a hidden retained inode or rolled back.
public static class RetainedFileMove
{
    internal static bool CaseOnlyPaths(string source,string target)=>Path.GetDirectoryName(source)==Path.GetDirectoryName(target)&&Path.GetFileName(source)!=Path.GetFileName(target)&&string.Equals(Path.GetFileName(source),Path.GetFileName(target),StringComparison.OrdinalIgnoreCase);
    internal static bool ExactLeafExists(string path)
    {
        RetainedFileReplacement.CheckPath(path);var parent=Path.GetDirectoryName(Path.GetFullPath(path))!;
        return Directory.Exists(parent)&&Directory.EnumerateFileSystemEntries(parent).Any(entry=>Path.GetFileName(entry)==Path.GetFileName(path));
    }
    internal static string ExistingPhysicalLeaf(string path)
    {
        RetainedFileReplacement.CheckPath(path);if(!File.Exists(path))return path;
        var requested=Path.GetFileName(path);var candidates=new List<string>();var visited=0;
        foreach(var entry in Directory.EnumerateFileSystemEntries(Path.GetDirectoryName(Path.GetFullPath(path))!)) {
            if(++visited>20000)throw new InvalidDataException("Too many files to inspect the actual filename safely.");
            var name=Path.GetFileName(entry);if(name==requested)return path;
            if(string.Equals(name,requested,StringComparison.OrdinalIgnoreCase))candidates.Add(entry);
        }
        if(candidates.Count!=1)throw new IOException("The actual filename could not be verified.");
        var actual=candidates[0];RetainedFileReplacement.CheckPath(actual);
        if(OperatingSystem.IsWindows()) {
            var logical=RetainedFileReplacement.Fingerprint(path);var physical=RetainedFileReplacement.Fingerprint(actual);
            if(logical is null||physical is null||logical.Volume!=physical.Volume||logical.FileId!=physical.FileId)throw new IOException("The filename alias does not identify the same file.");
        }
        return actual;
    }
    internal static bool IsCaseOnlyAlias(string source,string target)
    {
        if(!CaseOnlyPaths(source,target)||!RetainedFileReplacement.ExistsNoFollow(target)||!ExactLeafExists(source)||ExactLeafExists(target))return false;
        if(!OperatingSystem.IsWindows())return true; // Portable fixture: one exact directory entry resolving both aliases.
        var first=RetainedFileReplacement.Fingerprint(source);var second=RetainedFileReplacement.Fingerprint(target);
        return first is not null&&second is not null&&first.Volume==second.Volume&&first.FileId==second.FileId;
    }
    public static RetainedFileReplacement.Recovery Move(string source,string target,string sourcePath,string expectedHash,string recoveryRoot,Guid operation,string leasePath,Action<string>? observe=null,bool caseOnly=false)
    {
        RetainedFileReplacement.CheckPath(source);
        var before=RetainedFileReplacement.ReadVerified(source);if(TextPackStore.Hash(before)!=expectedHash)throw new FileChangedException();
        if(caseOnly?!IsCaseOnlyAlias(source,target):RetainedFileReplacement.ExistsNoFollow(target))throw new IOException("Destination exists or its case alias cannot be verified.");
        Directory.CreateDirectory(Path.GetDirectoryName(target)!);RetainedFileReplacement.CheckPath(target);
        RetainedFileReplacement.RequireSpace(target,before.Length);
        var directory=RetainedFileReplacement.OperationDirectory(target,operation,recoveryRoot);
        if(Directory.Exists(directory)||File.Exists(directory))throw new IOException("Move operation already exists.");
        Directory.CreateDirectory(directory);
        using var lease=RetainedFileReplacement.AcquireLease(leasePath);
        var record=new RetainedFileReplacement.Manifest(1,operation,Path.GetFileName(target),expectedHash,expectedHash,"pending",Kind:"move",SourcePath:sourcePath,CaseOnly:caseOnly?true:null);
        var recovery=new RetainedFileReplacement.Recovery(directory,record);
        RetainedFileReplacement.Create(recovery.Prepared,before);RetainedFileReplacement.SaveJson(Path.Combine(directory,"manifest.json"),record,creating:true);
        Directory.CreateDirectory(Path.GetDirectoryName(target)!);
        using var parents=RetainedFileReplacement.PinParents(source,target,recovery.Displaced);
        if(OperatingSystem.IsWindows()) {
            var from=RetainedFileReplacement.Fingerprint(source);var destination=RetainedFileReplacement.Fingerprint(Path.GetDirectoryName(target)!);
            if(from is null||destination is null||from.Volume!=destination.Volume)throw new IOException("Moving between these drives cannot preserve this file safely.");
        }
        observe?.Invoke("prepared");
        if(TextPackStore.Hash(RetainedFileReplacement.ReadVerified(source))!=expectedHash||(caseOnly?!IsCaseOnlyAlias(source,target):RetainedFileReplacement.ExistsNoFollow(target)))throw new RetainedFileReplacement.RequiredException(operation);
        observe?.Invoke("beforeMove");
        RetainedFileReplacement.CheckPath(source);RetainedFileReplacement.CheckPath(target);
        File.Move(source,target,overwrite:false);observe?.Invoke("moved");
        if(caseOnly&&!ExactLeafExists(target))throw new RetainedFileReplacement.RequiredException(operation);
        var actual=RetainedFileReplacement.ReadVerified(target);RetainedFileReplacement.Create(recovery.Displaced,actual);
        observe?.Invoke("observed");
        var valid=TextPackStore.Hash(actual)==expectedHash&&RetainedFileReplacement.ReadVerified(target).SequenceEqual(actual)&&!(caseOnly?ExactLeafExists(source):RetainedFileReplacement.ExistsNoFollow(source));
        record=record with{State=valid?"completed":"conflict"};RetainedFileReplacement.SaveJson(Path.Combine(directory,"manifest.json"),record);
        if(!valid)throw new RetainedFileReplacement.RequiredException(operation);
        return recovery with{Record=record};
    }
}
