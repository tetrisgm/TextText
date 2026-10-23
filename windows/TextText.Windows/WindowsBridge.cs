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
public sealed class HandoffNotOpenException() : InvalidOperationException("Shared editing has not opened. Try connecting again.");
public sealed class WindowsBridge : INativeWorkspaceBridge
{
    readonly WorkspaceContext context;
    readonly TextPackStore files;
    readonly SyncEngine sync;
    readonly MirrorPolicy? mirrorPolicy;
    readonly SharedEditingStore editing;
    readonly Dictionary<string,string> editingItems=[];
    readonly WindowsAgent agent;
    readonly ConcurrentDictionary<string, TaskCompletionSource<string>> agentTools = new();
    readonly HttpClient http = new(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(45) };
    readonly CancellationTokenSource lifetime = new();
    readonly Channel<bool> changes = Channel.CreateBounded<bool>(new BoundedChannelOptions(1) { FullMode = BoundedChannelFullMode.DropWrite });
    readonly FileSystemWatcher watcher;
    readonly Task worker;
    readonly System.Threading.Timer notification;
    readonly SemaphoreSlim requests = new(1, 1);
    readonly object retirementGate = new();
    Task? retirement;
    WorkspaceInventory? inventory;
    readonly object inventoryGate = new();
    internal Action? BeforeInventoryScanForTesting {get;set;}
    // Keep the last valid identity while a file is briefly unreadable during an
    // external atomic replacement. A real deletion has no scan error and is not
    // retained. This prevents a live editor from being removed for a repairable
    // intermediate ZIP.
    WorkspaceInventory? lastKnownInventory;
    long inventoryVersion;
    string? lastStatus;
    bool hasSyncIssues;
    long remoteManifestCount, lastRemoteManifestUtcTicks;
    string? schedulerFailure;
    void RemoteManifestReceived() {
        Interlocked.Exchange(ref lastRemoteManifestUtcTicks, DateTimeOffset.UtcNow.Ticks);
        Interlocked.Increment(ref remoteManifestCount);
    }
    // Snapshot and events share one conservative readiness contract. A retained
    // sync issue remains visible even when the last remote request succeeded.
    object ConnectionStatus() => new {
        connected = true, available = true, connecting = schedulerFailure is null && lastStatus is null,
        onlineReady = schedulerFailure is null && lastStatus == "ready", hasConflicts = hasSyncIssues,
        authenticationRequired = lastStatus == "auth-required",
        remoteManifestResponses = Interlocked.Read(ref remoteManifestCount),
        lastRemoteManifestUtc = Interlocked.Read(ref lastRemoteManifestUtcTicks) is var ticks && ticks > 0 ? new DateTimeOffset(ticks, TimeSpan.Zero).ToString("O") : null,
        schedulerFailure,
        message = schedulerFailure is null ? null : "Sync is paused. Restart TextText to reconnect.",
        workspaceId = context.WorkspaceId,
        webURL = new Uri(context.Origin, "/vault/" + context.WorkspaceId).AbsoluteUri
    };
    int permissionsChanged;
    long durabilityVersion, notifiedDurabilityVersion;
    // Last permissions read under the sync gate. Startup listings reuse it while
    // a remote sync pass holds the gate instead of leaving the renderer blank.
    (WorkspaceCapabilities? Capabilities, IReadOnlyDictionary<string,bool> Items)? knownPermissions;
    /// <summary>Longest a readiness query waits for the sync gate. Listings use an immediate permission snapshot or their existing fallback.</summary>
    public static readonly TimeSpan GateWait = TimeSpan.FromSeconds(2);

    public static TextPackStore OpenStore(string root,Uri origin,string workspaceId,string? stateDirectory=null) {
        var binding=TextPackStore.Hash(Encoding.UTF8.GetBytes(origin.AbsoluteUri+"\n"+workspaceId+"\n"+root));
        return new(root,stateDirectory??Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"TextText","Sync",binding));
    }
    public WindowsBridge(WorkspaceContext context) : this(context, null, null) { }
    /// <summary>Tests supply the sync transport and state directory; the application always uses the HTTP transport and the per-binding state directory.</summary>
    public WindowsBridge(WorkspaceContext context, ISyncTransport? transport, string? stateDirectory)
    {
        this.context = context;
        mirrorPolicy = context.MirrorPolicyFactory?.Invoke();
        files = OpenStore(context.Root,context.Origin,context.WorkspaceId,stateDirectory);
        if(context.AccountId is { } owner)AccountRootOwnership.Open(files,context.Origin,context.WorkspaceId,owner);
        var remote = transport ?? (context.AccountId is { } actor
            ? new HttpSyncTransport(http, context.Origin, context.WorkspaceId, actor, async () => new SyncAccountCredential(await context.TokenProvider(), actor), context.Access == "owner")
            : new HttpSyncTransport(http, context.Origin, context.WorkspaceId, context.TokenProvider, context.Access == "owner"));
        sync = new(files, remote, context.AccountId, mirrorPolicy);
        editing = new(files, sync, context.AccountId);
        agent = new(context.Root, context.WorkspaceId, context.Emit, ExecuteAgentTool);
        notification = new(_ => { if (!lifetime.IsCancellationRequested) _ = context.Emit("texttext:vault-changed", new { }); }, null, Timeout.Infinite, Timeout.Infinite);
        files.Changed += Changed;
        sync.DurabilityChanged += SyncStateChanged;
        sync.RemoteManifestReceived += RemoteManifestReceived;
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
        lock(inventoryGate) {
        cached=Volatile.Read(ref inventory);if(cached is not null)return cached;
        var version=Volatile.Read(ref inventoryVersion);BeforeInventoryScanForTesting?.Invoke();var scanned=files.ScanInventory();
        var prior=Volatile.Read(ref lastKnownInventory);
        if(prior is not null && files.LastScanErrors.Count>0) {
            var errors=files.LastScanErrors.Where(error=>error.Reason=="File is invalid or temporarily unavailable. Its contents have been preserved.")
                .Select(error=>error.Path).ToHashSet(StringComparer.OrdinalIgnoreCase);
            var retained=prior.Files.Where(file=>errors.Contains(file.Path) && !scanned.Files.Any(current=>current.ItemId==file.ItemId))
                .Where(file=>{try{return File.Exists(files.Resolve(file.Path));}catch{return false;}}).ToArray();
            if(retained.Length>0) scanned=new WorkspaceInventory(scanned.Files.Concat(retained).ToArray(),scanned.Folders);
        }
        Volatile.Write(ref lastKnownInventory,scanned);
        Volatile.Write(ref inventory,scanned);
        if(version!=Volatile.Read(ref inventoryVersion))Volatile.Write(ref inventory,null);
        return scanned;
        }
    }
    /// <summary>Runs a gate-protected sync read, giving up after <see cref="GateWait"/> when a sync pass holds the gate. Returns null only for that timeout; caller cancellation still throws.</summary>
    async Task<T?> BoundedGateRead<T>(Func<CancellationToken,Task<T>> read, CancellationToken ct) where T : struct
    {
        using var bounded = CancellationTokenSource.CreateLinkedTokenSource(ct, lifetime.Token);
        bounded.CancelAfter(GateWait);
        try { return await read(bounded.Token); }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested && !lifetime.IsCancellationRequested) { return null; }
    }
    PackFile Find(string id) => Inventory().Files.SingleOrDefault(file => file.ItemId == id) ?? throw new FileNotFoundException("Document is not available on this device.");
    static string Required(JsonElement p, string key) => p.GetProperty(key).GetString() ?? throw new InvalidDataException("Missing " + key);
    static string? Optional(JsonElement p, string key) => p.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
    static object Result(PackFile file) => new { path = file.Path, hash = file.Hash };

    async Task Run()
    {
        // Busy or deferred admission does not discharge a yielded full pass.
        var rerunRequired = false;
        var failures = 0; var localWake = false; var lastRemotePass = DateTimeOffset.MinValue;
        try {
            while (!lifetime.IsCancellationRequested) {
                var outcome="success";

                try {
                    // Remote discovery remains a separate read cadence. The shared
                    // policy owns all retry and local-change debounce timing.
                    var localOnly = localWake && failures == 0 && DateTimeOffset.UtcNow - lastRemotePass < TimeSpan.FromSeconds(30);
                    SyncEngine.PassOutcome pass;
                    try { pass = await sync.SyncPassAsync(lifetime.Token, localChangesOnly: localOnly); }
                    finally {
                        if(Interlocked.Exchange(ref permissionsChanged,0)!=0 && !lifetime.IsCancellationRequested) await context.Emit("texttext:vault-changed",new { });
                    }
                    if (pass == SyncEngine.PassOutcome.ForegroundYield) rerunRequired = true;
                    else if (pass == SyncEngine.PassOutcome.Completed) rerunRequired = false;
                    if(rerunRequired) lastRemotePass=DateTimeOffset.MinValue;
                    else if(pass==SyncEngine.PassOutcome.Completed && !localOnly) lastRemotePass=DateTimeOffset.UtcNow;
                    if(pass==SyncEngine.PassOutcome.Completed) {
                    hasSyncIssues = sync.Status.Error is not null;
                    var status = hasSyncIssues ? "conflict" : "ready";
                    var completedVersion = Volatile.Read(ref durabilityVersion);
                    if (lastStatus != status || notifiedDurabilityVersion != completedVersion) {
                        lastStatus = status; notifiedDurabilityVersion = completedVersion;
                        await context.Emit("texttext:vault-sync-status", ConnectionStatus());
                    }
                    }
                } catch (OperationCanceledException) when (lifetime.IsCancellationRequested) { break; }
                catch (Exception error) {
                    outcome=MirrorFailure.Outcome(error);
                    if (outcome == "conflict") hasSyncIssues = true;
                    var status=outcome=="conflict" ? "conflict" : outcome=="auth-required" ? "auth-required" : "offline";
                    if (lastStatus != status) { lastStatus = status; await context.Emit("texttext:vault-sync-status", ConnectionStatus()); }
                }
                MirrorScheduleDecision decision;
                try {
                    if(mirrorPolicy is null)throw new MirrorPolicyUnavailableException("The shared sync policy is unavailable.");
                    decision=await mirrorPolicy.ScheduleAsync(new(outcome,failures,sync.HasEligiblePending,rerunRequired),lifetime.Token);
                } catch(OperationCanceledException) when(lifetime.IsCancellationRequested) { break; }
                catch (Exception error) {
                    schedulerFailure = MirrorFailure.Outcome(error);
                    await context.Emit("texttext:vault-sync-status", ConnectionStatus());
                    // No executable policy means no background writer or invented
                    // native retry policy. Reopening creates a new fenced host.
                    await Task.Delay(Timeout.Infinite,lifetime.Token);break;
                }
                failures=decision.ConsecutiveFailures;
                localWake=false;
                if(decision.Action is "stop" or "wait-credentials" || decision.Action=="wait-reopen"&&outcome!="storage") {
                    // Credentials are immutable on this workspace bridge. A valid
                    // sign-in/reopen retires it and constructs a fresh bridge.
                    await Task.Delay(Timeout.Infinite,lifetime.Token);break;
                }
                if(decision.Action=="run") {
                    // Filesystem notifications cannot shorten a failed pass's delay.
                    await Task.Delay(decision.DelayMs!.Value,lifetime.Token);
                    while(changes.Reader.TryRead(out _)) { }
                    continue;
                }
                if(decision.Action=="wait-reopen") {
                    // A repaired/changed local file is an explicit recovery wake.
                    // The original outbox survives; no operation is regenerated.
                    await changes.Reader.ReadAsync(lifetime.Token);
                    while(changes.Reader.TryRead(out _)) { }
                    continue;
                }
                if(outcome is "permission" or "conflict") {
                    // Read the manifest again to observe regrant/resolution. Do not
                    // treat local typing as permission to retry a denied upload.
                    await Task.Delay(TimeSpan.FromSeconds(30),lifetime.Token);
                    while(changes.Reader.TryRead(out _)) { }
                    continue;
                }
                using var wake=CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
                wake.CancelAfter(TimeSpan.FromSeconds(30));
                try { await changes.Reader.ReadAsync(wake.Token);localWake=true; }
                catch(OperationCanceledException) when(!lifetime.IsCancellationRequested) { }
                while(changes.Reader.TryRead(out _)) { }
                if(localWake) {
                    try {
                        var debounce=await mirrorPolicy!.ScheduleAsync(new("success",0,false,true),lifetime.Token);
                        if(debounce.Action!="run"||debounce.DelayMs is null)throw new MirrorPolicyUnavailableException("Invalid wake schedule.");
                        await Task.Delay(debounce.DelayMs.Value,lifetime.Token);
                    } catch(OperationCanceledException) when(lifetime.IsCancellationRequested) { break; }
                    catch { await Task.Delay(Timeout.Infinite,lifetime.Token);break; }
                }
            }
        } catch(OperationCanceledException) when(lifetime.IsCancellationRequested) { }
    }

    public async Task<object?> InvokeAsync(string method, JsonElement p, CancellationToken ct)
    {
        using var requestLifetime=CancellationTokenSource.CreateLinkedTokenSource(ct,lifetime.Token);
        ct=requestLifetime.Token;ct.ThrowIfCancellationRequested();
        if (method == "agentToolResult") {
            if (agentTools.TryGetValue(Required(p, "requestId"), out var tool)) {
                var error = Optional(p, "error");
                if (error is not null) tool.TrySetException(new InvalidOperationException(error));
                else tool.TrySetResult(Required(p, "result"));
            }
            return null;
        }
        if (method.StartsWith("agent", StringComparison.Ordinal)) return await agent.DispatchAsync(method, p, ct);
        // Read-only queries never wait behind mutations. Mutations and collaboration
        // calls can wait for the sync gate without a bound (a slow first remote pass
        // holds it for the whole manifest download), and the renderer abandons a
        // bootstrap listing after 8 seconds. Reads only touch the file store under
        // its own lock, the cached inventory, and gate-bounded sync state.
        if (IsRead(method)) return await Task.Run(() => Execute(method, p, ct), ct);
        await requests.WaitAsync(ct);
        try { return await Task.Run(() => Execute(method, p, ct), ct); }
        finally { requests.Release(); }
    }

    static bool IsRead(string method) => method is "files.connection" or "files.recoveryDirectory" or "files.ready" or "files.list" or "files.read" or "files.text"
        or "collaboration.localHandoffConfig" or "files.savedFileMoveList" or "files.savedFileMoveRead" or "files.folderSyncMoveList" or "files.folderSyncMoveRead" or "files.folderRenameList" or "files.folderRenameRead" or "files.replacementList" or "files.replacementRead" or "files.recoveryAssets" or "files.recoveryAssetRead";

    static object FolderRenameRow(TextPackStore.FolderRenameRecoveryEntry entry) => new {
        id=entry.Id,fromPath=entry.FromPath,toPath=entry.ToPath,expectedIdentity=entry.ExpectedIdentity,
        from=new {present=entry.From.Present,identity=entry.From.Identity},
        to=new {present=entry.To.Present,identity=entry.To.Identity},
        inspection=entry.Inspection,summary=entry.Summary,resolutionBlocked=entry.ResolutionBlocked,resolved=entry.Resolved
    };

    static object? FolderSyncWire(object? value)=>value is null?null:JsonSerializer.SerializeToElement(value,new JsonSerializerOptions{PropertyNamingPolicy=JsonNamingPolicy.CamelCase});
    static object FolderSyncMoveRow(SyncEngine.FolderSyncRecoveryEntry row) => new {
        id=row.Id,command=JsonSerializer.SerializeToElement(row.Command,new JsonSerializerOptions{PropertyNamingPolicy=JsonNamingPolicy.CamelCase}),state=row.State,requestHash=row.RequestHash,expectedIdentity=row.ExpectedIdentity,
        from=new{present=row.From.Present,identity=row.From.Identity},to=new{present=row.To.Present,identity=row.To.Identity},localInspection=row.LocalInspection,inspection=row.Inspection,manifestRevision=row.ManifestRevision,folders=row.Folders,
        items=FolderSyncWire(row.Items),result=FolderSyncWire(row.Result),resolutionBlocked=row.ResolutionBlocked
    };

    void RequireReplacementScope(JsonElement parameters,CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        if(Required(parameters,"workspaceRoot")!=context.Root)throw new IOException("This recovery belongs to another workspace.");
        if(Required(parameters,"workspaceId")!=context.WorkspaceId||Optional(parameters,"accountId")!=context.AccountId)throw new SharedAccountMismatchException();
        if(context.AccountId is {} owner) {
            if(!File.Exists(Path.Combine(files.StateDirectory,AccountRootOwnership.FileName)))throw new IOException("Recovery ownership is unavailable. Restore its retained ownership record before continuing.");
            AccountRootOwnership.Open(files,context.Origin,context.WorkspaceId,owner);
        }
    }
    T ReplacementScope<T>(JsonElement parameters,CancellationToken ct,Func<T> action)
    {
        RequireReplacementScope(parameters,ct);var result=action();RequireReplacementScope(parameters,ct);return result;
    }

    async Task<object?> Execute(string method, JsonElement p, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        switch (method) {
            case "files.connection": return ConnectionStatus();
            case "files.restoreReconcile": {
                var itemId=Required(p,"itemId");await sync.ReconcileRestoredAsync(itemId,Required(p,"relativePath"),Required(p,"operationId"),ct);
                Volatile.Write(ref inventory,null);
                var restored=Find(itemId);
                if(restored.Path!=Required(p,"relativePath")||!await sync.IsReadyAsync(itemId,ct))throw new IOException("The restored file is still downloading. Try again.");
                return Result(restored);
            }
            case "files.recoveryDirectory": return files.GetRecoveryDirectory();
            case "files.savedFileMoveList": {
                RequireReplacementScope(p,ct);
                var page=await sync.SavedFileMoveRecoveryListAsync(ct,Optional(p,"path"));
                RequireReplacementScope(p,ct);
                return new {entries=page.Entries.Select(row=>FolderSyncWire(row)).ToArray(),truncated=page.Truncated};
            }
            case "files.savedFileMoveRead": {
                RequireReplacementScope(p,ct);
                var row=await sync.SavedFileMoveRecoveryReadAsync(Required(p,"id"),ct);
                RequireReplacementScope(p,ct);return FolderSyncWire(row);
            }
            case "files.retrySavedFileMove":
            case "files.keepSavedFileMoveNames": {
                RequireReplacementScope(p,ct);
                if(!p.TryGetProperty("consent",out var consent)||consent.ValueKind!=JsonValueKind.True)
                    throw new InvalidDataException("Inspect the saved move and confirm this action before continuing.");
                var operationId=Required(p,"id");var requestHash=Required(p,"requestHash");var inspection=Required(p,"inspection");
                if(method=="files.retrySavedFileMove")
                    await sync.RetrySavedFileMoveAsync(operationId,requestHash,inspection,true,()=>RequireReplacementScope(p,ct),ct);
                else await sync.KeepSavedFileMoveNamesAsync(operationId,requestHash,inspection,true,()=>RequireReplacementScope(p,ct),ct);
                RequireReplacementScope(p,ct);Changed();return new {resolved=true};
            }
            case "files.folderSyncMoveList": {
                RequireReplacementScope(p,ct);var row=await sync.FolderMoveRecoveryReadAsync(ct);RequireReplacementScope(p,ct);return row is null?Array.Empty<object>():new[]{FolderSyncMoveRow(row)};
            }
            case "files.folderSyncMoveRead": {
                RequireReplacementScope(p,ct);var row=await sync.FolderMoveRecoveryReadAsync(ct);RequireReplacementScope(p,ct);if(row is null||row.Id!=Required(p,"id"))throw new FileChangedException();return FolderSyncMoveRow(row);
            }
            case "files.resolveFolderSyncMove": {
                RequireReplacementScope(p,ct);if(!p.TryGetProperty("consent",out var consent)||consent.ValueKind!=JsonValueKind.True||!p.TryGetProperty("inspection",out var inspection)||inspection.ValueKind is not(JsonValueKind.Null or JsonValueKind.String))throw new InvalidDataException("Explicit fresh folder review is required.");
                await sync.ResolveFolderMoveRecoveryAsync(Required(p,"id"),inspection.ValueKind==JsonValueKind.Null?null:inspection.GetString(),Required(p,"localInspection"),Required(p,"requestHash"),()=>RequireReplacementScope(p,ct),ct);RequireReplacementScope(p,ct);Changed();return new{resolved=true};
            }
            case "files.folderRenameList": return ReplacementScope(p,ct,()=>files.FolderRenameRecoveryList().Select(FolderRenameRow).ToArray());
            case "files.folderRenameRead": return ReplacementScope(p,ct,()=>FolderRenameRow(files.FolderRenameRecoveryRead(Required(p,"id"))));
            case "files.resolveFolderRename": return ReplacementScope(p,ct,()=>{
                files.ResolveFolderRename(Required(p,"id"),Required(p,"fromPath"),Required(p,"toPath"),Required(p,"inspection"),()=>RequireReplacementScope(p,ct));
                Changed();return new {resolved=true};
            });
            case "files.replacementList": return ReplacementScope(p,ct,()=>files.ReplacementRecoveryList().Select(entry=>new {
                id=entry.Id,path=entry.Path,itemId=entry.ItemId,currentHash=entry.CurrentHash,preparedHash=entry.PreparedHash,displacedHash=entry.DisplacedHash,savedAt=entry.SavedAt,resolved=entry.Resolved,kind=entry.Kind,currentPresent=entry.CurrentPresent,captured=entry.Captured,resolutionBlocked=entry.ResolutionBlocked,sourcePath=entry.SourcePath,sourcePresent=entry.SourcePresent,sourceHash=entry.SourceHash }).ToArray());
            case "files.replacementRead": return ReplacementScope(p,ct,()=>{
                var file=files.ReplacementRecoveryRead(Required(p,"id"),Required(p,"version"));
                if(file.Absent)return (object)new {absent=true,path=file.Path,hash=(string?)null,data=(string?)null};
                if(file.Data is null||file.Hash is null)throw new InvalidDataException("Recovery bytes are unavailable. Reopen Recovery.");
                return new {path=file.Path,hash=file.Hash,itemId=file.ItemId,data=Convert.ToBase64String(file.Data),opaque=file.Opaque,parseError=file.ParseError};
            });
            case "files.resolveMove": return ReplacementScope(p,ct,()=>{
                var present=p.GetProperty("currentPresent").GetBoolean();
                var sourcePresent=p.GetProperty("sourcePresent").GetBoolean();
                var captured=p.GetProperty("captured").GetBoolean();
                if(Required(p,"kind")!="move" ||
                   (!present&&p.GetProperty("currentHash").ValueKind!=JsonValueKind.Null) ||
                   (!sourcePresent&&p.GetProperty("sourceHash").ValueKind!=JsonValueKind.Null) ||
                   (!captured&&p.GetProperty("displacedHash").ValueKind!=JsonValueKind.Null))
                    throw new InvalidDataException("The inspected move changed. Reopen Recovery.");
                files.ResolveMove(Required(p,"id"),Required(p,"path"),Required(p,"sourcePath"),Required(p,"itemId"),Required(p,"preparedHash"),
                    captured?Required(p,"displacedHash"):null,captured,present,present?Required(p,"currentHash"):null,
                    sourcePresent,sourcePresent?Required(p,"sourceHash"):null,()=>RequireReplacementScope(p,ct));
                Changed();return new {resolved=true};
            });
            case "files.resolveReplacement": return ReplacementScope(p,ct,()=>{
                var kind=p.TryGetProperty("kind",out var kindValue)?kindValue.GetString():"replacement";
                var present=!p.TryGetProperty("currentPresent",out var presenceValue)||presenceValue.GetBoolean();
                if(kind is not ("replacement" or "removal")||(!present&&(kind!="removal"||!p.TryGetProperty("currentHash",out var hashValue)||hashValue.ValueKind!=JsonValueKind.Null)))throw new InvalidDataException("The inspected file changed. Reopen Recovery.");
                files.ResolveReplacement(Required(p,"id"),Required(p,"path"),Required(p,"itemId"),present?Required(p,"currentHash"):null,Required(p,"preparedHash"),Required(p,"displacedHash"),()=>RequireReplacementScope(p,ct),currentPresent:present,kind:kind);
                Changed();return new {resolved=true};
            });
            case "files.cancelUncapturedDeletion": return ReplacementScope(p,ct,()=>{
                var present=p.GetProperty("currentPresent").GetBoolean();
                if(!present&&(!p.TryGetProperty("currentHash",out var hashValue)||hashValue.ValueKind!=JsonValueKind.Null))throw new InvalidDataException("The inspected file changed. Reopen Recovery.");
                files.CancelUncapturedDeletion(Required(p,"id"),Required(p,"path"),Required(p,"itemId"),Required(p,"preparedHash"),present,present?Required(p,"currentHash"):null,()=>RequireReplacementScope(p,ct));
                Changed();return new {resolved=true};
            });
            case "files.recoveryAssets": return ReplacementScope(p,ct,()=>{
                var page=files.RecoveryAssets();
                return new {assets=page.Assets.Select(entry=>new {id=entry.Id,filename=entry.Filename,byteLength=entry.ByteLength,hash=entry.Hash,savedAt=entry.SavedAt,entryPath=entry.EntryPath,itemPath=entry.ItemPath,provenanceError=entry.ProvenanceError}).ToArray(),assetsTruncated=page.Truncated};
            });
            case "files.recoveryAssetRead": return ReplacementScope(p,ct,()=>{
                var file=files.RecoveryAssetRead(Required(p,"id"),Required(p,"hash"));
                return new {data=Convert.ToBase64String(file.Data),hash=file.Hash,filename=file.Filename,byteLength=file.Data.Length};
            });
            case "files.ready": {
                // Readiness decides whether the editor joins shared editing now. While a
                // sync pass holds the gate the document opens locally and is promoted
                // after the pass reports status, so answering "not ready" is safe.
                var itemId = Required(p, "itemId");
                var ready = await BoundedGateRead(gated => sync.IsReadyAsync(itemId, gated), ct);
                return new { ready = ready ?? false };
            }
            case "files.list": {
                var snapshot = Inventory();
                var items = snapshot.Files;
                var owner = context.Access == "owner";
                var read = sync.TryListingPermissions(items, owner);
                if (read is { } current) knownPermissions = current;
                else {
                    // The remote pass holds the gate. Serve the last authoritative permissions
                    // (or the ownership default) and refresh the renderer once the pass ends.
                    Interlocked.Exchange(ref permissionsChanged, 1);
                }
                var (capabilities, permissions) = read ?? knownPermissions ?? (null, new Dictionary<string,bool>());
                var folders = snapshot.Folders;
                return (object)new { root = context.Root, name = Path.GetFileName(context.Root), folders,
                    fullAccess=capabilities?.FullAccess ?? owner,canCreateContent=capabilities?.CanCreateContent ?? owner,writableFolders=capabilities?.WritableFolders ?? [],
                    items = items.Select(f => new { canEditContent=permissions.TryGetValue(f.ItemId,out var allowed) ? allowed : capabilities?.CanWrite(f.ItemId,f.Path,false) ?? owner,itemId = f.ItemId, relativePath = f.Path, revision = f.Hash }),
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
            case "collaboration.localHandoffConfig": {
                if(p.ValueKind!=JsonValueKind.Object||p.EnumerateObject().Any())throw new InvalidDataException("Invalid local handoff configuration request.");
                if(string.IsNullOrWhiteSpace(context.AccountId))return null;
                AccountRootOwnership.Open(files,context.Origin,context.WorkspaceId,context.AccountId);
                return RetainedReplacementProfile.SupportsLocalHandoff(files)?new {version=1,profileVersion=4}:null;
            }
            case "collaboration.open": {
                var handoff=p.TryGetProperty("localHandoffVersion",out var requested);
                if(p.EnumerateObject().Any(field=>field.Name is not("itemId" or "path" or "hash" or "localHandoffVersion")))throw new InvalidDataException("Invalid collaboration open fields.");
                var itemId=Required(p,"itemId");var path=Required(p,"path");var hash=Required(p,"hash");
                if(handoff) {
                    if(requested.ValueKind!=JsonValueKind.Number||!requested.TryGetInt32(out var version)||version!=1)throw new InvalidDataException("Unsupported local handoff version.");
                    ct.ThrowIfCancellationRequested();
                    if(string.IsNullOrWhiteSpace(context.AccountId))throw new SharedAccountMismatchException();
                    try {AccountRootOwnership.Open(files,context.Origin,context.WorkspaceId,context.AccountId);RetainedReplacementProfile.PrepareLocalHandoff(files);}
                    catch(RetainedReplacementProfile.PreparationBusyException) {
                        ct.ThrowIfCancellationRequested();
                        RetainedReplacementProfile.RequireLocalHandoffPrincipal(files,context.Origin,context.WorkspaceId,context.AccountId);
                        if(editingItems.Values.Contains(itemId))throw;
                        throw new HandoffNotOpenException();
                    }
                }
                var session = await editing.OpenAsync(itemId,path,hash,ct);
                editingItems[session.SessionToken]=itemId;
                return new { sessionToken = session.SessionToken, path = session.Document.Path, hash = session.Document.Hash,
                    acknowledgedRevision = session.Checkpoint?.AcknowledgedRevision ?? await sync.BaselineRevisionAsync(itemId, ct) ?? session.Document.Hash,
                    projectedHash = session.Checkpoint?.ProjectedHash,
                    journal = session.Checkpoint?.Journal, retiredReason = session.Checkpoint?.RetiredReason,
                    // The shared client consumes this exact name; only stores that verify and archive authorized epoch adoption may announce it.
                    capabilities = SharedEditingStore.Capabilities, localHandoff=handoff?new {version=1,profileVersion=4}:null };
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
            case "collaboration.close": {var token=Required(p,"sessionToken");editing.Close(token);editingItems.Remove(token);return null;}
            case "collaboration.recover": {var token=Required(p,"sessionToken");await editing.RecoverAsync(token,Required(p,"recoveryPath"),Required(p,"recoveryHash"),ct);editingItems.Remove(token);Changed();return null;}
            default: throw new NotSupportedException("This desktop operation is not available: " + method);
        }
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

    public void Dispose() => _ = RetireAsync();
    public Task RetireAsync() {
        lock(retirementGate)return retirement??=RetireCoreAsync();
    }
    private async Task RetireCoreAsync()
    {
        mirrorPolicy?.Retire();
        lifetime.Cancel(); agent.Dispose(); watcher.Dispose(); notification.Dispose(); files.Changed -= Changed; sync.RemoteManifestReceived -= RemoteManifestReceived; sync.DurabilityChanged -= SyncStateChanged; sync.CapabilitiesChanged -= PermissionStateChanged;
        // Await the worker and every entered bridge operation before releasing
        // editing leases. Recovery can then prove that this writer has retired.
        try { await worker; }
        finally {
            await requests.WaitAsync();
            try { editing.Dispose(); http.Dispose(); }
            finally { requests.Release(); lifetime.Dispose(); }
        }
    }
}
