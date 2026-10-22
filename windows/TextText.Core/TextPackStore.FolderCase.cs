namespace TextText.Core;
public sealed partial class TextPackStore
{
    FolderCaseRename FolderCases=>new(this);
    internal Action<string>? FolderCaseObservationForTesting {get;set;}
    public sealed record FolderRenameEndpoint(bool Present,string? Identity);
    public sealed record FolderRenameRecoveryEntry(string Id,string FromPath,string ToPath,string ExpectedIdentity,FolderRenameEndpoint From,FolderRenameEndpoint To,string Inspection,string Summary,string? ResolutionBlocked,bool Resolved);
    public IReadOnlyList<FolderRenameRecoveryEntry> FolderRenameRecoveryList(){lock(gate)return FolderCases.List();}
    public FolderRenameRecoveryEntry FolderRenameRecoveryRead(string id){lock(gate)return FolderCases.Read(id);}
    public void ResolveFolderRename(string id,string fromPath,string toPath,string inspection,Action? beforeAcknowledge=null){lock(gate)FolderCases.Resolve(id,fromPath,toPath,inspection,beforeAcknowledge);Changed?.Invoke();}
    // Within one store-serialized scan, the first check's outcome stands for
    // every file; the scan repeats the check before returning and refuses its
    // result if folder history changed meanwhile.
    (bool Checked,Exception? Error)? folderCaseScope;
    void AssertFolderRenameReadable()
    {
        if(folderCaseScope is {Checked:true} scope){if(scope.Error is {} cached)System.Runtime.ExceptionServices.ExceptionDispatchInfo.Throw(cached);return;}
        try{FolderCases.AssertReadable();}
        catch(Exception error)when(folderCaseScope is not null){folderCaseScope=(true,error);InventoryObservationForTesting?.Invoke("folderCaseChecked");throw;}
        if(folderCaseScope is not null){folderCaseScope=(true,null);InventoryObservationForTesting?.Invoke("folderCaseChecked");}
    }
    void VerifyFolderCaseScopeUnchanged()
    {
        if(folderCaseScope is not {Checked:true} scope)return;
        Exception? now=null;try{FolderCases.AssertReadable();}catch(Exception error){now=error;}
        var same=scope.Error is null?now is null
            :now is not null&&now.GetType()==scope.Error.GetType()&&(now is not FolderCaseRename.RequiredException actual||actual.Operation==((FolderCaseRename.RequiredException)scope.Error).Operation);
        if(!same)throw new InvalidDataException("Folder history changed during inventory.");
    }
    public void ValidateFolderCatalog(IReadOnlyList<string> folders){lock(gate){FolderCases.VerifyExistingProfile();AssertFolderRenameReadable();FolderCaseRename.ValidateCatalog(this,folders);}}
}
