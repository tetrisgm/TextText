using System.Text.Json;
namespace TextText.Windows;
public interface INativeWorkspaceBridge : IDisposable
{
    void InitialViewFailed() { }
    Task RetireAsync() { Dispose(); return Task.CompletedTask; }
    Task<object?> InvokeAsync(string method, JsonElement parameters, CancellationToken cancellationToken);
}
