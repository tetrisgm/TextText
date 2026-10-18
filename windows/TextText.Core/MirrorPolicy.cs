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
public sealed record MirrorQueueCandidate(string OperationId,bool Conflicted,bool EditorOwned,bool RecoveryBlocked,bool Permitted);
public sealed record MirrorQueueObservation(MirrorQueueCandidate[] Candidates,int Budget);
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

    public async Task ReadyAsync(CancellationToken ct = default) => await ExecuteAsync(null,null,null,null,ct);
    public async Task<MirrorDisposition> DecideAsync(MirrorObservation observed, CancellationToken ct = default) =>
        (MirrorDisposition)(await ExecuteAsync(observed,null,null,null,ct) ?? throw new MirrorPolicyUnavailableException("Missing mirror disposition."));
    public async Task<MirrorScheduleDecision> ScheduleAsync(MirrorScheduleObservation observed,CancellationToken ct=default) =>
        (MirrorScheduleDecision)(await ExecuteAsync(null,observed,null,null,ct) ?? throw new MirrorPolicyUnavailableException("Missing mirror schedule."));

    public async Task<MirrorLifecycleDecision> LifecycleAsync(MirrorLifecycleObservation observed,CancellationToken ct=default) =>
        (MirrorLifecycleDecision)(await ExecuteAsync(null,null,observed,null,ct) ?? throw new MirrorPolicyUnavailableException("Missing mirror lifecycle decision."));

    public async Task<MirrorQueueDecision> QueueAsync(MirrorQueueObservation observed,CancellationToken ct=default) =>
        (MirrorQueueDecision)(await ExecuteAsync(null,null,null,observed,ct) ?? throw new MirrorPolicyUnavailableException("Missing mirror queue selection."));

    private async Task<object?> ExecuteAsync(MirrorObservation? observed, MirrorScheduleObservation? schedule, MirrorLifecycleObservation? lifecycle, MirrorQueueObservation? queue, CancellationToken ct)
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
            if(observed is null && schedule is null && lifecycle is null && queue is null) {
                using var confirmed = await Call("handshake"); Identity(confirmed.RootElement);
                return null;
            }
            var requestId = Guid.NewGuid().ToString();
            using var result = await Call(queue is not null ? "queue" : lifecycle is not null ? "lifecycle" : schedule is null ? "evaluate" : "schedule", new { version = 1, digest, pageId, generation, scope, requestId, observed=(object?)queue??(object?)lifecycle??(object?)schedule??observed });
            var value = result.RootElement; Identity(value);
            if(value.GetProperty("scope").Deserialize<MirrorScope>(Json) != scope || value.GetProperty("requestId").GetString() != requestId ||
               (queue is not null ? JsonSerializer.Serialize(value.GetProperty("observed").Deserialize<MirrorQueueObservation>(Json),Json) != JsonSerializer.Serialize(queue,Json) : lifecycle is not null ? value.GetProperty("observed").Deserialize<MirrorLifecycleObservation>(Json) != lifecycle : schedule is null ? value.GetProperty("observed").Deserialize<MirrorObservation>(Json) != observed : value.GetProperty("observed").Deserialize<MirrorScheduleObservation>(Json) != schedule)) throw new MirrorPolicyUnavailableException("Stale mirror policy reply.");
            // Recheck the current page after the decision RPC, before returning authority.
            using var current = await Call("handshake"); Identity(current.RootElement);
            if(queue is not null) {
                var decision=value.GetProperty("decision").Deserialize<MirrorQueueDecision>(Json)??throw new MirrorPolicyUnavailableException("Missing mirror queue selection.");
                var ids=decision.OperationIds??throw new MirrorPolicyUnavailableException("Missing selected operation IDs.");
                var selected=ids.ToHashSet(StringComparer.Ordinal);
                if(queue.Budget is <0 or >512 || ids.Length>queue.Budget || selected.Count!=ids.Length ||
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
