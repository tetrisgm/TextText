using System.Windows;
namespace TextText.Windows;
public static class App
{
    [STAThread]
    public static void Main()
    {
        using var instance = new System.Threading.Mutex(true, "Local\\TextText.Desktop", out var created);
        if (!created) return;
        // Keep native chrome independent of GPU compositor stalls before the first window.
        System.Windows.Media.RenderOptions.ProcessRenderMode = System.Windows.Interop.RenderMode.SoftwareOnly;
        MainWindow.WorkspaceFactory = context => new WindowsBridge(context);
        var application = new Application();
        application.Run(new MainWindow());
    }
}
