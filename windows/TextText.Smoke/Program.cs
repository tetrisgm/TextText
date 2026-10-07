using System.IO;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text;
using TextText.Core;
using System.Windows;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using TextText.Windows;

static class Program
{
 [STAThread] static int Main(string[] args) {
  if(args.Length != 2) { Console.Error.WriteLine("Usage: TextText.Smoke <test-bundle> <receipt-directory>"); return 2; }
  Directory.CreateDirectory(args[1]);
  using var log = new StreamWriter(Path.Combine(args[1],"desktop-smoke.log")) { AutoFlush=true };
  Console.SetOut(log); Console.SetError(log); Console.WriteLine("smoke: entry");
  ConfigureRendering();
  Console.WriteLine("smoke: rendering configured");
  return RunWpf(args);
 }
 [MethodImpl(MethodImplOptions.NoInlining)]
 private static void ConfigureRendering() => TextText.Windows.App.ConfigureRendering();
 // Keep WPF type loading/JIT separate from the first durable startup diagnostic.
 [MethodImpl(MethodImplOptions.NoInlining)]
 private static int RunWpf(string[] args) {
  Console.WriteLine("smoke: WPF entry");
  TextText.Windows.App.ConfigureRendering();
  if(System.Windows.Media.RenderOptions.ProcessRenderMode != System.Windows.Interop.RenderMode.SoftwareOnly) throw new InvalidOperationException("Native startup rendering mode was not configured.");
  var app = new Application(); Console.WriteLine("smoke: application created"); var result = 1;
  var temp = Path.Combine(Path.GetTempPath(),"texttext-desktop-smoke-"+Guid.NewGuid()); Directory.CreateDirectory(temp);
  Console.WriteLine("smoke: creating view"); var view = new WebView2(); var window = new Window { Title="TextText isolated desktop smoke",Width=1100,Height=800,Content=view };
  WindowsBridge? bridge=null;
  using var timeout=new CancellationTokenSource(TimeSpan.FromSeconds(90));
  timeout.Token.Register(()=>app.Dispatcher.BeginInvoke(new Action(()=> { Console.Error.WriteLine("Smoke timed out"); app.Shutdown(1); })));
  window.Loaded += async (_,_)=> { try {
   Console.WriteLine("smoke: loaded"); Directory.CreateDirectory(args[1]);
   var environment = await CoreWebView2Environment.CreateAsync(null,Path.Combine(temp,"webview"));
   Console.WriteLine("smoke: environment ready"); await view.EnsureCoreWebView2Async(environment); Console.WriteLine("smoke: webview ready");
   Directory.CreateDirectory(Path.Combine(temp,"workspace"));
   bridge=new WindowsBridge(new WorkspaceContext(Path.Combine(temp,"workspace"),"smoke-workspace",new Uri("https://127.0.0.1:1"),()=>Task.FromResult("isolated-test-token"),(name,detail)=>app.Dispatcher.InvokeAsync(()=>view.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { @event=name,detail }))).Task));
   view.CoreWebView2.SetVirtualHostNameToFolderMapping("texttext.local",Path.GetFullPath(args[0]),CoreWebView2HostResourceAccessKind.DenyCors);
   view.CoreWebView2.NavigationStarting += (_,e)=> { if(!e.Uri.StartsWith("https://texttext.local/",StringComparison.Ordinal)) e.Cancel=true; };
   view.CoreWebView2.WebMessageReceived += async (_,e)=> { string? id=null; try {
    if(!e.Source.StartsWith("https://texttext.local/",StringComparison.Ordinal)) return;
    using var input=JsonDocument.Parse(e.WebMessageAsJson); var r=input.RootElement; id=r.GetProperty("id").GetString(); var method=r.GetProperty("method").GetString();
    object? value;
    if(method=="native.status") value=new {workspaceId="smoke-workspace",root=Path.Combine(temp,"workspace"),name="Smoke",connected=true,available=true};
    else if(method=="native.http") value=new {status=503,headers=new {},body=""};
    else value=await bridge.InvokeAsync(method!,r.GetProperty("params"),timeout.Token);
    view.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new {id,result=value}));
   } catch(Exception ex) {view.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new {id,error=new {message=ex.Message}}));} };
   var loaded=new TaskCompletionSource();
   view.CoreWebView2.NavigationCompleted += (_,e)=> {if(e.IsSuccess) loaded.TrySetResult(); else loaded.TrySetException(new Exception("Navigation failed: "+e.WebErrorStatus));};
   Console.WriteLine("smoke: navigating"); view.Source=new Uri("https://texttext.local/index.html"); await loaded.Task.WaitAsync(timeout.Token); Console.WriteLine("smoke: page loaded");
   await view.ExecuteScriptAsync("window.runDesktopSmoke().then(checks=>window.smokeResult={ok:true,checks}).catch(error=>window.smokeResult={ok:false,error:String(error)})");
   string output;
   while(true) {timeout.Token.ThrowIfCancellationRequested(); output=await view.ExecuteScriptAsync("window.smokeResult || null"); if(output!="null") break; await Task.Delay(100,timeout.Token);}
   using var receipt=JsonDocument.Parse(output);
   await File.WriteAllTextAsync(Path.Combine(args[1],"desktop-smoke.json"),output);
   using(var image=File.Create(Path.Combine(args[1],"desktop-smoke.png"))) await view.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png,image);
   if(!receipt.RootElement.GetProperty("ok").GetBoolean()) throw new Exception(output);
   Console.WriteLine(output); await MainWindowCloseTests.RunAsync(temp,args[1],timeout.Token); result=0;
  }catch(Exception ex){Console.Error.WriteLine(ex);}finally{bridge?.Dispose();view.Dispose();app.Shutdown(result);} };
  Console.WriteLine("smoke: run window"); app.Run(window);
  var binding = TextPackStore.Hash(Encoding.UTF8.GetBytes("https://127.0.0.1:1/\nsmoke-workspace\n"+Path.Combine(temp,"workspace")));
  var deviceState = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"TextText","Sync",binding);
  try {if(Directory.Exists(deviceState)) Directory.Delete(deviceState,true); Directory.Delete(temp,true);}catch(IOException){Console.Error.WriteLine("Temporary WebView directory remains: "+temp);}
  return result;
 }
}
