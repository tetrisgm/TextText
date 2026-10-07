using System.Text.Json;
namespace TextText.Windows;

/// <summary>Keep the native file bridge alive until the editor acknowledges durable persistence.</summary>
public sealed class RendererFlushGuard
{
    private (string Id,TaskCompletionSource<bool> Completion)? pending;
    public bool Accept(string id,bool success)
    {
        if(pending is not { } request || request.Id != id) return false;
        return request.Completion.TrySetResult(success);
    }
    public async Task<bool> FlushAsync(Func<string,Task> executeScript,TimeSpan? timeout = null)
    {
        if(pending is not null) return false;
        var id = Guid.NewGuid().ToString(); var completion = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        pending = (id,completion);
        // ExecuteScriptAsync itself does not await a JavaScript Promise. The explicit reply does.
        var script = "void (async()=>{let ok=false;try{ok=typeof window.texttextFlushForSignOut==='function' && await window.texttextFlushForSignOut()===true;}catch{}window.chrome.webview.postMessage({id:" + JsonSerializer.Serialize(id) + ",method:'native.flushResult',params:{ok}});})()";
        try { await executeScript(script); return await completion.Task.WaitAsync(timeout ?? TimeSpan.FromSeconds(30)); }
        catch { return false; }
        finally { pending = null; }
    }
}
