namespace TextText.Core;
public sealed record WorkspaceCapabilities(bool FullAccess,bool CanCreateContent,string[] WritableFolders,Dictionary<string,bool> Items)
{
    public bool CanCreate(string path) => CanCreateContent || WritableFolders.Any(folder => path.StartsWith(folder.TrimEnd('/')+"/",StringComparison.Ordinal));
    public bool CanWrite(string itemId,string path,bool existing) => Items.TryGetValue(itemId,out var allowed) ? allowed : !existing && CanCreate(path);
}
