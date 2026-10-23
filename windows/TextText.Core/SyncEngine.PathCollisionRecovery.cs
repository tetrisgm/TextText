using System.Text.Json;

namespace TextText.Core;

public sealed partial class SyncEngine
{
    public sealed record PathCollisionEntry(string LocalItemId,string RemoteItemId,string SourcePath,string LocalOperationId,string RemoteOperationId,string State,string? ResolutionId);
    public sealed record PathCollisionReview(string Inspection,string LocalItemId,string RemoteItemId,string SourcePath,string DestinationPath,string LocalHash,string RemoteRevision,string LocalOperationId,string RemoteOperationId);
    public sealed record PathCollisionReceipt(string OperationId,string State,string LocalItemId,string RemoteItemId,string LocalPath,string RemotePath);
    public sealed record PathCollisionResolution(string Id,string RootHash,ProtectedRenameScope Scope,PathCollisionReview Review,string Phase,Operation LocalOperation,Operation RemoteOperation,string LocalPayloadHash,string RemotePayloadHash,string UploadId);
    readonly HashSet<string> pathCollisionHeldIDs=new(StringComparer.Ordinal);
    internal Action<string>? PathCollisionObservationForTesting {get;set;}

    public async Task<IReadOnlyList<PathCollisionEntry>> ListPathCollisionsAsync(CancellationToken ct=default)
    {
        await gate.WaitAsync(ct);
        try {
            using var ownership=workspaceOwnership.Acquire();var state=Load();
            var rows=new List<PathCollisionEntry>();
            foreach(var local in state.Outbox.Where(op=>op.Kind=="upload"&&op.Conflicted&&op.Revision is null)) {
                foreach(var remote in state.Outbox.Where(op=>op.Kind=="conflict"&&op.Conflicted&&op.ItemId!=local.ItemId&&op.Path==local.Path&&op.Payload is not null)) {
                    var saved=state.PathCollisions.Values.SingleOrDefault(value=>value.Review.LocalOperationId==local.Id&&value.Review.RemoteOperationId==remote.Id);
                    rows.Add(new(local.ItemId,remote.ItemId,local.Path,local.Id,remote.Id,saved?.Phase??"review",saved?.Id));
                    if(rows.Count==100)return rows;
                }
            }
            return rows;
        } finally {gate.Release();}
    }

    public async Task<PathCollisionReview> InspectPathCollisionAsync(string localItemId,string remoteItemId,CancellationToken ct=default)
    {
        RequireSavedMoveId(localItemId);RequireSavedMoveId(remoteItemId);
        await gate.WaitAsync(ct);
        try {
            using var ownership=workspaceOwnership.Acquire();
            var state=Load();var existing=state.PathCollisions.Values.SingleOrDefault(value=>value.Review.LocalItemId==localItemId&&value.Review.RemoteItemId==remoteItemId&&value.Phase=="prepared");
            if(existing is not null)return existing.Review;
            return await ReviewPathCollision(state,localItemId,remoteItemId,ct);
        } finally {gate.Release();}
    }

    public async Task<PathCollisionReceipt> KeepBothPathCollisionAsync(PathCollisionReview review,string operationId,CancellationToken ct=default)
    {
        RequireSavedMoveId(operationId);RequireSavedMoveId(review.LocalItemId);RequireSavedMoveId(review.RemoteItemId);
        await gate.WaitAsync(ct);
        try {
            using var ownership=workspaceOwnership.Acquire();var state=Load();
            if(state.PathCollisions.TryGetValue(operationId,out var prior)) {
                if(prior.Review!=review)throw new FileChangedException();
                if(prior.Phase=="completed") {if(transport.ProtectedRenameBinding!=prior.Scope)throw new SharedAccountMismatchException();VerifyCollisionArchives(prior);return CollisionReceipt(prior);}
            } else {
                if(state.PathCollisions.Values.Any(value=>value.Phase=="prepared"&&(value.Review.LocalItemId==review.LocalItemId||value.Review.RemoteItemId==review.RemoteItemId)))throw new FileChangedException();
                if(await ReviewPathCollision(state,review.LocalItemId,review.RemoteItemId,ct)!=review)throw new FileChangedException();
                var local=state.Outbox.Single(op=>op.Id==review.LocalOperationId);var remote=state.Outbox.Single(op=>op.Id==review.RemoteOperationId);
                var localPayload=CollisionPayload(local);var remotePayload=CollisionPayload(remote);
                store.Preserve(localPayload,"path-collision-original");store.Preserve(remotePayload,"path-collision-original");
                store.Preserve(store.Read(review.SourcePath),"path-collision-local");
                var context=SavedRenameContext()??throw new SharedAccountMismatchException();
                prior=new(operationId,context.RootHash,context.Scope,review,"prepared",local with{Payload=null},remote with{Payload=null},TextPackStore.Hash(localPayload),TextPackStore.Hash(remotePayload),Guid.NewGuid().ToString());
                state.PathCollisions.Add(operationId,prior);Save(state);PathCollisionObservationForTesting?.Invoke("prepared");
            }
            await ValidatePreparedCollision(state,prior,ct);
            if(File.Exists(store.Resolve(review.SourcePath)))store.Rename(review.SourcePath,review.DestinationPath,review.LocalHash);
            PathCollisionObservationForTesting?.Invoke("moved");
            await ValidatePreparedCollision(state,prior,ct);
            var bytes=store.Read(review.DestinationPath);
            if(TextPackStore.Identity(bytes)!=review.LocalItemId||TextPackStore.Hash(bytes)!=review.LocalHash||File.Exists(store.Resolve(review.SourcePath)))throw new FileChangedException();
            state.Outbox.RemoveAll(op=>op.Id==review.LocalOperationId||op.Id==review.RemoteOperationId);
            state.Outbox.Add(new(prior.UploadId,"upload",review.LocalItemId,review.DestinationPath,null,null,review.LocalHash,Convert.ToBase64String(bytes)));
            state.PathCollisions[operationId]=prior with{Phase="completed"};Save(state);
            PathCollisionObservationForTesting?.Invoke("completed");
            return CollisionReceipt(state.PathCollisions[operationId]);
        } finally {gate.Release();}
    }

    static PathCollisionReceipt CollisionReceipt(PathCollisionResolution value)=>new(value.Id,value.Phase,value.Review.LocalItemId,value.Review.RemoteItemId,value.Review.DestinationPath,value.Review.SourcePath);
    void VerifyCollisionArchives(PathCollisionResolution value) {
        foreach(var pair in new[]{(value.LocalPayloadHash,value.Review.LocalItemId),(value.RemotePayloadHash,value.Review.RemoteItemId)}) {
            var bytes=RetainedFileReplacement.Read(Path.Combine(store.StateDirectory,"recovery","path-collision-original-"+pair.Item1+".textpack"));
            if(TextPackStore.Hash(bytes)!=pair.Item1||TextPackStore.Identity(bytes)!=pair.Item2)throw new FileChangedException();
        }
        var local=RetainedFileReplacement.Read(Path.Combine(store.StateDirectory,"recovery","path-collision-local-"+value.Review.LocalHash+".textpack"));
        if(TextPackStore.Hash(local)!=value.Review.LocalHash||TextPackStore.Identity(local)!=value.Review.LocalItemId)throw new FileChangedException();
    }
    static byte[] CollisionPayload(Operation op) {
        var bytes=Convert.FromBase64String(op.Payload??throw new FileChangedException());
        if(TextPackStore.Hash(bytes)!=op.Hash||TextPackStore.Identity(bytes)!=op.ItemId)throw new FileChangedException();return bytes;
    }
    (Operation Local,Operation Remote) CollisionPair(State state,string localId,string remoteId) {
        if(localId==remoteId||state.Items.ContainsKey(localId)||state.Items.ContainsKey(remoteId)||state.FolderCommand is not null||state.PendingPull is not null)throw new FileChangedException();
        var local=state.Outbox.Where(op=>op.ItemId==localId).ToArray();var remote=state.Outbox.Where(op=>op.ItemId==remoteId).ToArray();
        if(local.Length!=1||remote.Length!=1||local[0] is not{Kind:"upload",Conflicted:true,Revision:null}||remote[0] is not{Kind:"conflict",Conflicted:true}||local[0].Path!=remote[0].Path)throw new FileChangedException();
        if(local[0].Id==remote[0].Id||state.Outbox.Count(op=>op.Id==local[0].Id||op.Id==remote[0].Id)!=2)throw new FileChangedException();
        foreach(var id in new[]{localId,remoteId}) {
            if(IsEditing(id)||state.SharedRenames.ContainsKey(id)||state.ProtectedRenames.ContainsKey(id)||state.BinaryOutbox.Any(op=>op.ItemId==id)||state.BinaryBaselines.ContainsKey(id)||store.ReplacementBlocked(id))throw new FileChangedException();
        }
        _=CollisionPayload(local[0]);_=CollisionPayload(remote[0]);return(local[0],remote[0]);
    }
    async Task<PathCollisionReview> ReviewPathCollision(State state,string localId,string remoteId,CancellationToken ct) {
        var pair=CollisionPair(state,localId,remoteId);var context=SavedRenameContext()??throw new SharedAccountMismatchException();
        var source=pair.Local.Path;var slash=source.LastIndexOf('/');var destination=source[..(slash+1)]+"Recovered-"+localId+".textpack";
        ValidatePortableComponents(destination);_=store.Resolve(destination);
        var local=store.Describe(source);if(local.ItemId!=localId)throw new FileChangedException();
        if(store.Intent(localId) is not null||store.Intent(remoteId) is not null)throw new FileChangedException();
        var proof=JsonSerializer.Serialize(state);
        var manifest=await transport.ManifestAsync(ct);ct.ThrowIfCancellationRequested();
        if(JsonSerializer.Serialize(Load())!=proof||SavedRenameContext()!=context||store.Intent(localId) is not null||store.Intent(remoteId) is not null)throw new FileChangedException();
        var remote=ValidateCollisionRemote(manifest,localId,remoteId,source,destination,context.Scope);
        var files=store.Scan();if(store.LastScanErrors.Count!=0||files.Count(file=>file.ItemId==localId)!=1||files.Any(file=>file.ItemId==remoteId||PortableCatalogKey(file.Path).Equals(PortableCatalogKey(destination),StringComparison.OrdinalIgnoreCase))||store.Describe(source)!=local)throw new FileChangedException();
        var inspection=SavedMoveHash(new{Context=context,Local=pair.Local,Remote=pair.Remote,File=local,Server=remote,Destination=destination,Capabilities=transport.Capabilities});
        return new(inspection,localId,remoteId,source,destination,local.Hash,remote.Revision,pair.Local.Id,pair.Remote.Id);
    }
    RemoteItem ValidateCollisionRemote(IReadOnlyList<RemoteItem> manifest,string localId,string remoteId,string source,string destination,ProtectedRenameScope scope) {
        if(transport.ProtectedRenameBinding!=scope)throw new SharedAccountMismatchException();
        if(manifest.Any(item=>item.ItemId==localId))throw new FileChangedException();
        var found=manifest.Where(item=>item.ItemId==remoteId).ToArray();
        if(found.Length!=1||found[0].Deleted||found[0].RelativePath!=source||manifest.Any(item=>item.ItemId!=remoteId&&!item.Deleted&&PortableCatalogKey(item.RelativePath).Equals(PortableCatalogKey(source),StringComparison.OrdinalIgnoreCase))||manifest.Any(item=>PortableCatalogKey(item.RelativePath).Equals(PortableCatalogKey(destination),StringComparison.OrdinalIgnoreCase)))throw new FileChangedException();
        if(transport.Capabilities is not{} caps||!caps.FullAccess||!caps.CanCreateContent||!caps.CanCreate(destination)||!caps.CanWrite(remoteId,source,true))throw new UnauthorizedAccessException("Workspace permission changed. Both copies remain preserved.");
        return found[0];
    }
    async Task ValidatePreparedCollision(State state,PathCollisionResolution value,CancellationToken ct) {
        var review=value.Review;var pair=CollisionPair(state,review.LocalItemId,review.RemoteItemId);
        VerifyCollisionArchives(value);
        var intent=store.Intent(review.LocalItemId);
        if(store.Intent(review.RemoteItemId) is not null||intent is not null&&(intent.Kind!="rename"||intent.Path!=review.SourcePath||intent.Destination!=review.DestinationPath||intent.Hash!=review.LocalHash))throw new FileChangedException();
        if(pair.Local with{Payload=null}!=value.LocalOperation||pair.Remote with{Payload=null}!=value.RemoteOperation||TextPackStore.Hash(CollisionPayload(pair.Local))!=value.LocalPayloadHash||TextPackStore.Hash(CollisionPayload(pair.Remote))!=value.RemotePayloadHash)throw new FileChangedException();
        var proof=JsonSerializer.Serialize(state);var manifest=await transport.ManifestAsync(ct);ct.ThrowIfCancellationRequested();
        if(JsonSerializer.Serialize(Load())!=proof||store.Intent(review.LocalItemId)!=intent||store.Intent(review.RemoteItemId) is not null)throw new FileChangedException();
        var remote=ValidateCollisionRemote(manifest,review.LocalItemId,review.RemoteItemId,review.SourcePath,review.DestinationPath,value.Scope);
        if(remote.Revision!=review.RemoteRevision)throw new FileChangedException();
        var source=File.Exists(store.Resolve(review.SourcePath));var destination=File.Exists(store.Resolve(review.DestinationPath));
        if(source==destination)throw new FileChangedException();
        var files=store.Scan();var file=store.Describe(source?review.SourcePath:review.DestinationPath);
        if(store.LastScanErrors.Count!=0||file.ItemId!=review.LocalItemId||file.Hash!=review.LocalHash||files.Count(item=>item.ItemId==review.LocalItemId)!=1||files.Any(item=>item.ItemId==review.RemoteItemId))throw new FileChangedException();
    }
    void ValidatePathCollisions(State state) {
        if(state.PathCollisions is null||state.PathCollisions.Count>100)throw new InvalidDataException("Invalid path collision recovery state.");
        pathCollisionHeldIDs.Clear();
        if(state.PathCollisions.Count==0)return;
        var context=SavedRenameContext()??throw new SharedAccountMismatchException();
        foreach(var pair in state.PathCollisions) {
            var value=pair.Value;RequireSavedMoveId(pair.Key);RequireSavedMoveId(value.UploadId);
            if(value.Id!=pair.Key||value.RootHash!=context.RootHash||value.Scope!=context.Scope||value.Phase is not("prepared" or "completed"))throw new InvalidDataException("Invalid path collision recovery state.");
            var review=value.Review;RequireSavedMoveId(review.LocalItemId);RequireSavedMoveId(review.RemoteItemId);
            ValidatePortableComponents(review.SourcePath);ValidatePortableComponents(review.DestinationPath);_=store.Resolve(review.SourcePath);_=store.Resolve(review.DestinationPath);
            if(review.LocalItemId==review.RemoteItemId||review.SourcePath==review.DestinationPath||value.LocalOperation.Id!=review.LocalOperationId||value.RemoteOperation.Id!=review.RemoteOperationId||value.LocalOperation.ItemId!=review.LocalItemId||value.RemoteOperation.ItemId!=review.RemoteItemId||value.LocalOperation.Payload is not null||value.RemoteOperation.Payload is not null)throw new InvalidDataException("Invalid path collision recovery state.");
            if(value.LocalOperation is not{Kind:"upload",Conflicted:true,Revision:null}||value.RemoteOperation is not{Kind:"conflict",Conflicted:true}||value.LocalOperation.Path!=review.SourcePath||value.RemoteOperation.Path!=review.SourcePath||value.LocalOperation.Hash!=value.LocalPayloadHash||value.RemoteOperation.Hash!=value.RemotePayloadHash||value.UploadId==review.LocalOperationId||value.UploadId==review.RemoteOperationId)throw new InvalidDataException("Invalid path collision recovery state.");
            foreach(var hash in new[]{review.Inspection,review.LocalHash,value.LocalPayloadHash,value.RemotePayloadHash})if(!System.Text.RegularExpressions.Regex.IsMatch(hash,@"^[0-9a-f]{64}$"))throw new InvalidDataException("Invalid path collision recovery state.");
            if(value.Phase=="prepared"){pathCollisionHeldIDs.Add(review.LocalItemId);pathCollisionHeldIDs.Add(review.RemoteItemId);}
        }
    }
}
