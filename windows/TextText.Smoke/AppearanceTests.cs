using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

static class AppearanceTests
{
    public static void Run(Application application)
    {
        if (!application.Resources.MergedDictionaries.Any(dictionary =>
            dictionary.Source?.OriginalString == "pack://application:,,,/PresentationFramework.Fluent;component/Themes/Fluent.xaml"))
            throw new Exception("Production system-theme dictionary was not installed.");
        if (application.TryFindResource(typeof(Button)) is not Style
            || application.TryFindResource("AccentTextFillColorPrimaryBrush") is not Brush)
            throw new Exception("Production native appearance resources did not load.");
        if (!AppContext.TryGetSwitch("Switch.System.Windows.Appearance.DisableFluentThemeWindowBackdrop", out var disabled) || !disabled)
            throw new Exception("Native window backdrop behavior was not preserved.");
        Console.WriteLine("PASS production native system-theme resources loaded; standard frame retained (not a visual light/dark acceptance result)");
    }
}
