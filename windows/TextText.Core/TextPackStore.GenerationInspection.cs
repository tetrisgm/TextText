using System.Text;
using System.Text.Json;
namespace TextText.Core;

public sealed partial class TextPackStore
{
    internal sealed record GenerationInventory(IReadOnlyList<PackFile> Files,IReadOnlyList<ScanError> Errors);
    // Discovery only: these bytes never certify a writable projection. In
    // particular, this path never enters AssertReadable or relocation recovery.
    internal GenerationInventory InspectGenerationInventory()
    {
        lock(gate) {
            var files=new Dictionary<string,PackFile>(StringComparer.Ordinal);var duplicates=new HashSet<string>(StringComparer.Ordinal);
            var errors=new List<ScanError>();var entries=0;
            void Error(string path,string? id=null){if(errors.Count<1000)errors.Add(new(path,"Generation inspection is unavailable; bytes remain retained.",id));}
            void Visit(string directory,int depth=0) {
                if(depth>128)throw new InvalidDataException("Generation inventory exceeds directory depth bound.");
                CheckLinks(directory);
                foreach(var path in Directory.EnumerateFileSystemEntries(directory)) {
                    if(++entries>80000)throw new InvalidDataException("Generation inventory exceeds bound.");
                    if(System.IO.Path.GetFileName(path).StartsWith('.'))continue;
                    var relative=System.IO.Path.GetRelativePath(Root,path).Replace('\\','/');
                    try {
                        CheckLinks(path);if(Directory.Exists(path)){Visit(path,depth+1);continue;}
                        if(!path.EndsWith(".textpack",StringComparison.OrdinalIgnoreCase))continue;
                        var full=Resolve(relative);var stamp=RetainedFileReplacement.Fingerprint(full);var bytes=ReadProjection(full);CheckLinks(full);
                        if(stamp is null||RetainedFileReplacement.Fingerprint(full)!=stamp)throw new FileChangedException();var id=Identity(bytes);var file=new PackFile(relative,Hash(bytes),id);
                        if(duplicates.Contains(id)){Error(relative,id);continue;}
                        if(files.Remove(id,out var previous)){duplicates.Add(id);Error(previous.Path,id);Error(relative,id);continue;}
                        files.Add(id,file);
                    } catch(Exception error)when(error is IOException or InvalidDataException or UnauthorizedAccessException or JsonException or DecoderFallbackException){Error(relative);}
                }
            }
            Visit(Root);return new(files.Values.ToArray(),errors);
        }
    }
    internal void ValidateGenerationFolderHistory(ProtectedRenameScope? scope) {
        lock(gate) {
            if(scope is not null&&scope.AccountId is null)throw new SharedAccountMismatchException();
            var ownerBytes=RetainedFileReplacement.Read(System.IO.Path.Combine(StateDirectory,AccountRootOwnership.FileName),8192);
            RetainedFileReplacement.JsonFields(ownerBytes,["Version","Origin","WorkspaceId","AccountId","RootHash"],["Version","Origin","WorkspaceId","AccountId","RootHash"]);
            var owner=JsonSerializer.Deserialize<AccountRootOwnership.Owner>(ownerBytes)??throw new InvalidDataException("Missing generation owner.");
            // A missing transport scope certifies no caller principal or generation.
            // Validate only the existing physical history before unrelated recovery.
            var expected=AccountRootOwnership.Expected(this,new Uri(scope?.Origin??owner.Origin),scope?.WorkspaceId??owner.WorkspaceId,scope?.AccountId??owner.AccountId);
            if(owner.Version is not(1 or 2)||(owner with{Version=1})!=expected)throw new SharedAccountMismatchException();
            if(owner.Version==2||RetainedReplacementProfile.HasPublishedMarker(StateDirectory))RetainedReplacementProfile.VerifyUnlocked(StateDirectory,owner,expected.RootHash);
            _=FolderCases.ReadCompletedHistory(RetainedReplacementProfile.PrincipalHash(owner));
        }
    }
    SortedDictionary<string,string> GenerationNativeInventory(string itemId) {
        var directory=System.IO.Path.Combine(StateDirectory,"shared-editing",itemId);RetainedFileReplacement.CheckPath(directory);
        var result=new SortedDictionary<string,string>(StringComparer.Ordinal);if(!Directory.Exists(directory)){if(File.Exists(directory))throw new InvalidDataException("Invalid generation item directory.");return result;}
        var count=0;long total=0;result["present"]="1";
        void FileProof(string path,string key) {
            RetainedFileReplacement.CheckPath(path);if(Directory.Exists(path))throw new InvalidDataException("Unexpected generation metadata directory.");
            var bytes=RetainedFileReplacement.Read(path,64*1024*1024);total+=bytes.Length;if(total>64*1024*1024)throw new InvalidDataException("Generation metadata exceeds bound.");result[key]=Hash(bytes);
        }
        foreach(var path in Directory.GetFileSystemEntries(directory)) {
            if(++count>1000)throw new InvalidDataException("Generation metadata entry limit exceeded.");RetainedFileReplacement.CheckPath(path);var name=System.IO.Path.GetFileName(path);
            if(Directory.Exists(path)) {
                if(!System.Text.RegularExpressions.Regex.IsMatch(name,@"\Aarchive-[0-9a-f]{32}\z"))throw new InvalidDataException("Unknown generation item directory.");
                result[name+"/present"]="1";
                foreach(var entry in Directory.GetFileSystemEntries(path)) {
                    if(++count>1000)throw new InvalidDataException("Generation metadata entry limit exceeded.");var leaf=System.IO.Path.GetFileName(entry);
                    if(!new[]{"checkpoint.json","intent.json","move-intent.json","acknowledge.json","recovered.json"}.Contains(leaf,StringComparer.Ordinal))throw new InvalidDataException("Unknown archived generation metadata.");
                    FileProof(entry,name+"/"+leaf);
                }
            } else {
                var fixedName=name=="checkpoint.json";
                var inactive=System.Text.RegularExpressions.Regex.IsMatch(name,@"\A(?:archived|archived-account)-[0-9a-f]{32}\.json\z")||
                    System.Text.RegularExpressions.Regex.IsMatch(name,@"\Arecovery-[A-Za-z0-9][A-Za-z0-9_-]{0,127}\.json\z");
                if(!fixedName&&!inactive)throw new InvalidDataException("Unknown or pending generation item metadata.");
                FileProof(path,name);
            }
        }
        return result;
    }
    internal string GenerationProtectionSnapshot(string itemId,ProtectedRenameScope scope)
    {
        lock(gate) {
            if(scope.AccountId is null)throw new SharedAccountMismatchException();
            AccountRootOwnership.RequireNoAdoption(StateDirectory);
            var ownerBytes=RetainedFileReplacement.Read(System.IO.Path.Combine(StateDirectory,AccountRootOwnership.FileName),8192);
            RetainedFileReplacement.JsonFields(ownerBytes,["Version","Origin","WorkspaceId","AccountId","RootHash"],["Version","Origin","WorkspaceId","AccountId","RootHash"]);
            var owner=JsonSerializer.Deserialize<AccountRootOwnership.Owner>(ownerBytes)??throw new InvalidDataException("Invalid generation owner.");
            var expected=AccountRootOwnership.Expected(this,new Uri(scope.Origin),scope.WorkspaceId,scope.AccountId);
            if(owner.Version is not(1 or 2)||(owner with{Version=1})!=expected)throw new SharedAccountMismatchException();
            if(owner.Version==2||RetainedReplacementProfile.HasPublishedMarker(StateDirectory))RetainedReplacementProfile.VerifyUnlocked(StateDirectory,owner,expected.RootHash);
            var profileDirectory=System.IO.Path.Combine(StateDirectory,"retained-replacement-profile");
            var profileHashes=new SortedDictionary<string,string>(StringComparer.Ordinal);
            if(Directory.Exists(profileDirectory)) {
                var known=new[]{"profile.json","owner-v1.json","owner-displaced.json","profile-v1.json","profile-v1-displaced.json","profile-v2.json","profile-v2-displaced.json","profile-v3.json","profile-v3-displaced.json","profile-v4.json","profile-v4-displaced.json","profile-v5.json","profile-v5-displaced.json"};
                var paths=Directory.GetFileSystemEntries(profileDirectory);if(paths.Length>known.Length)throw new InvalidDataException("Generation profile exceeds bound.");
                foreach(var path in paths){var name=System.IO.Path.GetFileName(path);if(!known.Contains(name,StringComparer.Ordinal))throw new InvalidDataException("Unknown generation profile metadata.");profileHashes[name]=Hash(RetainedFileReplacement.Read(path,8192));}
            }
            var principal=RetainedReplacementProfile.PrincipalHash(owner);
            var registry=Replacements.ReadCompletedHistoryForItem(principal,itemId);
            var folders=FolderCases.ReadCompletedHistory(principal);
            var protection=SharedEditingStore.ReadProtectionSnapshot(this,itemId,scope.AccountId);
            var directory=System.IO.Path.Combine(StateDirectory,"shared-editing",itemId);
            if(new[]{"intent.json","move-intent.json","binary-intent.json","acknowledge.json"}.Any(name=>File.Exists(System.IO.Path.Combine(directory,name))))
                throw new InvalidDataException("Generation inspection retains pending native work.");
            return JsonSerializer.Serialize(new{Owner=Hash(ownerBytes),Profiles=profileHashes,Registry=registry.OrderBy(p=>p.Key).ToArray(),Folders=folders.OrderBy(p=>p.Key).ToArray(),Protection=protection.Fingerprint,NativeInventory=GenerationNativeInventory(itemId)});
        }
    }
    internal byte[] ReadGenerationProjection(string path,string itemId,ProtectedRenameScope scope)
    {
        lock(gate) {
            var before=GenerationProtectionSnapshot(itemId,scope);
            var full=Resolve(path);var stamp=RetainedFileReplacement.Fingerprint(full);var bytes=ReadProjection(full);CheckLinks(full);
            if(stamp is null||RetainedFileReplacement.Fingerprint(full)!=stamp||Identity(bytes)!=itemId)throw new FileChangedException();
            if(GenerationProtectionSnapshot(itemId,scope)!=before)throw new FileChangedException();return bytes;
        }
    }
    internal IReadOnlyList<PackFile> ScanGenerationCandidates(IReadOnlySet<string> candidates,ProtectedRenameScope? scope)
        =>ScanInventory(candidates,scope).Files;
}
