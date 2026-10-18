using System.IO;
using System.Text.Json;
using System.Text.RegularExpressions;
using TextText.Core;

// Read-only evidence for one explicitly owned external-tool fixture tree.
internal static class FolderCaseObservation
{
    internal static (object Proof,bool Pending) Observe(string root,string itemId,string title,string configuredFile,JsonElement request)
    {
        static void Fields(JsonElement value,params string[] keys) { if(value.ValueKind!=JsonValueKind.Object||!value.EnumerateObject().Select(p=>p.Name).Order().SequenceEqual(keys.Order()))throw new InvalidDataException("Folder observation fields are unsupported."); }
        Fields(request,"operationId","phase","scenario");var operation=request.GetProperty("operationId").GetString()!;var requested=request.GetProperty("phase").GetString()!;var scenario=request.GetProperty("scenario");
        Fields(scenario,"role","round","source","destination","emptyDescendants");var source=scenario.GetProperty("source").GetString()!;var destination=scenario.GetProperty("destination").GetString()!;
        var descendants=scenario.GetProperty("emptyDescendants").EnumerateArray().Select(x=>x.GetString()!).ToArray();
        if(!Regex.IsMatch(operation,"^fc-[a-f0-9]{32}$")||requested is not ("before" or "after")||scenario.GetProperty("role").GetString() is not ("mac-cli" or "pc-cli")||scenario.GetProperty("round").GetInt32()!=1||source==destination||!string.Equals(source,destination,StringComparison.OrdinalIgnoreCase)||!Regex.IsMatch(source,"^Six-client acceptance folder [a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$",RegexOptions.IgnoreCase)||descendants.Length>8||descendants.Distinct().Count()!=descendants.Length||descendants.Any(p=>p.Split('/').Any(x=>!Regex.IsMatch(x,"^[A-Za-z][A-Za-z0-9 -]{0,63}$")))||!title.StartsWith("Six-client acceptance ",StringComparison.Ordinal)||title.IndexOfAny(['/', '\\'])>=0)throw new InvalidDataException("Owned folder request is invalid.");
        foreach(var path in descendants){var slash=path.LastIndexOf('/');if(slash>=0&&!descendants.Contains(path[..slash]))throw new InvalidDataException("Folder ancestry is incomplete.");}
        root=Path.GetFullPath(root);if(!new[]{Path.Combine(root,source,title+".textpack"),Path.Combine(root,destination,title+".textpack")}.Contains(Path.GetFullPath(configuredFile),StringComparer.Ordinal))throw new IOException("Actor file is outside the owned folder.");RetainedFileReplacement.CheckPath(root);var names=Directory.GetFileSystemEntries(root).Select(Path.GetFileName).ToArray();
        var pending=requested=="after"&&!names.Contains(destination,StringComparer.Ordinal)&&names.Contains(source,StringComparer.Ordinal);var phase=pending?"before":requested;var name=phase=="before"?source:destination;var other=phase=="before"?destination:source;
        if(!names.Contains(name,StringComparer.Ordinal)||names.Contains(other,StringComparer.Ordinal))throw new IOException("Exact owned folder spelling is unavailable.");
        var directory=Path.Combine(root,name);var initial=RetainedFileReplacement.Fingerprint(directory)??throw new IOException("Directory identity is unavailable.");
        var folders=new List<string>();var files=new List<string>();string? hash=null;
        void Scan(string at,string prefix){foreach(var full in Directory.GetFileSystemEntries(at).Order(StringComparer.Ordinal)){RetainedFileReplacement.CheckPath(full);var leaf=Path.GetFileName(full);var relative=prefix.Length==0?leaf:prefix+"/"+leaf;var attributes=File.GetAttributes(full);if((attributes&FileAttributes.ReparsePoint)!=0)throw new IOException("Linked fixture entry refused.");if((attributes&FileAttributes.Directory)!=0){if(!descendants.Contains(relative))throw new IOException("Unknown fixture directory preserved.");folders.Add(relative);Scan(full,relative);}else{if(relative!=title+".textpack"||new FileInfo(full).Length>64*1024*1024)throw new IOException("Unknown fixture file preserved.");var before=RetainedFileReplacement.Fingerprint(full);var bytes=File.ReadAllBytes(full);if(before is null||before!=RetainedFileReplacement.Fingerprint(full)||TextPackStore.Identity(bytes)!=itemId)throw new IOException("Fixture archive identity changed.");hash=TextPackStore.Hash(bytes);files.Add(relative);}}}
        Scan(directory,"");if(!files.SequenceEqual([title+".textpack"])||!folders.Order(StringComparer.Ordinal).SequenceEqual(descendants.Order(StringComparer.Ordinal))||RetainedFileReplacement.Fingerprint(directory)!=initial||hash is null)throw new IOException("Owned folder membership changed.");
        return(new {version=1,kind="filesystem",operationId=operation,phase,source,destination,itemId,relativePath=name+"/"+title+".textpack",folderIdentity=$"{initial.Volume}:{initial.FileId}",archiveSha256=hash,folders=new[]{name}.Concat(folders.Select(p=>name+"/"+p)).Order(StringComparer.Ordinal).ToArray()},pending);
    }
}
