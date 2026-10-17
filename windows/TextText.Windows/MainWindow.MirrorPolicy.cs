using System.IO;
using System.Text.Json;
using Microsoft.Web.WebView2.Wpf;
using TextText.Core;

namespace TextText.Windows;

public sealed partial class MainWindow
{
    private MirrorPolicy CreateMirrorPolicy(WebView2 view, Account owner, Task pageReady)
    {
        var bytes=File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory,"Assets","mirror-policy.json"));
        if(bytes.Length>4096)throw new IOException("Reopen TextText to reconnect this folder.");
        using var manifest=JsonDocument.Parse(bytes);
        var digest=manifest.RootElement.GetProperty("digest").GetString();
        if(manifest.RootElement.GetProperty("version").GetInt32()!=1 || digest is null || digest.Length!=64 ||
           !System.Text.RegularExpressions.Regex.IsMatch(digest,"^[a-f0-9]{64}$"))throw new IOException("Reopen TextText to reconnect this folder.");
        return new MirrorPolicy(digest,new(owner.AccountId??"legacy",owner.WorkspaceId,Guid.NewGuid().ToString()),async(script,ct)=>{
            await pageReady.WaitAsync(ct);
            var request=await Dispatcher.InvokeAsync(()=>{
                ct.ThrowIfCancellationRequested();
                if(!ReferenceEquals(web,view)||view.CoreWebView2 is not {} core||!IsLocal(core.Source))throw new IOException("The workspace page changed.");
                return core.ExecuteScriptAsync(script);
            });
            return await request.WaitAsync(ct);
        });
    }
}
