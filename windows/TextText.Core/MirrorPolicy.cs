using System.Text.Json;

namespace TextText.Core;

public sealed record MirrorObservation(string LocalHash, string BaselineHash, string RemoteRevision, string BaselineRevision, bool Refresh);
public sealed record MirrorScope(string AccountId, string WorkspaceId, string Lifecycle);
public enum MirrorDisposition { Upload, Pull, Idle }

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

    public async Task<MirrorDisposition> DecideAsync(MirrorObservation observed, CancellationToken ct = default)
    {
        await gate.WaitAsync(ct);
        try {
            void Current() { ct.ThrowIfCancellationRequested(); if(Volatile.Read(ref retired) != 0) throw new IOException("Mirror policy connection retired."); }
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
                   generation is {} bound && value.GetProperty("generation").GetInt64() != bound) throw new IOException("Mirror policy page changed.");
            }
            using(var hello = await Call("handshake")) {
                var next = hello.RootElement.GetProperty("pageId").GetString();
                if(string.IsNullOrEmpty(next)) throw new IOException("Mirror policy page unavailable.");
                // Freeze the first identity before binding; never silently adopt a reload.
                pageId ??= next;
                Identity(hello.RootElement);
                if(generation is null) {
                    using var binding = await Call("bind", new {scope,generation=hello.RootElement.GetProperty("generation").GetInt64()});
                    Identity(binding.RootElement);
                    if(binding.RootElement.GetProperty("scope").Deserialize<MirrorScope>(Json) != scope) throw new IOException("Mirror policy owner changed.");
                    generation=binding.RootElement.GetProperty("generation").GetInt64();
                }
            }
            var requestId = Guid.NewGuid().ToString();
            using var result = await Call("evaluate", new { version = 1, digest, pageId, generation, scope, requestId, observed });
            var value = result.RootElement; Identity(value);
            if(value.GetProperty("scope").Deserialize<MirrorScope>(Json) != scope || value.GetProperty("requestId").GetString() != requestId ||
               value.GetProperty("observed").Deserialize<MirrorObservation>(Json) != observed) throw new IOException("Stale mirror policy reply.");
            // Recheck the current page after the decision RPC, before returning authority.
            using var current = await Call("handshake"); Identity(current.RootElement);
            return value.GetProperty("disposition").GetString() switch {
                "upload" => MirrorDisposition.Upload, "pull" => MirrorDisposition.Pull, "idle" => MirrorDisposition.Idle,
                _ => throw new IOException("Unknown mirror disposition.")
            };
        } catch(TimeoutException) { Retire(); throw; }
        finally { gate.Release(); }
    }
}
