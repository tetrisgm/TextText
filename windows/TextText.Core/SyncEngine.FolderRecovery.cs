using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
namespace TextText.Core;
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record FolderCaseRecoveryReply(string State,string RequestHash,string? OperationId=null,string? Source=null,string? Destination=null,string? Inspection=null,string? ManifestRevision=null,string[]? Folders=null,FolderCaseMoveItem[]? Items=null,FolderCaseMoveReceipt? Result=null);
public sealed partial class SyncEngine
{
    public sealed record FolderSyncRecoveryEntry(string Id,FolderCaseMoveRequest Command,string State,string? RequestHash,string ExpectedIdentity,TextPackStore.FolderRenameEndpoint From,TextPackStore.FolderRenameEndpoint To,string LocalInspection,string? Inspection,string? ManifestRevision,string[]? Folders,FolderCaseMoveItem[]? Items,FolderCaseMoveReceipt? Result,string? ResolutionBlocked);
    [JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
    sealed record FolderCancellation(int Version,FolderSyncCommand Command,string RequestHash,FolderCaseRecoveryReply Server,string LocalInspection,string RootHash,string? AccountId);
    string FolderRootHash=>TextPackStore.Hash(Encoding.UTF8.GetBytes(store.Root));
    static bool SameRequest(FolderSyncCommand? a,FolderSyncCommand? b)=>a is not null&&b is not null&&JsonSerializer.Serialize(a.Request)==JsonSerializer.Serialize(b.Request)&&a.RootHash==b.RootHash&&a.AccountId==b.AccountId&&a.SourceIdentity==b.SourceIdentity;
    (FolderCaseRename.Inspection Metadata,string Digest) InspectFolderCommand(FolderSyncCommand command)
    {
        var metadata=new FolderCaseRename(store).InspectPaths(Guid.Parse(command.Request.OperationId),command.Request.Source,command.Request.Destination);
        var digest=TextPackStore.Hash(JsonSerializer.SerializeToUtf8Bytes(new{rootHash=FolderRootHash,accountId,command.Request,command.SourceIdentity,metadata.Digest}));return(metadata,digest);
    }
    void ValidateFolderRecovery(FolderSyncCommand command,FolderCaseRecoveryReply reply)
    {
        var r=command.Request;if(!Digest(reply.RequestHash))throw new InvalidDataException("Invalid folder recovery request binding.");
        if(reply.State=="completed") {
            if(reply.Result is not {} result||reply.OperationId is not null||reply.Source is not null||reply.Destination is not null||reply.Inspection is not null||reply.ManifestRevision is not null||reply.Folders is not null||reply.Items is not null)throw new InvalidDataException("Invalid completed folder recovery.");
            var expectedFolders=r.Folders.Select(x=>RebaseFolder(x,r.Source,r.Destination)).Order(StringComparer.Ordinal);var expectedItems=r.Items.Select(x=>x with{RelativePath=RebaseFolder(x.RelativePath,r.Source,r.Destination)}).OrderBy(x=>x.ItemId,StringComparer.Ordinal);
            if(result.OperationId!=r.OperationId||result.Status!="moved"||result.Source!=r.Source||result.Destination!=r.Destination||!Digest(result.ManifestRevision)||result.Folders is null||result.Items is null||result.Folders.Any(x=>x is null)||result.Items.Any(x=>x is null)||!result.Folders.Order(StringComparer.Ordinal).SequenceEqual(expectedFolders)||!result.Items.OrderBy(x=>x.ItemId,StringComparer.Ordinal).SequenceEqual(expectedItems))throw new InvalidDataException("Completed folder recovery changed the retained request.");return;
        }
        if(reply.State is not("review"or"cancelled")||reply.OperationId!=r.OperationId||reply.Source!=r.Source||reply.Destination!=r.Destination||!Digest(reply.Inspection)||!Digest(reply.ManifestRevision)||reply.Result is not null)throw new InvalidDataException("Folder recovery scope does not match its retained request.");
        if(reply.State=="cancelled"){if(reply.Folders is not null||reply.Items is not null)throw new InvalidDataException("Invalid cancelled folder response.");return;}
        if(reply.Folders is null||reply.Items is null||reply.Folders.Length>20000||reply.Items.Length>40000||reply.Folders.Any(x=>x is null)||reply.Items.Any(x=>x is null)||reply.Folders.Distinct(StringComparer.Ordinal).Count()!=reply.Folders.Length||reply.Items.Select(x=>x.ItemId).Distinct(StringComparer.Ordinal).Count()!=reply.Items.Length)throw new InvalidDataException("Invalid folder review topology.");foreach(var path in reply.Folders)store.ValidateManagedFolder(path);foreach(var item in reply.Items){_=store.Resolve(item.RelativePath);if(!Digest(item.Revision))throw new InvalidDataException("Invalid folder review item.");}
    }
    FolderSyncRecoveryEntry FolderRecoveryRow(FolderSyncCommand command,FolderCaseRecoveryReply? reply,string? error)
    {
        var local=InspectFolderCommand(command);var r=command.Request;return new(r.OperationId,r,reply?.State??"unavailable",reply?.RequestHash,command.SourceIdentity,new(local.Metadata.From.Present,local.Metadata.From.Identity),new(local.Metadata.To.Present,local.Metadata.To.Identity),local.Digest,reply?.Inspection,reply?.ManifestRevision,reply?.Folders,reply?.Items,reply?.Result,local.Metadata.Blocked??error);
    }
    public async Task<FolderSyncRecoveryEntry?> FolderMoveRecoveryReadAsync(CancellationToken ct=default)
    {
        // Atomic state reads do not wait behind a hung sync request. A pending
        // command is immutable; recheck it after the bounded authoritative read.
        ct.ThrowIfCancellationRequested();var command=Load().FolderCommand;if(command is null)return null;_=InspectFolderCommand(command);if(FolderWireBlockReason(command.Request) is {} wireError)return FolderRecoveryRow(command,null,wireError);
        using var bounded=CancellationTokenSource.CreateLinkedTokenSource(ct);bounded.CancelAfter(TimeSpan.FromSeconds(2));FolderCaseRecoveryReply? reply=null;string? error=null;
        try{reply=await transport.RecoverFolderCaseAsync(command.Request,false,null,bounded.Token).WaitAsync(bounded.Token);ValidateFolderRecovery(command,reply);}
        catch(OperationCanceledException)when(!ct.IsCancellationRequested){error="The server did not verify this folder operation in time. Retry inspection before deciding.";}
        catch(Exception failure)when(failure is HttpRequestException or IOException or InvalidDataException or JsonException or NotSupportedException){reply=null;error="The server has not verified this folder operation: "+failure.Message;}
        ct.ThrowIfCancellationRequested();if(!SameRequest(command,Load().FolderCommand))throw new FileChangedException();return FolderRecoveryRow(command,reply,error);
    }
    public async Task ResolveFolderMoveRecoveryAsync(string operationId,string? inspection,string localInspection,string requestHash,Action? beforeAcknowledge=null,CancellationToken ct=default)
    {
        if(!Guid.TryParseExact(operationId,"D",out _)||!Digest(localInspection)||!Digest(requestHash)||inspection is not null&&!Digest(inspection))throw new InvalidDataException("Invalid folder review acknowledgement.");
        await gate.WaitAsync(ct);try{
            using var workspace=workspaceOwnership.Acquire();var state=Load();var command=state.FolderCommand??throw new FileChangedException();if(command.Request.OperationId!=operationId)throw new FileChangedException();RequireFolderWire(command.Request);
            void LocalCheck(){ct.ThrowIfCancellationRequested();beforeAcknowledge?.Invoke();if(!SameRequest(command,Load().FolderCommand))throw new FileChangedException();var local=InspectFolderCommand(command);if(local.Metadata.Blocked is not null||local.Digest!=localInspection)throw new FileChangedException();}
            LocalCheck();var current=await transport.RecoverFolderCaseAsync(command.Request,false,null,ct);ValidateFolderRecovery(command,current);LocalCheck();if(current.RequestHash!=requestHash||current.Inspection!=inspection)throw new FileChangedException();
            if(current.State=="completed") {var remote=(await transport.ManifestAsync(ct)).ToDictionary(x=>x.ItemId);LocalCheck();await ReconcileFolderCase(state,store.Scan().ToDictionary(x=>x.ItemId),remote,ct,LocalCheck);return;}
            if(current.State is not("review"or"cancelled"))throw new InvalidDataException("The server has not verified this folder operation.");
            LocalCheck();var cancelled=await transport.RecoverFolderCaseAsync(command.Request,true,current.Inspection,ct);ValidateFolderRecovery(command,cancelled);LocalCheck();if(cancelled.State!="cancelled"||cancelled.RequestHash!=requestHash||cancelled.Inspection!=inspection)throw new FileChangedException();
            var receipt=new FolderCancellation(1,command,requestHash,cancelled,localInspection,FolderRootHash,accountId);var bytes=JsonSerializer.SerializeToUtf8Bytes(receipt);var directory=Path.Combine(store.StateDirectory,"folder-sync-cancellations");RetainedFileReplacement.CheckPath(directory);Directory.CreateDirectory(directory);var path=Path.Combine(directory,operationId+".json");
            if(File.Exists(path)){var prior=JsonSerializer.Deserialize<FolderCancellation>(RetainedFileReplacement.Read(path,16*1024*1024))??throw new InvalidDataException("Invalid retained folder cancellation.");if(prior.Version!=1||prior.RootHash!=FolderRootHash||prior.AccountId!=accountId||prior.RequestHash!=requestHash||!SameRequest(prior.Command,command)||JsonSerializer.Serialize(prior.Server)!=JsonSerializer.Serialize(cancelled))throw new InvalidDataException("Retained cancellation does not match this folder operation.");}else RetainedFileReplacement.Create(path,bytes);
            LocalCheck();state.FolderCommand=null;state.FolderBaseline=null;Save(state);HasEligiblePending=false;
        }finally{gate.Release();}
    }
}
