namespace TextText.Core;

/// The moved inode remains visible. The observed destination is an immutable
/// snapshot, never represented as a hidden retained inode or rolled back.
public static class RetainedFileMove
{
    public static RetainedFileReplacement.Recovery Move(string source,string target,string sourcePath,string expectedHash,string recoveryRoot,Guid operation,string leasePath,Action<string>? observe=null)
    {
        RetainedFileReplacement.CheckPath(source);
        var before=RetainedFileReplacement.ReadVerified(source);if(TextPackStore.Hash(before)!=expectedHash)throw new FileChangedException();
        if(RetainedFileReplacement.ExistsNoFollow(target))throw new IOException("Destination exists.");
        Directory.CreateDirectory(Path.GetDirectoryName(target)!);RetainedFileReplacement.CheckPath(target);
        RetainedFileReplacement.RequireSpace(target,before.Length);
        var directory=RetainedFileReplacement.OperationDirectory(target,operation,recoveryRoot);
        if(Directory.Exists(directory)||File.Exists(directory))throw new IOException("Move operation already exists.");
        Directory.CreateDirectory(directory);
        using var lease=RetainedFileReplacement.AcquireLease(leasePath);
        var record=new RetainedFileReplacement.Manifest(1,operation,Path.GetFileName(target),expectedHash,expectedHash,"pending",Kind:"move",SourcePath:sourcePath);
        var recovery=new RetainedFileReplacement.Recovery(directory,record);
        RetainedFileReplacement.Create(recovery.Prepared,before);RetainedFileReplacement.SaveJson(Path.Combine(directory,"manifest.json"),record,creating:true);
        Directory.CreateDirectory(Path.GetDirectoryName(target)!);
        using var parents=RetainedFileReplacement.PinParents(source,target,recovery.Displaced);
        if(OperatingSystem.IsWindows()) {
            var from=RetainedFileReplacement.Fingerprint(source);var destination=RetainedFileReplacement.Fingerprint(Path.GetDirectoryName(target)!);
            if(from is null||destination is null||from.Volume!=destination.Volume)throw new IOException("Moving between these drives cannot preserve this file safely.");
        }
        observe?.Invoke("prepared");
        if(TextPackStore.Hash(RetainedFileReplacement.ReadVerified(source))!=expectedHash||RetainedFileReplacement.ExistsNoFollow(target))throw new RetainedFileReplacement.RequiredException(operation);
        observe?.Invoke("beforeMove");
        RetainedFileReplacement.CheckPath(source);RetainedFileReplacement.CheckPath(target);
        File.Move(source,target,overwrite:false);observe?.Invoke("moved");
        var actual=RetainedFileReplacement.ReadVerified(target);RetainedFileReplacement.Create(recovery.Displaced,actual);
        observe?.Invoke("observed");
        var valid=TextPackStore.Hash(actual)==expectedHash&&RetainedFileReplacement.ReadVerified(target).SequenceEqual(actual)&&!RetainedFileReplacement.ExistsNoFollow(source);
        record=record with{State=valid?"completed":"conflict"};RetainedFileReplacement.SaveJson(Path.Combine(directory,"manifest.json"),record);
        if(!valid)throw new RetainedFileReplacement.RequiredException(operation);
        return recovery with{Record=record};
    }
}
