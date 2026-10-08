using System.IO;
using System.Text.Json;
using TextText.Core;
namespace TextText.Windows;

/// Account credentials keep their original identity; only this device's chosen
/// workspace changes. Existing account records remain backward compatible.
internal static class WorkspaceSelection
{
    private static string FilePath(string accountId) {
        if(!Guid.TryParseExact(accountId,"D",out _)) throw new IOException("Invalid account workspace.");
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"TextText","Selections",accountId+".json");
    }
    public static AvailableWorkspace? Load(string accountId) {
        var path=FilePath(accountId);if(!File.Exists(path))return null;
        var bytes=File.ReadAllBytes(path);if(bytes.Length>4096)throw new IOException("Workspace selection is invalid.");
        var value=JsonSerializer.Deserialize<AvailableWorkspace>(bytes);
        if(value is null || !Guid.TryParseExact(value.Id,"D",out _) || value.Name.Length>500 || value.Access is not ("owner" or "workspace" or "scoped"))throw new IOException("Workspace selection is invalid.");
        return value;
    }
    public static void Save(string accountId,AvailableWorkspace selected) {
        var path=FilePath(accountId);Directory.CreateDirectory(Path.GetDirectoryName(path)!);var pending=path+"."+Guid.NewGuid().ToString("N")+".pending";
        try {using(var file=new FileStream(pending,FileMode.CreateNew,FileAccess.Write,FileShare.None)){JsonSerializer.Serialize(file,selected);file.Flush(true);}File.Move(pending,path,true);}
        finally{if(File.Exists(pending))File.Delete(pending);}
    }
}
