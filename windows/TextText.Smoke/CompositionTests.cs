using System.IO;
using System.Text.Json;
using System.Windows;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

static class CompositionTests
{
    public static async Task RunAsync(string root, CancellationToken ct)
    {
        var fixture = Environment.GetEnvironmentVariable("TEXTTEXT_COMPOSITION_BUNDLE");
        if (string.IsNullOrEmpty(fixture)) {
            if(Environment.GetEnvironmentVariable("TEXTTEXT_SMOKE_CASE") == "composition") throw new Exception("Focused composition check requires its fixture");
            Console.WriteLine("SKIP composition: explicit fixture not supplied"); return;
        }
        var view = new WebView2();
        var window = new Window { Title = "Isolated composition fixture", Width = 1000, Height = 700, Content = view };
        window.Show();
        async Task Until(string expression) {
            using var bounded = CancellationTokenSource.CreateLinkedTokenSource(ct); bounded.CancelAfter(TimeSpan.FromSeconds(15));
            try { while (await view.ExecuteScriptAsync(expression) != "true") await Task.Delay(25, bounded.Token); }
            catch(OperationCanceledException) when(!ct.IsCancellationRequested) {
                Console.WriteLine("Composition diagnostic: " + await view.ExecuteScriptAsync("JSON.stringify({focused:document.hasFocus(),active:document.activeElement?.tagName,text:document.getElementById('control')?.textContent,events:window.inputEvents})"));
                Console.WriteLine($"Composition window active: {window.IsActive}; keyboard focus: {view.IsKeyboardFocusWithin}");
                throw new TimeoutException("Composition check: " + expression);
            }
        }
        try {
            var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(root, "composition-profile"));
            await view.EnsureCoreWebView2Async(environment);
            Console.WriteLine("Composition WebView2: " + environment.BrowserVersionString);
            view.CoreWebView2.NavigateToString("<meta charset='utf-8'><div id='control' contenteditable='plaintext-only'>Original</div>");
            await Until("Boolean(document.getElementById('control'))");
            window.Activate();view.Focus();
            await view.ExecuteScriptAsync("const control=document.getElementById('control');control.focus();const selection=getSelection(),range=document.createRange();range.selectNodeContents(control);range.collapse(false);selection.removeAllRanges();selection.addRange(range)");
            await Until("document.hasFocus()&&document.activeElement===document.getElementById('control')");
            await view.CoreWebView2.CallDevToolsProtocolMethodAsync("Input.imeSetComposition", "{\"text\":\"漢\",\"selectionStart\":1,\"selectionEnd\":1}");
            await Until("document.getElementById('control').textContent==='Original漢'");
            await Task.Delay(200,ct);
            await view.CoreWebView2.CallDevToolsProtocolMethodAsync("Input.insertText", "{\"text\":\"漢字\"}");
            await Until("document.getElementById('control').textContent==='Original漢字'");
            view.CoreWebView2.SetVirtualHostNameToFolderMapping("texttext.local", fixture, CoreWebView2HostResourceAccessKind.DenyCors);
            view.CoreWebView2.Navigate("https://texttext.local/index.html");
            await Until("Boolean(document.querySelector('[data-view=\"b\"] [aria-label=\"Document body\"]'))&&window.initialReads===1");
            await view.ExecuteScriptAsync("window.render(['b'])");
            await Until("!document.querySelector('[data-view=\"a\"]')");
            window.Activate();view.Focus();
            await view.ExecuteScriptAsync("window.inputEvents=[];for(const name of ['compositionstart','compositionend'])document.addEventListener(name,e=>inputEvents.push(e.type),true)");
            await view.ExecuteScriptAsync("window.body=document.querySelector('[aria-label=\"Document body\"]');body.dataset.continuity='kept'");
            // Put the caret through browser input. A synthetic range on the
            // styled root boundary loses the CDP composition range in WebView2.
            using var rect = JsonDocument.Parse(await view.ExecuteScriptAsync("(()=>{const r=body.getBoundingClientRect();return{x:r.x+20,y:r.y+12}})()"));
            foreach(var type in new[]{"mousePressed","mouseReleased"}) await view.CoreWebView2.CallDevToolsProtocolMethodAsync("Input.dispatchMouseEvent",JsonSerializer.Serialize(new {type,x=rect.RootElement.GetProperty("x").GetDouble(),y=rect.RootElement.GetProperty("y").GetDouble(),button="left",clickCount=1}));
            foreach(var type in new[]{"keyDown","keyUp"}) await view.CoreWebView2.CallDevToolsProtocolMethodAsync("Input.dispatchKeyEvent",JsonSerializer.Serialize(new {type,key="End",code="End",windowsVirtualKeyCode=35}));
            await view.CoreWebView2.CallDevToolsProtocolMethodAsync("Input.imeSetComposition", "{\"text\":\"漢\",\"selectionStart\":1,\"selectionEnd\":1}");
            await Until("body.textContent.includes('漢')");
            await view.ExecuteScriptAsync("window.peerDone=false;window.peerInsert().then(()=>window.peerDone=true)");
            await Until("window.peerDone");
            await view.CoreWebView2.CallDevToolsProtocolMethodAsync("Input.insertText", "{\"text\":\"漢字\"}");
            await Until("body.textContent==='Peer Original漢字'");
            if (await view.ExecuteScriptAsync("JSON.stringify(inputEvents)===JSON.stringify(['compositionstart','compositionend'])") != "true") throw new Exception("Driver did not complete one native composition");
            if (await view.ExecuteScriptAsync("document.querySelector('[aria-label=\"Document body\"]')===body&&body.dataset.continuity==='kept'&&document.activeElement===body") != "true") throw new Exception("Composition lost the mounted editor or focus");
            await view.ExecuteScriptAsync("window.render([])");
            await Until("window.nativeCloses===window.nativeOpens");
            await view.ExecuteScriptAsync("window.render(['c'])");
            await Until("document.querySelector('[aria-label=\"Document body\"]')?.textContent==='Peer Original漢字'");
            Console.WriteLine("PASS actual WebView2 composition keeps peer edits, focus, editor identity and native-adapter reopen text");
        } finally { window.Close(); view.Dispose(); }
    }
}
