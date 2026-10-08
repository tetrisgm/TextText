using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
namespace TextText.Core;

public sealed record ScanError(string Path,string Reason,string? ItemId=null);
public sealed record PackFile(string Path, string Hash, string ItemId);
public sealed record FileIntent(string Kind, string ItemId, string Path, string Hash, string? Destination = null);
public sealed class FileChangedException() : IOException("The file changed. Reload its current contents before writing.");
public sealed class TextPackStore
{
    public string Root { get; }
    public string StateDirectory { get; }
    public IReadOnlyList<ScanError> LastScanErrors {get;private set;}=[];
    public event Action? Changed;
    readonly object gate = new();
    public TextPackStore(string root, string? stateDirectory = null)
    {
        Root = System.IO.Path.GetFullPath(root); Directory.CreateDirectory(Root); CheckLinks(Root);
        StateDirectory = stateDirectory ?? System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "TextText", "Sync", Hash(Encoding.UTF8.GetBytes(Root)));
        Directory.CreateDirectory(StateDirectory); CheckLinks(StateDirectory);
    }
    static void CheckLinks(string path)
    {
        for (var p = path; !string.IsNullOrEmpty(p); p = System.IO.Path.GetDirectoryName(p))
            if ((File.Exists(p) || Directory.Exists(p)) && ProviderPaths.IsUnsafeReparse(p)) throw new IOException("Linked folders are not supported.");
    }
    public string Resolve(string path)
    {
        if (string.IsNullOrWhiteSpace(path) || path.Contains('\\') || path.Contains(':') || path.StartsWith('/') || path.Split('/').Any(p => p is ".." or "." or "" || p.EndsWith(' ') || p.EndsWith('.'))) throw new IOException("Invalid workspace path.");
        var full = System.IO.Path.GetFullPath(System.IO.Path.Combine(Root, path));
        if (!full.StartsWith(Root.TrimEnd(System.IO.Path.DirectorySeparatorChar) + System.IO.Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new IOException("Path leaves workspace.");
        CheckLinks(full); return full;
    }
    // Manifest directories are additive; omitted directories and their contents remain.
    public void EnsureFolders(IReadOnlyList<string> folders) {
        if(folders.Count>20000)throw new IOException("Too many workspace folders.");
        lock(gate)foreach(var path in folders) {
            if(path.Length>1024||path.Split('/').Any(p=>p.StartsWith('.')||p.EndsWith(".textpack",StringComparison.OrdinalIgnoreCase)))throw new IOException("Invalid workspace folder.");
            _=Resolve(path);var current=Root;
            foreach(var part in path.Split('/')) {
                current=System.IO.Path.Combine(current,part);CheckLinks(current);
                if(File.Exists(System.IO.Path.Combine(System.IO.Path.GetDirectoryName(current)!,"."+part+".icloud")))throw new IOException("Folder is awaiting download.");
                Directory.CreateDirectory(current);CheckLinks(current);
            }
        }
    }
    public static string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    public byte[] Read(string path) { lock(gate) return File.ReadAllBytes(Resolve(path)); }
    public PackFile Describe(string path) { var bytes = Read(path); return new(path, Hash(bytes), Identity(bytes)); }
    public static string Identity(byte[] bytes)
    {
        var text = Markdown(bytes).TrimStart('\uFEFF');
        if (!text.StartsWith("---\n") && !text.StartsWith("---\r\n")) throw new InvalidDataException("TextPack has no identity header.");
        var end = Regex.Match(text, @"\r?\n---\s*\r?\n");
        if (!end.Success) throw new InvalidDataException("Invalid identity header.");
        var matches = Regex.Matches(text[..end.Index], @"(?m)^textTextId:\s*(.+?)\r?$");
        if (matches.Count != 1) throw new InvalidDataException("Missing or duplicate TextPack identity.");
        var raw = matches[0].Groups[1].Value.Trim();
        var id = raw.StartsWith('"') ? JsonSerializer.Deserialize<string>(raw)! : raw;
        if (!Regex.IsMatch(id, @"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")) throw new InvalidDataException("Invalid TextPack identity."); return id;
    }
    public static string Markdown(byte[] bytes)
    {
        if (bytes.Length > 64 * 1024 * 1024) throw new InvalidDataException("TextPack too large.");
        using var archive = new ZipArchive(new MemoryStream(bytes));
        long total = 0; var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var entry in archive.Entries) {
            if (!names.Add(entry.FullName) || entry.FullName.StartsWith('/') || entry.FullName.Contains('\\') || entry.FullName.Split('/').Contains("..")) throw new InvalidDataException("Invalid archive entry.");
            total += entry.Length; if (total > 256 * 1024 * 1024) throw new InvalidDataException("Expanded archive too large.");
        }
        var text = archive.GetEntry(CanonicalPrefix(archive)+"text.md")!;
        if (text.Length > 16 * 1024 * 1024) throw new InvalidDataException("Markdown too large.");
        using var reader = new StreamReader(text.Open(), new UTF8Encoding(false, true)); return reader.ReadToEnd();
    }
    static string CanonicalPrefix(ZipArchive archive) {
        if(archive.GetEntry("text.md")!=null)return "";
        var candidates=archive.Entries.Where(e=>e.FullName.Split('/').Length==2&&e.FullName.EndsWith("/text.md",StringComparison.Ordinal)&&archive.GetEntry(e.FullName[..^7]+"document.json")!=null).ToArray();
        if(candidates.Length!=1)throw new InvalidDataException("TextPack has no unambiguous document entry.");
        return candidates[0].FullName[..^7];
    }
    public static string DocumentPrefix(byte[] bytes) { _=Identity(bytes);using var archive=new ZipArchive(new MemoryStream(bytes));return CanonicalPrefix(archive); }
    public static byte[] WithDocument(byte[] original,string markdown,string documentJson) {
        var identity=Identity(original);using var document=JsonDocument.Parse(documentJson);
        if(document.RootElement.GetProperty("schemaVersion").GetInt32()!=1||document.RootElement.GetProperty("content").ValueKind!=JsonValueKind.Object)throw new InvalidDataException("Invalid document snapshot.");
        using var source=new ZipArchive(new MemoryStream(original));var prefix=CanonicalPrefix(source);using var output=new MemoryStream();
        using(var target=new ZipArchive(output,ZipArchiveMode.Create,true)) {
            foreach(var entry in source.Entries){var copy=target.CreateEntry(entry.FullName,CompressionLevel.Optimal);copy.LastWriteTime=entry.LastWriteTime;copy.ExternalAttributes=entry.ExternalAttributes;using var to=copy.Open();
                if(entry.FullName==prefix+"text.md")to.Write(Encoding.UTF8.GetBytes(markdown));else if(entry.FullName==prefix+"document.json")to.Write(Encoding.UTF8.GetBytes(documentJson));else{using var from=entry.Open();from.CopyTo(to);}}
            if(source.GetEntry(prefix+"document.json")==null){using var stream=target.CreateEntry(prefix+"document.json").Open();stream.Write(Encoding.UTF8.GetBytes(documentJson));}
        }
        var bytes=output.ToArray();if(Identity(bytes)!=identity)throw new InvalidDataException("Document identity changed.");return bytes;
    }
    public static bool Equivalent(byte[] left,byte[] right) {
        _=Identity(left);_=Identity(right);
        using var a=new ZipArchive(new MemoryStream(left));using var b=new ZipArchive(new MemoryStream(right));
        if(a.Entries.Count!=b.Entries.Count)return false;
        foreach(var entry in a.Entries){var other=b.GetEntry(entry.FullName);if(other==null || entry.Length!=other.Length)return false;using var x=entry.Open();using var y=other.Open();var xb=new byte[8192];var yb=new byte[8192];while(true){var xn=x.Read(xb);if(xn==0){if(y.ReadByte()!=-1)return false;break;}y.ReadExactly(yb.AsSpan(0,xn));if(!xb.AsSpan(0,xn).SequenceEqual(yb.AsSpan(0,xn)))return false;}}
        return true;
    }
    public IReadOnlyList<PackFile> Scan()
    {
        var found = new Dictionary<string,PackFile>();var duplicated=new HashSet<string>();var errors=new List<ScanError>();
        string Relative(string path)=>System.IO.Path.GetRelativePath(Root,path).Replace('\\','/');
        void Error(string path,string reason,string? id=null){if(errors.Count<1000)errors.Add(new(Relative(path),reason,id));}
        void Visit(string directory) {
            string[] entries;
            try {CheckLinks(directory);entries=Directory.GetFileSystemEntries(directory);}catch(Exception error)when(error is IOException or UnauthorizedAccessException){Error(directory,"Folder is temporarily unavailable.");return;}
            foreach(var path in entries) {
                if(System.IO.Path.GetFileName(path).StartsWith('.'))continue;
                try {
                    if(ProviderPaths.IsUnsafeReparse(path)){Error(path,"Linked workspace entry is unsupported.");continue;}
                    if(Directory.Exists(path)){Visit(path);continue;}
                    if(!path.EndsWith(".textpack",StringComparison.OrdinalIgnoreCase))continue;
                    var entry=Describe(Relative(path));
                    if(duplicated.Contains(entry.ItemId)){Error(path,"Duplicate document identity.",entry.ItemId);continue;}
                    if(found.Remove(entry.ItemId,out var previous)){duplicated.Add(entry.ItemId);Error(Resolve(previous.Path),"Duplicate document identity.",entry.ItemId);Error(path,"Duplicate document identity.",entry.ItemId);continue;}
                    found.Add(entry.ItemId,entry);
                }catch(Exception error)when(error is IOException or InvalidDataException or UnauthorizedAccessException or JsonException or DecoderFallbackException){Error(path,"File is invalid or temporarily unavailable. Its contents have been preserved.");}
            }
        }
        lock(gate){CheckLinks(Root);Visit(Root);LastScanErrors=errors.ToArray();}return found.Values.ToArray();
    }

    public static void AtomicWrite(string path, byte[] bytes)
    {
        Directory.CreateDirectory(System.IO.Path.GetDirectoryName(path)!); CheckLinks(path);
        var temp = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try { using(var stream = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough)) { stream.Write(bytes); stream.Flush(true); } CheckLinks(path); File.Move(temp,path,true); }
        finally { if(File.Exists(temp)) File.Delete(temp); }
    }
    void Match(string full, string? expected) { if (File.Exists(full) ? expected == null || Hash(File.ReadAllBytes(full)) != expected : expected != null) throw new FileChangedException(); }
    public PackFile Write(string path, byte[] bytes, string? expectedHash = null)
    {
        var id = Identity(bytes);
        lock(gate) { var full=Resolve(path); Match(full,expectedHash); if(File.Exists(full)) { var previous=File.ReadAllBytes(full); if(Identity(previous)!=id) throw new InvalidDataException("A different document already occupies this path."); Preserve(previous, "history"); } AtomicWrite(full,bytes); }
        Changed?.Invoke(); return new(path,Hash(bytes),id);
    }
    public PackFile UpdateMarkdown(string path, string markdown, string expectedHash)
    {
        var bytes=Read(path); if(Hash(bytes)!=expectedHash) throw new FileChangedException(); var identity=Identity(bytes);
        using var source=new ZipArchive(new MemoryStream(bytes));var prefix=CanonicalPrefix(source); using var output=new MemoryStream();
        using(var target=new ZipArchive(output,ZipArchiveMode.Create,true)) foreach(var entry in source.Entries) {
            var copy=target.CreateEntry(entry.FullName,CompressionLevel.Optimal); copy.LastWriteTime=entry.LastWriteTime; copy.ExternalAttributes=entry.ExternalAttributes;
            using var to=copy.Open(); if(entry.FullName==prefix+"text.md") to.Write(Encoding.UTF8.GetBytes(markdown)); else { using var from=entry.Open(); from.CopyTo(to); }
        }
        var result=output.ToArray(); if(Identity(result)!=identity) throw new InvalidDataException("Identity changes require creating a new document."); return Write(path,result,expectedHash);
    }
    public void Rename(string from,string to,string expectedHash)
    {
        lock(gate) { var source=Resolve(from); var target=Resolve(to); Match(source,expectedHash); if(File.Exists(target)) throw new IOException("Destination exists.");
            var intent=new FileIntent("rename",Identity(File.ReadAllBytes(source)),from,expectedHash,to); RecordIntent(intent);
            Directory.CreateDirectory(System.IO.Path.GetDirectoryName(target)!); File.Move(source,target); }
        Changed?.Invoke();
    }
    public void Delete(string path,string expectedHash)
    {
        lock(gate) { var full=Resolve(path); Match(full,expectedHash); var bytes=File.ReadAllBytes(full); Preserve(bytes,"trash"); RecordIntent(new("delete",Identity(bytes),path,expectedHash)); File.Delete(full); } Changed?.Invoke();
    }
    void RecordIntent(FileIntent intent) => AtomicWrite(System.IO.Path.Combine(StateDirectory,"intent-"+intent.ItemId+".json"),JsonSerializer.SerializeToUtf8Bytes(intent));
    public FileIntent? Intent(string id) { var path=System.IO.Path.Combine(StateDirectory,"intent-"+id+".json"); return File.Exists(path)?JsonSerializer.Deserialize<FileIntent>(File.ReadAllBytes(path)):null; }
    public void ClearIntent(string id) => File.Delete(System.IO.Path.Combine(StateDirectory,"intent-"+id+".json"));
    public string GetRecoveryDirectory() {
        var directory=System.IO.Path.Combine(StateDirectory,"recovery");
        CheckLinks(directory);Directory.CreateDirectory(directory);CheckLinks(directory);
        return directory;
    }
    public string Preserve(byte[] bytes,string kind)
    {
        var path=System.IO.Path.Combine(GetRecoveryDirectory(),kind+"-"+Hash(bytes)+".textpack"); if(!File.Exists(path)) AtomicWrite(path,bytes); return path;
    }
}
