using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Threading;
using TextText.Core;
namespace TextText.Windows;

public sealed partial class MainWindow
{
    private readonly Queue<string> activationFiles = new();
    private DispatcherTimer? activationTimer;
    private bool activatingFile;
    private int activationAttempts;
    private (string Id, TaskCompletionSource<string> Completion)? pendingOpen;
    private void AcceptFileOpen(string id, JsonElement parameters)
    {
        if (pendingOpen is { } pending && pending.Id == id && parameters.TryGetProperty("result", out var result))
            pending.Completion.TrySetResult(result.GetString() ?? "blocked");
    }
    public void ActivateFiles(string[] paths)
    {
        if (closing) return;
        if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;
        Activate();
        foreach (var path in paths.Take(16))
            if (activationFiles.Count < 16) activationFiles.Enqueue(path);
        if (activationFiles.Count == 0) return;
        if (activationTimer is null)
        {
            activationTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(300) };
            activationTimer.Tick += async (_, _) => await OpenPendingFile();
            Closed += (_, _) => activationTimer.Stop();
        }
        activationTimer.Start();
    }
    private async Task OpenPendingFile()
    {
        if (activatingFile || transitioning || closing || account is null || bridge is null || web?.CoreWebView2 is not { } core) return;
        activatingFile = true;
        try
        {
            // NavigationCompleted precedes React effects; wait for the real editor guard.
            if (await core.ExecuteScriptAsync("typeof window.texttextOpenFile === 'function'") != "true")
            {
                if (++activationAttempts >= 100) { activationFiles.Clear(); activationAttempts = 0; MessageBox.Show(this, "TextText is still opening. Please try opening the file again.", "Open file"); }
                return;
            }
            if (!activationFiles.TryPeek(out var target)) { activationTimer?.Stop(); return; }
            string relative;
            try { relative = FileActivation.Resolve(new TextPackStore(root), target); }
            catch (Exception error) when (error is IOException or ArgumentException or UnauthorizedAccessException)
            {
                activationFiles.Dequeue();
                MessageBox.Show(this, error.Message == "This file is outside your current workspace." ? error.Message : "This file is unavailable in your current workspace.", "Open file", MessageBoxButton.OK, MessageBoxImage.Information); return;
            }
            transitioning = true;
            if (!await FlushEditor()) { activationFiles.Dequeue(); ShowSaveFailure(); return; }
            var id = Guid.NewGuid().ToString();
            var completion = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
            pendingOpen = (id, completion);
            var script = "void (async()=>{let result='blocked';try{result=await window.texttextOpenFile(" + JsonSerializer.Serialize(relative) + ");}catch{}window.chrome.webview.postMessage({id:" + JsonSerializer.Serialize(id) + ",method:'native.fileOpenResult',params:{result}});})()";
            await core.ExecuteScriptAsync(script);
            var result = await completion.Task.WaitAsync(TimeSpan.FromSeconds(30), lifetime.Token);
            if (result != "busy") { activationFiles.Dequeue(); activationAttempts = 0; }
            else if (++activationAttempts >= 100) { activationFiles.Dequeue(); activationAttempts = 0; MessageBox.Show(this, "TextText is busy. Please try opening the file again.", "Open file"); }

        }
        catch (Exception error) when (error is InvalidOperationException or System.Runtime.InteropServices.COMException or TimeoutException or OperationCanceledException)
        { if (activationFiles.Count > 0) activationFiles.Dequeue(); if (!closing) MessageBox.Show(this, "The file could not be opened. Please try again.", "Open file", MessageBoxButton.OK, MessageBoxImage.Information); }
        finally
        {
            pendingOpen = null; transitioning = false; activatingFile = false;
            if (!closing && web is not null) web.IsEnabled = true;
            if (activationFiles.Count == 0) activationTimer?.Stop();
        }
    }
}
