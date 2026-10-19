using System.Text.Json;
namespace TextText.Core;

public sealed partial class SyncEngine
{
    public sealed record SavedFileMoveRecoveryEntry(string Id,string ItemId,string SourcePath,string DestinationPath,
        string? RequestHash,string State,string? LocalPath,string? RemotePath,string? Inspection,
        bool RetryAllowed,bool KeepNamesAllowed,string? BlockedReason);
    public sealed record SavedFileMoveRecoveryList(IReadOnlyList<SavedFileMoveRecoveryEntry> Entries,bool Truncated);
    sealed record SavedMoveInspection(SavedFileMoveRecoveryEntry Entry,State State,ProtectedSavedRename.Record? Record,
        string LocalProof,RemoteItem? Remote);

    static string SavedMoveHash(object value)
    {
        using var json=JsonDocument.Parse(JsonSerializer.SerializeToUtf8Bytes(value));
        using var output=new MemoryStream();
        using(var writer=new Utf8JsonWriter(output))WriteSavedMoveValue(writer,json.RootElement);
        return TextPackStore.Hash(output.ToArray());
    }
    static void WriteSavedMoveValue(Utf8JsonWriter writer,JsonElement value)
    {
        if(value.ValueKind!=JsonValueKind.Object){value.WriteTo(writer);return;}
        writer.WriteStartObject();
        foreach(var field in value.EnumerateObject().OrderBy(field=>field.Name,StringComparer.Ordinal))
        {writer.WritePropertyName(field.Name);WriteSavedMoveValue(writer,field.Value);}
        writer.WriteEndObject();
    }
    string SavedMoveLocalProof(string itemId)
    {
        var state=Load();var context=SavedRenameContext();
        var files=store.Scan().Where(file=>file.ItemId==itemId).OrderBy(file=>file.Path,StringComparer.Ordinal).ToArray();
        var protection=ReadSavedProtection(itemId);
        return SavedMoveHash(new{State=JsonSerializer.Serialize(state),Context=context,Files=files,
            Errors=store.LastScanErrors,Protection=protection,Intent=store.Intent(itemId),Editing=IsEditing(itemId),
            Binding=transport.ProtectedRenameBinding,Capabilities=transport.Capabilities});
    }
    static void RequireSavedMoveId(string id)
    {
        if(!Guid.TryParseExact(id,"D",out var parsed)||parsed.ToString("D")!=id)
            throw new InvalidDataException("Invalid saved file move identity.");
    }
    async Task<(RemoteItem[]? Items,string? Blocked)> SavedMoveRemote(CancellationToken ct)
    {
        using var bounded=CancellationTokenSource.CreateLinkedTokenSource(ct);
        bounded.CancelAfter(TimeSpan.FromSeconds(2));
        try{return ((await transport.ManifestAsync(bounded.Token).WaitAsync(bounded.Token)).ToArray(),null);}
        catch(OperationCanceledException)when(!ct.IsCancellationRequested){return(null,"unavailable");}
        catch(Exception error)when(error is HttpRequestException or IOException or JsonException or InvalidDataException or NotSupportedException)
        {return(null,"unavailable");}
    }
    async Task<SavedMoveInspection> InspectSavedMove(string id,RemoteItem[]? manifest,string? unavailable,CancellationToken ct)
    {
        RequireSavedMoveId(id);ct.ThrowIfCancellationRequested();
        var state=Load();var record=state.ProtectedRenames.Values.SingleOrDefault(value=>value.Request.OperationId==id);
        var legacy=state.SharedRenames.Values.SingleOrDefault(value=>value.Id==id);
        if(record is null&&legacy is null)throw new FileChangedException();
        var itemId=record?.Request.ItemId??legacy!.ItemId;
        var source=record?.Request.Source??legacy!.Path;var destination=record?.Request.Destination??legacy!.Destination!;
        var localProof=SavedMoveLocalProof(itemId);
        var files=store.Scan().Where(file=>file.ItemId==itemId).ToArray();
        var local=files.Length==1?files[0]:null;var unique=files.Length==1&&store.LastScanErrors.Count==0;
        var matches=manifest?.Where(value=>value.ItemId==itemId).ToArray();
        var remote=matches?.Length==1?matches[0]:null;
        var context=SavedRenameContext(record is not null);
        var scope=context is not null&&transport.ProtectedRenameBinding==context.Scope;
        string? blocked=!scope?"ownership":unavailable;
        if(matches is not null&&matches.Length!=1)blocked??="ambiguous";
        var baseline=state.Items.GetValueOrDefault(itemId);
        var checkpointPath=Path.Combine(store.StateDirectory,"shared-editing",itemId,"checkpoint.json");
        var protection=ReadSavedProtection(itemId);
        SharedCheckpoint? checkpoint=File.Exists(checkpointPath)?JsonSerializer.Deserialize<SharedCheckpoint>(RetainedFileReplacement.Read(checkpointPath,16*1024*1024)):null;
        var pendingNative=new[]{"intent.json","move-intent.json","binary-intent.json","acknowledge.json"}.Any(name=>File.Exists(Path.Combine(store.StateDirectory,"shared-editing",itemId,name)));
        var ready=checkpoint is not null&&protection.Available&&!pendingNative&&checkpoint.RetiredReason is null&&local is not null&&
            checkpoint.Path==local.Path&&(checkpoint.ProjectedHash==local.Hash||checkpoint.Pending);
        if(legacy is not null)blocked??="ambiguous";
        if(!unique)blocked??="ambiguous";
        if(record is not null&&(baseline?.Lifecycle!=record.Lifecycle||remote?.Lifecycle!=record.Lifecycle||remote?.Deleted==true))blocked??="lifecycle";
        if(Blocked(state,itemId)||state.PendingPull?.ItemId==itemId||state.FolderCommand?.Request.Items.Any(item=>item.ItemId==itemId)==true||store.ReplacementBlocked(itemId)||pendingNative||!protection.Available)blocked??="recovery";
        var intent=store.Intent(itemId);
        if(intent is not null&&(intent.Kind!="rename"||intent.Destination!=local?.Path))blocked??="recovery";
        if(!ready)blocked??="checkpoint";
        var permitted=remote is not null&&local is not null&&SavedRenamePermitted(state,itemId,remote.RelativePath,local.Path);
        if(!permitted)blocked??="permission";
        var phase=record?.Phase switch{ProtectedSavedRename.Phase.Pending=>"pending",ProtectedSavedRename.Phase.TerminalRejected=>"terminal-rejected",ProtectedSavedRename.Phase.Stopped=>"stopped",_=>"review"};
        var retry=false;var keep=false;
        if(blocked is null&&record is not null)
        {
            var resolution=record.Resolution;
            var observation=new MirrorSavedRenameObservation(phase,source,destination,record.Lifecycle,
                resolution?.LocalPath,resolution?.RemotePath,resolution?.LocalLifecycle,resolution?.RemoteLifecycle,
                local?.Path,remote?.RelativePath,baseline?.Path,checkpoint?.Path,baseline?.Lifecycle,remote?.Lifecycle,
                remote?.Deleted??false,unique,ready,checkpoint?.RetiredReason is not null,scope,permitted,false,record.Receipt is not null,remote is not null);
            if(mirrorPolicy is null)blocked="unavailable";
            else
            {
                var decision=await mirrorPolicy.SavedRenameAsync(observation,ct);
                ct.ThrowIfCancellationRequested();
                if(SavedMoveLocalProof(itemId)!=localProof)blocked="stale";
                else
                {
                    retry=phase=="pending"&&decision.Action=="replay-saved";
                    keep=phase=="terminal-rejected"&&decision.Action=="review"&&record.Receipt is {Deleted:false,Revision:not null} receipt&&receipt.RelativePath==remote!.RelativePath;
                    if(phase=="pending"&&!retry)blocked="ambiguous";
                }
            }
        }
        if(SavedMoveLocalProof(itemId)!=localProof){blocked="stale";retry=false;keep=false;}
        var requestHash=record is null?null:SavedMoveHash(record.Request);
        var inspection=blocked is null?SavedMoveHash(new{Record=record,LocalProof=localProof,Remote=remote}):null;
        var shownState=blocked is null?phase:"review";
        return new(new(id,itemId,source,destination,requestHash,shownState,local?.Path,remote?.RelativePath,inspection,retry,keep,blocked),state,record,localProof,remote);
    }
    public async Task<SavedFileMoveRecoveryList> SavedFileMoveRecoveryListAsync(CancellationToken ct=default,string? path=null)
    {
        var state=Load();
        if(path is not null)_=store.Resolve(path);
        var currentPaths=store.Scan().GroupBy(file=>file.ItemId).ToDictionary(group=>group.Key,group=>group.Select(file=>file.Path).ToArray());
        var candidates=state.ProtectedRenames.Values.Select(value=>(Id:value.Request.OperationId,Item:value.Request.ItemId,Source:value.Request.Source,Destination:value.Request.Destination))
            .Concat(state.SharedRenames.Values.Select(value=>(Id:value.Id,Item:value.ItemId,Source:value.Path,Destination:value.Destination!)))
            .Where(value=>path is null||value.Source==path||value.Destination==path||currentPaths.GetValueOrDefault(value.Item)?.Contains(path,StringComparer.Ordinal)==true)
            .OrderBy(value=>value.Id,StringComparer.Ordinal).ToArray();
        if(candidates.Length==0)return new([],false);
        // Inventory is local-only. Explicit Read performs authenticated server
        // inspection before exposing either action or an inspection token.
        var entries=new List<SavedFileMoveRecoveryEntry>();
        foreach(var candidate in candidates.Take(100))
        {
            ct.ThrowIfCancellationRequested();var record=state.ProtectedRenames.GetValueOrDefault(candidate.Item);
            var phase=record?.Phase switch{ProtectedSavedRename.Phase.Pending=>"pending",ProtectedSavedRename.Phase.TerminalRejected=>"terminal-rejected",ProtectedSavedRename.Phase.Stopped=>"stopped",_=>"review"};
            var paths=currentPaths.GetValueOrDefault(candidate.Item);
            entries.Add(new(candidate.Id,candidate.Item,candidate.Source,candidate.Destination,
                record is null?null:SavedMoveHash(record.Request),phase,paths?.Length==1?paths[0]:null,null,null,false,false,
                record is null?"ambiguous":"unavailable"));
        }
        if(JsonSerializer.Serialize(Load())!=JsonSerializer.Serialize(state))throw new FileChangedException();
        await Task.CompletedTask;
        return new(entries,candidates.Length>100);
    }
    public async Task<SavedFileMoveRecoveryEntry> SavedFileMoveRecoveryReadAsync(string id,CancellationToken ct=default)
    {
        RequireSavedMoveId(id);var before=JsonSerializer.Serialize(Load());
        var remote=await SavedMoveRemote(ct);
        if(JsonSerializer.Serialize(Load())!=before)throw new FileChangedException();
        return (await InspectSavedMove(id,remote.Items,remote.Blocked,ct)).Entry;
    }
    public Task RetrySavedFileMoveAsync(string id,string requestHash,string inspection,bool consent,Action? beforeAcknowledge=null,CancellationToken ct=default)
        => ResolveSavedFileMove(id,requestHash,inspection,consent,false,beforeAcknowledge,ct);
    public Task KeepSavedFileMoveNamesAsync(string id,string requestHash,string inspection,bool consent,Action? beforeAcknowledge=null,CancellationToken ct=default)
        => ResolveSavedFileMove(id,requestHash,inspection,consent,true,beforeAcknowledge,ct);
    async Task ResolveSavedFileMove(string id,string requestHash,string inspection,bool consent,bool keep,Action? beforeAcknowledge,CancellationToken ct)
    {
        RequireSavedMoveId(id);
        if(!consent||!Digest(requestHash)||!Digest(inspection))throw new InvalidDataException("A fresh saved file move inspection and consent are required.");
        await gate.WaitAsync(ct);
        try
        {
            using var workspace=workspaceOwnership.Acquire();
            beforeAcknowledge?.Invoke();var before=JsonSerializer.Serialize(Load());
            var remote=await SavedMoveRemote(ct);beforeAcknowledge?.Invoke();
            if(JsonSerializer.Serialize(Load())!=before)throw new FileChangedException();
            var inspected=await InspectSavedMove(id,remote.Items,remote.Blocked,ct);beforeAcknowledge?.Invoke();
            var entry=inspected.Entry;var record=inspected.Record;
            if(entry.RequestHash!=requestHash||entry.Inspection!=inspection||record is null||
                (keep?!entry.KeepNamesAllowed:!entry.RetryAllowed)||SavedMoveLocalProof(entry.ItemId)!=inspected.LocalProof)throw new FileChangedException();
            if(keep)
            {
                var context=SavedRenameContext(true)??throw new SharedAccountMismatchException();
                var stopped=ProtectedSavedRename.Stop(record,new(entry.LocalPath!,entry.RemotePath!,record.Lifecycle,record.Lifecycle));
                var next=ProtectedSavedRename.Replace(context,inspected.State.ProtectedRenames,entry.ItemId,record,stopped);
                beforeAcknowledge?.Invoke();
                if(SavedMoveLocalProof(entry.ItemId)!=inspected.LocalProof)throw new FileChangedException();
                var prior=inspected.State.Items[entry.ItemId];
                inspected.State.Items[entry.ItemId]=prior with{Path=entry.LocalPath!};
                try{SaveProtectedRenameMap(inspected.State,next);}catch{inspected.State.Items[entry.ItemId]=prior;throw;}
            }
            else
            {
                await ReconcileSavedRename(inspected.State,entry.ItemId,inspected.State.Items.GetValueOrDefault(entry.ItemId),inspected.Remote,ct,beforeAcknowledge);
                beforeAcknowledge?.Invoke();
            }
        }
        finally{gate.Release();}
    }
}
