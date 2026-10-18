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
    void AssertFolderRenameReadable()=>FolderCases.AssertReadable();
    public void ValidateFolderCatalog(IReadOnlyList<string> folders){lock(gate){FolderCases.VerifyExistingProfile();AssertFolderRenameReadable();FolderCaseRename.ValidateCatalog(this,folders);}}
}
