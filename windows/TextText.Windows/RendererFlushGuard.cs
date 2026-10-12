using System.Text.Json;
namespace TextText.Windows;

/// <summary>Keep the native file bridge alive until the editor acknowledges durable persistence.</summary>
public sealed class RendererFlushGuard
{
    private (string Id,TaskCompletionSource<bool> Completion)? pending;
    private string lastOutcome = "none";
    public bool Accept(string id,bool success)
    {
        if(pending is not { } request || request.Id != id) return false;
        return request.Completion.TrySetResult(success);
    }
    public async Task<bool> FlushAsync(Func<string,Task> executeScript,TimeSpan? timeout = null)
    {
        if(pending is not null) { lastOutcome = "busy"; return false; }
        var id = Guid.NewGuid().ToString(); var completion = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        pending = (id,completion);
        // ExecuteScriptAsync itself does not await a JavaScript Promise. The explicit reply does.
        var script = "void (async()=>{let ok=false,reason='missing-hook';try{if(typeof window.texttextFlushForSignOut==='function'){reason='rejected';ok=await window.texttextFlushForSignOut()===true;if(ok)reason='saved'}}catch{reason='exception'}window.__texttextNativeFlushDiagnostic={reason,at:Date.now()};window.chrome.webview.postMessage({id:" + JsonSerializer.Serialize(id) + ",method:'native.flushResult',params:{ok}});})()";
        try {
            // Both WebView2 dispatch and the JavaScript acknowledgement can stall.
            // Bound the entire operation, not only the acknowledgement phase.
            var deadline = timeout ?? TimeSpan.FromSeconds(30);
            using var limit = new CancellationTokenSource(deadline);
            await executeScript(script).WaitAsync(limit.Token);
            var accepted = await completion.Task.WaitAsync(limit.Token);
            lastOutcome = accepted ? "saved" : "rejected";
            return accepted;
        }
        catch (OperationCanceledException) { lastOutcome = "timeout"; return false; }
        catch (Exception error) { lastOutcome = "dispatch:" + error.GetType().Name; return false; }
        finally { pending = null; }
    }
}
