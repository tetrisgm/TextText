using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.Json;

namespace TextText.Windows;

/// <summary>Private app-server process. No model credentials or process messages cross into WebView.</summary>
public sealed class WindowsAgent : IDisposable
{
    private readonly string root, workspaceId;
    private readonly Func<string,object?,Task> emit;
    private readonly Func<string,bool,string,JsonElement,CancellationToken,Task<string>> tools;
    private readonly SemaphoreSlim write = new(1), commands = new(1);
    private readonly ConcurrentDictionary<string,TaskCompletionSource<JsonElement>> pending = new();
    private readonly CancellationTokenSource lifetime = new();
    private Process? process;
    private CancellationTokenSource? taskCancellation;
    private string state = "disconnected", message = "", email = "", taskId = "", selectedPath = "", threadId = "", turnId = "", loginId = "";
    private long generation;
    private bool folderTask, customizing, restoreAttempted;
    private readonly ConcurrentDictionary<string,TaskCompletionSource<bool>> proposals = new();
    private int disposed, activeNotifications;
    private readonly string runtime;
    private readonly string[] runtimePrefix;
    private readonly Action<Uri> openBrowser;
    public WindowsAgent(string root,string workspaceId,Func<string,object?,Task> emit,Func<string,bool,string,JsonElement,CancellationToken,Task<string>> executeTool,string? runtimePath = null,string[]? runtimePrefixArguments = null,Action<Uri>? launchBrowser = null)
    { openBrowser = launchBrowser ?? (uri => Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true })); runtime = runtimePath ?? Path.Combine(AppContext.BaseDirectory,"Runtime","bin","codex.exe"); runtimePrefix = runtimePrefixArguments ?? []; this.root = Path.GetFullPath(root); this.workspaceId = workspaceId; this.emit = emit; tools = executeTool; }
    public object Status => new { state, message, accountEmail = string.IsNullOrEmpty(email) ? null : email, available = File.Exists(runtime) };
    private async Task Update(string next,string text = "") { state = next; message = text; await emit("texttext:vault-agent",new { type = "status",state,message,accountEmail = email }); }
    public async Task<object?> DispatchAsync(string method,JsonElement parameters,CancellationToken ct)
    {
        if(method == "agentStatus") {
            // Restore once on demand. Status polling must never open an OAuth page
            // or repeatedly spawn a signed-out runtime.
            if(!restoreAttempted && state == "disconnected" && File.Exists(runtime)) {
                using var restore = CancellationTokenSource.CreateLinkedTokenSource(ct,lifetime.Token);
                restore.CancelAfter(TimeSpan.FromSeconds(15));
                await commands.WaitAsync(restore.Token);
                try {
                    if(!restoreAttempted) {
                        restoreAttempted = true;
                        try { await Connect(restore.Token,allowLogin:false); }
                        catch { /* Connect records a recoverable failure; explicit Connect can retry. */ }
                    }
                } finally { commands.Release(); }
            }
            return Status;
        }
        if(method == "agentCancel") { if(Get(parameters,"taskId") == taskId) await Cancel(); return Status; }
        if(method == "agentProposalResult") { if(Get(parameters,"taskId") == taskId && proposals.TryGetValue(Get(parameters,"proposalId"),out var proposal)) proposal.TrySetResult(parameters.TryGetProperty("valid",out var valid) && valid.GetBoolean()); return Status; }
        await commands.WaitAsync(ct);
        try {
            switch(method) {
                case "agentConnect": await Connect(ct); break;
                case "agentDisconnect": await Cancel(); if(process is not null) await Call("account/logout",new {},ct); Stop(); email = ""; await Update("disconnected"); break;
                case "agentSend": await Send(parameters,ct); break;
                case "agentCancel": if(Get(parameters,"taskId") == taskId) await Cancel(); break;
                default: throw new InvalidOperationException("Unknown agent operation.");
            }
            return Status;
        } finally { commands.Release(); }
    }
    private async Task Connect(CancellationToken ct,bool allowLogin = true)
    {
        restoreAttempted = true;
        if(state == "ready" || state == "working" || state == "connecting") return;
        if(!File.Exists(runtime)) { await Update("failed","This build does not include the Codex runtime."); return; }
        Stop();
        var home = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"TextText","Agent",workspaceId);
        Directory.CreateDirectory(home);
        var start = new ProcessStartInfo(runtime) { UseShellExecute = false,CreateNoWindow = true,RedirectStandardInput = true,RedirectStandardOutput = true,RedirectStandardError = true,StandardInputEncoding = new UTF8Encoding(false),StandardOutputEncoding = new UTF8Encoding(false),StandardErrorEncoding = new UTF8Encoding(false),WorkingDirectory = home };
        foreach(var argument in runtimePrefix) start.ArgumentList.Add(argument);
        start.ArgumentList.Add("app-server");
        start.Environment["CODEX_HOME"] = home;
        // Never inherit a provider key from a developer shell into a user's agent.
        start.Environment.Remove("OPENAI_API_KEY"); start.Environment.Remove("CODEX_API_KEY");
        process = Process.Start(start) ?? throw new InvalidOperationException("Codex could not start.");
        var current = process;
        _ = Pump(current);
        _ = Drain(current.StandardError);
        await Update("connecting");
        try {
            await Call("initialize",new { clientInfo = new { name = "texttext-windows",title = "TextText",version = "1" },capabilities = new { experimentalApi = true } },ct);
            await Write(new { method = "initialized",@params = new {} });
            var account = await Call("account/read",new {},ct);
            if(await AcceptAccount(account)) return;
            if(!allowLogin) { await Update("disconnected"); return; }
            var result = await Call("account/login/start",new { type = "chatgpt" },ct);
            var url = Get(result,"authUrl"); loginId = Get(result,"loginId");
            if(!Uri.TryCreate(url,UriKind.Absolute,out var uri) || uri.Scheme != "https" || uri.UserInfo.Length != 0 || (uri.Host != "auth.openai.com" && uri.Host != "chatgpt.com")) throw new InvalidOperationException("Invalid authorization address.");
            openBrowser(uri);
            await Update("connecting","Finish signing in to ChatGPT in your browser.");
            _ = LoginTimeout(loginId);
        } catch { Stop(); await Update("failed","Codex could not connect. Please try again."); throw; }
    }
    private async Task LoginTimeout(string expected)
    { try { await Task.Delay(TimeSpan.FromMinutes(10),lifetime.Token); if(loginId == expected && state == "connecting") { Stop(); await Update("signed-out","Sign-in expired. Connect again."); } } catch(OperationCanceledException) {} }
    private async Task<bool> AcceptAccount(JsonElement result)
    {
        if(!result.TryGetProperty("account",out var account) || account.ValueKind != JsonValueKind.Object || Get(account,"type") != "chatgpt") return false;
        email = Get(account,"email"); loginId = ""; await Update("ready"); return true;
    }
    private async Task Send(JsonElement parameters,CancellationToken ct)
    {
        if(state != "ready") throw new InvalidOperationException("Connect Codex before starting a task.");
        string path = Get(parameters,"path"), prompt = Get(parameters,"prompt"), id = Get(parameters,"taskId");
        string imageUrl = Get(parameters,"imageUrl");
        var requestedFolder = Get(parameters,"scope") == "folder";
        if(requestedFolder) { if(path.Length > 0 || imageUrl.Length > 0 || parameters.TryGetProperty("customizing",out var folderCustom) && folderCustom.GetBoolean()) throw new InvalidOperationException("Choose either an item or folder task."); path = Get(parameters,"folderPath"); }
        if(imageUrl.Length > 0) {
            const string prefix = "data:image/jpeg;base64,";
            if(imageUrl.Length > 1_000_000 || !imageUrl.StartsWith(prefix,StringComparison.Ordinal)) throw new InvalidOperationException("The selected photo could not be prepared.");
            byte[] image;
            try { image = Convert.FromBase64String(imageUrl[prefix.Length..]); }
            catch(FormatException) { throw new InvalidOperationException("The selected photo could not be prepared."); }
            if(image.Length < 3 || image[0] != 0xff || image[1] != 0xd8 || image[2] != 0xff) throw new InvalidOperationException("The selected photo could not be prepared.");
            if(parameters.TryGetProperty("customizing",out var imageCustom) && imageCustom.GetBoolean()) throw new InvalidOperationException("Choose an item photo task first.");
        }
        if(!requestedFolder && path.Length == 0 || path.Length > 1024 || id.Length == 0 || id.Length > 128 || prompt.Length == 0 || prompt.Length > 16000) throw new InvalidOperationException("Choose an item and a task.");
        var full = Path.GetFullPath(Path.Combine(root,path));
        if(!(requestedFolder && full == Path.GetFullPath(root)) && !full.StartsWith(root + Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase) || path.Contains('\\') || path.Split('/').Any(segment => segment is ".." or ".")) throw new InvalidOperationException("Invalid item path.");
        // Resolve through the same scope-validating store as tool calls before asking a model anything.
        await tools(path,requestedFolder,requestedFolder ? "list_files" : "read_file",JsonSerializer.SerializeToElement(new { path }),ct);
        folderTask = requestedFolder;
        selectedPath = path; taskId = id; threadId = ""; turnId = "";
        customizing = parameters.TryGetProperty("customizing",out var custom) && custom.GetBoolean();
        taskCancellation = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token); taskCancellation.CancelAfter(TimeSpan.FromMinutes(10));
        var token = taskCancellation.Token; var fence = Interlocked.Increment(ref generation);
        _ = TaskDeadline(fence,token);
        await Update("working");
        try {
            var config = await Call("config/read",new { includeLayers = false },token);
            var servers = new Dictionary<string,object>();
            if(config.TryGetProperty("config",out var configuration) && configuration.TryGetProperty("mcp_servers",out var mcp) && mcp.ValueKind == JsonValueKind.Object) foreach(var server in mcp.EnumerateObject()) servers[server.Name] = new { enabled = false };
            var features = new Dictionary<string,object>();
            foreach(var name in new[] { "shell_tool","unified_exec","shell_snapshot","apps","hooks","plugins","remote_plugin","multi_agent","browser_use","browser_use_external","computer_use","in_app_browser","skill_search" }) features[name] = false;
            features["code_mode"] = new { direct_only_tool_namespaces = new[] { "texttext" } };
            var result = await Call("thread/start",new { approvalPolicy = "never",sandbox = "read-only",ephemeral = true,cwd = root,
                developerInstructions = "You are TextText's assistant. Use only the supplied texttext tools within the selected " + (folderTask ? "folder boundary: " : "file: ") + path + ". Read before editing and use its exact hash. Preserve other changes. Never use shell, filesystem, skills, web or other integrations. For read-only requests do not write. " + (customizing ? "Only propose a template preview; do not write." : ""),
                dynamicTools = new[] { new { type = "namespace",name = "texttext",description = "Selected TextText item tools",tools = Definitions(customizing,folderTask) } },
                config = new { mcp_servers = servers,features,agents = new { enabled = false },tools = new { view_image = false },web_search = "disabled",project_doc_max_bytes = 0 } },token);
            token.ThrowIfCancellationRequested(); if(fence != generation) return;
            threadId = result.GetProperty("thread").GetProperty("id").GetString()!;
            var input = new List<object> { new { type = "text",text = prompt } };
            if(imageUrl.Length > 0) input.Add(new { type = "image",url = imageUrl });
            var turn = await Call("turn/start",new { threadId,input,approvalPolicy = "never" },token);
            if(fence == generation && turn.TryGetProperty("turn",out var started)) turnId = Get(started,"id");
        } catch { if(fence == generation) { await emit("texttext:vault-agent",new { type = "error",taskId = id,message = "The task could not start. Your files are preserved." }); await Update("ready"); } throw; }
    }
    private async Task TaskDeadline(long fence,CancellationToken token)
    {
        try { await Task.Delay(Timeout.Infinite,token); } catch(OperationCanceledException) {
            if(disposed == 0 && generation == fence && taskId.Length > 0) {
                var id = taskId; await Cancel();
                await emit("texttext:vault-agent",new { type = "error",taskId = id,message = "The task timed out. Completed saves are preserved." });
            }
        }
    }
    private static object[] Definitions(bool design,bool folder = false)
    {
        object Tool(string name,string description,string[] required,params string[] properties) => new { type = "function",name,description,inputSchema = new { type = "object",properties = properties.ToDictionary(key => key,key => new { type = "string" }),required,additionalProperties = false } };
        var itemTools = new[] { Tool("read_file","Read the selected TextPack and revision hash.",new[]{"path"},"path"),
          design ? Tool("propose_template","Preview a complete declarative template without writing.",new[]{"path","hash","templateJSON"},"path","hash","templateJSON","templateAuthoringSourceJSON")
          : Tool("write_file","Update selected TextPack with exact read hash, preserving assets.",new[]{"path","hash","markdown"},"path","hash","markdown","documentJSON","templateJSON","templateAuthoringSourceJSON") };
        return folder ? itemTools.Concat(new[] { Tool("list_files","List files in the selected folder.",Array.Empty<string>()), Tool("create_file","Create a TextPack in the selected folder.",new[]{"title","body"},"title","body","folder","kind") }).ToArray() : itemTools;
    }
    static bool FolderToolAllowed(string folder,string tool,JsonElement args) {
        if(tool == "list_files") return true;
        if(tool is not ("create_file" or "read_file" or "write_file")) return false;
        var path = Get(args,tool == "create_file" ? "folder" : "path");
        if(tool == "create_file" && !args.TryGetProperty("folder",out _)) path = folder;
        if(path.Contains('\\') || path.Contains(':') || path.Split('/').Any(p => p is "." or "..")) return false;
        return folder.Length == 0 || path.StartsWith(folder+"/",StringComparison.Ordinal) || tool == "create_file" && path == folder;
    }
    private async Task Cancel()
    {
        var id = taskId; Interlocked.Increment(ref generation); taskCancellation?.Cancel();
        foreach(var proposal in proposals.Values) proposal.TrySetCanceled(); proposals.Clear();
        if(process is not null && threadId.Length > 0 && turnId.Length > 0) { try { await Call("turn/interrupt",new { threadId,turnId },lifetime.Token); } catch {} }
        taskId = ""; threadId = ""; turnId = ""; taskCancellation?.Dispose(); taskCancellation = null;
        if(id.Length > 0) await emit("texttext:vault-agent",new { type = "turn-cancelled",taskId = id,message = "Stopped. Completed saves are preserved." });
        if(process is not null) await Update("ready");
    }
    private async Task Pump(Process current)
    {
        try {
            var buffer = new char[8192]; var line = new StringBuilder();
            while(!lifetime.IsCancellationRequested) {
                var count = await current.StandardOutput.ReadAsync(buffer.AsMemory(),lifetime.Token); if(count == 0) break;
                for(var i=0;i<count;i++) { if(buffer[i] == '\n') { if(line.Length > 0) { using var json = JsonDocument.Parse(line.ToString()); var value = json.RootElement.Clone(); line.Clear(); if(value.TryGetProperty("id",out var id) && !value.TryGetProperty("method",out _)) { if(pending.TryRemove(id.ToString(),out var request)) { if(value.TryGetProperty("error",out _)) request.TrySetException(new InvalidOperationException("Codex rejected the request.")); else request.TrySetResult(value.GetProperty("result").Clone()); } } else { if(Interlocked.Increment(ref activeNotifications) > 64) { Interlocked.Decrement(ref activeNotifications); throw new InvalidOperationException("Too many agent notifications."); } _ = Handle(value,current); } } } else { line.Append(buffer[i]); if(line.Length > 4 * 1024 * 1024) throw new InvalidOperationException("Agent message exceeds limit."); } }
            }
        } catch {} finally { if(ReferenceEquals(process,current)) { Stop(); if(disposed == 0) await Update("failed","Codex stopped. Completed saves are preserved."); } }
    }
    private async Task Drain(StreamReader reader) { try { var buffer = new char[4096]; while(await reader.ReadAsync(buffer.AsMemory(),lifetime.Token) > 0) {} } catch {} }
    private async Task Handle(JsonElement value,Process source)
    {
        try {
            if(!ReferenceEquals(process,source)) return;
            var method = Get(value,"method"); var p = value.TryGetProperty("params",out var parameters) ? parameters : JsonSerializer.SerializeToElement(new {});
            if(method == "account/login/completed" && Get(p,"loginId") == loginId && loginId.Length > 0) { if(p.TryGetProperty("success",out var success) && success.GetBoolean()) await AcceptAccount(await Call("account/read",new {},lifetime.Token)); else await Update("signed-out","Sign-in did not complete. Connect again."); return; }
            var fence = generation; var id = taskId; var token = taskCancellation?.Token ?? new CancellationToken(true);
            if(id.Length == 0 || token.IsCancellationRequested || Get(p,"threadId") != threadId) return;
            if(method == "turn/started") { turnId = p.GetProperty("turn").GetProperty("id").GetString()!; return; }
            if(method == "item/tool/call" && value.TryGetProperty("id",out var callId)) {
                var tool = Get(p,"tool"); var args = p.GetProperty("arguments");
                var success = false; var text = "The tool is unavailable for this task.";
                if(Get(p,"namespace") == "texttext" && (folderTask ? FolderToolAllowed(selectedPath,tool,args) : Get(args,"path") == selectedPath && (tool == "read_file" || tool == (customizing ? "propose_template" : "write_file")))) {
                    await emit("texttext:vault-agent",new { type = "tool-call",taskId = id,tool,path = selectedPath });
                    try {
                        token.ThrowIfCancellationRequested();
                        text = await tools(selectedPath,folderTask,tool,args,token);
                        token.ThrowIfCancellationRequested(); success = true;
                        if(tool == "propose_template") {
                            var proposalId = Guid.NewGuid().ToString(); var completion = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously); proposals[proposalId] = completion;
                            try { await emit("texttext:vault-agent",new { type = "template-proposal",taskId = id,proposalId,path = selectedPath,hash = Get(args,"hash"),templateJSON = Get(args,"templateJSON"),templateAuthoringSourceJSON = Get(args,"templateAuthoringSourceJSON") }); success = await completion.Task.WaitAsync(TimeSpan.FromSeconds(30),token); } finally { proposals.TryRemove(proposalId,out _); }
                        }
                    } catch { text = "The file changed or the operation was stopped. Read it again before trying an edit."; success = false; }
                }
                if(fence == generation) await Write(new { id = callId,result = new { success,contentItems = new[] { new { type = "inputText",text = text.Length > 2_000_000 ? text[..2_000_000] : text } } } });
                return;
            }
            if(method == "item/completed" && p.TryGetProperty("item",out var item) && Get(item,"type") == "agentMessage" && Get(item,"phase") == "final_answer") await emit("texttext:vault-agent",new { type = "final-text",taskId = id,text = Get(item,"text")[..Math.Min(Get(item,"text").Length,24000)] });
            if(method == "turn/completed") { var turn = p.GetProperty("turn"); var ok = Get(turn,"status") == "completed"; await emit("texttext:vault-agent",new { type = ok ? "turn-completed" : "error",taskId = id,message = ok ? "" : "The task stopped before completion. Completed saves are preserved." }); if(fence == generation) { taskId = ""; taskCancellation?.Cancel(); taskCancellation?.Dispose(); taskCancellation = null; await Update("ready"); } }
        } catch { /* Malformed or obsolete notifications cannot authorize a tool. */ }
        finally { Interlocked.Decrement(ref activeNotifications); }
    }
    private async Task<JsonElement> Call(string method,object parameters,CancellationToken ct)
    {
        if(pending.Count >= 64) throw new InvalidOperationException("Too many agent requests.");
        var id = Guid.NewGuid().ToString(); var completion = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously); pending[id] = completion;
        try { await Write(new { id,method,@params = parameters }); return await completion.Task.WaitAsync(TimeSpan.FromSeconds(30),ct); }
        finally { pending.TryRemove(id,out _); }
    }
    private async Task Write(object value)
    {
        await write.WaitAsync(lifetime.Token);
        try { var current = process ?? throw new InvalidOperationException("Codex is not connected."); await current.StandardInput.WriteLineAsync(JsonSerializer.Serialize(value)); await current.StandardInput.FlushAsync(); }
        finally { write.Release(); }
    }
    private static string Get(JsonElement value,string name) => value.ValueKind == JsonValueKind.Object && value.TryGetProperty(name,out var property) && property.ValueKind == JsonValueKind.String ? property.GetString()! : "";
    private void Stop()
    {
        Interlocked.Increment(ref generation); taskCancellation?.Cancel(); var current = process; process = null;
        if(current is not null) { try { if(!current.HasExited) current.Kill(true); } catch {} current.Dispose(); }
        foreach(var request in pending.Values) request.TrySetException(new InvalidOperationException("Codex stopped.")); pending.Clear();
        foreach(var proposal in proposals.Values) proposal.TrySetCanceled(); proposals.Clear();
        loginId = ""; taskId = ""; threadId = ""; turnId = "";
    }
    public void Dispose() { if(Interlocked.Exchange(ref disposed,1) != 0) return; lifetime.Cancel(); Stop(); }
}
