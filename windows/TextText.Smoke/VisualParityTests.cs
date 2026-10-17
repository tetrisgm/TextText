using System.IO;
using System.Text.Json;
using System.Windows;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

static class VisualParityTests
{
    private sealed record Metrics(string Font, string LineHeight, string Background, string Color, string ColorScheme,
        string ButtonFont, double ButtonHeight, double SidebarWidth, bool Overflow, bool Ready);

    public static async Task RunAsync(string root, string receipts, CancellationToken ct)
    {
        var fixture = Environment.GetEnvironmentVariable("TEXTTEXT_VISUAL_PARITY_BUNDLE");
        if (string.IsNullOrEmpty(fixture)) { Console.WriteLine("SKIP visual parity: explicit bundle not supplied"); return; }
        var outputBase = Environment.GetEnvironmentVariable("TEXTTEXT_VISUAL_PARITY_RECEIPTS") ?? receipts;
        var output = Path.Combine(outputBase, "webview2-visual-parity-" + Guid.NewGuid());
        Directory.CreateDirectory(output);
        var view = new WebView2 { Width = 1200, Height = 800 };
        var window = new Window { Title = "TextText isolated visual parity", Content = view, SizeToContent = SizeToContent.WidthAndHeight };
        window.Show();
        try {
            var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(root, "visual-parity-profile"));
            await view.EnsureCoreWebView2Async(environment);
            var core = view.CoreWebView2;
            core.Settings.IsPasswordAutosaveEnabled = false;
            core.Settings.IsGeneralAutofillEnabled = false;
            core.SetVirtualHostNameToFolderMapping("texttext.local", Path.GetFullPath(fixture), CoreWebView2HostResourceAccessKind.DenyCors);
            core.NavigationStarting += (_, e) => { if (!e.Uri.StartsWith("https://texttext.local/", StringComparison.Ordinal)) e.Cancel = true; };
            var json = new JsonSerializerOptions { PropertyNameCaseInsensitive = true, WriteIndented = true };
            var baselines = new Dictionary<string, Metrics>();
            var rows = new List<object>();
            foreach (var profile in new[] { "native", "web" }) {
                var loaded = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
                void Finished(object? sender, CoreWebView2NavigationCompletedEventArgs e) {
                    if (e.IsSuccess) loaded.TrySetResult(); else loaded.TrySetException(new IOException("Visual fixture navigation failed: " + e.WebErrorStatus));
                }
                core.NavigationCompleted += Finished;
                try { core.Navigate("https://texttext.local/" + profile + ".html"); await loaded.Task.WaitAsync(TimeSpan.FromSeconds(10), ct); }
                finally { core.NavigationCompleted -= Finished; }
                using var readiness = CancellationTokenSource.CreateLinkedTokenSource(ct);
                readiness.CancelAfter(TimeSpan.FromSeconds(10));
                while (await view.ExecuteScriptAsync("typeof window.visualParityMetrics==='function' && window.visualParityMetrics()?.ready===true").WaitAsync(readiness.Token) != "true")
                    await Task.Delay(25, readiness.Token);
                foreach (var theme in new[] { "light", "dark" }) {
                    await view.ExecuteScriptAsync("document.documentElement.dataset.theme=" + JsonSerializer.Serialize(theme)).WaitAsync(ct);
                    // Readiness is bounded and rendering stays on this real native view.
                    await Task.Delay(50, ct);
                    var raw = await view.ExecuteScriptAsync("window.visualParityMetrics()").WaitAsync(ct);
                    var metrics = JsonSerializer.Deserialize<Metrics>(raw, json) ?? throw new IOException("Visual fixture returned no metrics.");
                    if (!metrics.Ready || metrics.Font != "14px" || metrics.ButtonFont != "14px"
                        || metrics.LineHeight != "20.3px" || Math.Abs(metrics.ButtonHeight - 34) > 0.1
                        || Math.Abs(metrics.SidebarWidth - 240) > 0.1 || metrics.Overflow || metrics.ColorScheme != theme
                        || metrics.Background != (theme == "light" ? "rgb(255, 255, 255)" : "rgb(35, 35, 35)"))
                        throw new Exception("Shared shell baseline differs in actual WebView2: " + raw);
                    if (await view.ExecuteScriptAsync("innerWidth===1200 && innerHeight===800 && getComputedStyle(document.querySelector('.vault-app')).transform==='none'").WaitAsync(ct) != "true")
                        throw new Exception("Visual comparison requires equal 1200x800 CSS viewport without transform scaling.");
                    if (baselines.TryGetValue(theme, out var baseline) && metrics != baseline)
                        throw new Exception("Web globals changed shared shell metrics in actual WebView2.");
                    baselines[theme] = metrics;
                    using (var image = File.Create(Path.Combine(output, profile + "-" + theme + ".png")))
                        await core.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, image);
                    rows.Add(new { evidence = "Actual WebView2 isolated shared-component fixture; not installed app or physical input acceptance", profile, theme, metrics });
                }
            }
            await File.WriteAllTextAsync(Path.Combine(output, "receipt.json"), JsonSerializer.Serialize(rows, json), ct);
            Console.WriteLine("PASS actual WebView2 shared shell light/dark parity. Screenshots and metrics: " + output);
        } finally { view.Dispose(); window.Close(); }
    }
}
