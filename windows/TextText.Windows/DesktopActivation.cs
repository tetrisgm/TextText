using System.IO;
using System.IO.Pipes;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
namespace TextText.Windows;

internal sealed class DesktopActivation : IDisposable
{
    private readonly CancellationTokenSource lifetime = new();
    private readonly string name;
    private readonly Action<string[]> receive;
    public static string UserKey => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(WindowsIdentity.GetCurrent().User!.Value)))[..24];
    public DesktopActivation(Action<string[]> receive)
    {
        this.receive = receive; name = "TextText.Desktop." + UserKey;
        _ = Listen();
    }
    private async Task Listen()
    {
        while (!lifetime.IsCancellationRequested)
        {
            try
            {
                using var pipe = new NamedPipeServerStream(name, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                await pipe.WaitForConnectionAsync(lifetime.Token);
                using var deadline = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token); deadline.CancelAfter(TimeSpan.FromSeconds(5));
                var header = new byte[4]; await pipe.ReadExactlyAsync(header, deadline.Token);
                var length = BitConverter.ToInt32(header);
                if (length < 2 || length > 131072) continue;
                var data = new byte[length]; await pipe.ReadExactlyAsync(data, deadline.Token);
                var paths = JsonSerializer.Deserialize<string[]>(data);
                if (paths is null || paths.Length > 16 || paths.Any(path => path is null || path.Length > 32767)) continue;
                receive(paths);
                await pipe.WriteAsync(new byte[] { 1 }, deadline.Token);
            }
            catch (OperationCanceledException) { }
            catch (IOException) { }
            catch (JsonException) { }
        }
    }
    public static async Task<bool> Forward(string[] paths)
    {
        try
        {
            using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(8));
            using var pipe = new NamedPipeClientStream(".", "TextText.Desktop." + UserKey, PipeDirection.InOut, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
            await pipe.ConnectAsync(deadline.Token);
            var data = JsonSerializer.SerializeToUtf8Bytes(paths);
            if (data.Length > 131072 || paths.Length > 16) return false;
            await pipe.WriteAsync(BitConverter.GetBytes(data.Length), deadline.Token); await pipe.WriteAsync(data, deadline.Token);
            var ack = new byte[1]; await pipe.ReadExactlyAsync(ack, deadline.Token); return ack[0] == 1;
        }
        catch (Exception error) when (error is IOException or OperationCanceledException) { return false; }
    }
    public void Dispose() { lifetime.Cancel(); }
}
