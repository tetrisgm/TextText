namespace TextText.Core;

/// Retains the actual deletion-boundary inode using an exclusive same-volume
/// move. No file is unlinked and recreated visible files are never rolled back.
public static class RetainedFileRemoval
{
    public static RetainedFileReplacement.Recovery Capture(string target,string expectedHash,string recoveryRoot,Guid operation,Action<string>? observe=null,string? leasePath=null)
    {
        var before=RetainedFileReplacement.Read(target);
        if(TextPackStore.Hash(before)!=expectedHash)throw new FileChangedException();
        RetainedFileReplacement.RequireSpace(target,before.Length);
        var directory=RetainedFileReplacement.OperationDirectory(target,operation,recoveryRoot);
        if(Directory.Exists(directory)||File.Exists(directory))throw new IOException("Retained removal operation already exists.");
        Directory.CreateDirectory(directory);RetainedFileReplacement.CheckPath(directory);
        using var captureLease=RetainedFileReplacement.AcquireLease(leasePath??Path.Combine(directory,".capture.lock"));
        if(OperatingSystem.IsWindows()) {
            var source=RetainedFileReplacement.Fingerprint(target);var storage=RetainedFileReplacement.Fingerprint(directory);
            if(source is null||storage is null||source.Volume!=storage.Volume)throw new IOException("This filesystem cannot retain deleted files safely.");
        }
        var record=new RetainedFileReplacement.Manifest(1,operation,Path.GetFileName(target),expectedHash,expectedHash,"pending",Kind:"removal");
        RetainedFileReplacement.Create(Path.Combine(directory,"prepared"),before);
        RetainedFileReplacement.SaveJson(Path.Combine(directory,"manifest.json"),record,creating:true);
        observe?.Invoke("prepared");
        if(TextPackStore.Hash(RetainedFileReplacement.Read(target))!=expectedHash)throw new RetainedFileReplacement.RequiredException(operation);
        observe?.Invoke("beforeCapture");
        var recovery=new RetainedFileReplacement.Recovery(directory,record);
        File.Move(target,recovery.Displaced,overwrite:false);
        observe?.Invoke("captured");
        var classified=RetainedFileReplacement.Classify(recovery,target);
        if(classified.Record.State!="completed")throw new RetainedFileReplacement.RequiredException(operation);
        return classified;
    }
    internal static RetainedFileReplacement.Recovery CancelUncaptured(RetainedFileReplacement.Recovery recovery,string candidate)
    {
        if(recovery.Record.Kind!="removal"||recovery.Record.State!="pending"||RetainedFileReplacement.ExistsNoFollow(recovery.Displaced))throw new InvalidDataException("Removal was already captured.");
        var before=RetainedFileReplacement.Fingerprint(candidate);var prepared=RetainedFileReplacement.Read(recovery.Prepared);var bytes=RetainedFileReplacement.Read(candidate);
        if(TextPackStore.Hash(prepared)!=recovery.Record.ExpectedHash||!prepared.SequenceEqual(bytes)||before!=RetainedFileReplacement.Fingerprint(candidate)||RetainedFileReplacement.ExistsNoFollow(recovery.Displaced))throw new FileChangedException();
        var record=recovery.Record with{State="cancelled"};RetainedFileReplacement.SaveJson(Path.Combine(recovery.Directory,"manifest.json"),record);return recovery with{Record=record};
    }
}
