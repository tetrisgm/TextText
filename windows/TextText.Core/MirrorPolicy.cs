using System.Text.Json;

namespace TextText.Core;

public sealed record MirrorObservation(string LocalHash, string BaselineHash, string RemoteRevision, string BaselineRevision, bool Refresh);
public sealed record MirrorScope(string AccountId, string WorkspaceId, string Lifecycle);
public enum MirrorDisposition { Upload, Pull, Idle }

public sealed class MirrorPolicyUnavailableException(string message,Exception? inner=null) : IOException(message,inner);
public sealed class MirrorPolicyTimeoutException(Exception inner) : TimeoutException("Mirror policy timed out.",inner);
public sealed record MirrorScheduleObservation(string Outcome,int ConsecutiveFailures,bool HasEligiblePending,bool Rerun);
public sealed record MirrorScheduleDecision(string Action,int? DelayMs,int ConsecutiveFailures);
public sealed record MirrorLifecycleObservation(bool RemotePresent,bool RemoteDeleted,string? RemoteLifecycle,string? RemoteRevision,bool EditorOwned,
    string? BaselineLifecycle,string? BaselineRevision,string? PendingKind,string? PendingLifecycle,string? PendingBaseRevision,bool PendingConflicted);
public sealed record MirrorLifecycleDecision(string Baseline,string Pending);
public sealed record MirrorSharedPathObservation(bool ProtectedProjection,string? BaselinePath,string? LocalPath,string? RemotePath,string? CheckpointPath,
    bool CheckpointReady,bool CheckpointRetired,bool LocalUnique,bool RemoteDeleted,string? LocalLifecycle,string? RemoteLifecycle,bool Blocked,bool OrganizePermitted,string PendingRename);
public sealed record MirrorSharedPathDecision(string Action);
public sealed record MirrorQueuedUploadPathObservation(string PendingKind,bool PendingConflicted,bool PendingUnique,string PendingPath,string? PendingBaseRevision,string? PendingLifecycle,string? BaselinePath,string? BaselineRevision,string? BaselineLifecycle,string? RemotePath,string? RemoteRevision,string? RemoteLifecycle,bool RemoteDeleted,bool RemoteAuthoritative,string? LocalPath,bool LocalUnique,bool LocalIdentityVerified,bool StagedPayloadVerified,bool EditorOwned,bool RecoveryBlocked,bool Permitted,string IntentKind,string? IntentPath,string? IntentDestination);
public sealed record MirrorQueuedUploadPathDecision(string Action);
public sealed record MirrorSavedRenameObservation(string Phase,string? SavedSource,string? SavedDestination,string? SavedLifecycle,string? StoppedLocalPath,string? StoppedRemotePath,string? StoppedLocalLifecycle,string? StoppedRemoteLifecycle,string? LocalPath,string? RemotePath,string? BaselinePath,string? CheckpointPath,string? LocalLifecycle,string? RemoteLifecycle,bool RemoteDeleted,bool LocalUnique,bool CheckpointReady,bool Retired,bool ScopeVerified,bool CanOrganize,bool RecoveryBlocked,bool TerminalProofValid,bool RemoteAuthoritative);
public sealed record MirrorFolderObservation(string Phase,bool CapabilityAvailable,bool TopologyMatches,bool ChangesContained,string[] Barriers);
public sealed record MirrorFolderDecision(string Action);
public sealed record MirrorSavedRenameDecision(string Action);
public sealed record MirrorTombstoneObservation(bool RemotePresent,bool RemoteDeleted,bool RemoteAuthoritative,bool EditorOwned,bool RecoveryBlocked,bool LocalPresent,bool LocalUnique,bool LocalIdentityVerified,string? LocalHash,string? BaselineHash,string? LocalPath,string? BaselinePath,string? RemotePath,string? BaselineRevision,string? RemoteRevision,string? LocalLifecycle,string? RemoteLifecycle);
public sealed record MirrorTombstoneDecision(string Action);
public sealed record MirrorQueueCandidate(string OperationId,bool Conflicted,bool EditorOwned,bool RecoveryBlocked,bool Permitted);
public sealed record MirrorQueueObservation(MirrorQueueCandidate[] Candidates,int Budget,
    [property:System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] string? Lane=null);
public sealed record MirrorQueueDecision(string[] OperationIds,bool HasMore);
public static class MirrorFailure
{
    // Concrete transport/storage classifications only; never inspect error text.
    public static string Outcome(Exception error) => error switch {
        MirrorPolicyUnavailableException => "policy-unavailable",
        MirrorPolicyTimeoutException => "policy-unavailable",
        TimeoutException => "transient",
        SyncConflictException => "conflict",
        HttpRequestException {StatusCode:System.Net.HttpStatusCode.Unauthorized} => "auth-required",
        HttpRequestException {StatusCode:System.Net.HttpStatusCode.Forbidden or System.Net.HttpStatusCode.NotFound} => "permission",
        HttpRequestException {StatusCode:System.Net.HttpStatusCode.Conflict or System.Net.HttpStatusCode.PreconditionFailed} => "conflict",
        HttpRequestException e when e.StatusCode is null || (int)e.StatusCode==408 || (int)e.StatusCode==429 || (int)e.StatusCode>=500 => "transient",
        OperationCanceledException => "transient",
        FileChangedException => "transient",
        _ => "storage"
    };
}

/// <summary>RPC validation only. All portable decisions run in the packaged page.
/// A new page requires a new adapter; stale replies never authorize file writes.</summary>
public sealed class MirrorPolicy(string digest, MirrorScope scope, Func<string, CancellationToken, Task<string>> evaluate, TimeSpan? timeout = null)
{
    static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    readonly SemaphoreSlim gate = new(1, 1);
    string? pageId;
    long? generation;
    int retired;
    public void Retire() => Interlocked.Exchange(ref retired, 1);

    public async Task ReadyAsync(CancellationToken ct = default) => await ExecuteAsync(null,null,null,null,null,null,null,null,ct);
    public async Task<MirrorDisposition> DecideAsync(MirrorObservation observed, CancellationToken ct = default) =>
        (MirrorDisposition)(await ExecuteAsync(observed,null,null,null,null,null,null,null,ct) ?? throw new MirrorPolicyUnavailableException("Missing mirror disposition."));
    public async Task<MirrorScheduleDecision> ScheduleAsync(MirrorScheduleObservation observed,CancellationToken ct=default) =>
        (MirrorScheduleDecision)(await ExecuteAsync(null,observed,null,null,null,null,null,null,ct) ?? throw new MirrorPolicyUnavailableException("Missing mirror schedule."));

    public async Task<MirrorLifecycleDecision> LifecycleAsync(MirrorLifecycleObservation observed,CancellationToken ct=default) =>
        (MirrorLifecycleDecision)(await ExecuteAsync(null,null,observed,null,null,null,null,null,ct) ?? throw new MirrorPolicyUnavailableException("Missing mirror lifecycle decision."));

    public async Task<MirrorQueueDecision> QueueAsync(MirrorQueueObservation observed,CancellationToken ct=default) {
        if(observed.Lane is not (null or "document" or "binary"))throw new MirrorPolicyUnavailableException("Unknown mirror queue lane.");
        return (MirrorQueueDecision)(await ExecuteAsync(null,null,null,observed,null,null,null,null,ct) ?? throw new MirrorPolicyUnavailableException("Missing mirror queue selection."));
    }

    public async Task<MirrorSharedPathDecision> SharedPathAsync(MirrorSharedPathObservation observed,CancellationToken ct=default) =>
        (MirrorSharedPathDecision)(await ExecuteAsync(null,null,null,null,observed,null,null,null,ct) ?? throw new MirrorPolicyUnavailableException("Missing protected path decision."));

    public async Task<MirrorTombstoneDecision> TombstoneAsync(MirrorTombstoneObservation observed,CancellationToken ct=default) =>
        (MirrorTombstoneDecision)(await ExecuteAsync(null,null,null,null,null,observed,null,null,ct) ?? throw new MirrorPolicyUnavailableException("Missing tombstone decision."));

    public async Task<MirrorQueuedUploadPathDecision> QueuedUploadPathAsync(MirrorQueuedUploadPathObservation observed,CancellationToken ct=default) =>
        (MirrorQueuedUploadPathDecision)(await ExecuteAsync(null,null,null,null,null,null,null,observed,ct) ?? throw new MirrorPolicyUnavailableException("Missing queued upload path decision."));
    public async Task<MirrorSavedRenameDecision> SavedRenameAsync(MirrorSavedRenameObservation observed,CancellationToken ct=default) =>
        (MirrorSavedRenameDecision)(await ExecuteAsync(null,null,null,null,null,null,observed,null,ct) ?? throw new MirrorPolicyUnavailableException("Missing saved rename decision."));

    public async Task<MirrorFolderDecision> FolderAsync(MirrorFolderObservation observed,CancellationToken ct=default) =>
        (MirrorFolderDecision)(await ExecuteAsync(null,null,null,null,null,null,null,null,ct,observed) ?? throw new MirrorPolicyUnavailableException("Missing folder decision."));

    private async Task<object?> ExecuteAsync(MirrorObservation? observed, MirrorScheduleObservation? schedule, MirrorLifecycleObservation? lifecycle, MirrorQueueObservation? queue, MirrorSharedPathObservation? sharedPath, MirrorTombstoneObservation? tombstone, MirrorSavedRenameObservation? savedRename, MirrorQueuedUploadPathObservation? queuedUploadPath, CancellationToken ct, MirrorFolderObservation? folder=null)
    {
        await gate.WaitAsync(ct);
        try {
            void Current() { ct.ThrowIfCancellationRequested(); if(Volatile.Read(ref retired) != 0) throw new MirrorPolicyUnavailableException("Mirror policy connection retired."); }
            Current();
            async Task<JsonDocument> Call(string method, object? argument = null) {
                var script = "window.texttextMirrorPolicy." + method + "(" + (argument is null ? "" : JsonSerializer.Serialize(argument, Json)) + ")";
                var reply = await evaluate(script, ct).WaitAsync(timeout ?? TimeSpan.FromSeconds(5), ct);
                Current();
                return JsonDocument.Parse(reply);
            }
            void Identity(JsonElement value) {
                if(value.GetProperty("version").GetInt32() != 1 || value.GetProperty("digest").GetString() != digest ||
                   value.GetProperty("pageId").GetString() != pageId ||
                   generation is {} bound && value.GetProperty("generation").GetInt64() != bound) throw new MirrorPolicyUnavailableException("Mirror policy page changed.");
            }
            using(var hello = await Call("handshake")) {
                var next = hello.RootElement.GetProperty("pageId").GetString();
                if(string.IsNullOrEmpty(next)) throw new MirrorPolicyUnavailableException("Mirror policy page unavailable.");
                // Freeze the first identity before binding; never silently adopt a reload.
                pageId ??= next;
                Identity(hello.RootElement);
                if(generation is null) {
                    using var binding = await Call("bind", new {scope,generation=hello.RootElement.GetProperty("generation").GetInt64()});
                    Identity(binding.RootElement);
                    if(binding.RootElement.GetProperty("scope").Deserialize<MirrorScope>(Json) != scope) throw new MirrorPolicyUnavailableException("Mirror policy owner changed.");
                    generation=binding.RootElement.GetProperty("generation").GetInt64();
                }
            }
            if(observed is null && schedule is null && lifecycle is null && queue is null && sharedPath is null && tombstone is null && savedRename is null && queuedUploadPath is null && folder is null) {
                using var confirmed = await Call("handshake"); Identity(confirmed.RootElement);
                return null;
            }
            var requestId = Guid.NewGuid().ToString();
            using var result = await Call(folder is not null ? "folder" : queuedUploadPath is not null ? "queuedUploadPath" : savedRename is not null ? "savedRename" : tombstone is not null ? "tombstone" : sharedPath is not null ? "sharedPath" : queue is not null ? "queue" : lifecycle is not null ? "lifecycle" : schedule is null ? "evaluate" : "schedule", new { version = 1, digest, pageId, generation, scope, requestId, observed=(object?)folder??(object?)queuedUploadPath??(object?)savedRename??(object?)tombstone??(object?)sharedPath??(object?)queue??(object?)lifecycle??(object?)schedule??observed });
            var value = result.RootElement; Identity(value);
            if(sharedPath is not null) {
                bool Keys(JsonElement objectValue,params string[] keys)=>objectValue.ValueKind==JsonValueKind.Object&&objectValue.EnumerateObject().Select(p=>p.Name).Order(StringComparer.Ordinal).SequenceEqual(keys.Order(StringComparer.Ordinal),StringComparer.Ordinal);
                if(!Keys(value,"version","digest","pageId","generation","scope","requestId","observed","decision")||
                   !Keys(value.GetProperty("scope"),"accountId","workspaceId","lifecycle")||!Keys(value.GetProperty("decision"),"action")||
                   !Keys(value.GetProperty("observed"),"protectedProjection","baselinePath","localPath","remotePath","checkpointPath","checkpointReady","checkpointRetired","localUnique","remoteDeleted","localLifecycle","remoteLifecycle","blocked","organizePermitted","pendingRename"))throw new MirrorPolicyUnavailableException("Unknown protected path reply field.");
            }
            if(folder is not null) {
                bool Keys(JsonElement o,params string[] keys)=>o.ValueKind==JsonValueKind.Object&&o.EnumerateObject().Select(p=>p.Name).Order(StringComparer.Ordinal).SequenceEqual(keys.Order(StringComparer.Ordinal));
                if(!Keys(value,"version","digest","pageId","generation","scope","requestId","observed","decision")||!Keys(value.GetProperty("scope"),"accountId","workspaceId","lifecycle")||!Keys(value.GetProperty("decision"),"action")||!Keys(value.GetProperty("observed"),"phase","capabilityAvailable","topologyMatches","changesContained","barriers"))throw new MirrorPolicyUnavailableException("Unknown folder reply field.");
            }
            if(queuedUploadPath is not null) {
                bool Keys(JsonElement objectValue,params string[] keys)=>objectValue.ValueKind==JsonValueKind.Object&&objectValue.EnumerateObject().Select(p=>p.Name).Order(StringComparer.Ordinal).SequenceEqual(keys.Order(StringComparer.Ordinal),StringComparer.Ordinal);
                if(!Keys(value,"version","digest","pageId","generation","scope","requestId","observed","decision")||
                   !Keys(value.GetProperty("scope"),"accountId","workspaceId","lifecycle")||!Keys(value.GetProperty("decision"),"action")||
                   !Keys(value.GetProperty("observed"),"pendingKind","pendingConflicted","pendingUnique","pendingPath","pendingBaseRevision","pendingLifecycle","baselinePath","baselineRevision","baselineLifecycle","remotePath","remoteRevision","remoteLifecycle","remoteDeleted","remoteAuthoritative","localPath","localUnique","localIdentityVerified","stagedPayloadVerified","editorOwned","recoveryBlocked","permitted","intentKind","intentPath","intentDestination"))throw new MirrorPolicyUnavailableException("Unknown queued upload path reply field.");
            }
            if(savedRename is not null) {
                bool Keys(JsonElement objectValue,params string[] keys)=>objectValue.ValueKind==JsonValueKind.Object&&objectValue.EnumerateObject().Select(p=>p.Name).Order(StringComparer.Ordinal).SequenceEqual(keys.Order(StringComparer.Ordinal),StringComparer.Ordinal);
                if(!Keys(value,"version","digest","pageId","generation","scope","requestId","observed","decision")||
                   !Keys(value.GetProperty("scope"),"accountId","workspaceId","lifecycle")||!Keys(value.GetProperty("decision"),"action")||
                   !Keys(value.GetProperty("observed"),"phase","savedSource","savedDestination","savedLifecycle","stoppedLocalPath","stoppedRemotePath","stoppedLocalLifecycle","stoppedRemoteLifecycle","localPath","remotePath","baselinePath","checkpointPath","localLifecycle","remoteLifecycle","remoteDeleted","localUnique","checkpointReady","retired","scopeVerified","canOrganize","recoveryBlocked","terminalProofValid","remoteAuthoritative"))throw new MirrorPolicyUnavailableException("Unknown saved rename reply field.");
            }
            if(tombstone is not null) {
                bool Keys(JsonElement objectValue,params string[] keys)=>objectValue.ValueKind==JsonValueKind.Object&&objectValue.EnumerateObject().Select(p=>p.Name).Order(StringComparer.Ordinal).SequenceEqual(keys.Order(StringComparer.Ordinal),StringComparer.Ordinal);
                if(!Keys(value,"version","digest","pageId","generation","scope","requestId","observed","decision")||
                   !Keys(value.GetProperty("scope"),"accountId","workspaceId","lifecycle")||!Keys(value.GetProperty("decision"),"action")||
                   !Keys(value.GetProperty("observed"),"remotePresent","remoteDeleted","remoteAuthoritative","editorOwned","recoveryBlocked","localPresent","localUnique","localIdentityVerified","localHash","baselineHash","localPath","baselinePath","remotePath","baselineRevision","remoteRevision","localLifecycle","remoteLifecycle"))throw new MirrorPolicyUnavailableException("Unknown tombstone reply field.");
            }
            if(value.GetProperty("scope").Deserialize<MirrorScope>(Json) != scope || value.GetProperty("requestId").GetString() != requestId ||
               (folder is not null ? JsonSerializer.Serialize(value.GetProperty("observed").Deserialize<MirrorFolderObservation>(Json),Json)!=JsonSerializer.Serialize(folder,Json) : queuedUploadPath is not null ? value.GetProperty("observed").Deserialize<MirrorQueuedUploadPathObservation>(Json) != queuedUploadPath : savedRename is not null ? value.GetProperty("observed").Deserialize<MirrorSavedRenameObservation>(Json) != savedRename : tombstone is not null ? value.GetProperty("observed").Deserialize<MirrorTombstoneObservation>(Json) != tombstone : sharedPath is not null ? value.GetProperty("observed").Deserialize<MirrorSharedPathObservation>(Json) != sharedPath : queue is not null ? JsonSerializer.Serialize(value.GetProperty("observed").Deserialize<MirrorQueueObservation>(Json),Json) != JsonSerializer.Serialize(queue,Json) : lifecycle is not null ? value.GetProperty("observed").Deserialize<MirrorLifecycleObservation>(Json) != lifecycle : schedule is null ? value.GetProperty("observed").Deserialize<MirrorObservation>(Json) != observed : value.GetProperty("observed").Deserialize<MirrorScheduleObservation>(Json) != schedule)) throw new MirrorPolicyUnavailableException("Stale mirror policy reply.");
            // Recheck the current page after the decision RPC, before returning authority.
            using var current = await Call("handshake"); Identity(current.RootElement);
            if(folder is not null) {
                var decision=value.GetProperty("decision").Deserialize<MirrorFolderDecision>(Json)??throw new MirrorPolicyUnavailableException("Missing folder decision.");
                if(decision.Action is not ("none" or "hold" or "stage-new" or "replay-existing"))throw new MirrorPolicyUnavailableException("Invalid folder decision.");
                return decision;
            }
            if(queuedUploadPath is not null) {
                var decision=value.GetProperty("decision").Deserialize<MirrorQueuedUploadPathDecision>(Json)??throw new MirrorPolicyUnavailableException("Missing queuedUploadPath decision.");
                if(decision.Action is not ("defer" or "keep" or "reissue-at-remote-path"))throw new MirrorPolicyUnavailableException("Invalid queuedUploadPath decision.");
                return decision;
            }
            if(savedRename is not null) {
                var decision=value.GetProperty("decision").Deserialize<MirrorSavedRenameDecision>(Json)??throw new MirrorPolicyUnavailableException("Missing savedRename decision.");
                if(decision.Action is not ("hold" or "replay-saved" or "review" or "suppress-stopped" or "stage-new"))throw new MirrorPolicyUnavailableException("Invalid savedRename decision.");
                return decision;
            }
            if(tombstone is not null) {
                var decision=value.GetProperty("decision").Deserialize<MirrorTombstoneDecision>(Json)??throw new MirrorPolicyUnavailableException("Missing tombstone decision.");
                if(decision.Action is not ("defer" or "no-local" or "remove-local" or "retain-conflict"))throw new MirrorPolicyUnavailableException("Invalid tombstone decision.");
                return decision;
            }
            if(sharedPath is not null) {
                var decision=value.GetProperty("decision").Deserialize<MirrorSharedPathDecision>(Json)??throw new MirrorPolicyUnavailableException("Missing protected path decision.");
                if(decision.Action is not ("hold" or "unchanged" or "follow-remote" or "announce-local" or "adopt-path"))throw new MirrorPolicyUnavailableException("Invalid protected path decision.");
                return decision;
            }
            if(queue is not null) {
                var decision=value.GetProperty("decision").Deserialize<MirrorQueueDecision>(Json)??throw new MirrorPolicyUnavailableException("Missing mirror queue selection.");
                var ids=decision.OperationIds??throw new MirrorPolicyUnavailableException("Missing selected operation IDs.");
                var selected=ids.ToHashSet(StringComparer.Ordinal);
                if(queue.Lane is not (null or "document" or "binary") || queue.Budget is <0 or >512 || ids.Length>queue.Budget || selected.Count!=ids.Length ||
                   !queue.Candidates.Where(c=>selected.Contains(c.OperationId)).Select(c=>c.OperationId).SequenceEqual(ids,StringComparer.Ordinal))
                    throw new MirrorPolicyUnavailableException("Invalid mirror queue selection.");
                return decision;
            }
            if(lifecycle is not null) {
                var decision=value.GetProperty("decision").Deserialize<MirrorLifecycleDecision>(Json)??throw new MirrorPolicyUnavailableException("Missing mirror lifecycle decision.");
                if(decision.Baseline is not ("keep" or "adopt" or "defer") || decision.Pending is not ("none" or "keep" or "adopt" or "retire-delete" or "fence-edit" or "keep-fenced" or "defer"))
                    throw new MirrorPolicyUnavailableException("Invalid mirror lifecycle decision.");
                return decision;
            }
            if(schedule is not null) {
                var decision=value.GetProperty("decision").Deserialize<MirrorScheduleDecision>(Json)??throw new MirrorPolicyUnavailableException("Missing mirror schedule.");
                if(decision.Action is not ("run" or "wait-change" or "wait-credentials" or "wait-reopen" or "stop") ||
                   decision.ConsecutiveFailures is <0 or >6 ||
                   (decision.Action=="run" ? decision.DelayMs is null or <0 or >60_000 : decision.DelayMs is not null))throw new MirrorPolicyUnavailableException("Invalid mirror schedule.");
                return decision;
            }
            return value.GetProperty("disposition").GetString() switch {
                "upload" => MirrorDisposition.Upload, "pull" => MirrorDisposition.Pull, "idle" => MirrorDisposition.Idle,
                _ => throw new MirrorPolicyUnavailableException("Unknown mirror disposition.")
            };
        } catch(OperationCanceledException) when(ct.IsCancellationRequested) { throw; }
        catch(TimeoutException error) { Retire(); throw new MirrorPolicyTimeoutException(error); }
        catch(Exception error) { Retire();throw error is MirrorPolicyUnavailableException ? error : new MirrorPolicyUnavailableException("Mirror policy is unavailable.",error); }
        finally { gate.Release(); }
    }
}
