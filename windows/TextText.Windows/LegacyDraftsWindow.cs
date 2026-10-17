using System.IO;
using System.Windows;
using System.Windows.Controls;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
namespace TextText.Windows;

/// Reads the historical profile without attaching a native workspace bridge or
/// credentials. The bundled viewer has no network transport or storage writes.
public sealed class LegacyDraftsWindow : Window
{
    readonly WebView2 view = new();
    bool closed;
    const string Page="https://texttext.local/legacy-recovery.html";
    public LegacyDraftsWindow(string profile)
    {
        Title="Older TextText drafts";Width=900;Height=720;MinWidth=600;MinHeight=420;
        var status=new TextBlock{Text="Opening older drafts…",Margin=new Thickness(24),TextWrapping=TextWrapping.Wrap};Content=status;
        Loaded+=async(_,_)=> {
            try {
                if(!Directory.Exists(profile)) {status.Text="No older TextText profile was found for this workspace.";return;}
                Content=view;
                var environment=await CoreWebView2Environment.CreateAsync(null,profile);
                if(closed)return;
                await view.EnsureCoreWebView2Async(environment);
                if(closed)return;
                var core=view.CoreWebView2;
                core.Settings.AreHostObjectsAllowed=false;core.Settings.IsPasswordAutosaveEnabled=false;core.Settings.IsGeneralAutofillEnabled=false;core.Settings.AreDevToolsEnabled=false;
                core.SetVirtualHostNameToFolderMapping("texttext.local",Path.Combine(AppContext.BaseDirectory,"Assets"),CoreWebView2HostResourceAccessKind.DenyCors);
                core.AddWebResourceRequestedFilter("*",CoreWebView2WebResourceContext.All);
                core.WebResourceRequested+=(_,e)=> {
                    if(e.Request.Uri is not (Page or "https://texttext.local/legacy-recovery.js"))
                        e.Response=environment.CreateWebResourceResponse(null,403,"Unavailable","");
                };
                core.NavigationStarting+=(_,e)=>{if(e.Uri!=Page&&!e.Uri.StartsWith("blob:https://texttext.local/",StringComparison.Ordinal))e.Cancel=true;};
                core.NewWindowRequested+=(_,e)=>e.Handled=true;
                core.PermissionRequested+=(_,e)=>e.State=CoreWebView2PermissionState.Deny;
                core.DownloadStarting+=(_,e)=> {
                    if(core.Source!=Page||!e.DownloadOperation.Uri.StartsWith("blob:https://texttext.local/",StringComparison.Ordinal)){e.Cancel=true;return;}
                    var save=new Microsoft.Win32.SaveFileDialog{Title="Save recovery copy",FileName=Path.GetFileName(e.ResultFilePath),OverwritePrompt=true};
                    e.Handled=true;if(save.ShowDialog(this)==true)e.ResultFilePath=save.FileName;else e.Cancel=true;
                };
                core.Navigate(Page);
            } catch {if(!closed){status.Text="The older profile could not be opened. Close other TextText windows and try again. Its saved records remain on this device.";Content=status;}}
        };
        Closed+=(_,_)=>{closed=true;view.Dispose();};
    }
}
