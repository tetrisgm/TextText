using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace TextText.Core;

/// Retains the actual displaced file. Caller owns store serialization and must
/// register the identity fence before invoking Replace. Artifacts are never deleted.
public static class RetainedFileReplacement
{
    public sealed record Stamp(long Length, long Creation, long LastWrite, long Change, uint Volume, ulong FileId);
    public sealed record Manifest(int Version, Guid Operation, string Filename, string ExpectedHash, string PreparedHash, string State,
        Stamp? PreparedStamp = null, Stamp? DisplacedStamp = null,string? Kind=null,string? SourcePath=null,bool? CaseOnly=null);
    public sealed record Recovery(string Directory, Manifest Record)
    {
        public string Prepared => Path.Combine(Directory, "prepared");
        public string Replacement => Path.Combine(Directory, "replacement");
        public string Displaced => Path.Combine(Directory, "displaced");
    }
    public sealed class RequiredException(Guid operation) : IOException("File replacement requires recovery inspection.")
    { public Guid Operation { get; } = operation; }
    public static bool ValidHash(string value) => Regex.IsMatch(value, @"^[a-f0-9]{64}\z");
    public static void JsonFields(byte[] bytes,string[] known,string[] required)
    {
        using var document=JsonDocument.Parse(bytes);
        if(document.RootElement.ValueKind!=JsonValueKind.Object)throw new InvalidDataException("Invalid recovery record.");
        var fields=document.RootElement.EnumerateObject().Select(field=>field.Name).ToArray();
        if(fields.Distinct(StringComparer.Ordinal).Count()!=fields.Length||fields.Any(field=>!known.Contains(field,StringComparer.Ordinal))||required.Any(field=>!fields.Contains(field,StringComparer.Ordinal)))throw new InvalidDataException("Unsupported recovery record fields.");
    }
    [StructLayout(LayoutKind.Sequential)] struct BasicInfo { public long Creation, Access, Write, Change; public uint Attributes; }
    [StructLayout(LayoutKind.Sequential)] struct FileInformation { public uint Attributes; public System.Runtime.InteropServices.ComTypes.FILETIME Creation, Access, Write; public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern SafeFileHandle CreateFileW(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] static extern bool GetFileInformationByHandle(SafeFileHandle handle, out FileInformation info);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] static extern bool GetFileInformationByHandleEx(SafeFileHandle handle, int kind, out BasicInfo info, uint size);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] static extern bool GetDiskFreeSpaceExW(string path, out ulong available, out ulong total, out ulong free);
    public static void RequireSpace(string target, int candidateBytes)
    {
        var required = checked(2L * candidateBytes + 64L * 1024 * 1024);
        if (OperatingSystem.IsWindows()) {
            if (!GetDiskFreeSpaceExW(Path.GetDirectoryName(Path.GetFullPath(target))!, out var available, out _, out _)) throw new IOException("Could not verify recovery storage. Check this drive and try again.");
            if (available < (ulong)required) throw new IOException("This drive needs more free space to save safely. Free space and try again. Your files and pending edits remain saved.");
        }
    }
    // Portable test runs deliberately do not cache: Windows change-time and file
    // identity are required before metadata can stand in for hashing retained bytes.
    public static Stamp? Fingerprint(string path, bool ancestorsVerified=false)
    {
        if (!OperatingSystem.IsWindows()) return null;
        if(!ancestorsVerified)CheckPath(path);
        using var handle = CreateFileW(NativePath(path), 0, 7, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero);
        if (handle.IsInvalid || !GetFileInformationByHandle(handle, out var info) ||
            !GetFileInformationByHandleEx(handle, 0, out var basic, (uint)Marshal.SizeOf<BasicInfo>())) return null;
        if(ancestorsVerified&&(info.Attributes&(uint)(FileAttributes.ReparsePoint|FileAttributes.Directory))!=0)throw new IOException("Linked recovery paths are not supported.");
        return new(((long)info.SizeHigh << 32) | info.SizeLow, basic.Creation, basic.Write, basic.Change,
            info.Volume, ((ulong)info.IndexHigh << 32) | info.IndexLow);
    }
    public static bool Unchanged(string path, Stamp? stamp) => stamp is not null && stamp == Fingerprint(path);
    static string NativePath(string path)
    {
        var full=Path.GetFullPath(path);
        if(full.StartsWith(@"\\?\",StringComparison.Ordinal))return full;
        return full.StartsWith(@"\\",StringComparison.Ordinal)?@"\\?\UNC\"+full[2..]:@"\\?\"+full;
    }
    static (string Hash, Stamp? Stamp) HashStable(string path,bool ancestorsVerified=false)
    {
        var before = Fingerprint(path,ancestorsVerified); var hash = TextPackStore.Hash(ancestorsVerified?ReadVerified(path):Read(path)); var after = Fingerprint(path,ancestorsVerified);
        if (before != after) throw new FileChangedException();
        return (hash, after);
    }
    public static void CheckPath(string path, ISet<string>? verified=null)
    {
        for (var current = Path.GetFullPath(path); !string.IsNullOrEmpty(current); current = Path.GetDirectoryName(current)) {
            if(verified?.Contains(current)==true)break;
            if (ProviderPaths.IsUnsafeReparseIfPresent(current))
                throw new IOException("Linked recovery paths are not supported.");
            verified?.Add(current);
        }
    }
    public static byte[] Read(string path, int maximum = 64 * 1024 * 1024)
    {
        CheckPath(path);
        if ((File.GetAttributes(path) & FileAttributes.Directory) != 0) throw new IOException("Recovery path is not a file.");
        using var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 4096, FileOptions.SequentialScan);
        if (file.Length > maximum) throw new InvalidDataException("Recovery file exceeds limits.");
        var bytes = new byte[checked((int)file.Length)]; file.ReadExactly(bytes);
        if (file.ReadByte() != -1) throw new FileChangedException();
        return bytes;
    }
    // Caller has checked the operation directory in this guard. The final file
    // is opened without following a reparse point and held against writers.
    internal static byte[] ReadVerified(string path,int maximum=64*1024*1024)
    {
        if(!OperatingSystem.IsWindows())return Read(path,maximum);
        using var handle=CreateFileW(NativePath(path),0x80000000,1,IntPtr.Zero,3,0x00200000,IntPtr.Zero);
        if(handle.IsInvalid||!GetFileInformationByHandle(handle,out var info)) {
            var error=Marshal.GetLastWin32Error();
            if(error==2)throw new FileNotFoundException("Retained recovery file is missing.",path);
            if(error==3)throw new DirectoryNotFoundException("Retained recovery directory is missing.");
            throw new IOException("Cannot open retained recovery file.",new System.ComponentModel.Win32Exception(error));
        }
        if((info.Attributes&(uint)(FileAttributes.ReparsePoint|FileAttributes.Directory))!=0)throw new IOException("Retained recovery path is not a regular file.");
        using var file=new FileStream(handle,FileAccess.Read);
        if(file.Length>maximum)throw new InvalidDataException("Recovery file exceeds limits.");
        var bytes=new byte[checked((int)file.Length)];file.ReadExactly(bytes);
        if(file.ReadByte()!=-1)throw new FileChangedException();
        return bytes;
    }
    static (string? Hash, Stamp? Stamp) TryHash(string path,bool ancestorsVerified=false)
    {
        try { return HashStable(path,ancestorsVerified); }
        catch (IOException) { return (null, null); }
        catch (UnauthorizedAccessException) { return (null, null); }
    }
    public static void Create(string path, byte[] bytes)
    {
        CheckPath(path);
        using var file = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough);
        file.Write(bytes); file.Flush(true);
    }
    public static void SaveJson<T>(string path, T value, bool creating = false)
    {
        CheckPath(path);
        var bytes = JsonSerializer.SerializeToUtf8Bytes(value);
        if (creating) { Create(path, bytes); return; }
        var temporary = Path.Combine(Path.GetDirectoryName(path)!, "." + Path.GetFileName(path) + "." + Guid.NewGuid().ToString("N"));
        Create(temporary, bytes);
        // Journal replacement never discards the document or retained versions.
        File.Move(temporary, path, true);
    }
    public static string OperationDirectory(string target, Guid operation,string? recoveryRoot=null) => Path.Combine(
        recoveryRoot??Path.GetDirectoryName(Path.GetFullPath(target))!, ".texttext-replacements",
        TextPackStore.Hash(Encoding.UTF8.GetBytes(Path.GetFileName(target))), operation.ToString("D"));
    public static Recovery Inspect(string target, Guid operation)
    {
        return InspectDirectory(OperationDirectory(target, operation), Path.GetFileName(target), operation);
    }
    static readonly object manifestGate=new();
    static readonly Dictionary<string,(Stamp Stamp,Manifest Manifest)> manifests=new(StringComparer.Ordinal);
    public static Recovery InspectDirectory(string directory,string filename,Guid operation,ISet<string>? verified=null,bool allowCaseAlias=false)
    {
        CheckPath(directory,verified);
        var path=Path.Combine(directory,"manifest.json");var stamp=Fingerprint(path,ancestorsVerified:true);Manifest? manifest=null;
        lock(manifestGate)if(stamp is not null&&manifests.TryGetValue(path,out var cached)&&cached.Stamp==stamp)manifest=cached.Manifest;
        if(manifest is null) {
        var bytes=ReadVerified(path,8192);
        JsonFields(bytes,["Version","Operation","Filename","ExpectedHash","PreparedHash","State","PreparedStamp","DisplacedStamp","Kind","SourcePath","CaseOnly"],["Version","Operation","Filename","ExpectedHash","PreparedHash","State"]);
        manifest = JsonSerializer.Deserialize<Manifest>(bytes)
            ?? throw new InvalidDataException("Missing replacement manifest.");
        if(stamp!=Fingerprint(path,ancestorsVerified:true))throw new FileChangedException();
        if(stamp is not null)lock(manifestGate){if(manifests.Count>=4096)manifests.Clear();manifests[path]=(stamp,manifest);}
        }
        if (manifest.Version != 1 || manifest.Operation != operation || (manifest.Filename != filename&&!(allowCaseAlias&&string.Equals(manifest.Filename,filename,StringComparison.OrdinalIgnoreCase))) ||
            Path.GetFileName(directory)!=operation.ToString("D") || Path.GetFileName(Path.GetDirectoryName(directory))!=TextPackStore.Hash(Encoding.UTF8.GetBytes(manifest.Filename)) ||
            Path.GetFileName(Path.GetDirectoryName(Path.GetDirectoryName(directory)))!=".texttext-replacements" ||
            !ValidHash(manifest.ExpectedHash) || !ValidHash(manifest.PreparedHash) ||
            manifest.Kind is not (null or "removal" or "move") || manifest.State is not ("pending" or "conflict" or "completed" or "cancelled") || manifest.State=="cancelled"&&manifest.Kind is not ("removal" or "move") || manifest.Kind is ("removal" or "move")&&manifest.ExpectedHash!=manifest.PreparedHash) throw new InvalidDataException("Invalid replacement manifest.");
        if(manifest.CaseOnly is not null&&(manifest.Kind!="move"||manifest.CaseOnly!=true)||manifest.CaseOnly==true&&!RetainedFileMove.CaseOnlyPaths(Path.GetFileName(manifest.SourcePath!),manifest.Filename))throw new InvalidDataException("Invalid case-only move manifest.");
        if((manifest.Kind=="move")!=(manifest.SourcePath is not null))throw new InvalidDataException("Invalid move manifest source.");
        return new(directory, manifest);
    }
    public static string OriginalTarget(Recovery recovery) => Path.Combine(Path.GetDirectoryName(Path.GetDirectoryName(Path.GetDirectoryName(recovery.Directory)))!,recovery.Record.Filename);
    public static Recovery Classify(Recovery recovery, string target,bool persist=true,ISet<string>? verified=null)
    {
        if (Path.GetFileName(recovery.Directory)!=recovery.Record.Operation.ToString("D") ||
            Path.GetFileName(Path.GetDirectoryName(recovery.Directory))!=TextPackStore.Hash(Encoding.UTF8.GetBytes(recovery.Record.Filename)) ||
            recovery.Record.Filename != Path.GetFileName(target)) throw new InvalidDataException("Replacement target mismatch.");
        CheckPath(recovery.Directory,verified);
        if(recovery.Record.Kind=="removal"&&(recovery.Record.State is "pending" or "cancelled")&&!ExistsNoFollow(recovery.Displaced)) {
            var preparedHash=TextPackStore.Hash(ReadVerified(recovery.Prepared));
            if(preparedHash!=recovery.Record.PreparedHash)throw new InvalidDataException("Prepared removal changed.");
            if(recovery.Record.State=="cancelled")return recovery;
            if(ExistsNoFollow(target)&&TextPackStore.Hash(Read(target))==recovery.Record.ExpectedHash) {
                var cancelled=recovery.Record with{State="cancelled"};
                if(persist)SaveJson(Path.Combine(recovery.Directory,"manifest.json"),cancelled);
                return recovery with{Record=cancelled};
            }
            return recovery;
        }
        bool Matches(string path,Stamp? expected)=>expected is not null&&expected==Fingerprint(path,ancestorsVerified:true);
        var preparedUnchanged = Matches(recovery.Prepared, recovery.Record.PreparedStamp);
        var prepared = preparedUnchanged ? (Hash: recovery.Record.PreparedHash, Stamp: recovery.Record.PreparedStamp) : HashStable(recovery.Prepared,ancestorsVerified:true);
        if (prepared.Hash != recovery.Record.PreparedHash) throw new InvalidDataException("Prepared recovery changed.");
        if (recovery.Record.State == "conflict") return recovery;
        if (recovery.Record.State == "completed" && preparedUnchanged && Matches(recovery.Displaced, recovery.Record.DisplacedStamp)) return recovery;
        var displaced = TryHash(recovery.Displaced,ancestorsVerified:true);
        // A completed operation can be followed by legitimate later target writes.
        // An old open descriptor may still change its displaced file, however.
        var state = recovery.Record.State == "completed"
            ? displaced.Hash == recovery.Record.ExpectedHash ? "completed" : "conflict"
            : displaced.Hash == recovery.Record.ExpectedHash && (recovery.Record.Kind=="removal"?!ExistsNoFollow(target):TryHash(target).Hash == recovery.Record.PreparedHash) ? "completed" : "conflict";
        if (state == recovery.Record.State && prepared.Stamp == recovery.Record.PreparedStamp && displaced.Stamp == recovery.Record.DisplacedStamp) return recovery;
        var record = recovery.Record with { State = state, PreparedStamp = prepared.Stamp, DisplacedStamp = displaced.Stamp };
        if(persist)SaveJson(Path.Combine(recovery.Directory, "manifest.json"), record);
        return recovery with { Record = record };
    }
    sealed class ParentPins(List<SafeFileHandle> handles):IDisposable
    {public void Dispose(){foreach(var handle in handles)handle.Dispose();}}
    // Deny rename/delete of every pathname ancestor while a Windows mutation is
    // active. Final file handles intentionally retain their existing semantics.
    internal static IDisposable PinParents(params string[] paths)
    {
        var handles=new List<SafeFileHandle>();var seen=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        try {
            foreach(var path in paths) {
                CheckPath(path);
                var parents=new Stack<string>();
                for(var parent=Path.GetDirectoryName(Path.GetFullPath(path));!string.IsNullOrEmpty(parent);parent=Path.GetDirectoryName(parent))parents.Push(parent);
                foreach(var parent in parents) {
                    if(!seen.Add(parent)||!OperatingSystem.IsWindows())continue;
                    var handle=CreateFileW(NativePath(parent),0,3,IntPtr.Zero,3,0x02200000,IntPtr.Zero);
                    if(handle.IsInvalid||!GetFileInformationByHandle(handle,out var info)||(info.Attributes&(uint)FileAttributes.ReparsePoint)!=0||(info.Attributes&(uint)FileAttributes.Directory)==0) {
                        handle.Dispose();throw new IOException("Workspace folder changed or could not be protected during the file operation.");
                    }
                    handles.Add(handle);
                }
                CheckPath(path);
            }
            return new ParentPins(handles);
        }catch{foreach(var handle in handles)handle.Dispose();throw;}
    }
    internal sealed class LeaseBusyException() : IOException("The native lease is held by another operation.");
    internal static IDisposable AcquireLease(string path,bool shared=false)
    {
        CheckPath(path);Directory.CreateDirectory(Path.GetDirectoryName(path)!);CheckPath(Path.GetDirectoryName(path)!);
        if(!OperatingSystem.IsWindows())return new FileStream(path,FileMode.OpenOrCreate,shared?FileAccess.Read:FileAccess.ReadWrite,shared?FileShare.Read:FileShare.None);
        var handle=CreateFileW(NativePath(path),shared?0x80000000u:0xC0000000u,shared?1u:0u,IntPtr.Zero,4,0x00200000,IntPtr.Zero);
        if(handle.IsInvalid) {
            var error=System.Runtime.InteropServices.Marshal.GetLastWin32Error();handle.Dispose();
            if(error is 32 or 33)throw new LeaseBusyException();
            throw new IOException("Removal operation is currently active or unavailable.");
        }
        if(!GetFileInformationByHandle(handle,out var info)) {handle.Dispose();throw new IOException("Removal operation is currently active or unavailable.");}
        if((info.Attributes&(uint)(FileAttributes.ReparsePoint|FileAttributes.Directory))!=0){handle.Dispose();throw new IOException("Invalid removal operation lease.");}
        return handle;
    }
    internal static bool ExistsNoFollow(string path)
    {
        CheckPath(path);
        try {var attributes=File.GetAttributes(path);if((attributes&(FileAttributes.Directory|FileAttributes.ReparsePoint))!=0)throw new IOException("Recovery observation is not a regular file.");return true;}
        catch(FileNotFoundException){return false;}catch(DirectoryNotFoundException){return false;}
    }
    public static Recovery Replace(string target, string expectedHash, byte[] prepared, Guid operation,
        Action<string>? observe = null,string? recoveryRoot=null)
    {
        CheckPath(target);
        if (!ValidHash(expectedHash) || prepared.Length > 64 * 1024 * 1024) throw new InvalidDataException("Invalid replacement input.");
        if (TextPackStore.Hash(Read(target)) != expectedHash) throw new FileChangedException();
        RequireSpace(target, prepared.Length);
        var directory = OperationDirectory(target, operation,recoveryRoot); CheckPath(directory);
        if (Directory.Exists(directory)) throw new RequiredException(operation);
        Directory.CreateDirectory(directory); CheckPath(directory);
        var record = new Manifest(1, operation, Path.GetFileName(target), expectedHash, TextPackStore.Hash(prepared), "pending");
        var recovery = new Recovery(directory, record);
        Create(recovery.Prepared, prepared); Create(recovery.Replacement, prepared);
        SaveJson(Path.Combine(directory, "manifest.json"), record, creating: true);
        using var parentPins=PinParents(target,recovery.Prepared,recovery.Replacement,recovery.Displaced);
        observe?.Invoke("prepared");
        if (TextPackStore.Hash(Read(target)) != expectedHash) throw new RequiredException(operation);
        observe?.Invoke("beforeReplace");
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("Retained replacement requires the Windows primitive.");
        CheckPath(target);CheckPath(recovery.Replacement);CheckPath(recovery.Displaced);
        var targetIdentity=Fingerprint(target);var replacementIdentity=Fingerprint(recovery.Replacement);
        if(targetIdentity is null||replacementIdentity is null||targetIdentity.Volume!=replacementIdentity.Volume)throw new IOException("This drive cannot verify a safe retained replacement. Your original file and prepared edits remain retained.");
        try { File.Replace(recovery.Replacement, target, recovery.Displaced, ignoreMetadataErrors: false); }
        catch (IOException) { _ = Classify(recovery, target); throw new RequiredException(operation); }
        catch (UnauthorizedAccessException) { _ = Classify(recovery, target); throw new RequiredException(operation); }
        observe?.Invoke("replaced");
        var result = Classify(recovery, target);
        if (result.Record.State != "completed") throw new RequiredException(operation);
        return result;
    }
}
