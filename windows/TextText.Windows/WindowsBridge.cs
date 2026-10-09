using System.IO;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using System.Collections.Concurrent;
using System.IO.Compression;
using TextText.Core;

namespace TextText.Windows;

/// <summary>Native file/account boundary. Document rendering and commands remain in the shared editor.</summary>
public sealed class WindowsBridge : INativeWorkspaceBridge
{
    readonly WorkspaceContext context;
    readonly TextPackStore files;
    readonly SyncEngine sync;
    readonly SharedEditingStore editing;
    readonly WindowsAgent agent;
    readonly ConcurrentDictionary<string, TaskCompletionSource<string>> agentTools = new();
    readonly HttpClient http = new(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(45) };
    readonly CancellationTokenSource lifetime = new();
    readonly Channel<bool> changes = Channel.CreateBounded<bool>(new BoundedChannelOptions(1) { FullMode = BoundedChannelFullMode.DropWrite });
    readonly FileSystemWatcher watcher;
    readonly Task worker;
    readonly System.Threading.Timer notification;
    readonly SemaphoreSlim requests = new(1, 1);
    WorkspaceInventory? inventory;
    long inventoryVersion;
    string? lastStatus;
    int permissionsChanged;
    long durabilityVersion, notifiedDurabilityVersion;

    public WindowsBridge(WorkspaceContext context)
    {
        this.context = context;
        var binding = TextPackStore.Hash(Encoding.UTF8.GetBytes(context.Origin.AbsoluteUri + "\n" + context.WorkspaceId + "\n" + context.Root));
        files = new(context.Root, Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "TextText", "Sync", binding));
        sync = new(files, new HttpSyncTransport(http, context.Origin, context.WorkspaceId, context.TokenProvider, context.Access == "owner"));
        editing = new(files, sync);
        agent = new(context.Root, context.WorkspaceId, context.Emit, ExecuteAgentTool);
        notification = new(_ => { if (!lifetime.IsCancellationRequested) _ = context.Emit("texttext:vault-changed", new { }); }, null, Timeout.Infinite, Timeout.Infinite);
        files.Changed += Changed;
        sync.DurabilityChanged += SyncStateChanged;
        sync.CapabilitiesChanged += PermissionStateChanged;
        watcher = new(context.Root) { IncludeSubdirectories = true, NotifyFilter = NotifyFilters.FileName | NotifyFilters.DirectoryName | NotifyFilters.LastWrite | NotifyFilters.Size };
        watcher.Changed += FileChanged; watcher.Created += FileChanged; watcher.Deleted += FileChanged; watcher.Renamed += FileChanged;
        watcher.Error += (_, _) => Changed();
        watcher.EnableRaisingEvents = true;
        worker = Task.Run(Run);
    }

    void FileChanged(object sender, FileSystemEventArgs e)
    {
        // Temporary atomic-write entries are ignored. A directory rename still invalidates the index.
        if (!e.FullPath.EndsWith(".tmp", StringComparison.OrdinalIgnoreCase)) Changed();
    }
    void Changed() { Interlocked.Increment(ref inventoryVersion); Volatile.Write(ref inventory, null); changes.Writer.TryWrite(true); if (!lifetime.IsCancellationRequested) notification.Change(200, Timeout.Infinite); }
    // Record durable state transitions, then notify readiness only after the
    // sync pass completes. Never feed acknowledgements back into Changed:
    // doing that would wake another cloud request after every acknowledgement.
    void PermissionStateChanged() => Interlocked.Exchange(ref permissionsChanged,1);
    void SyncStateChanged() => Interlocked.Increment(ref durabilityVersion);
    WorkspaceInventory Inventory() {
        var cached=Volatile.Read(ref inventory);if(cached is not null)return cached;
        var version=Volatile.Read(ref inventoryVersion);var scanned=files.ScanInventory();
        Volatile.Write(ref inventory,scanned);
        if(version!=Volatile.Read(ref inventoryVersion))Volatile.Write(ref inventory,null);
        return scanned;
    }
    PackFile Find(string id) => Inventory().Files.SingleOrDefault(file => file.ItemId == id) ?? throw new FileNotFoundException("Document is not available on this device.");
    static string Required(JsonElement p, string key) => p.GetProperty(key).GetString() ?? throw new InvalidDataException("Missing " + key);
    static string? Optional(JsonElement p, string key) => p.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
    static object Result(PackFile file) => new { path = file.Path, hash = file.Hash };

    async Task Run()
    {
        var failures = 0; var localWake = false; var lastRemotePass = DateTimeOffset.MinValue;
        try {
            while (!lifetime.IsCancellationRequested) {
                try {
                    // File saves from an active shared editor are already sent
                    // through collaboration. Local wakeups need no cloud read
                    // unless another file changed; remote discovery still runs
                    // at least every 30 seconds under continuous local typing.
                    var localOnly = localWake && failures == 0 && DateTimeOffset.UtcNow - lastRemotePass < TimeSpan.FromSeconds(30);
                    if (!localOnly) lastRemotePass = DateTimeOffset.UtcNow;
                    await sync.SyncAsync(lifetime.Token, localChangesOnly: localOnly);
                    failures = 0;
                    if(Interlocked.Exchange(ref permissionsChanged,0)!=0) await context.Emit("texttext:vault-changed",new { });
                    var status = sync.Status.Error is null ? "ready" : "conflict";
                    var completedVersion = Volatile.Read(ref durabilityVersion);
                    if (lastStatus != status || notifiedDurabilityVersion != completedVersion) {
                        lastStatus = status; notifiedDurabilityVersion = completedVersion;
                        await context.Emit("texttext:vault-sync-status", new { connected = true, available = true, onlineReady = true, hasConflicts = status == "conflict" });
                    }
                } catch (OperationCanceledException) when (lifetime.IsCancellationRequested) { break; }
                catch (Exception error) {
                    failures = Math.Min(failures + 1, 6);
                    // Report meaningful state changes, not every successful poll or retry.
                    var status = error is SyncConflictException ? "conflict" : "offline";
                    if (lastStatus != status) { lastStatus = status; await context.Emit("texttext:vault-sync-status", new { connected = true, available = true, onlineReady = false, hasConflicts = status == "conflict" }); }
                }
                using var wake = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
                wake.CancelAfter(TimeSpan.FromSeconds(failures == 0 ? 30 : Math.Min(120, 2 << failures)));
                try { await changes.Reader.ReadAsync(wake.Token); localWake = true; } catch (OperationCanceledException) when (!lifetime.IsCancellationRequested) { localWake = false; }
                while (changes.Reader.TryRead(out _)) { }
                await Task.Delay(failures == 0 ? 400 : Math.Min(30_000, 1000 << failures), lifetime.Token);
            }
        } catch (OperationCanceledException) when (lifetime.IsCancellationRequested) { }
    }

    public async Task<object?> InvokeAsync(string method, JsonElement p, CancellationToken ct)
    {
        if (method == "agentToolResult") {
            if (agentTools.TryGetValue(Required(p, "requestId"), out var tool)) {
                var error = Optional(p, "error");
                if (error is not null) tool.TrySetException(new InvalidOperationException(error));
                else tool.TrySetResult(Required(p, "result"));
            }
            return null;
        }
        if (method.StartsWith("agent", StringComparison.Ordinal)) return await agent.DispatchAsync(method, p, ct);
        await requests.WaitAsync(ct);
        try {
            return await Task.Run(async () => {
                ct.ThrowIfCancellationRequested();
                switch (method) {
                    case "files.connection": return new { connected = true, available = true, onlineReady = lastStatus == "ready", hasConflicts = lastStatus == "conflict", webURL = new Uri(context.Origin, "/vault/" + context.WorkspaceId).AbsoluteUri };
                    case "files.restoreReconcile": {
                        var itemId=Required(p,"itemId");await sync.ReconcileRestoredAsync(itemId,Required(p,"relativePath"),Required(p,"operationId"),ct);
                        Volatile.Write(ref inventory,null);
                        var restored=Find(itemId);
                        if(restored.Path!=Required(p,"relativePath")||!await sync.IsReadyAsync(itemId,ct))throw new IOException("The restored file is still downloading. Try again.");
                        return Result(restored);
                    }
                    case "files.recoveryDirectory": return files.GetRecoveryDirectory();
                    case "files.ready": return new { ready = await sync.IsReadyAsync(Required(p, "itemId"), ct) };
                    case "files.list": {
                        var capabilities = await sync.CapabilitiesAsync(ct);
                        var snapshot = Inventory();
                        var items = snapshot.Files;
                        var permissions = await sync.FilePermissionsAsync(items,context.Access == "owner",ct);
                        var folders = snapshot.Folders;
                        return (object)new { root = context.Root, name = Path.GetFileName(context.Root), folders,
                            fullAccess=capabilities?.FullAccess ?? context.Access == "owner",canCreateContent=capabilities?.CanCreateContent ?? context.Access == "owner",writableFolders=capabilities?.WritableFolders ?? [],
                            items = items.Select(f => new { canEditContent=permissions[f.ItemId],itemId = f.ItemId, relativePath = f.Path, revision = f.Hash }),
                            revision = TextPackStore.Hash(Encoding.UTF8.GetBytes(string.Join('\n', folders.Select(folder => "folder:"+folder).Concat(items.OrderBy(f => f.Path).Select(f => f.Path + ":" + f.Hash))))) };
                    }
                    case "files.read": {
                        var file = Find(Required(p, "itemId")); var data = files.Read(file.Path);
                        return new { path = file.Path, hash = TextPackStore.Hash(data), data = Convert.ToBase64String(data) };
                    }
                    case "files.text": {
                        var file = Find(Required(p, "itemId")); var data = files.Read(file.Path);
                        var markdown = TextPackStore.Markdown(data);
                        using var archive = new ZipArchive(new MemoryStream(data));
                        var document = archive.GetEntry(TextPackStore.DocumentPrefix(data) + "document.json");
                        if (document?.Length > 8 * 1024 * 1024) throw new InvalidDataException("Document snapshot exceeds size limit.");
                        string? json = null;
                        if (document is not null) { using var reader = new StreamReader(document.Open()); json = reader.ReadToEnd(); }
                        return new { path = file.Path, hash = TextPackStore.Hash(data), markdown, documentJSON = json };
                    }
                    case "files.write": {
                        var data = Convert.FromBase64String(Required(p, "data"));
                        if (TextPackStore.Identity(data) != Required(p, "itemId")) throw new InvalidDataException("Document identity does not match.");
                        return Result(files.WriteIdempotent(Required(p, "path"), data, Optional(p, "expectedHash"), Required(p, "operationId")));
                    }
                    case "files.creationResume":
                    case "files.creationWrite": {
                        var scope=Required(p,"creationScope");
                        if(scope.Length>0) _=files.Resolve(scope);
                        var capabilities=await sync.CapabilitiesAsync(ct);
                        var permissions=await sync.FilePermissionsAsync(files.Scan(),context.Access=="owner",ct);
                        void Authorize(PackFile file,bool existing) {
                            if(scope.Length>0 && !file.Path.StartsWith(scope+"/",StringComparison.Ordinal)) throw new UnauthorizedAccessException("The created file moved outside this task's folder.");
                            var allowed=existing ? permissions.TryGetValue(file.ItemId,out var editable) && editable : capabilities?.CanCreate(file.Path) ?? context.Access=="owner";
                            if(!allowed) throw new UnauthorizedAccessException("Editing access is unavailable.");
                        }
                        var created=files.CreateIdempotent(Required(p,"creationOperationId"),Required(p,"creationIntent"),Authorize,
                            method=="files.creationWrite" ? Required(p,"path") : null,
                            method=="files.creationWrite" ? Convert.FromBase64String(Required(p,"data")) : null);
                        return created is null ? null : new {path=created.Path,hash=created.Hash,itemId=created.ItemId};
                    }
                    case "files.rename": {
                        var file = Find(Required(p, "itemId")); var path = Required(p, "path");
                        files.Rename(file.Path, path, Required(p, "expectedHash")); return Result(files.Describe(path));
                    }
                    case "files.delete": {
                        var file = Find(Required(p, "itemId")); files.Delete(file.Path, Required(p, "expectedHash")); return null;
                    }
                    case "collaboration.open": {
                        var session = await editing.OpenAsync(Required(p, "itemId"), Required(p, "path"), Required(p, "hash"), ct);
                        return new { sessionToken = session.SessionToken, path = session.Document.Path, hash = session.Document.Hash,
                            acknowledgedRevision = session.Checkpoint?.AcknowledgedRevision ?? await sync.BaselineRevisionAsync(Required(p, "itemId"), ct) ?? session.Document.Hash,
                            projectedHash = session.Checkpoint?.ProjectedHash,
                            journal = session.Checkpoint?.Journal, retiredReason = session.Checkpoint?.RetiredReason,
                            // The shared client consumes this exact name; only stores that verify and archive authorized epoch adoption may announce it.
                            capabilities = SharedEditingStore.Capabilities };
                    }
                    case "collaboration.checkpoint": {
                        var file = Find(Required(p, "itemId"));
                        var bytes = Convert.FromBase64String(Required(p, "data"));
                        var checkpoint = new SharedCheckpoint(Required(p, "itemId"), file.Path, TextPackStore.Hash(bytes), Required(p, "revision"),
                            p.GetProperty("epoch").GetInt64(), p.GetProperty("seq").GetInt64(), p.GetProperty("journalGeneration").GetInt64(),
                            Required(p, "journal"), p.GetProperty("pending").GetBoolean());
                        var result = await editing.CheckpointAsync(Required(p, "sessionToken"), Required(p, "hash"), bytes, checkpoint, ct);
                        return Result(result);
                    }
                    case "collaboration.close": editing.Close(Required(p, "sessionToken")); return null;
                    case "collaboration.recover": await editing.RecoverAsync(Required(p, "sessionToken"), Required(p, "recoveryPath"), Required(p, "recoveryHash"), ct); Changed(); return null;
                    default: throw new NotSupportedException("This desktop operation is not available: " + method);
                }
            }, ct);
        } finally { requests.Release(); }
    }

    async Task<string> ExecuteAgentTool(string path, bool folder, string tool, JsonElement args, string operationId, CancellationToken ct)
    {
        if (folder) { if(path.Length > 0) _ = files.Resolve(path); } else _ = files.Resolve(path);
        if (!folder && Required(args, "path") != path) throw new InvalidDataException("The agent can only access its selected item.");
        var id = Guid.NewGuid().ToString();
        var pending = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        if (agentTools.Count >= 16 || !agentTools.TryAdd(id, pending)) throw new IOException("Too many pending agent tools.");
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct, lifetime.Token);
        timeout.CancelAfter(TimeSpan.FromSeconds(60));
        try {
            await context.Emit("texttext:windows-agent-tool", new { requestId = id, selectedPath = path, folderScope = folder, tool, arguments = args, operationId });
            return await pending.Task.WaitAsync(timeout.Token);
        } finally {
            agentTools.TryRemove(id, out _);
            if (timeout.IsCancellationRequested) await context.Emit("texttext:windows-agent-cancel", new { requestId = id });
        }
    }

    public void Dispose()
    {
        lifetime.Cancel(); agent.Dispose(); watcher.Dispose(); notification.Dispose(); files.Changed -= Changed; sync.DurabilityChanged -= SyncStateChanged; sync.CapabilitiesChanged -= PermissionStateChanged;
        // Do not race an in-flight durable write. Teardown completes after that write and the sync worker.
        _ = Task.Run(async () => {
            try { await worker; await requests.WaitAsync(); editing.Dispose(); http.Dispose(); }
            finally { requests.Release(); lifetime.Dispose(); }
        });
    }
}
