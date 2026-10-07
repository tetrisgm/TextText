using System.IO;
using System.Security.Cryptography;
using System.Text.Json;
namespace TextText.Windows;
public sealed record Account(string Token, string WorkspaceId, string Name);
internal static class CredentialStore
{
    private static readonly string DirectoryPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "TextText");
    private static readonly string FilePath = Path.Combine(DirectoryPath, "account.dpapi");
    public static Account? Load()
    {
        if (!File.Exists(FilePath)) return null;
        return JsonSerializer.Deserialize<Account>(ProtectedData.Unprotect(File.ReadAllBytes(FilePath), null, DataProtectionScope.CurrentUser));
    }
    public static void Save(Account account)
    {
        Directory.CreateDirectory(DirectoryPath);
        var temporary = FilePath + ".pending";
        File.WriteAllBytes(temporary, ProtectedData.Protect(JsonSerializer.SerializeToUtf8Bytes(account), null, DataProtectionScope.CurrentUser));
        File.Move(temporary, FilePath, true);
    }
    public static void Clear() { if (File.Exists(FilePath)) File.Delete(FilePath); }
}
