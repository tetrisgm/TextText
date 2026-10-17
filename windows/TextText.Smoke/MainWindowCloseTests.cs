using System.Collections;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Windows;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using TextText.Windows;

/// <summary>Exercise the production window's Closing -> flush -> Receive path.
/// Reflection is confined to this test executable: the app's login, credential
/// store and production workspace are never opened or changed.</summary>
static class MainWindowCloseTests
{
    const BindingFlags PrivateInstance=BindingFlags.Instance|BindingFlags.NonPublic;
    static FieldInfo Field(string name)=>typeof(MainWindow).GetField(name,PrivateInstance)??throw new Exception("Missing window field: "+name);
    static void Check(bool condition,string label,List<string> checks){if(!condition)throw new Exception(label);checks.Add(label);Console.WriteLine("PASS "+label);}
    internal static void RemoveProductionLoaded(MainWindow window)
    {
        // Constructor subscribes an anonymous Loaded callback that reads real
        // credentials. Remove exactly that callback before showing this fixture.
        var property=typeof(UIElement).GetProperty("EventHandlersStore",PrivateInstance)??throw new Exception("Cannot isolate Loaded handler.");
        var store=property.GetValue(window)??throw new Exception("Missing Loaded event store.");
        var method=store.GetType().GetMethod("GetRoutedEventHandlers",BindingFlags.Instance|BindingFlags.Public|BindingFlags.NonPublic)??throw new Exception("Cannot inspect Loaded handlers.");
        var handlers=method.Invoke(store,[FrameworkElement.LoadedEvent]) as IEnumerable??throw new Exception("Missing production Loaded handler.");
        var count=0;
        foreach(var handler in handlers){var callback=(Delegate)(handler!.GetType().GetProperty("Handler")?.GetValue(handler)??throw new Exception("Cannot isolate Loaded callback."));window.RemoveHandler(FrameworkElement.LoadedEvent,callback);count++;}
        if(count!=1)throw new Exception("Unexpected production Loaded handlers; stop rather than touch credentials.");
    }
    sealed record Fixture(MainWindow Window,WebView2 View);
    static async Task<Fixture> Create(string root,CancellationToken ct)
    {
        Directory.CreateDirectory(root);var assets=Path.Combine(root,"assets");Directory.CreateDirectory(assets);
        await File.WriteAllTextAsync(Path.Combine(assets,"index.html"),"<!doctype html><title>TextText close fixture</title><p>Isolated native close verification</p>",ct);
        var window=new MainWindow();RemoveProductionLoaded(window);window.Title="TextText isolated MainWindow close test";
        var view=new WebView2();Field("web").SetValue(window,view);window.Content=view;window.Show();
        try {
            var environment=await CoreWebView2Environment.CreateAsync(null,Path.Combine(root,"profile"));await view.EnsureCoreWebView2Async(environment);
            view.CoreWebView2.SetVirtualHostNameToFolderMapping("texttext.local",assets,CoreWebView2HostResourceAccessKind.DenyCors);
            view.CoreWebView2.NavigationStarting+=(_,e)=>{if(!e.Uri.StartsWith("https://texttext.local/",StringComparison.Ordinal))e.Cancel=true;};
            var receive=typeof(MainWindow).GetMethod("Receive",PrivateInstance)??throw new Exception("Missing production Receive method.");
            view.CoreWebView2.WebMessageReceived+=(EventHandler<CoreWebView2WebMessageReceivedEventArgs>)receive.CreateDelegate(typeof(EventHandler<CoreWebView2WebMessageReceivedEventArgs>),window);
            var ready=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);view.CoreWebView2.NavigationCompleted+=(_,e)=>{if(e.IsSuccess)ready.TrySetResult();else ready.TrySetException(new Exception("Fixture navigation failed."));};
            view.CoreWebView2.Navigate("https://texttext.local/index.html");await ready.Task.WaitAsync(ct);
            return new(window,view);
        }catch{ForceClose(window);throw;}
    }
    static void ForceClose(MainWindow window){Field("closing").SetValue(window,true);window.Close();}
    static async Task Until(Func<Task<bool>> condition,CancellationToken ct){using var bounded=CancellationTokenSource.CreateLinkedTokenSource(ct);bounded.CancelAfter(TimeSpan.FromSeconds(8));while(!await condition()){await Task.Delay(40,bounded.Token);}}
    sealed class ActivationBridge : INativeWorkspaceBridge
    {
        public int Calls;
        public Task<object?> InvokeAsync(string method, JsonElement parameters, CancellationToken cancellationToken) { Calls++; return Task.FromResult<object?>(null); }
        public void Dispose() { }
    }
    public static async Task RunAsync(string root,string receipts,CancellationToken ct)
    {
        var checks=new List<string>();
        await AccountRecoveryTests.RunAsync(root,receipts,ct);
        var stalledGuard=new RendererFlushGuard();
        var neverDispatched=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        Check(!await stalledGuard.FlushAsync(_=>neverDispatched.Task,TimeSpan.FromMilliseconds(120)),"stalled WebView dispatch is bounded and fails closed",checks);
        Check(!await stalledGuard.FlushAsync(_=>Task.CompletedTask,TimeSpan.FromMilliseconds(120)),"missing renderer acknowledgment is bounded and fails closed",checks);
        var fenced=await Create(Path.Combine(root,"retired-sender"),ct);
        var replacement=new WebView2();var fencedBridge=new ActivationBridge();
        try {
            Field("bridge").SetValue(fenced.Window,fencedBridge);
            var rejectedRoot=Path.Combine(root,"rejected-workspace");Directory.CreateDirectory(Path.Combine(rejectedRoot,".texttext"));
            await File.WriteAllTextAsync(Path.Combine(rejectedRoot,".texttext","workspace-binding.json"),"{invalid",ct);
            Field("account").SetValue(fenced.Window,new Account("isolated-not-a-token",Guid.NewGuid().ToString(),"Isolated"));
            Field("root").SetValue(fenced.Window,root);
            var open=typeof(MainWindow).GetMethod("OpenWorkspace",PrivateInstance)!;
            var rejected=false;
            try { await ((Task)open.Invoke(fenced.Window,[rejectedRoot,null,null,null])!); } catch(IOException) { rejected=true; }
            Check(rejected&&ReferenceEquals(Field("web").GetValue(fenced.Window),fenced.View)&&ReferenceEquals(Field("bridge").GetValue(fenced.Window),fencedBridge)&&(string)Field("root").GetValue(fenced.Window)! == root,"failed workspace preparation preserves previous view bridge and root",checks);
            Field("web").SetValue(fenced.Window,replacement);
            await fenced.View.ExecuteScriptAsync("window.chrome.webview.postMessage({id:'retired-write',method:'files.write',params:{}})");
            await Task.Delay(150,ct);
            Check(fencedBridge.Calls==0,"retired WebView cannot dispatch writes to replacement bridge",checks);
            Field("web").SetValue(fenced.Window,fenced.View);
            await fenced.View.ExecuteScriptAsync("window.chrome.webview.postMessage({id:'current-write',method:'files.write',params:{}})");
            await Until(()=>Task.FromResult(fencedBridge.Calls==1),ct);
            Check(fencedBridge.Calls==1,"current view remains usable after rejected retired request",checks);
            var savedFactory=MainWindow.WorkspaceFactory;
            try {
                var bridgeCreations=0; MainWindow.WorkspaceFactory=_=>{bridgeCreations++;return new ActivationBridge();};
                var preparedRoot=Path.Combine(root,"prepared-workspace");Directory.CreateDirectory(preparedRoot);
                var failed=false;
                try { await ((Task)open.Invoke(fenced.Window,[preparedRoot,(Action)(()=>throw new IOException("isolated commit failure")),null,null])!).WaitAsync(TimeSpan.FromSeconds(15),ct); }
                catch(IOException){failed=true;}
                Check(failed&&ReferenceEquals(Field("web").GetValue(fenced.Window),fenced.View)&&fenced.Window.IsVisible,"failed initialized workspace switch restores usable previous presentation",checks);
                var flushRejected=false; var beforeFailedFlush=bridgeCreations;
                try { await ((Task)open.Invoke(fenced.Window,[preparedRoot,null,null,(Func<Task>)(()=>throw new IOException("isolated flush failure"))])!).WaitAsync(TimeSpan.FromSeconds(15),ct); }
                catch(IOException){flushRejected=true;}
                Check(flushRejected&&bridgeCreations==beforeFailedFlush&&ReferenceEquals(Field("web").GetValue(fenced.Window),fenced.View)&&ReferenceEquals(Field("bridge").GetValue(fenced.Window),fencedBridge),"failed prepared editor flush preserves previous workspace and bridge",checks);
                await ((Task)open.Invoke(fenced.Window,[preparedRoot,null,null,null])!).WaitAsync(TimeSpan.FromSeconds(15),ct);
                var initialized=(WebView2)Field("web").GetValue(fenced.Window)!;
                await Until(async()=>await initialized.ExecuteScriptAsync("location.host === 'texttext.local' && document.readyState === 'complete'")=="true",ct);
                Check(initialized.IsLoaded&&initialized.ActualWidth>100&&initialized.CoreWebView2 is not null,"production OpenWorkspace initializes attached visible native view",checks);
            }finally{MainWindow.WorkspaceFactory=savedFactory;}
        } finally { replacement.Dispose();ForceClose(fenced.Window); }
        var success=await Create(Path.Combine(root,"close-success"),ct);
        try {
            var closed=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);success.Window.Closed+=(_,_)=>closed.TrySetResult();
            var closedSource=success.View.CoreWebView2;
            await success.View.ExecuteScriptAsync("window.flushStarted=false;window.texttextFlushForNativeClose=()=>new Promise(resolve=>{window.flushStarted=true;window.finishFlush=()=>resolve({ok:true,durability:{workspaceId:'fixture',itemId:'item',lifecycle:'life',generation:3,outcome:'durable'}})});");
            success.Window.Close();
            await Until(async()=>await success.View.ExecuteScriptAsync("window.flushStarted") == "true",ct);
            Check(success.Window.IsVisible&&!closed.Task.IsCompleted,"actual MainWindow waits for pending editor flush",checks);
            Check(!success.View.IsEnabled,"native close fences editor input before awaiting durability",checks);
            await Task.Delay(120,ct);Check(!closed.Task.IsCompleted,"MainWindow does not treat ExecuteScript completion as durable ACK",checks);
            try {await success.View.ExecuteScriptAsync("window.finishFlush()");}catch(Exception)when(closed.Task.IsCompleted){ /* Closing disposes WebView before its script callback can return. */ }
            await closed.Task.WaitAsync(TimeSpan.FromSeconds(8),ct);
            Check(!success.Window.IsVisible,"actual MainWindow Receive routes flushResult and closes",checks);
            var durableResult=(Field("flushGuard").GetValue(success.Window) as RendererFlushGuard)?.LastDurability;
            Check(durableResult is { Outcome:"durable",Generation:3,WorkspaceId:"fixture" },"native close guard retains typed renderer durability result",checks);
            var lateReply=typeof(MainWindow).GetMethod("ReplyForSource",PrivateInstance)??throw new Exception("Missing native reply path.");
            lateReply.Invoke(success.Window,[closedSource,new { id="late-close-reply" }]);
            Check(true,"late native reply after WebView disposal does not crash the dispatcher",checks);
        }finally{if(success.Window.IsVisible)ForceClose(success.Window);}

        var emptyHome=await Create(Path.Combine(root,"close-empty-home"),ct);
        try {
            var closed=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            emptyHome.Window.Closed+=(_,_)=>closed.TrySetResult();
            await emptyHome.View.ExecuteScriptAsync("window.texttextFlushForNativeClose=async()=>({ok:true,idle:true,durability:{outcome:'durable'}})");
            emptyHome.Window.Close();
            await closed.Task.WaitAsync(TimeSpan.FromSeconds(8),ct);
            Check(!emptyHome.Window.IsVisible,"an explicitly empty home screen closes without a document receipt",checks);
        }finally{if(emptyHome.Window.IsVisible)ForceClose(emptyHome.Window);}

        var localFile=await Create(Path.Combine(root,"close-local-file"),ct);
        try {
            var closed=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            localFile.Window.Closed+=(_,_)=>closed.TrySetResult();
            await localFile.View.ExecuteScriptAsync("window.texttextFlushForNativeClose=async()=>({ok:true,idle:false,durability:{workspaceId:'fixture',itemId:'item',lifecycle:'local-file:Note.textpack',fileHash:'saved-hash',outcome:'local-file-durable'}})");
            localFile.Window.Close();
            await closed.Task.WaitAsync(TimeSpan.FromSeconds(8),ct);
            Check(!localFile.Window.IsVisible,"a saved local TextPack closes with its file receipt",checks);
        }finally{if(localFile.Window.IsVisible)ForceClose(localFile.Window);}

        var transient=await Create(Path.Combine(root,"close-transient"),ct);
        try {
            var closed=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            transient.Window.Closed+=(_,_)=>closed.TrySetResult();
            await transient.View.ExecuteScriptAsync("window.flushCalls=0;window.texttextFlushForNativeClose=async()=>{window.flushCalls++;return window.flushCalls>1?{ok:true,durability:{workspaceId:'fixture',itemId:'item',lifecycle:'life',generation:3,outcome:'durable'}}:{ok:true,durability:{outcome:'durable'}}};");
            transient.Window.Close();
            await closed.Task.WaitAsync(TimeSpan.FromSeconds(8),ct);
            Check(!transient.Window.IsVisible,"incomplete durability receipt retries and closes after a complete acknowledgement",checks);
        }finally{if(transient.Window.IsVisible)ForceClose(transient.Window);}

        var failure=await Create(Path.Combine(root,"close-failure"),ct);var observedDialog=0;
        // Win32 MessageBox runs a native modal loop; a DispatcherTimer is not a
        // reliable observer inside that loop. Poll only this fixture UI thread
        // from a bounded worker timer and click its exact expected dialog button.
        var uiThread=GetCurrentThreadId();var seen=new HashSet<string>();
        using var dismiss=new System.Threading.Timer(timerState=>EnumThreadWindows(uiThread,(handle,state)=>{
            var title=new StringBuilder(256);GetWindowText(handle,title,title.Capacity);var caption=title.ToString();
            lock(seen)if(seen.Add(caption))Console.WriteLine("close-test window: "+caption);
            if(caption=="Keep editing"){
                Interlocked.Exchange(ref observedDialog,1);var button=GetDlgItem(handle,1);
                var sent=SendMessageTimeout(handle,0x0111,new IntPtr(1),button,0x0002,1000,out _);
                if(sent==IntPtr.Zero)Console.WriteLine("close-test dialog command failed: "+Marshal.GetLastWin32Error());
                PostMessage(handle,0x0010,IntPtr.Zero,IntPtr.Zero);
            }return true;
        },IntPtr.Zero),null,Timeout.Infinite,Timeout.Infinite);
        try {
            var closed=false;failure.Window.Closed+=(_,_)=>closed=true;
            await failure.View.ExecuteScriptAsync("window.texttextFlushForNativeClose=async()=>({ok:false,durability:{outcome:'storage-unavailable'}});");dismiss.Change(0,40);failure.Window.Close();
            await Until(()=>Task.FromResult(Volatile.Read(ref observedDialog)==1&&!(bool)Field("transitioning").GetValue(failure.Window)!),ct);
            Check(Volatile.Read(ref observedDialog)==1,"actual MainWindow handles failed renderer flush",checks);
            Check(!closed&&failure.Window.IsVisible&&failure.View.IsEnabled,"failed flush preserves open usable window",checks);
            Interlocked.Exchange(ref observedDialog,0);
            await failure.View.ExecuteScriptAsync("window.texttextFlushForNativeClose=()=>new Promise(()=>{});");
            failure.Window.Close();
            var hangDeadline=DateTimeOffset.UtcNow.AddSeconds(22);
            while((Volatile.Read(ref observedDialog)==0||(bool)Field("transitioning").GetValue(failure.Window)!)&&DateTimeOffset.UtcNow<hangDeadline)await Task.Delay(50,ct);
            Check(Volatile.Read(ref observedDialog)==1,"never-settling editor flush returns to an actionable dialog",checks);
            Check(!closed&&failure.Window.IsVisible,"stalled renderer cannot close an unconfirmed editor",checks);
        }finally{dismiss.Change(Timeout.Infinite,Timeout.Infinite);if(failure.Window.IsVisible)ForceClose(failure.Window);}
        var activationRoot=Path.Combine(root,"activation");
        var activation=await Create(activationRoot,ct);
        try {
            var workspace=Path.Combine(activationRoot,"workspace");Directory.CreateDirectory(workspace);
            var target=Path.Combine(workspace,"Example.textpack");
            using(var zip=System.IO.Compression.ZipFile.Open(target,System.IO.Compression.ZipArchiveMode.Create))
            using(var writer=new StreamWriter(zip.CreateEntry("text.md").Open()))writer.Write("---\ntextTextId: activation-fixture\n---\nSaved content");
            Field("root").SetValue(activation.Window,workspace);
            Field("account").SetValue(activation.Window,new Account("isolated-unused",Guid.NewGuid().ToString(),"Fixture"));
            Field("bridge").SetValue(activation.Window,new ActivationBridge());
            await activation.View.ExecuteScriptAsync("window.opened=[];window.busyOnce=true;window.texttextOpenFile=async path=>{if(window.busyOnce){window.busyOnce=false;return 'busy';}window.opened.push(path);return 'opened';};window.texttextFlushForNativeClose=()=>new Promise(resolve=>{window.finishActivationFlush=()=>{window.texttextFlushForNativeClose=async()=>({ok:true,durability:{workspaceId:'fixture',itemId:'item',lifecycle:'life',generation:3,outcome:'durable'}});resolve({ok:true,durability:{workspaceId:'fixture',itemId:'item',lifecycle:'life',generation:3,outcome:'durable'}})};});");
            activation.Window.ActivateFiles([target]);
            await Until(async()=>await activation.View.ExecuteScriptAsync("typeof window.finishActivationFlush==='function'")=="true",ct);
            activation.Window.ActivateFiles([target]);
            Check(((Queue<string>)Field("activationFiles").GetValue(activation.Window)!).Count==1,"duplicate activation while file is opening keeps one queued request",checks);
            Check(await activation.View.ExecuteScriptAsync("window.opened.length")=="0","file activation waits for durable editor flush",checks);
            await activation.View.ExecuteScriptAsync("window.finishActivationFlush()");
            await Until(async()=>await activation.View.ExecuteScriptAsync("window.opened.length")=="1",ct);
            Check(await activation.View.ExecuteScriptAsync("window.opened[0]")=="\"Example.textpack\"","busy file activation retries and routes native acknowledgement",checks);
            Check(activation.Window.IsVisible&&activation.View.IsEnabled,"file activation leaves existing host usable",checks);
            await Until(()=>Task.FromResult(!(bool)Field("activatingFile").GetValue(activation.Window)!),ct);
            activation.Window.ActivateFiles([target]);
            await Until(async()=>await activation.View.ExecuteScriptAsync("window.opened.length")=="2",ct);
            await Until(()=>Task.FromResult(!(bool)Field("activatingFile").GetValue(activation.Window)!),ct);
            Check(((Queue<string>)Field("activationFiles").GetValue(activation.Window)!).Count==0,
                "same file can be activated again after its prior request completes",checks);
            await activation.View.ExecuteScriptAsync("window.currentFile='Elsewhere.textpack';window.texttextOpenFile=async path=>{window.currentFile=path;window.opened.push(path);return 'opened'};");
            activation.Window.ActivateFiles([target]);
            await Until(async()=>await activation.View.ExecuteScriptAsync("window.opened.length")=="3",ct);
            await Until(()=>Task.FromResult(!(bool)Field("activatingFile").GetValue(activation.Window)!),ct);
            Check(await activation.View.ExecuteScriptAsync("window.currentFile")=="\"Example.textpack\"",
                "activation after navigating away opens the requested file again",checks);
            var activationClosed=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            activation.Window.Closed+=(_,_)=>activationClosed.TrySetResult();
            await activation.View.ExecuteScriptAsync("window.texttextFlushForNativeClose=()=>new Promise(resolve=>{window.finishCloseDuringActivation=()=>{window.texttextFlushForNativeClose=async()=>({ok:true,durability:{workspaceId:'fixture',itemId:'item',lifecycle:'life',generation:3,outcome:'durable'}});resolve({ok:true,durability:{workspaceId:'fixture',itemId:'item',lifecycle:'life',generation:3,outcome:'durable'}})}});");
            activation.Window.ActivateFiles([target]);
            await Until(async()=>await activation.View.ExecuteScriptAsync("typeof window.finishCloseDuringActivation==='function'")=="true",ct);
            activation.Window.Close();
            Check(activation.Window.IsVisible&&!activationClosed.Task.IsCompleted,"close waits for in-progress file activation",checks);
            await activation.View.ExecuteScriptAsync("window.finishCloseDuringActivation()");
            await activationClosed.Task.WaitAsync(TimeSpan.FromSeconds(8),ct);
            Check(!activation.Window.IsVisible,"close requested during activation finishes after durable flush",checks);
        } finally { ForceClose(activation.Window); }
        await File.WriteAllTextAsync(Path.Combine(receipts,"main-window-close.json"),JsonSerializer.Serialize(new{ok=true,checks}),ct);
    }
    delegate bool EnumWindow(IntPtr window,IntPtr state);
    [DllImport("kernel32.dll")]static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")]static extern bool EnumThreadWindows(uint threadId,EnumWindow callback,IntPtr state);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern int GetWindowText(IntPtr window,StringBuilder text,int count);
    [DllImport("user32.dll")]static extern IntPtr GetDlgItem(IntPtr dialog,int id);
    [DllImport("user32.dll",SetLastError=true)]static extern IntPtr SendMessageTimeout(IntPtr window,uint message,IntPtr wParam,IntPtr lParam,uint flags,uint timeout,out IntPtr result);
    [DllImport("user32.dll")]static extern bool PostMessage(IntPtr window,uint message,IntPtr wParam,IntPtr lParam);
}
