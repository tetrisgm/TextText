using System.Text.Json;
using System.Text.Json.Serialization;
namespace TextText.Core;
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record FolderCaseMoveItem(string ItemId,string RelativePath,string Revision);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record FolderCaseMoveRequest(string OperationId,string Source,string Destination,string BaseManifestRevision,string[] Folders,FolderCaseMoveItem[] Items);
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record FolderCaseMoveReceipt(string OperationId,string Status,string Source,string Destination,string[] Folders,FolderCaseMoveItem[] Items,string ManifestRevision);
public sealed partial class SyncEngine
{
    [JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record FolderIdentity(string Path,string Identity);
    [JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record FolderSyncBaseline(int Version,string ManifestRevision,string[] Folders,FolderCaseMoveItem[] Items,FolderIdentity[] Identities);
    [JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record FolderSyncCommand(int Version,FolderCaseMoveRequest Request,string SourceIdentity,string RootHash,string? AccountId,bool Conflicted=false);
    static bool WithinFolder(string path,string folder)=>path==folder||path.StartsWith(folder+"/",StringComparison.Ordinal);
    static string RebaseFolder(string path,string source,string destination)=>destination+path[source.Length..];
    static bool Digest(string? value)=>value is {Length:64}&&value.All(c=>c is >= '0' and <= '9' or >= 'a' and <= 'f');
    internal static string? FolderWireBlockReason(FolderCaseMoveRequest request)
    {
        if(!Guid.TryParseExact(request.OperationId,"D",out _)||request.Source.Length>256||request.Destination.Length>256||request.Folders.Length>20000||request.Items.Length>20000||request.Folders.Any(x=>x is null||x.Length>256)||request.Items.Any(x=>x is null||x.RelativePath.Length>1024))return "This folder command exceeds the automatic server contract. Review the retained folder move; its command and current files remain preserved.";
        var bytes=JsonSerializer.SerializeToUtf8Bytes(request,new JsonSerializerOptions{PropertyNamingPolicy=JsonNamingPolicy.CamelCase});
        return bytes.Length>4*1024*1024-1024?"This folder command is too large for authoritative move/recovery inspection. Review it before syncing; the original command and current files remain preserved.":null;
    }
    static void RequireFolderWire(FolderCaseMoveRequest request){if(FolderWireBlockReason(request) is {} reason)throw new IOException(reason);}
    void ValidateFolderState(State state)
    {
        if(state.FolderBaseline is {} b){if(b.Version!=1||!Digest(b.ManifestRevision)||b.Folders is null||b.Items is null||b.Identities is null||b.Folders.Length>20000||b.Items.Length>40000||b.Identities.Length!=b.Folders.Length||b.Identities.Select(x=>x.Path).Distinct(StringComparer.Ordinal).Count()!=b.Folders.Length||b.Folders.Distinct(StringComparer.Ordinal).Count()!=b.Folders.Length||b.Items.Select(x=>x.ItemId).Distinct().Count()!=b.Items.Length)throw new InvalidDataException("Invalid folder sync baseline.");foreach(var p in b.Folders)store.ValidateManagedFolder(p);foreach(var x in b.Items){_=store.Resolve(x.RelativePath);if(!Digest(x.Revision))throw new InvalidDataException("Invalid folder item revision.");}foreach(var x in b.Identities){store.ValidateManagedFolder(x.Path);if(!b.Folders.Contains(x.Path,StringComparer.Ordinal)||!System.Text.RegularExpressions.Regex.IsMatch(x.Identity,@"\Awindows:[0-9a-f]{8}:[0-9a-f]{16}\z"))throw new InvalidDataException("Invalid folder directory identity.");}}
        if(state.FolderCommand is {} c){var r=c.Request;if(c.Version!=1||c.AccountId!=accountId||c.RootHash!=TextPackStore.Hash(System.Text.Encoding.UTF8.GetBytes(store.Root))||!Guid.TryParse(r.OperationId,out _)||!Digest(r.BaseManifestRevision)||r.Source==r.Destination||Path.GetDirectoryName(r.Source)!=Path.GetDirectoryName(r.Destination)||!string.Equals(r.Source.Normalize(),r.Destination.Normalize(),StringComparison.OrdinalIgnoreCase)||r.Folders is null||r.Items is null||r.Folders.Length>20000||r.Items.Length>40000||r.Folders.Distinct(StringComparer.Ordinal).Count()!=r.Folders.Length||r.Items.Select(x=>x.ItemId).Distinct(StringComparer.Ordinal).Count()!=r.Items.Length||!r.Folders.Contains(r.Source,StringComparer.Ordinal))throw new InvalidDataException("Invalid pending folder move.");store.ValidateManagedFolder(r.Source);store.ValidateManagedFolder(r.Destination);foreach(var p in r.Folders){store.ValidateManagedFolder(p);if(!WithinFolder(p,r.Source))throw new InvalidDataException("Invalid folder move subtree.");}foreach(var i in r.Items){_=store.Resolve(i.RelativePath);if(!WithinFolder(i.RelativePath,r.Source)||!Digest(i.Revision))throw new InvalidDataException("Invalid folder move item.");}}
    }
    string? ChangedFolderDestination(FolderIdentity identity)
    {
        var old=store.Resolve(identity.Path);if(FolderCaseRename.ExactPathExists(store.Root,old))return null;
        var parent=Path.GetDirectoryName(old)!;if(!FolderCaseRename.ExactPathExists(store.Root,parent)||!Directory.Exists(parent))return null;
        var leaf=Path.GetFileName(old);var aliases=Directory.EnumerateDirectories(parent).Where(x=>string.Equals(Path.GetFileName(x).Normalize(),leaf.Normalize(),StringComparison.OrdinalIgnoreCase)).Take(2).ToArray();
        if(aliases.Length==0)return null;
        if(aliases.Length!=1||FolderCaseRename.Identity(aliases[0])!=identity.Identity)throw new IOException("The folder alias does not match its recorded physical identity. Review the move; both trees remain preserved.");
        return Path.GetRelativePath(store.Root,aliases[0]).Replace('\\','/');
    }
    bool FolderSpellingChanged(State state)=>state.FolderCommand!=null||state.FolderBaseline?.Identities.Any(x=>ChangedFolderDestination(x)!=null)==true||state.FolderBaseline==null&&(state.ManagedFolders??[]).Any(x=>Directory.Exists(store.Resolve(x))&&!FolderCaseRename.ExactPathExists(store.Root,store.Resolve(x)));
    void CaptureFolderBaseline(State state,Dictionary<string,RemoteItem> remote)
    {
        if(!OperatingSystem.IsWindows()||state.FolderCommand!=null||!transport.SupportsFolderCaseMoves||!Digest(transport.ManifestRevision)||transport.AuthoritativeFolders is not {} folders)return;
        if(remote.Values.Any(x=>!x.Deleted&&state.Items.TryGetValue(x.ItemId,out var item)&&item.Path!=x.RelativePath)){state.FolderBaseline=null;Save(state);return;}
        var identities=new List<FolderIdentity>();foreach(var folder in folders){var p=store.Resolve(folder);if(!FolderCaseRename.ExactPathExists(store.Root,p)||!Directory.Exists(p))return;identities.Add(new(folder,FolderCaseRename.Identity(p)));}
        state.FolderBaseline=new(1,transport.ManifestRevision!,folders.Order(StringComparer.Ordinal).ToArray(),remote.Values.Where(x=>!x.Deleted).Select(x=>new FolderCaseMoveItem(x.ItemId,x.RelativePath,x.Revision)).OrderBy(x=>x.ItemId,StringComparer.Ordinal).ToArray(),identities.ToArray());Save(state);
    }
    void VerifyMovedTree(FolderSyncCommand command,Dictionary<string,PackFile> local)
    {
        var r=command.Request;var destination=store.Resolve(r.Destination);if(FolderCaseRename.ExactPathExists(store.Root,store.Resolve(r.Source))||!FolderCaseRename.ExactPathExists(store.Root,destination)||FolderCaseRename.Identity(destination)!=command.SourceIdentity)throw new IOException("The observed folder changed. Both current trees remain preserved for review.");
        var expectedFolders=r.Folders.Select(x=>RebaseFolder(x,r.Source,r.Destination)).ToHashSet(StringComparer.Ordinal);var expectedFiles=r.Items.ToDictionary(x=>RebaseFolder(x.RelativePath,r.Source,r.Destination),StringComparer.Ordinal);var actualFolders=new HashSet<string>(StringComparer.Ordinal){r.Destination};var actualFiles=new HashSet<string>(StringComparer.Ordinal);var stack=new Stack<string>();stack.Push(destination);var count=0;
        while(stack.Count>0)foreach(var p in Directory.EnumerateFileSystemEntries(stack.Pop())){if(++count>60000)throw new IOException("Folder move inspection exceeds its safe bound.");RetainedFileReplacement.CheckPath(p);var rel=Path.GetRelativePath(store.Root,p).Replace('\\','/');if(Directory.Exists(p)){actualFolders.Add(rel);stack.Push(p);}else{actualFiles.Add(rel);if(!expectedFiles.TryGetValue(rel,out var item)||!local.TryGetValue(item.ItemId,out var pack)||pack.Path!=rel)throw new IOException("Folder membership changed. Review the folder move.");}}
        if(!actualFolders.SetEquals(expectedFolders)||!actualFiles.SetEquals(expectedFiles.Keys))throw new IOException("Folder membership changed. Empty folders and file bytes remain preserved for review.");
    }
    async Task<MirrorFolderDecision> FolderDecision(State state,MirrorFolderObservation observed,CancellationToken ct,Action? beforeAcknowledge=null)
    {
        if(mirrorPolicy is null)throw new MirrorPolicyUnavailableException("The shared folder policy is unavailable.");
        beforeAcknowledge?.Invoke();
        var ownerPath=Path.Combine(store.StateDirectory,AccountRootOwnership.FileName);
        var owner=File.Exists(ownerPath)?RetainedFileReplacement.Read(ownerPath,4096):null;
        var memory=JsonSerializer.Serialize(state);
        var durable=JsonSerializer.Serialize(Load());
        var capability=transport.SupportsFolderCaseMoves;
        var revision=transport.ManifestRevision;
        var catalog=JsonSerializer.Serialize(transport.AuthoritativeFolders);
        var decision=await mirrorPolicy.FolderAsync(observed,ct);
        ct.ThrowIfCancellationRequested();beforeAcknowledge?.Invoke();
        if((owner is null?File.Exists(ownerPath):!File.Exists(ownerPath)||!RetainedFileReplacement.Read(ownerPath,4096).SequenceEqual(owner))||JsonSerializer.Serialize(state)!=memory||JsonSerializer.Serialize(Load())!=durable||
           transport.SupportsFolderCaseMoves!=capability||transport.ManifestRevision!=revision||
           JsonSerializer.Serialize(transport.AuthoritativeFolders)!=catalog)
            throw new IOException("Folder state changed during policy inspection. Retained work remains preserved.");
        return decision;
    }
    async Task<Dictionary<string,RemoteItem>> ReconcileFolderCase(State state,Dictionary<string,PackFile> local,Dictionary<string,RemoteItem> remote,CancellationToken ct,Action? beforeAcknowledge=null)
    {
        if(state.FolderCommand==null&&state.FolderBaseline==null&&transport.AuthoritativeFolders is {} firstCatalog&&firstCatalog.Any(x=>((state.ManagedFolders??[]).Contains(x,StringComparer.Ordinal)||state.Items.Values.Any(item=>WithinFolder(item.Path,x)))&&Directory.Exists(store.Resolve(x))&&!FolderCaseRename.ExactPathExists(store.Root,store.Resolve(x))))throw new IOException("This folder changed spelling before its directory identity baseline was recorded. Review the folder move; files remain preserved.");
        if(state.FolderCommand==null&&state.FolderBaseline is {} baseline){
            var changed=baseline.Identities.Select(x=>(Identity:x,Destination:ChangedFolderDestination(x))).Where(x=>x.Destination!=null).OrderBy(x=>x.Identity.Path.Length).ToArray();
            if(changed.Length>0){var first=changed[0];var source=first.Identity.Path;var destination=first.Destination!;
                if(!transport.SupportsFolderCaseMoves||!Digest(transport.ManifestRevision)||transport.AuthoritativeFolders is not {} currentFolders)throw new IOException("This server cannot safely synchronize folder spelling changes. Review the folder move.");
                var topologyMatches=baseline.Folders.Order(StringComparer.Ordinal).SequenceEqual(currentFolders.Order(StringComparer.Ordinal))&&baseline.Items.Select(x=>(x.ItemId,x.RelativePath)).OrderBy(x=>x.ItemId,StringComparer.Ordinal).SequenceEqual(remote.Values.Where(x=>!x.Deleted).Select(x=>(x.ItemId,x.RelativePath)).OrderBy(x=>x.ItemId,StringComparer.Ordinal));
                var contained=changed.All(x=>WithinFolder(x.Identity.Path,source));
                var affectedIds=remote.Values.Where(x=>!x.Deleted&&WithinFolder(x.RelativePath,source)).Select(x=>x.ItemId).ToHashSet(StringComparer.Ordinal);
                var barriers=new List<string>();
                if(state.Outbox.Any(x=>affectedIds.Contains(x.ItemId)))barriers.Add("document");
                if(state.SharedRenames.Keys.Any(affectedIds.Contains)||state.ProtectedRenames.Keys.Any(affectedIds.Contains))barriers.Add("savedRename");
                if(state.BinaryOutbox.Any(x=>affectedIds.Contains(x.ItemId)))barriers.Add("binary");
                if(state.PendingPull is {} pendingPull&&affectedIds.Contains(pendingPull.ItemId))barriers.Add("pull");
                var decision=await FolderDecision(state,new("candidate",true,topologyMatches,contained,barriers.ToArray()),ct,beforeAcknowledge);
                // Recompute actual directory identities after the page await.
                var freshChanges=baseline.Identities.Select(x=>(Identity:x,Destination:ChangedFolderDestination(x))).Where(x=>x.Destination!=null).OrderBy(x=>x.Identity.Path.Length).ToArray();
                if(!changed.SequenceEqual(freshChanges))throw new IOException("Folder identity changed during policy inspection.");
                if(!topologyMatches)throw new IOException("Folder topology changed. Review the folder move; local bytes remain preserved.");
                if(!contained)throw new IOException("More than one folder moved. Review each move.");
                if(decision.Action!="stage-new")throw new IOException("Existing file commands must finish before this folder move can be reviewed. All durable work remains retained.");
                var request=new FolderCaseMoveRequest(Guid.NewGuid().ToString("D"),source,destination,transport.ManifestRevision!,baseline.Folders.Where(x=>WithinFolder(x,source)).ToArray(),remote.Values.Where(x=>!x.Deleted&&WithinFolder(x.RelativePath,source)).Select(x=>new FolderCaseMoveItem(x.ItemId,x.RelativePath,x.Revision)).OrderBy(x=>x.ItemId,StringComparer.Ordinal).ToArray());
                RequireFolderWire(request);
                var affected=request.Items.Select(x=>x.ItemId).ToHashSet(StringComparer.Ordinal);if(state.Outbox.Any(x=>affected.Contains(x.ItemId))||state.SharedRenames.Keys.Any(affected.Contains)||state.ProtectedRenames.Keys.Any(affected.Contains)||state.BinaryOutbox.Any(x=>affected.Contains(x.ItemId))||state.PendingPull is {} pull&&affected.Contains(pull.ItemId))throw new IOException("Existing file commands must finish before this folder move can be reviewed. All durable work remains retained.");
                var command=new FolderSyncCommand(1,request,first.Identity.Identity,TextPackStore.Hash(System.Text.Encoding.UTF8.GetBytes(store.Root)),accountId);VerifyMovedTree(command,store.Scan().ToDictionary(x=>x.ItemId));beforeAcknowledge?.Invoke();RetainedReplacementProfile.PrepareFolderSync(store);beforeAcknowledge?.Invoke();state.FolderCommand=command;Save(state);
            }
        }
        if(state.FolderCommand is not {} pending)return remote;
        if(!transport.SupportsFolderCaseMoves)throw new IOException("Folder move capability is unavailable; the retained command will not be replaced.");
        RequireFolderWire(pending.Request);
        HasEligiblePending=true;
        VerifyMovedTree(pending,local);var requestPending=pending.Request;FolderCaseMoveReceipt receipt;
        var replay=await FolderDecision(state,new("pending",true,false,false,[]),ct,beforeAcknowledge);
        VerifyMovedTree(pending,store.Scan().ToDictionary(x=>x.ItemId));
        if(replay.Action!="replay-existing")throw new IOException("Folder move policy is unavailable; the retained command remains preserved.");
        beforeAcknowledge?.Invoke();
        try{receipt=await transport.MoveFolderCaseAsync(requestPending,ct);}catch(SyncConflictException){state.FolderCommand=pending with{Conflicted=true};Save(state);throw;}
        ct.ThrowIfCancellationRequested();store.ValidateReplacementRegistry();VerifyMovedTree(pending,store.Scan().ToDictionary(x=>x.ItemId));
        var expectedFolders=requestPending.Folders.Select(x=>RebaseFolder(x,requestPending.Source,requestPending.Destination)).Order(StringComparer.Ordinal).ToArray();var expectedItems=requestPending.Items.Select(x=>x with{RelativePath=RebaseFolder(x.RelativePath,requestPending.Source,requestPending.Destination)}).OrderBy(x=>x.ItemId,StringComparer.Ordinal).ToArray();
        if(receipt.OperationId!=requestPending.OperationId||receipt.Status!="moved"||receipt.Source!=requestPending.Source||receipt.Destination!=requestPending.Destination||!Digest(receipt.ManifestRevision)||receipt.Folders is null||receipt.Items is null||!receipt.Folders.Order(StringComparer.Ordinal).SequenceEqual(expectedFolders)||!receipt.Items.OrderBy(x=>x.ItemId,StringComparer.Ordinal).SequenceEqual(expectedItems))throw new InvalidDataException("Folder move receipt does not match its retained command.");
        beforeAcknowledge?.Invoke();ct.ThrowIfCancellationRequested();
        foreach(var item in requestPending.Items){var path=RebaseFolder(item.RelativePath,requestPending.Source,requestPending.Destination);if(SharedEditingStore.HasReadyCheckpoint(store,item.ItemId))SharedEditingStore.RebaseProjection(store,item.ItemId,path,adoptingExternalChange:true);if(state.Items.TryGetValue(item.ItemId,out var prior))state.Items[item.ItemId]=prior with{Path=path}; }
        beforeAcknowledge?.Invoke();ct.ThrowIfCancellationRequested();
        state.ManagedFolders=(state.ManagedFolders??[]).Select(x=>WithinFolder(x,requestPending.Source)?RebaseFolder(x,requestPending.Source,requestPending.Destination):x).Distinct(StringComparer.Ordinal).ToList();state.FolderBaseline=null;state.FolderCommand=null;Save(state);HasEligiblePending=false;
        return (await transport.ManifestAsync(ct)).ToDictionary(x=>x.ItemId);
    }
}
