using System.Text.Json;
namespace TextText.Windows;
public interface INativeWorkspaceBridge : IDisposable
{
    Task<object?> InvokeAsync(string method, JsonElement parameters, CancellationToken cancellationToken);
}
