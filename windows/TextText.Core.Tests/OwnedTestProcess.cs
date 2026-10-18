using System.Diagnostics;
using System.Runtime.InteropServices;

static class OwnedTestProcess
{
    public static ProcessStartInfo Create()
    {
        // The test SDK may be private and unregistered. Launch through the host
        // of the runtime already executing us instead of rediscovering it via
        // an apphost whose inherited environment may deliberately be cleared.
        var runtime = new DirectoryInfo(RuntimeEnvironment.GetRuntimeDirectory());
        var root = runtime.Parent?.Parent?.Parent?.FullName
            ?? throw new IOException("Cannot locate the running test runtime.");
        var host = Path.Combine(root, OperatingSystem.IsWindows() ? "dotnet.exe" : "dotnet");
        if (!File.Exists(host)) throw new IOException("The running test runtime has no host.");
        var start = new ProcessStartInfo(host) {
            UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true
        };
        start.ArgumentList.Add(typeof(OwnedTestProcess).Assembly.Location);
        return start;
    }
}
