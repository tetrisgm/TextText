using System.IO.Compression;
using System.Security.Cryptography;

namespace TextText.Core;

/// <summary>Reads and changes one asset without interpreting document text or metadata.</summary>
public static class BinaryEntryPacks
{
    public sealed record Entry(string Path,string Sha256,byte[] Bytes);
    static string Hash(byte[] data)=>Convert.ToHexString(SHA256.HashData(data)).ToLowerInvariant();
    static void CheckPath(string path) {
        if(path.Length>512 || !path.StartsWith("assets/",StringComparison.Ordinal) || path.Split('/').Any(x=>x.Length==0||x is "." or "..") || path.Contains('\\') || path.Any(char.IsControl))
            throw new InvalidDataException("Invalid binary entry path.");
    }
    static Dictionary<string,byte[]> ReadAll(byte[] pack,out string prefix) {
        if(pack.Length>64*1024*1024)throw new InvalidDataException("TextPack exceeds size limit.");
        _=TextPackStore.Identity(pack);
        prefix=TextPackStore.DocumentPrefix(pack);
        using var archive=new ZipArchive(new MemoryStream(pack),ZipArchiveMode.Read);
        var result=new Dictionary<string,byte[]>(StringComparer.Ordinal);
        long size=0;
        foreach(var entry in archive.Entries) {
            if(result.Count>=10000 || (size+=entry.Length)>64*1024*1024)throw new InvalidDataException("Expanded TextPack exceeds size limit.");
            using var input=entry.Open();using var output=new MemoryStream();input.CopyTo(output);
            result.Add(entry.FullName,output.ToArray());
        }
        return result;
    }
    public static IReadOnlyDictionary<string,Entry> Assets(byte[] pack) {
        var entries=ReadAll(pack,out var prefix);
        return entries.Where(x=>x.Key.StartsWith(prefix+"assets/",StringComparison.Ordinal) && !x.Key.EndsWith('/'))
            .ToDictionary(x=>x.Key[prefix.Length..],x=>new Entry(x.Key[prefix.Length..],Hash(x.Value),x.Value),StringComparer.Ordinal);
    }
    public static byte[] Patch(byte[] pack,string entryPath,string? expectedHash,byte[]? replacement) {
        CheckPath(entryPath);
        if(replacement is {Length:>16*1024*1024} || replacement is {Length:0})throw new InvalidDataException("Binary entry exceeds size limit.");
        if(replacement is null && expectedHash is null)throw new InvalidDataException("Binary deletion requires a base hash.");
        var entries=ReadAll(pack,out var prefix);var name=prefix+entryPath;
        if(entries.Keys.Any(key=>key!=name&&string.Equals(key.Normalize().ToLowerInvariant(),name.Normalize().ToLowerInvariant(),StringComparison.Ordinal)))
            throw new InvalidDataException("Binary entry path collision.");
        entries.TryGetValue(name,out var prior);
        if((prior is null?null:Hash(prior))!=expectedHash)throw new FileChangedException();
        if(replacement is null)entries.Remove(name);else entries[name]=replacement;
        if(entries.Count>10000 || entries.Values.Sum(x=>(long)x.Length)>64*1024*1024)throw new InvalidDataException("Expanded TextPack exceeds size limit.");
        using var output=new MemoryStream();
        using(var archive=new ZipArchive(output,ZipArchiveMode.Create,true))foreach(var pair in entries.OrderBy(x=>x.Key,StringComparer.Ordinal)) {
            using var stream=archive.CreateEntry(pair.Key,CompressionLevel.NoCompression).Open();stream.Write(pair.Value);
        }
        var changed=output.ToArray();_=TextPackStore.Identity(changed);
        return changed;
    }
}
