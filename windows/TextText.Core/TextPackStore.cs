using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
namespace TextText.Core;

public sealed record ScanError(string Path,string Reason,string? ItemId=null);
public sealed record PackFile(string Path, string Hash, string ItemId);
public sealed record WorkspaceInventory(IReadOnlyList<PackFile> Files, IReadOnlyList<string> Folders);
public sealed record FileIntent(string Kind, string ItemId, string Path, string Hash, string? Destination = null,string? OperationId=null);
public sealed record FileMutationReceipt(int Version, string Fingerprint, string ItemId, string Path, string Hash, bool Committed);
public sealed record FileCreationReceipt(int Version, string Intent, string ItemId, string Path, string Hash, string Data);
public sealed class FileChangedException() : IOException("The file changed. Reload its current contents before writing.");
public sealed partial class TextPackStore
{
    public string Root { get; }
    public string StateDirectory { get; }
    public IReadOnlyList<ScanError> LastScanErrors {get;private set;}=[];
    public event Action? Changed;
    internal Action? BeforeWriteCommitForTesting { get; set; }
    internal Action<string>? RemovalObservationForTesting { get; set; }
    internal Action<string>? MoveObservationForTesting { get; set; }
    readonly object gate = new();
    RetainedReplacementProfile.InventoryVerification? inventoryVerification;
    internal Action<string>? InventoryObservationForTesting {get;set;}
    internal void VerifyInventoryProfile(AccountRootOwnership.Owner owner,string rootHash)
    {
        if(inventoryVerification is {} scope)scope.Verify(owner,rootHash);
        else RetainedReplacementProfile.Verify(StateDirectory,owner,rootHash);
    }

    internal T WithExclusiveMutation<T>(Func<T> action) { lock(gate) return action(); }
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
        lock(gate){FolderCases.VerifyExistingProfile();AssertFolderRenameReadable();FolderCaseRename.ValidateCatalog(this,folders);foreach(var path in folders) {
            if(path.Length>1024||path.Split('/').Any(p=>p.StartsWith('.')||p.EndsWith(".textpack",StringComparison.OrdinalIgnoreCase)))throw new IOException("Invalid workspace folder.");
            _=Resolve(path);var current=Root;
            foreach(var part in path.Split('/')) {
                current=System.IO.Path.Combine(current,part);CheckLinks(current);
                if(File.Exists(System.IO.Path.Combine(System.IO.Path.GetDirectoryName(current)!,"."+part+".icloud")))throw new IOException("Folder is awaiting download.");
                if(Directory.Exists(current)&&!FolderCaseRename.ExactPathExists(Root,current)) {
                    var aliases=Directory.EnumerateDirectories(System.IO.Path.GetDirectoryName(current)!).Where(entry=>string.Equals(System.IO.Path.GetFileName(entry),part,StringComparison.OrdinalIgnoreCase)).Take(2).ToArray();
                    if(aliases.Length!=1||FolderCaseRename.Identity(aliases[0])!=FolderCaseRename.Identity(current))throw new IOException("Folder spelling alias is ambiguous.");
                    FolderCases.RenameAlias(aliases[0],current,FolderCaseObservationForTesting);
                } else Directory.CreateDirectory(current);
                CheckLinks(current);
            }
        }}
    }
    public void ValidateManagedFolder(string path) {
        if(path.Length>1024||path.Split('/').Any(p=>p.StartsWith('.')||p.EndsWith(".textpack",StringComparison.OrdinalIgnoreCase)))throw new IOException("Invalid workspace folder.");
        _=Resolve(path);
    }
    // Nonrecursive deletion refuses concurrent entries, unknown descendants and provider placeholders.
    public bool RemoveEmptyManagedFolder(string path) {
        if(path.Length>1024||path.Split('/').Any(p=>p.StartsWith('.')||p.EndsWith(".textpack",StringComparison.OrdinalIgnoreCase)))throw new IOException("Invalid workspace folder.");
        lock(gate) {
            FolderCases.VerifyExistingProfile();AssertFolderRenameReadable();var full=Resolve(path);if(!FolderCaseRename.ExactPathExists(Root,full))return true;var current=Root;
            foreach(var part in path.Split('/')) {
                current=System.IO.Path.Combine(current,part);CheckLinks(current);
                if(Directory.Exists(current)&&(File.GetAttributes(current)&FileAttributes.Offline)!=0)throw new IOException("Folder is awaiting download.");
                if(File.Exists(System.IO.Path.Combine(System.IO.Path.GetDirectoryName(current)!,"."+part+".icloud")))throw new IOException("Folder is awaiting download.");
            }
            try {Directory.Delete(full,false);Changed?.Invoke();return true;}
            catch(DirectoryNotFoundException){return true;}
            catch(IOException){return false;}
            catch(UnauthorizedAccessException){return false;}
        }
    }
    public static string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    static byte[] ReadProjection(string full)
    {
        // On Windows this sharing mode excludes in-place writes and rename-over
        // while the bounded snapshot is open. Never allocate from unchecked size.
        using var stream = new FileStream(full, FileMode.Open, FileAccess.Read, FileShare.Read, 4096, FileOptions.SequentialScan);
        var length = stream.Length;
        if (length > 64 * 1024 * 1024) throw new InvalidDataException("TextPack too large.");
        var bytes = new byte[checked((int)length)];
        stream.ReadExactly(bytes);
        if (stream.ReadByte() != -1) throw new FileChangedException();
        return bytes;
    }
    public byte[] Read(string path) { lock(gate) { AssertFolderRenameReadable();Replacements.AssertPathReadable(path);var bytes=ReadProjection(Resolve(path)); string? id;try{id=Identity(bytes);}catch{AssertReplacementReadable(null);throw;}AssertReplacementReadable(id);return bytes; } }
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
        return Equivalent(left,right,false);
    }
    // A copied pack may carry additional, noncompeting frontmatter. These
    // bytes are a real local change: the caller must CAS-upload them, never
    // silently declare the files equal or discard the extra metadata.
    public static bool ExtendsMetadata(byte[] local,byte[] remote) => Equivalent(local,remote,true);
    static bool Equivalent(byte[] left,byte[] right,bool extendingMetadata) {
        _=Identity(left);_=Identity(right);
        using var a=new ZipArchive(new MemoryStream(left));using var b=new ZipArchive(new MemoryStream(right));
        var aFiles=a.Entries.Where(entry=>!entry.FullName.EndsWith('/')||entry.Length!=0).ToArray();
        var bFiles=b.Entries.Where(entry=>!entry.FullName.EndsWith('/')||entry.Length!=0).ToArray();
        if(aFiles.Length!=bFiles.Length)return false;
        var documentPath=CanonicalPrefix(a)+"document.json";
        foreach(var entry in aFiles){var other=b.GetEntry(entry.FullName);if(other==null)return false;using var x=entry.Open();using var y=other.Open();
            if(extendingMetadata && entry.FullName==CanonicalPrefix(a)+"text.md") {
                using var localReader=new StreamReader(x,new UTF8Encoding(false,true));using var remoteReader=new StreamReader(y,new UTF8Encoding(false,true));
                if(!ExtendsHeader(localReader.ReadToEnd(),remoteReader.ReadToEnd()))return false;
                continue;
            }
            if(entry.FullName==documentPath) {
                try {using var leftDocument=JsonDocument.Parse(x);using var rightDocument=JsonDocument.Parse(y);
                    if(!UniqueProperties(leftDocument.RootElement)||!UniqueProperties(rightDocument.RootElement)||!JsonElement.DeepEquals(leftDocument.RootElement,rightDocument.RootElement))return false;
                } catch(JsonException){return false;}
                continue;
            }
            if(entry.Length!=other.Length)return false;var xb=new byte[8192];var yb=new byte[8192];while(true){var xn=x.Read(xb);if(xn==0){if(y.ReadByte()!=-1)return false;break;}y.ReadExactly(yb.AsSpan(0,xn));if(!xb.AsSpan(0,xn).SequenceEqual(yb.AsSpan(0,xn)))return false;}}
        return true;
    }
    static bool ExtendsHeader(string local,string remote) {
        static (Dictionary<string,string> Fields,string Body)? Parse(string text) {
            var match=Regex.Match(text,@"\A---\r?\n(?<header>[\s\S]*?)\r?\n---[ \t]*\r?\n(?<body>[\s\S]*)\z");
            if(!match.Success)return null;
            var fields=new Dictionary<string,string>(StringComparer.Ordinal);
            foreach(var line in match.Groups["header"].Value.Split('\n')) {
                var field=Regex.Match(line.TrimEnd('\r'),@"\A(?<key>[A-Za-z][A-Za-z0-9_-]*):[ \t]*(?<value>.*)\z");
                // Accept only the single-line JSON scalars emitted by our
                // projection. General YAML, comments and duplicates stay exact.
                if(!field.Success)return null;
                var value=field.Groups["value"].Value;
                try {using var json=JsonDocument.Parse(value);if(json.RootElement.ValueKind is JsonValueKind.Object or JsonValueKind.Array)return null;}
                catch(JsonException){return null;}
                if(!fields.TryAdd(field.Groups["key"].Value,value))return null;
            }
            return (fields,match.Groups["body"].Value);
        }
        var a=Parse(local);var b=Parse(remote);
        return a is {} added && b is {} original && added.Body==original.Body && added.Fields.Count>original.Fields.Count &&
            original.Fields.All(field=>added.Fields.TryGetValue(field.Key,out var value)&&value==field.Value) &&
            added.Fields.Where(field=>!original.Fields.ContainsKey(field.Key)).All(field=>
                field.Key is "workspace" or "mode" or "slug" || field.Key=="excerpt" && field.Value=="\"\"");
    }
    // JSON object ordering is serialization, but duplicate keys are ambiguous.
    // Other archive entries (including authored Markdown metadata) stay exact.
    static bool UniqueProperties(JsonElement value) {
        if(value.ValueKind==JsonValueKind.Object) {var names=new HashSet<string>(StringComparer.Ordinal);foreach(var property in value.EnumerateObject())if(!names.Add(property.Name)||!UniqueProperties(property.Value))return false;}
        else if(value.ValueKind==JsonValueKind.Array)foreach(var item in value.EnumerateArray())if(!UniqueProperties(item))return false;
        return true;
    }
    public IReadOnlyList<PackFile> Scan() => ScanInventory().Files;
    public WorkspaceInventory ScanInventory()=>ScanInventory(null,null);
    WorkspaceInventory ScanInventory(IReadOnlySet<string>? noRecoveryItems,ProtectedRenameScope? generationScope)
    {
        var folders=new List<string>();var found = new Dictionary<string,PackFile>();var duplicated=new HashSet<string>();var errors=new List<ScanError>();
        string Relative(string path)=>System.IO.Path.GetRelativePath(Root,path).Replace('\\','/');
        void Error(string path,string reason,string? id=null){if(errors.Count<1000)errors.Add(new(Relative(path),reason,id));}
        void Visit(string directory) {
            string[] entries;
            try {CheckLinks(directory);entries=Directory.GetFileSystemEntries(directory);}catch(Exception error)when(error is IOException or UnauthorizedAccessException){Error(directory,"Folder is temporarily unavailable.");return;}
            if(directory!=Root)folders.Add(Relative(directory));
            foreach(var path in entries) {
                if(System.IO.Path.GetFileName(path).StartsWith('.'))continue;
                try {
                    if(ProviderPaths.IsUnsafeReparse(path)){Error(path,"Linked workspace entry is unsupported.");continue;}
                    if(Directory.Exists(path)){Visit(path);continue;}
                    if(!path.EndsWith(".textpack",StringComparison.OrdinalIgnoreCase))continue;
                    PackFile entry;
                    if(noRecoveryItems is {Count:>0}) {
                        var discovery=ReadProjection(Resolve(Relative(path)));var id=Identity(discovery);
                        if(noRecoveryItems.Contains(id)) {
                            try {
                                var bytes=ReadGenerationProjection(Relative(path),id,generationScope??throw new SharedAccountMismatchException());
                                entry=new(Relative(path),Hash(bytes),id);
                            } catch(Exception error)when(error is IOException or InvalidDataException or JsonException or UnauthorizedAccessException) {
                                Error(path,"Generation inspection is unavailable; bytes remain retained.",id);continue;
                            }
                        } else entry=Describe(Relative(path));
                    } else entry=Describe(Relative(path));
                    if(duplicated.Contains(entry.ItemId)){Error(path,"Duplicate document identity.",entry.ItemId);continue;}
                    if(found.Remove(entry.ItemId,out var previous)){duplicated.Add(entry.ItemId);Error(Resolve(previous.Path),"Duplicate document identity.",entry.ItemId);Error(path,"Duplicate document identity.",entry.ItemId);continue;}
                    found.Add(entry.ItemId,entry);
                }catch(Exception error)when(error is IOException or InvalidDataException or UnauthorizedAccessException or JsonException or DecoderFallbackException){Error(path,"File is invalid or temporarily unavailable. Its contents have been preserved.");}
            }
        }
        lock(gate){
            using var verification=RetainedReplacementProfile.HasPublishedMarker(StateDirectory)
                ?new RetainedReplacementProfile.InventoryVerification(StateDirectory,Hash(Encoding.UTF8.GetBytes(Root))):null;
            inventoryVerification=verification;
            var outerFolderScope=folderCaseScope is not null;
            if(!outerFolderScope)folderCaseScope=(false,null);
            try {
                inventoryReplacements=new(Root,StateDirectory,RemovalObservationForTesting){VerifyProfile=VerifyInventoryProfile,PinnedOwner=verification is not null};
                InventoryObservationForTesting?.Invoke("profileVerified");
                FolderCases.VerifyExistingProfile();
                if(noRecoveryItems is not {Count:>0})AssertFolderRenameReadable();
                // Per-entry recovery remains enabled; the profile chain and the
                // folder-case outcome are shared within this synchronous,
                // store-serialized scan and rechecked before it returns.
                CheckLinks(Root);Visit(Root);InventoryObservationForTesting?.Invoke("scanned");
                if(!outerFolderScope)VerifyFolderCaseScopeUnchanged();
                LastScanErrors=errors.ToArray();
            } finally {inventoryVerification=null;inventoryReplacements=null;if(!outerFolderScope)folderCaseScope=null;}
        }return new(found.Values.ToArray(),folders.Order(StringComparer.Ordinal).ToArray());
    }

    public static void AtomicWrite(string path, byte[] bytes, bool overwrite = true)
        => AtomicWrite(path, bytes, overwrite, null);
    static void AtomicWrite(string path, byte[] bytes, bool overwrite, Action? beforeCommit)
    {
        Directory.CreateDirectory(System.IO.Path.GetDirectoryName(path)!); CheckLinks(path);
        var temp = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try { using(var stream = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough)) { stream.Write(bytes); stream.Flush(true); } CheckLinks(path); beforeCommit?.Invoke(); File.Move(temp,path,overwrite); }
        finally { if(File.Exists(temp)) File.Delete(temp); }
    }
    void Match(string full, string? expected) {
        AssertFolderRenameReadable();Replacements.AssertPathReadable(System.IO.Path.GetRelativePath(Root,full).Replace('\\','/'));
        if(File.Exists(full)) {var bytes=ReadProjection(full);AssertReplacementReadable(Identity(bytes));if(expected is null||Hash(bytes)!=expected)throw new FileChangedException();}
        else if(expected is not null)throw new FileChangedException();
    }
    public PackFile Write(string path, byte[] bytes, string? expectedHash = null)
    {
        var id = Identity(bytes);
        lock(gate) { AssertReplacementReadable(id); var full=RetainedFileMove.ExistingPhysicalLeaf(Resolve(path)); Match(full,expectedHash); if(File.Exists(full)) { var previous=ReadProjection(full); if(Identity(previous)!=id) throw new InvalidDataException("A different document already occupies this path."); Preserve(previous, "history"); }
            if(OperatingSystem.IsWindows() && expectedHash is not null) {
                RetainedReplacementProfile.Prepare(this);
                var operation=Guid.NewGuid();
                var recoveryRoot=System.IO.Path.Combine(Root,".texttext","retained-replacements",Hash(Encoding.UTF8.GetBytes(path)));
                _=RetainedFileReplacement.Replace(full,expectedHash,bytes,operation,point=>{
                    if(point=="prepared") {
                        BeforeWriteCommitForTesting?.Invoke();CheckLinks(full);Match(full,expectedHash);
                        Replacements.Register(operation,id,path,expectedHash,Hash(bytes),RetainedFileReplacement.OperationDirectory(full,operation,recoveryRoot));
                    }
                },recoveryRoot);
                AssertReplacementReadable(id);
            } else AtomicWrite(full, bytes, expectedHash != null, () => {
                BeforeWriteCommitForTesting?.Invoke();
                // Staging and fsync can take time. Recheck after both, so an
                // external save during preparation remains available to merge.
                // File.Move itself is not a filesystem-wide compare-and-swap.
                CheckLinks(full); Match(full, expectedHash);
            });
        }
        Changed?.Invoke(); return new(path,Hash(bytes),id);
    }
    // Persist intent before writing and completion before returning. A retry
    // follows committed identity; it never reapplies old bytes over later work.
    public PackFile WriteIdempotent(string path, byte[] bytes, string? expectedHash, string operationId)
    {
        if (!Guid.TryParseExact(operationId,"D",out _)) throw new InvalidDataException("Invalid file operation identity.");
        var id=Identity(bytes); var hash=Hash(bytes); _=Resolve(path);
        var fingerprint=Hash(JsonSerializer.SerializeToUtf8Bytes(new { Root, path, expectedHash, hash, id }));
        var journal=System.IO.Path.Combine(StateDirectory,"mutation-"+operationId.ToLowerInvariant()+".json");
        CheckLinks(journal); CheckLinks(journal+".lock");
        lock(gate) {
            AssertReplacementReadable(id);
            using var fence=new FileStream(journal+".lock",FileMode.OpenOrCreate,FileAccess.ReadWrite,FileShare.None);
            FileMutationReceipt? receipt=null;
            if(File.Exists(journal)) {
                if(new FileInfo(journal).Length>4096)throw new InvalidDataException("Invalid file operation receipt.");
                receipt=JsonSerializer.Deserialize<FileMutationReceipt>(File.ReadAllBytes(journal));
                if(receipt is null || receipt.Version!=1 || receipt.Fingerprint!=fingerprint || receipt.ItemId!=id || receipt.Path!=path || receipt.Hash!=hash)
                    throw new InvalidDataException("The operation identity belongs to a different file change.");
                if(receipt.Committed) {
                    var matches=Scan().Where(file=>file.ItemId==id).ToArray();
                    if(matches.Length!=1 || LastScanErrors.Any(error=>error.ItemId==id))throw new FileChangedException();
                    return matches[0];
                }
                // Completion can be interrupted after the atomic file write.
                // Only the exact prepared result attests that pending write.
                if(Scan().Any(file=>file.ItemId==id && file.Path!=path) || LastScanErrors.Any(error=>error.ItemId==id))
                    throw new FileChangedException();
                if(File.Exists(Resolve(path))) {
                    var observed=Describe(path);
                    if(observed.ItemId==id && observed.Hash==hash) {
                        AtomicWrite(journal,JsonSerializer.SerializeToUtf8Bytes(receipt with { Committed=true }));
                        return observed;
                    }
                }
            } else {
                Match(Resolve(path),expectedHash);
                receipt=new(1,fingerprint,id,path,hash,false);
                AtomicWrite(journal,JsonSerializer.SerializeToUtf8Bytes(receipt));
            }
            if(expectedHash is null && (Scan().Any(file=>file.ItemId==id && file.Path!=path) || LastScanErrors.Any(error=>error.ItemId==id)))
                throw new FileChangedException();
            var result=Write(path,bytes,expectedHash);
            AssertReplacementReadable(id);
            AtomicWrite(journal,JsonSerializer.SerializeToUtf8Bytes(receipt with { Committed=true }));
            return result;
        }
    }
    // Freeze the creation result before publishing it. Renderer restarts can
    // otherwise generate a different identity, ZIP or collision suffix.
    // Completed records retain only attestation, not a second permanent ZIP.
    public PackFile? CreateIdempotent(string operationId, string intent, Action<PackFile,bool> authorize, string? path=null, byte[]? bytes=null)
    {
        if(!Guid.TryParseExact(operationId,"D",out _) || !Regex.IsMatch(intent,"^[a-f0-9]{64}$"))
            throw new InvalidDataException("Invalid creation identity.");
        var journal=System.IO.Path.Combine(StateDirectory,"creation-"+operationId.ToLowerInvariant()+".json");
        CheckLinks(journal); CheckLinks(journal+".lock");
        lock(gate) {
            using var fence=new FileStream(journal+".lock",FileMode.OpenOrCreate,FileAccess.ReadWrite,FileShare.None);
            FileCreationReceipt receipt;
            if(File.Exists(journal)) {
                if(new FileInfo(journal).Length>45*1024*1024) throw new InvalidDataException("Invalid creation receipt.");
                receipt=JsonSerializer.Deserialize<FileCreationReceipt>(File.ReadAllBytes(journal)) ?? throw new InvalidDataException("Invalid creation receipt.");
                if(receipt.Version!=1 || receipt.Intent!=intent || receipt.Data is null || receipt.Path is null || receipt.Hash is null || !Guid.TryParseExact(receipt.ItemId,"D",out _) || !Regex.IsMatch(receipt.Hash,"^[a-f0-9]{64}$"))
                    throw new InvalidDataException("The creation identity belongs to another request or unsupported receipt.");
                _=Resolve(receipt.Path);
            } else {
                if(path is null || bytes is null) return null;
                if(bytes.Length>32*1024*1024) throw new InvalidDataException("The TextPack exceeds the creation limit.");
                var id=Identity(bytes); _=Resolve(path);
                if(!Guid.TryParseExact(id,"D",out _)) throw new InvalidDataException("Invalid new document identity.");
                authorize(new(path,Hash(bytes),id),false);
                receipt=new(1,intent,id,path,Hash(bytes),Convert.ToBase64String(bytes));
                AtomicWrite(journal,JsonSerializer.SerializeToUtf8Bytes(receipt));
            }
            var matches=Scan().Where(file=>file.ItemId==receipt.ItemId).ToArray();
            if(matches.Length>1 || LastScanErrors.Any(error=>error.ItemId==receipt.ItemId)) throw new FileChangedException();
            authorize(matches.SingleOrDefault() ?? new(receipt.Path,receipt.Hash,receipt.ItemId),matches.Length==1);
            if(receipt.Data.Length==0) {
                // A compact receipt is meaningful only with a matching durable
                // committed mutation. Never infer success from identity alone.
                var mutation=System.IO.Path.Combine(StateDirectory,"mutation-"+operationId.ToLowerInvariant()+".json");
                CheckLinks(mutation);
                if(!File.Exists(mutation) || new FileInfo(mutation).Length>4096) throw new InvalidDataException("Creation completion is unavailable.");
                var completed=JsonSerializer.Deserialize<FileMutationReceipt>(File.ReadAllBytes(mutation));
                var fingerprint=Hash(JsonSerializer.SerializeToUtf8Bytes(new {Root,path=receipt.Path,expectedHash=(string?)null,hash=receipt.Hash,id=receipt.ItemId}));
                if(completed is null || completed.Version!=1 || !completed.Committed || completed.Fingerprint!=fingerprint || completed.ItemId!=receipt.ItemId || completed.Path!=receipt.Path || completed.Hash!=receipt.Hash)
                    throw new InvalidDataException("Creation completion could not be verified.");
                if(matches.Length!=1) throw new FileChangedException();
                return matches[0];
            }
            var prepared=Convert.FromBase64String(receipt.Data);
            if(prepared.Length>32*1024*1024 || Identity(prepared)!=receipt.ItemId || Hash(prepared)!=receipt.Hash)
                throw new InvalidDataException("The prepared creation is invalid.");
            var result=WriteIdempotent(receipt.Path,prepared,null,operationId);
            AtomicWrite(journal,JsonSerializer.SerializeToUtf8Bytes(receipt with {Data=""}));
            return result;
        }
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
        lock(gate) {
            var source=Resolve(from);var target=Resolve(to);Match(source,expectedHash);Replacements.AssertPathReadable(to);
            if(FolderCaseRename.AlreadyMovedAlias(Root,source,target)) {
                RetainedReplacementProfile.PrepareFolderCase(this,FolderCaseObservationForTesting);
                var actual=ReadProjection(target);var id=Identity(actual);
                if(Hash(actual)!=expectedHash||Scan().Count(file=>file.ItemId==id)!=1)throw new FileChangedException();
                RecordIntent(new FileIntent("rename",id,from,expectedHash,to));
            } else {
            var caseOnly=RetainedFileMove.IsCaseOnlyAlias(source,target);
            if(!caseOnly&&RetainedFileReplacement.ExistsNoFollow(target))throw new IOException("Destination exists.");
            var before=ReadProjection(source);if(Hash(before)!=expectedHash)throw new FileChangedException();var identity=Identity(before);
            RetainedReplacementProfile.Prepare(this);var operation=Guid.NewGuid();
            var recoveryRoot=System.IO.Path.Combine(Root,".texttext","retained-replacements",Hash(Encoding.UTF8.GetBytes(to)));
            _=RetainedFileMove.Move(source,target,from,expectedHash,recoveryRoot,operation,Replacements.CaptureLeasePath(operation),point=>{
                if(point=="prepared")Replacements.Register(operation,identity,to,expectedHash,expectedHash,RetainedFileReplacement.OperationDirectory(target,operation,recoveryRoot),kind:"move",sourcePath:from,caseOnly:caseOnly);
                MoveObservationForTesting?.Invoke(point);
            },caseOnly:caseOnly);
            AssertReplacementReadable(identity);RecordIntent(new FileIntent("rename",identity,from,expectedHash,to));
            }
        }
        Changed?.Invoke();
    }
    public void Delete(string path,string expectedHash)=>RemoveRetaining(path,expectedHash,recordDeletion:true);
    public void RemoveRetaining(string path,string expectedHash,bool recordDeletion=false)
    {
        lock(gate) {
            var full=RetainedFileMove.ExistingPhysicalLeaf(Resolve(path));Match(full,expectedHash);var bytes=ReadProjection(full);var identity=Identity(bytes);
            if(Hash(bytes)!=expectedHash)throw new FileChangedException();
            if(recordDeletion)ClearPriorDeletionForRestoredFile(identity,path,expectedHash);
            RetainedReplacementProfile.Prepare(this);Preserve(bytes,"history");
            var operation=Guid.NewGuid();var recoveryRoot=System.IO.Path.Combine(Root,".texttext","retained-replacements",Hash(Encoding.UTF8.GetBytes(path)));
            _=RetainedFileRemoval.Capture(full,expectedHash,recoveryRoot,operation,point=>{
                if(point=="prepared")Replacements.Register(operation,identity,path,expectedHash,expectedHash,RetainedFileReplacement.OperationDirectory(full,operation,recoveryRoot),kind:"removal",userDeletion:recordDeletion);
                RemovalObservationForTesting?.Invoke(point);
            },leasePath:Replacements.CaptureLeasePath(operation));
            RemovalObservationForTesting?.Invoke("beforeDeletionMarker");
            if(recordDeletion)AssertReplacementReadable(identity);
        }
        Changed?.Invoke();
    }
    void ClearPriorDeletionForRestoredFile(string itemId,string path,string expectedHash)
    {
        using var publication=DeletionPublication(StateDirectory);
        var existing=Intent(itemId);if(existing is null||existing.Kind=="rename")return;
        if(existing.Kind!="delete")throw new InvalidDataException("Unknown pending file intent cannot be replaced.");
        var bound=Replacements.RequireBoundDeletionMarker(itemId);var source=ReadProjection(Resolve(path));
        if(Identity(source)!=itemId||Hash(source)!=expectedHash)throw new FileChangedException();
        Replacements.MarkDeletionConsumed(bound.Intent);
        var marker=System.IO.Path.Combine(StateDirectory,"intent-"+itemId+".json");
        if(!RetainedFileReplacement.Read(marker,8192).SequenceEqual(bound.Bytes))throw new FileChangedException();
        File.Delete(marker);
    }
    internal static IDisposable DeletionPublication(string state)
    {
        var path=System.IO.Path.Combine(state,".deletion-publication.lock");RetainedFileReplacement.CheckPath(path);
        return new FileStream(path,FileMode.OpenOrCreate,FileAccess.ReadWrite,FileShare.None);
    }
    void RecordIntent(FileIntent intent) {using var publication=DeletionPublication(StateDirectory);AtomicWrite(System.IO.Path.Combine(StateDirectory,"intent-"+intent.ItemId+".json"),JsonSerializer.SerializeToUtf8Bytes(intent));}
    public FileIntent? Intent(string id) { var path=System.IO.Path.Combine(StateDirectory,"intent-"+id+".json"); return File.Exists(path)?JsonSerializer.Deserialize<FileIntent>(File.ReadAllBytes(path)):null; }
    void ConsumeIntent(string id,FileIntent? expected=null)
    {
        using var publication=DeletionPublication(StateDirectory);var saved=Intent(id);if(saved is null||expected is not null&&saved!=expected)return;
        if(saved.OperationId is not null) {
            var bound=Replacements.RequireBoundDeletionMarker(id);if(bound.Intent!=saved)throw new FileChangedException();
            Replacements.MarkDeletionConsumed(saved);
            if(!RetainedFileReplacement.Read(System.IO.Path.Combine(StateDirectory,"intent-"+id+".json"),8192).SequenceEqual(bound.Bytes))throw new FileChangedException();
        }
        File.Delete(System.IO.Path.Combine(StateDirectory,"intent-"+id+".json"));
    }
    public void ClearIntent(string id, FileIntent expected) {lock(gate)ConsumeIntent(id,expected);}
    public void ClearIntent(string id) {lock(gate)ConsumeIntent(id);}
    public string GetRecoveryDirectory() {
        var directory=System.IO.Path.Combine(StateDirectory,"recovery");
        CheckLinks(directory);Directory.CreateDirectory(directory);CheckLinks(directory);
        return directory;
    }
    public string Preserve(byte[] bytes,string kind)
    {
        return PreserveBytes(bytes,kind,".textpack",64*1024*1024);
    }
    public string PreserveAsset(byte[] bytes,string kind) => PreserveBytes(bytes,kind,".asset",16*1024*1024);
    string PreserveBytes(byte[] bytes,string kind,string extension,int maximum) {
        if(bytes.Length>maximum)throw new InvalidDataException("Recovery exceeds bounds.");
        lock(gate) {
            var path=System.IO.Path.Combine(GetRecoveryDirectory(),kind+"-"+Hash(bytes)+extension);
            CheckLinks(path);
            if(!File.Exists(path)) {
                using var created=new FileStream(path,FileMode.CreateNew,FileAccess.Write,FileShare.None);
                created.Write(bytes);created.Flush(true);
            } else {
                using var existing=new FileStream(path,FileMode.Open,FileAccess.ReadWrite,FileShare.Read);
                if(existing.Length!=bytes.Length)throw new InvalidDataException("Existing recovery bytes changed.");
                var captured=new byte[bytes.Length];existing.ReadExactly(captured);
                if(existing.ReadByte()!=-1||!captured.AsSpan().SequenceEqual(bytes))throw new InvalidDataException("Existing recovery bytes changed.");
                existing.Flush(true);
            }
            return path;
        }
    }
}
