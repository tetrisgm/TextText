using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Microsoft.Win32.SafeHandles;
namespace TextText.Core;

/// Device-private metadata journal. It retains identities and consent, never claims to back up a directory's bytes.
internal sealed class FolderCaseRename(TextPackStore store)
{
    internal sealed record Endpoint(bool Present,string? Identity);
    sealed record Intent(int Version,Guid Operation,string RootHash,string OwnerHash,string SourcePath,string DestinationPath,string SourceIdentity,string ParentIdentity,string State,string? ConsentHash=null);
    sealed record Consent(int Version,Guid Operation,string RootHash,string OwnerHash,string SourcePath,string DestinationPath,string Inspection,Endpoint From,Endpoint To);
    internal sealed record Inspection(Endpoint From,Endpoint To,string Digest,string Summary,string? Blocked);
    string DirectoryPath=>Path.Combine(store.StateDirectory,"folder-case");
    string RootHash=>TextPackStore.Hash(Encoding.UTF8.GetBytes(store.Root));
    string PathFor(Guid id)=>Path.Combine(DirectoryPath,id.ToString("D")+".json");
    string ConsentFor(Guid id)=>Path.Combine(DirectoryPath,"consents",id.ToString("D")+".json");
    internal sealed class RequiredException(Guid operation):IOException("A folder spelling change needs recovery inspection. Both current directories remain untouched."){internal Guid Operation=>operation;}
    [StructLayout(LayoutKind.Sequential)]struct FileInformation {public uint Attributes;public System.Runtime.InteropServices.ComTypes.FILETIME Creation,Access,Write;public uint Volume,SizeHigh,SizeLow,Links,IndexHigh,IndexLow;}
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern SafeFileHandle CreateFileW(string name,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
    [DllImport("kernel32.dll",SetLastError=true)]static extern bool GetFileInformationByHandle(SafeFileHandle handle,out FileInformation info);
    [DllImport("kernel32.dll",SetLastError=true)]static extern bool SetFileInformationByHandle(SafeFileHandle handle,int kind,IntPtr buffer,uint size);
    static string Identity(SafeFileHandle handle){if(!GetFileInformationByHandle(handle,out var info)||(info.Attributes&0x400)!=0)throw new IOException("Folder identity cannot be verified.");return $"windows:{info.Volume:x8}:{(((ulong)info.IndexHigh<<32)|info.IndexLow):x16}";}
    internal static string Identity(string path){var stamp=RetainedFileReplacement.Fingerprint(path)??throw new IOException("Folder identity is unavailable.");return $"windows:{stamp.Volume:x8}:{stamp.FileId:x16}";}
    internal static bool ExactPathExists(string root,string path)
    {
        RetainedFileReplacement.CheckPath(path);var relative=Path.GetRelativePath(root,path);if(relative==".")return Directory.Exists(root);
        if(relative.StartsWith(".."+Path.DirectorySeparatorChar)||Path.IsPathRooted(relative))throw new IOException("Folder path leaves workspace.");
        var current=root;
        foreach(var part in relative.Split(Path.DirectorySeparatorChar)){
            if(!Directory.Exists(current))return false;string? found=null;var count=0;
            foreach(var entry in Directory.EnumerateFileSystemEntries(current)){if(++count>20000)throw new IOException("Too many entries to inspect exact folder spelling.");if(Path.GetFileName(entry)==part){found=entry;break;}}
            if(found is null)return false;RetainedFileReplacement.CheckPath(found);current=found;
        }return true;
    }
    internal static bool AlreadyMovedAlias(string root,string source,string destination)
    {
        if(source==destination||Path.GetDirectoryName(source)==Path.GetDirectoryName(destination)||!string.Equals(source,destination,StringComparison.OrdinalIgnoreCase)||ExactPathExists(root,source)||!ExactPathExists(root,destination)||!File.Exists(source)||!File.Exists(destination))return false;
        return Identity(source)==Identity(destination);
    }
    internal static void ValidateCatalog(TextPackStore store,IReadOnlyList<string> folders)
    {
        if(folders.Count>20000)throw new IOException("Too many workspace folders.");var prefixes=new Dictionary<string,List<string>>(StringComparer.OrdinalIgnoreCase);
        foreach(var folder in folders){store.ValidateManagedFolder(folder);var prefix="";foreach(var part in folder.Split('/')){prefix=prefix.Length==0?part:prefix+"/"+part;if(!prefixes.TryGetValue(prefix,out var names))prefixes[prefix]=names=[];if(!names.Contains(prefix,StringComparer.Ordinal))names.Add(prefix);}}
        foreach(var names in prefixes.Values.Where(x=>x.Count>1)){
            var identities=new HashSet<string>(StringComparer.Ordinal);
            foreach(var name in names){var path=store.Resolve(name);if(!ExactPathExists(store.Root,path)||!Directory.Exists(path)||!identities.Add(Identity(path)))throw new IOException("The folder catalog requests conflicting spellings of the same folder.");}
        }
    }
    internal void VerifyExistingProfile()
    {
        if(!RetainedReplacementProfile.HasPublishedMarker(store.StateDirectory))return;
        var path=Path.Combine(store.StateDirectory,AccountRootOwnership.FileName);
        var owner=JsonSerializer.Deserialize<AccountRootOwnership.Owner>(RetainedFileReplacement.Read(path,8192))??throw new InvalidDataException("Folder account profile is unavailable.");
        RetainedReplacementProfile.Verify(store.StateDirectory,owner,RootHash);
    }
    string Owner()
    {
        AccountRootOwnership.RequireNoAdoption(store.StateDirectory);var path=Path.Combine(store.StateDirectory,AccountRootOwnership.FileName);
        var owner=JsonSerializer.Deserialize<AccountRootOwnership.Owner>(RetainedFileReplacement.Read(path,8192))??throw new InvalidDataException("Missing folder account binding.");
        if(owner.Version!=2||owner.RootHash!=RootHash)throw new InvalidDataException("Folder account binding changed.");
        RetainedReplacementProfile.Verify(store.StateDirectory,owner,RootHash);
        var marker=JsonSerializer.Deserialize<RetainedReplacementProfile.Marker>(RetainedFileReplacement.Read(Path.Combine(store.StateDirectory,"retained-replacement-profile","profile.json"),8192))!;
        if(marker.Version is not (2 or 3 or 4))throw new InvalidDataException("Folder compatibility profile is unavailable.");return RetainedReplacementProfile.PrincipalHash(owner);
    }
    IDisposable Lease()=>RetainedFileReplacement.AcquireLease(Path.Combine(store.StateDirectory,"folder-case.lock"));
    void Validate(Intent intent,string owner)
    {
        if(intent.Version!=1||intent.RootHash!=RootHash||intent.OwnerHash!=owner||intent.Operation==Guid.Empty||intent.State is not("pending"or"completed"or"conflict"or"cancelled")||intent.SourcePath==intent.DestinationPath||!string.Equals(intent.SourcePath,intent.DestinationPath,StringComparison.OrdinalIgnoreCase)||Path.GetDirectoryName(intent.SourcePath)!=Path.GetDirectoryName(intent.DestinationPath)||!System.Text.RegularExpressions.Regex.IsMatch(intent.SourceIdentity,@"\Awindows:[0-9a-f]{8}:[0-9a-f]{16}\z")||!System.Text.RegularExpressions.Regex.IsMatch(intent.ParentIdentity,@"\Awindows:[0-9a-f]{8}:[0-9a-f]{16}\z"))throw new InvalidDataException("Folder journal scope cannot be verified.");
        store.ValidateManagedFolder(intent.SourcePath);store.ValidateManagedFolder(intent.DestinationPath);
        if(intent.ConsentHash is not null){if(intent.State!="completed"||!RetainedFileReplacement.ValidHash(intent.ConsentHash))throw new InvalidDataException("Invalid folder consent.");var bytes=RetainedFileReplacement.Read(ConsentFor(intent.Operation),16384);RetainedFileReplacement.JsonFields(bytes,["Version","Operation","RootHash","OwnerHash","SourcePath","DestinationPath","Inspection","From","To"],["Version","Operation","RootHash","OwnerHash","SourcePath","DestinationPath","Inspection","From","To"]);using(var parsed=JsonDocument.Parse(bytes)){foreach(var key in new[]{"From","To"})RetainedFileReplacement.JsonFields(Encoding.UTF8.GetBytes(parsed.RootElement.GetProperty(key).GetRawText()),["Present","Identity"],["Present","Identity"]);}var consent=JsonSerializer.Deserialize<Consent>(bytes)!;if(TextPackStore.Hash(bytes)!=intent.ConsentHash||consent.Version!=1||consent.Operation!=intent.Operation||consent.RootHash!=RootHash||consent.OwnerHash!=owner||consent.SourcePath!=intent.SourcePath||consent.DestinationPath!=intent.DestinationPath||!RetainedFileReplacement.ValidHash(consent.Inspection)||consent.From.Present!=(consent.From.Identity is not null)||consent.To.Present!=(consent.To.Identity is not null))throw new InvalidDataException("Folder consent changed.");}
    }
    Intent Read(Guid id,string owner){var bytes=RetainedFileReplacement.Read(PathFor(id),16384);RetainedFileReplacement.JsonFields(bytes,["Version","Operation","RootHash","OwnerHash","SourcePath","DestinationPath","SourceIdentity","ParentIdentity","State","ConsentHash"],["Version","Operation","RootHash","OwnerHash","SourcePath","DestinationPath","SourceIdentity","ParentIdentity","State"]);var intent=JsonSerializer.Deserialize<Intent>(bytes)??throw new InvalidDataException("Invalid folder journal.");if(intent.Operation!=id)throw new InvalidDataException("Folder journal name changed.");Validate(intent,owner);return intent;}
    IEnumerable<Intent> Entries()
    {
        VerifyExistingProfile();RetainedFileReplacement.CheckPath(DirectoryPath);if(!Directory.Exists(DirectoryPath))yield break;
        var owner=Owner();foreach(var file in Directory.EnumerateFiles(DirectoryPath,"*.json")){if(!Guid.TryParseExact(Path.GetFileNameWithoutExtension(file),"D",out var id)||Path.GetFileName(file)!=id.ToString("D")+".json")throw new InvalidDataException("Unknown folder journal.");yield return Read(id,owner);}
    }
    void Save(Intent intent)=>TextPackStore.AtomicWrite(PathFor(intent.Operation),JsonSerializer.SerializeToUtf8Bytes(intent));
    Endpoint Probe(string relative){var path=store.Resolve(relative);if(!ExactPathExists(store.Root,path))return new(false,null);return new(true,Identity(path));}
    internal void AssertReadable()
    {
        if(!Directory.Exists(DirectoryPath)){if(File.Exists(Path.Combine(store.StateDirectory,"retained-replacement-profile","profile-v1.json")))VerifyExistingProfile();return;}
        using var lease=Lease();foreach(var original in Entries()){
            if(original.State is "completed"or"cancelled")continue;var intent=original;
            if(intent.State=="pending"){
                var from=Probe(intent.SourcePath);var to=Probe(intent.DestinationPath);var parent=Path.GetDirectoryName(store.Resolve(intent.DestinationPath))!;
                if(Identity(parent)==intent.ParentIdentity){
                    if(from==new Endpoint(true,intent.SourceIdentity)&&!to.Present)intent=intent with{State="cancelled"};
                    else if(!from.Present&&to==new Endpoint(true,intent.SourceIdentity))intent=intent with{State="completed"};
                }
                if(intent==original)intent=intent with{State="conflict"};Save(intent);
            }
            if(intent.State=="conflict")throw new RequiredException(intent.Operation);
        }
    }
    internal void RenameAlias(string source,string destination,Action<string>? observe)
    {
        if(!OperatingSystem.IsWindows())throw new IOException("This filesystem cannot safely change folder spelling.");
        var expectedIdentity=Identity(source);var expectedParent=Identity(Path.GetDirectoryName(source)!);
        if(Path.GetDirectoryName(source)!=Path.GetDirectoryName(destination)||source==destination||!string.Equals(source,destination,StringComparison.OrdinalIgnoreCase)||!ExactPathExists(store.Root,source)||ExactPathExists(store.Root,destination)||!Directory.Exists(destination)||Identity(source)!=expectedIdentity||Identity(destination)!=expectedIdentity)throw new IOException("Folder alias cannot be verified.");
        RetainedReplacementProfile.PrepareFolderCase(store,observe);
        using var lease=Lease();var owner=Owner();Directory.CreateDirectory(DirectoryPath);RetainedFileReplacement.CheckPath(DirectoryPath);
        using var parents=RetainedFileReplacement.PinParents(source,destination);
        var intent=new Intent(1,Guid.NewGuid(),RootHash,owner,Path.GetRelativePath(store.Root,source).Replace('\\','/'),Path.GetRelativePath(store.Root,destination).Replace('\\','/'),expectedIdentity,expectedParent,"pending");Save(intent);
        observe?.Invoke("beforeSourcePin");
        using var handle=CreateFileW(source,0x10000,3,IntPtr.Zero,3,0x02200000,IntPtr.Zero);
        if(handle.IsInvalid||!Directory.Exists(source)||Identity(handle)!=expectedIdentity||Identity(source)!=expectedIdentity||Identity(Path.GetDirectoryName(source)!)!=expectedParent){Save(intent with{State="conflict"});throw new RequiredException(intent.Operation);}
        var identity=expectedIdentity;observe?.Invoke("prepared");
        if(!ExactPathExists(store.Root,source)||ExactPathExists(store.Root,destination)||Identity(source)!=identity)throw new RequiredException(intent.Operation);
        observe?.Invoke("beforeRename");
        var name=Encoding.Unicode.GetBytes(destination);var offset=IntPtr.Size==8?20:12;var length=checked(offset+name.Length+2);var buffer=Marshal.AllocHGlobal(length);
        try{for(var i=0;i<length;i++)Marshal.WriteByte(buffer,i,0);Marshal.WriteIntPtr(buffer,IntPtr.Size==8?8:4,IntPtr.Zero);Marshal.WriteInt32(buffer,IntPtr.Size==8?16:8,name.Length);Marshal.Copy(name,0,IntPtr.Add(buffer,offset),name.Length);if(!SetFileInformationByHandle(handle,3,buffer,(uint)length))throw new IOException("Folder spelling change was refused: "+Marshal.GetLastWin32Error());}finally{Marshal.FreeHGlobal(buffer);}
        observe?.Invoke("renamed");
        if(ExactPathExists(store.Root,source)||!ExactPathExists(store.Root,destination)||Identity(destination)!=identity||Identity(handle)!=identity){Save(intent with{State="conflict"});throw new RequiredException(intent.Operation);}
        Save(intent with{State="completed"});observe?.Invoke("completed");
    }
    internal Inspection InspectPaths(Guid operation,string source,string destination)=>Inspect(new Intent(1,operation,RootHash,"",source,destination,"","","pending"));
    Inspection Inspect(Intent intent)
    {
        Endpoint from=new(false,null),to=new(false,null);string? blocked=null;var rows=new List<string>();var count=0;var bytes=0;
        try{
            try{from=Probe(intent.SourcePath);}catch(Exception error)when(error is IOException or UnauthorizedAccessException or InvalidDataException){from=new(true,null);blocked=error.Message;}
            try{to=Probe(intent.DestinationPath);}catch(Exception error)when(error is IOException or UnauthorizedAccessException or InvalidDataException){to=new(true,null);blocked??=error.Message;}
            if(blocked is not null)throw new IOException(blocked);
            void Visit(string full,string relative){RetainedFileReplacement.CheckPath(full);var stamp=RetainedFileReplacement.Fingerprint(full)??throw new IOException("An inspected entry disappeared.");var row=JsonSerializer.Serialize(new{path=relative,type=Directory.Exists(full)?"directory":"file",identity=Identity(full),stamp.Length,stamp.LastWrite,stamp.Change});bytes+=Encoding.UTF8.GetByteCount(row);if(++count>10000||bytes>4*1024*1024)throw new IOException("Folder inspection exceeds its safe metadata limit.");rows.Add(row);if(Directory.Exists(full))foreach(var child in Directory.EnumerateFileSystemEntries(full).Order(StringComparer.Ordinal))Visit(child,relative+"/"+Path.GetFileName(child));}
            if(from.Present)Visit(store.Resolve(intent.SourcePath),"from");if(to.Present)Visit(store.Resolve(intent.DestinationPath),"to");
        }catch(Exception error)when(error is IOException or UnauthorizedAccessException or InvalidDataException){blocked=error.Message;}
        var digest=TextPackStore.Hash(JsonSerializer.SerializeToUtf8Bytes(new{intent.Operation,intent.SourcePath,intent.DestinationPath,from,to,rows,blocked}));return new(from,to,digest,$"{count} entries inspected. This review records directory metadata; it does not copy file contents.",blocked);
    }
    TextPackStore.FolderRenameRecoveryEntry Row(Intent intent){var inspection=Inspect(intent);return new(intent.Operation.ToString("D"),intent.SourcePath,intent.DestinationPath,intent.SourceIdentity,new(inspection.From.Present,inspection.From.Identity),new(inspection.To.Present,inspection.To.Identity),inspection.Digest,inspection.Summary,inspection.Blocked,intent.State=="completed");}
    internal IReadOnlyList<TextPackStore.FolderRenameRecoveryEntry> List()=>Entries().Where(x=>x.State is "pending"or"conflict"||x.ConsentHash is not null).Select(Row).ToArray();
    internal TextPackStore.FolderRenameRecoveryEntry Read(string id){if(!Guid.TryParseExact(id,"D",out var operation))throw new InvalidDataException("Invalid folder operation.");return Row(Read(operation,Owner()));}
    sealed class EndpointPins:IDisposable
    {
        readonly List<SafeFileHandle> handles=[];
        internal EndpointPins(params string[] paths){try{foreach(var path in paths){RetainedFileReplacement.CheckPath(path);if(!File.Exists(path)&&!Directory.Exists(path))continue;var handle=CreateFileW(path,0,3,IntPtr.Zero,3,0x02200000,IntPtr.Zero);if(handle.IsInvalid){handle.Dispose();throw new IOException("Folder inspection endpoints could not be pinned.");}handles.Add(handle);_=Identity(handle);}}catch{Dispose();throw;}}
        public void Dispose(){foreach(var handle in handles)handle.Dispose();}
    }
    internal void Resolve(string id,string fromPath,string toPath,string inspection,Action? beforeAck)
    {
        if(!Guid.TryParseExact(id,"D",out var operation)||!RetainedFileReplacement.ValidHash(inspection))throw new InvalidDataException("Invalid folder inspection.");using var lease=Lease();var owner=Owner();var intent=Read(operation,owner);
        if(intent.SourcePath!=fromPath||intent.DestinationPath!=toPath||intent.State is not("pending"or"conflict"))throw new FileChangedException();
        using var parents=RetainedFileReplacement.PinParents(store.Resolve(fromPath),store.Resolve(toPath));
        using var endpoints=OperatingSystem.IsWindows()?new EndpointPins(store.Resolve(fromPath),store.Resolve(toPath)):null;
        var current=Inspect(intent);if(current.Blocked is not null||current.Digest!=inspection)throw new FileChangedException();beforeAck?.Invoke();var rechecked=Inspect(intent);if(rechecked.Blocked is not null||rechecked.Digest!=inspection||Owner()!=owner)throw new FileChangedException();
        var consent=new Consent(1,operation,RootHash,owner,fromPath,toPath,inspection,current.From,current.To);var bytes=JsonSerializer.SerializeToUtf8Bytes(consent);Directory.CreateDirectory(Path.GetDirectoryName(ConsentFor(operation))!);if(File.Exists(ConsentFor(operation))){if(!RetainedFileReplacement.Read(ConsentFor(operation),16384).SequenceEqual(bytes))throw new InvalidDataException("Folder consent changed.");}else RetainedFileReplacement.Create(ConsentFor(operation),bytes);
        beforeAck?.Invoke();if(Owner()!=owner)throw new FileChangedException();Save(intent with{State="completed",ConsentHash=TextPackStore.Hash(bytes)});
    }
}
