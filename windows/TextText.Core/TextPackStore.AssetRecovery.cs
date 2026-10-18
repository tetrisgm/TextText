using System.Text.Json;
using System.Text.RegularExpressions;

namespace TextText.Core;

public sealed partial class TextPackStore
{
    public sealed record AssetProvenance(int Version,string OperationId,string ItemId,string? Path,string EntryPath,string PayloadHash,string? ExpectedHash,string? Lifecycle,string Filename,string Hash);
    public sealed record RecoveryAssetEntry(string Id,string Filename,int ByteLength,string Hash,string SavedAt,string? EntryPath=null,string? ItemPath=null,string? ProvenanceError=null);
    public sealed record RecoveryAssetsPage(IReadOnlyList<RecoveryAssetEntry> Assets,bool Truncated);
    public sealed record RecoveryAssetFile(string Filename,string Hash,byte[] Data);
    public string PreserveSubmittedAsset(byte[] bytes,SyncEngine.BinaryPending operation)
    {
        lock(gate) {
            var file=PreserveAsset(bytes,"binary-conflict-asset");var hash=Hash(bytes);
            if(operation.PayloadHash is not null&&operation.PayloadHash!=hash)throw new InvalidDataException("Submitted attachment changed.");
            if(!Guid.TryParseExact(operation.Id,"D",out _)||operation.ItemId.Length>128||operation.EntryPath.Length>1024||operation.SourcePath?.Length>4096||operation.Lifecycle?.Length>256)throw new InvalidDataException("Invalid submitted attachment provenance.");
            var value=new AssetProvenance(1,operation.Id,operation.ItemId,operation.SourcePath,operation.EntryPath,hash,operation.ExpectedHash,operation.Lifecycle,System.IO.Path.GetFileName(file),hash);
            var metadata=System.IO.Path.Combine(GetRecoveryDirectory(),"binary-conflict-asset-"+hash+"-"+operation.Id+".json");
            var encoded=JsonSerializer.SerializeToUtf8Bytes(value);
            if(encoded.Length>8192)throw new InvalidDataException("Submitted attachment provenance exceeds bounds.");
            if(File.Exists(metadata)) {
                if(!RetainedFileReplacement.Read(metadata,8192).SequenceEqual(encoded))throw new InvalidDataException("Existing submitted attachment provenance changed. All versions remain retained.");
            } else RetainedFileReplacement.Create(metadata,encoded);
            return file;
        }
    }
    static string RecoveryAssetHash(string id)
    {
        var match=Regex.Match(id,@"^binary-conflict-asset-([a-f0-9]{64})\.asset\z");
        return match.Success?match.Groups[1].Value:throw new InvalidDataException("Unknown retained attachment.");
    }
    public RecoveryAssetsPage RecoveryAssets()
    {
        lock(gate) {
            var recoveryDirectory=System.IO.Path.Combine(StateDirectory,"recovery");CheckLinks(recoveryDirectory);
            if(!Directory.Exists(recoveryDirectory))return new([],false);
            var result=new List<RecoveryAssetEntry>();long total=0,metadataTotal=0;var truncated=false;
            foreach(var path in Directory.EnumerateFiles(recoveryDirectory,"*.asset").Order(StringComparer.Ordinal)) {
                var name=System.IO.Path.GetFileName(path);
                if(!Regex.IsMatch(name,@"^binary-conflict-asset-[a-f0-9]{64}\.asset\z"))continue;
                if(result.Count>=200){truncated=true;break;}
                RetainedFileReplacement.CheckPath(path);
                var length=new FileInfo(path).Length;
                if(length>16*1024*1024||total+length>64L*1024*1024){truncated=true;continue;}
                var bytes=RetainedFileReplacement.Read(path,16*1024*1024);total+=bytes.Length;
                if(Hash(bytes)!=RecoveryAssetHash(name))throw new InvalidDataException("A retained attachment changed. Its bytes remain available in the recovery folder.");
                string? entryPath=null,itemPath=null,provenanceError=null;
                var sidecars=Directory.EnumerateFiles(recoveryDirectory,"binary-conflict-asset-"+Hash(bytes)+"-*.json").Take(201).ToArray();
                if(sidecars.Length>200)provenanceError="Too many saved origin records to verify. The exact attachment can still be downloaded.";
                else foreach(var sidecar in sidecars) {
                    try {
                        var metadataBytes=RetainedFileReplacement.Read(sidecar,8192);metadataTotal+=metadataBytes.Length;
                        if(metadataTotal>4*1024*1024){truncated=true;throw new InvalidDataException();}
                        var provenance=JsonSerializer.Deserialize<AssetProvenance>(metadataBytes)??throw new InvalidDataException();
                        if(provenance.Version!=1||!Guid.TryParseExact(provenance.OperationId,"D",out _)||
                           System.IO.Path.GetFileName(sidecar)!="binary-conflict-asset-"+Hash(bytes)+"-"+provenance.OperationId+".json"||
                           provenance.PayloadHash!=Hash(bytes)||provenance.Hash!=Hash(bytes)||provenance.Filename!=name||
                           provenance.ItemId is null||!Regex.IsMatch(provenance.ItemId,@"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\z")||provenance.EntryPath is null||provenance.EntryPath.Length>1024||
                           provenance.Path is null||provenance.Path.Length>4096||provenance.ExpectedHash is not null&&!RetainedFileReplacement.ValidHash(provenance.ExpectedHash))throw new InvalidDataException();
                        _=Resolve(provenance.Path);
                        if(provenance.EntryPath.Contains('\\')||provenance.EntryPath.Split('/').Any(part=>part is "" or "." or ".."))throw new InvalidDataException();
                        if(entryPath is not null&&(entryPath!=provenance.EntryPath||itemPath!=provenance.Path))throw new InvalidDataException();
                        entryPath=provenance.EntryPath;itemPath=provenance.Path;
                    }catch(Exception error)when(error is IOException or InvalidDataException or JsonException or UnauthorizedAccessException) {
                        provenanceError="This attachment's saved origin could not be verified. Its exact bytes can still be downloaded.";
                    }
                }
                if(provenanceError is not null){entryPath=null;itemPath=null;}
                result.Add(new(name,name,bytes.Length,Hash(bytes),File.GetCreationTimeUtc(path).ToString("O"),entryPath,itemPath,provenanceError));
            }
            return new(result,truncated);
        }
    }
    public RecoveryAssetFile RecoveryAssetRead(string id,string expectedHash)
    {
        lock(gate) {
            if(RecoveryAssetHash(id)!=expectedHash)throw new FileChangedException();
            var bytes=RetainedFileReplacement.Read(System.IO.Path.Combine(StateDirectory,"recovery",id),16*1024*1024);
            if(Hash(bytes)!=expectedHash)throw new FileChangedException();
            return new(id,expectedHash,bytes);
        }
    }
}
