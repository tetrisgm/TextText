using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Reflection;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using TextText.Core;
using TextText.Windows;

static class AccountRecoveryTests
{
    const BindingFlags Flags=BindingFlags.NonPublic|BindingFlags.Instance;
    static FieldInfo Field(string name)=>typeof(MainWindow).GetField(name,Flags)!;
    static void Check(bool value,string label){if(!value)throw new Exception(label);Console.WriteLine("PASS "+label);}
    sealed class Profile(string workspace,bool revoke):HttpMessageHandler {
        public int Profiles;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken ct) {
            if(request.Headers.Authorization?.Parameter!="isolated-review-fixture")throw new Exception("Unexpected fixture credential");
            var path=request.RequestUri!.AbsolutePath;
            object value;
            if(path=="/api/vault/"+workspace+"/account"){Profiles++;value=new{accountId="account-a",email="fixture@example.test"};}
            else if(path=="/api/vault/workspaces")value=new{workspaces=new[]{new{id=workspace,name="Review fixture",access="owner"}}};
            else if(path=="/api/vault/"+workspace+"/items"){
                if(revoke&&Profiles>=2)return Task.FromResult(new HttpResponseMessage(HttpStatusCode.Forbidden));
                value=new{items=Array.Empty<object>()};
            } else throw new Exception("Unexpected fixture request");
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK){Content=JsonContent.Create(value)});
        }
    }
    static IEnumerable<T> Children<T>(DependencyObject root) where T:DependencyObject {
        if(root is T match)yield return match;
        for(var i=0;i<VisualTreeHelper.GetChildrenCount(root);i++)foreach(var child in Children<T>(VisualTreeHelper.GetChild(root,i)))yield return child;
    }
    public static async Task RunAsync(string temporary,string receipts,CancellationToken ct) {
        foreach(var scenario in new[]{"cancel","changed","revoked","keep"}) {
            var workspace=Guid.NewGuid().ToString();var folder=Path.Combine(temporary,"review-"+scenario);
            var store=WindowsBridge.OpenStore(folder,new Uri("https://texttext.app"),workspace);
            var state=Path.Combine(store.StateDirectory,"sync.json");var original=JsonSerializer.SerializeToUtf8Bytes(new SyncEngine.State());File.WriteAllBytes(state,original);
            var window=new MainWindow();MainWindowCloseTests.RemoveProductionLoaded(window);
            var identity=new Account("isolated-review-fixture",workspace,"Review fixture","account-a");
            Field("account").SetValue(window,identity);
            ((HttpClient)Field("http").GetValue(window)!).Dispose();var profile=new Profile(workspace,scenario=="revoked");Field("http").SetValue(window,new HttpClient(profile));
            window.Title="TextText isolated account review";window.Content=new TextBlock{Text="Isolated account recovery test"};window.Show();
            var clicked=false;var timer=new DispatcherTimer{Interval=TimeSpan.FromMilliseconds(40)};
            timer.Tick+=(_,_)=> {
                var dialog=Application.Current.Windows.Cast<Window>().FirstOrDefault(w=>w.Owner==window&&w.Title=="Review saved work");
                if(dialog is null)return;
                if(ct.IsCancellationRequested){dialog.DialogResult=false;timer.Stop();return;}
                var label=scenario=="cancel"?"Cancel":"Keep saved work";
                var button=Children<Button>(dialog).Single(b=>Equals(b.Content,label));
                Check(Children<TextBlock>(dialog).Any(t=>t.Text.Contains("fixture@example.test"))&&Children<TextBlock>(dialog).Any(t=>t.Text==folder),"native review identifies the verified account and exact folder");
                if(scenario=="cancel") {
                    var bitmap=new RenderTargetBitmap((int)dialog.ActualWidth,(int)dialog.ActualHeight,96,96,PixelFormats.Pbgra32);bitmap.Render(dialog);
                    var encoder=new PngBitmapEncoder();encoder.Frames.Add(BitmapFrame.Create(bitmap));using var file=File.Create(Path.Combine(receipts,"account-review.png"));encoder.Save(file);
                }
                if(scenario=="changed")Field("account").SetValue(window,identity with {AccountId="account-b"});
                clicked=true;timer.Stop();
                if(scenario=="cancel")dialog.DialogResult=false;else button.RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
            };
            timer.Start();
            try {
                var method=typeof(MainWindow).GetMethod("ReviewRetainedWork",Flags)!;var accepted=false;var refused=false;
                try{accepted=await ((Task<bool>)method.Invoke(window,[folder,identity,identity])!);}
                catch(Exception error)when(error is SharedAccountMismatchException or IOException){refused=true;}
                Check(clicked,"native account review waited for an explicit choice");
                if(scenario=="keep")Check(accepted&&profile.Profiles==2&&JsonSerializer.Deserialize<SyncEngine.State>(File.ReadAllBytes(state))!.AccountId=="account-a","explicit native choice rechecks authority and adopts the reviewed account");
                else Check(!accepted&&(scenario=="cancel"||refused)&&File.ReadAllBytes(state).SequenceEqual(original)&&!File.Exists(Path.Combine(store.StateDirectory,AccountRootOwnership.FileName)),"native review "+scenario+" preserves the unbound originals");
            } finally {
                timer.Stop();Field("closing").SetValue(window,true);window.Close();
                Directory.Delete(store.StateDirectory,true); // only this newly generated fixture's private state
            }
        }
    }
}
