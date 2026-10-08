using System.Windows;
namespace TextText.Windows;
public static class App
{
    [STAThread]
    public static void Main(string[] args)
    {
        using var instance = new System.Threading.Mutex(true, "Global\\TextText.Desktop." + DesktopActivation.UserKey, out var created);
        if (!created) { if (!DesktopActivation.Forward(args).GetAwaiter().GetResult()) MessageBox.Show("TextText is still opening. Please try opening the file again.", "TextText"); return; }
        MainWindow.WorkspaceFactory = context => new WindowsBridge(context);
        var application = new Application();
        var window = new MainWindow();
        using var activation = new DesktopActivation(paths => application.Dispatcher.BeginInvoke(() => window.ActivateFiles(paths)));
        window.ActivateFiles(args);
        application.Run(window);
    }
}
