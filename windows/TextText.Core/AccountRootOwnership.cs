using System.Text.Json;
using System.Text.RegularExpressions;
namespace TextText.Core;

public sealed class LegacyAccountStateException() : IOException("Review this folder's saved work before keeping it with the signed-in account. Original files remain on this device.");

/// Device-private ownership survives a missing sync cursor. It is never copied
/// into a portable workspace binding or inferred from the next sign-in.
public static class AccountRootOwnership
{
    public sealed record Owner(int Version,string Origin,string WorkspaceId,string AccountId,string RootHash);
    public const string FileName="account-owner.json";
    public const string PendingAdoption="account-adoption.json";
    static string Origin(Uri origin) {
        if(origin.Scheme!="https"||origin.UserInfo.Length!=0||origin.AbsolutePath!="/"||origin.Query.Length!=0||origin.Fragment.Length!=0)throw new InvalidDataException("Invalid account server.");
        return origin.GetLeftPart(UriPartial.Authority).ToLowerInvariant();
    }
    internal static Owner Expected(TextPackStore store,Uri origin,string workspaceId,string accountId) {
        if(!Regex.IsMatch(accountId,@"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\z")||!Regex.IsMatch(workspaceId,@"^[A-Za-z0-9_-]+\z"))throw new InvalidDataException("Invalid account binding.");
        return new(1,Origin(origin),workspaceId,accountId,TextPackStore.Hash(System.Text.Encoding.UTF8.GetBytes(store.Root)));
    }
    static byte[] Read(string path,int limit) {
        if((File.GetAttributes(path)&FileAttributes.ReparsePoint)!=0||new FileInfo(path).Length>limit)throw new InvalidDataException("Account state could not be verified.");
        var bytes=File.ReadAllBytes(path);if(bytes.Length>limit)throw new InvalidDataException("Account state exceeds its limit.");return bytes;
    }
    public static void RequireNoAdoption(string stateDirectory) {
        if(File.Exists(Path.Combine(stateDirectory,PendingAdoption)))throw new LegacyAccountStateException();
    }
    public static void Open(TextPackStore store,Uri origin,string workspaceId,string accountId) {
        var expected=Expected(store,origin,workspaceId,accountId);RequireNoAdoption(store.StateDirectory);
        var marker=Path.Combine(store.StateDirectory,FileName);
        if(File.Exists(marker)) { Verify(marker,expected);return; }
        if(RetainedReplacementProfile.Exists(store.StateDirectory))throw new InvalidDataException("Retained replacement ownership is missing. Restore its preserved ownership before opening this folder.");
        var state=Path.Combine(store.StateDirectory,"sync.json");
        if(File.Exists(state)) {
            var saved=JsonSerializer.Deserialize<SyncEngine.State>(Read(state,90*1024*1024))??throw new InvalidDataException("Invalid sync state.");
            if(saved.Version!=1)throw new InvalidDataException("Update TextText to open this workspace.");
            if(saved.AccountId is null)throw new LegacyAccountStateException();
            if(saved.AccountId!=accountId)throw new SharedAccountMismatchException();
        } else if(Directory.EnumerateFileSystemEntries(store.Root).Any(path=>Path.GetFileName(path)!=".texttext") ||
            Directory.Exists(Path.Combine(store.StateDirectory,"shared-editing")) && Directory.EnumerateFileSystemEntries(Path.Combine(store.StateDirectory,"shared-editing")).Any())
            throw new LegacyAccountStateException();
        Publish(store,expected);
    }
    internal static void Verify(string path,Owner expected) {
        var actual=JsonSerializer.Deserialize<Owner>(Read(path,4096))??throw new InvalidDataException("Invalid account ownership record.");
        if(actual.Version==2||actual.Version==1&&RetainedReplacementProfile.HasPublishedMarker(Path.GetDirectoryName(path)!))RetainedReplacementProfile.Verify(Path.GetDirectoryName(path)!,actual,expected.RootHash);
        else if(actual.Version!=1)throw new InvalidDataException("Update TextText to open this workspace.");
        if((actual with{Version=1})!=(expected with{Version=1}))throw new SharedAccountMismatchException();
    }
    // Only the explicit adoption transaction may publish ownership for legacy
    // bytes. Ordinary opening must first pass the checks above.
    internal static void Publish(TextPackStore store,Owner expected) {
        var marker=Path.Combine(store.StateDirectory,FileName);
        if(File.Exists(marker)){Verify(marker,expected);return;}
        if(RetainedReplacementProfile.Exists(store.StateDirectory))throw new InvalidDataException("Retained replacement ownership is missing.");
        var temporary=Path.Combine(store.StateDirectory,".account-owner-"+Guid.NewGuid().ToString("N")+".tmp");
        try {
            using(var file=new FileStream(temporary,FileMode.CreateNew,FileAccess.Write,FileShare.None)) {JsonSerializer.Serialize(file,expected);file.Flush(true);}
            try{File.Move(temporary,marker,false);}catch(IOException)when(File.Exists(marker)){Verify(marker,expected);}
        } finally {if(File.Exists(temporary))File.Delete(temporary);}
    }
}
