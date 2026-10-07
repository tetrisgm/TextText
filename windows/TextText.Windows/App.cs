using System.Windows;
namespace TextText.Windows;
public static class App
{
    [STAThread]
    public static void Main()
    {
        using var instance = new System.Threading.Mutex(true, "Local\\TextText.Desktop", out var created);
        if (!created) return;
        MainWindow.WorkspaceFactory = context => new WindowsBridge(context);
        var application = new Application();
        application.Run(new MainWindow());
    }
}
