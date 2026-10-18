using System.IO;
using System.Collections;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using TextText.Core;

// Private actor evidence only. Never follows a disk path to infer the selected session.
internal static class LeafMoveObservation
{
    [StructLayout(LayoutKind.Sequential)] struct FileIdentity {public uint Attributes,CreationLow,CreationHigh,AccessLow,AccessHigh,WriteLow,WriteHigh,Volume,SizeHigh,SizeLow,Links,IndexHigh,IndexLow;}
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle handle,out FileIdentity value);
    internal sealed record Scenario(string Role,int Round,string Source,string Destination);
    static void Fields(JsonElement value,params string[] names) {
        if(value.ValueKind!=JsonValueKind.Object||!value.EnumerateObject().Select(x=>x.Name).Order().SequenceEqual(names.Order()))throw new InvalidDataException("Unsupported leaf move fields.");
    }
    internal static Scenario Validate(JsonElement value,string title) {
        Fields(value,"role","round","source","destination");
        var s=new Scenario(value.GetProperty("role").GetString()!,value.GetProperty("round").GetInt32(),value.GetProperty("source").GetString()!,value.GetProperty("destination").GetString()!);
        static string[] Parts(string path) {var parts=path.Split('/');if(parts.Length!=2||parts.Any(x=>string.IsNullOrEmpty(x)||x is "." or ".."||x.Contains('\\')||x.Contains(':'))||!Regex.IsMatch(parts[0],"^Six-client acceptance folder [a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$")||!Regex.IsMatch(parts[1],"^Six-client acceptance [A-Za-z0-9 -]{1,160}\\.textpack$"))throw new InvalidDataException("Leaf move is outside its owned fixture.");return parts;}
        var a=Parts(s.Source);var b=Parts(s.Destination);
        if(s.Role is not ("mac-cli" or "pc-cli")||s.Round!=1||a[0]!=b[0]||string.Equals(a[1],b[1],StringComparison.OrdinalIgnoreCase)||Path.GetFileNameWithoutExtension(a[1])!=title)throw new InvalidDataException("Leaf move does not bind the original immutable title.");
        return s;
    }
    internal static void ValidateConfig(string file,string title,JsonElement scenario) {
        var s=Validate(scenario,title);var normalized=Path.GetFullPath(file).Replace('\\','/');
        if(!new[]{s.Source,s.Destination}.Any(path=>normalized.EndsWith("/"+path,StringComparison.Ordinal)))throw new InvalidDataException("Configured file is not a declared leaf endpoint.");
    }
    internal static async Task<string> SelectedPath(object bridge,string itemId,CancellationToken ct) {
        const BindingFlags flags=BindingFlags.Instance|BindingFlags.NonPublic;
        var editing=bridge.GetType().GetField("editing",flags)?.GetValue(bridge)??throw new IOException("Live shared editor unavailable.");
        var gate=(SemaphoreSlim?)editing.GetType().GetField("gate",flags)?.GetValue(editing)??throw new IOException("Live shared session gate unavailable.");
        await gate.WaitAsync(ct);try {
            var sessions=(IDictionary?)editing.GetType().GetField("sessions",flags)?.GetValue(editing)??throw new IOException("Live shared sessions unavailable.");
            var paths=new List<string>();foreach(var active in sessions.Values) {
                var type=active!.GetType();if((string?)type.GetProperty("ItemId")?.GetValue(active)==itemId)paths.Add((string?)type.GetProperty("Path")?.GetValue(active)??throw new IOException("Live session path unavailable."));
            }
            return paths.Count==1?paths[0]:throw new IOException("Expected exactly one live selected shared session.");
        }finally{gate.Release();}
    }
    static void UniqueIdentity(string root,string itemId,string expected) {
        var visited=0;var matches=new List<string>();long bytesRead=0;
        void Scan(string directory){RetainedFileReplacement.CheckPath(directory);var stamp=RetainedFileReplacement.Fingerprint(directory);foreach(var entry in Directory.GetFileSystemEntries(directory)) {
            if(++visited>10000)throw new IOException("Unique identity scan exceeds bound.");
            if(directory==root&&Path.GetFileName(entry)==".texttext")continue;
            RetainedFileReplacement.CheckPath(entry);var attributes=File.GetAttributes(entry);if((attributes&FileAttributes.ReparsePoint)!=0)throw new IOException("Unique identity scan contains an unsafe entry.");
            if((attributes&FileAttributes.Directory)!=0){Scan(entry);continue;}
            if(!entry.EndsWith(".textpack",StringComparison.OrdinalIgnoreCase))continue;
            var before=RetainedFileReplacement.Fingerprint(entry)??throw new IOException("Identity scan file unavailable.");bytesRead=checked(bytesRead+before.Length);if(before.Length>64*1024*1024||bytesRead>256*1024*1024)throw new IOException("Identity scan bytes exceed bound.");
            var data=File.ReadAllBytes(entry);if(before!=RetainedFileReplacement.Fingerprint(entry))throw new IOException("Identity scan changed.");
            if(TextPackStore.Identity(data)==itemId)matches.Add(Path.GetRelativePath(root,entry).Replace('\\','/'));
        }if(stamp!=RetainedFileReplacement.Fingerprint(directory))throw new IOException("Identity scan tree changed.");}
        Scan(root);if(matches.Count!=1||matches[0]!=expected)throw new IOException("Stable item identity is not unique at the observed path.");
    }
    internal static (object Proof,bool Pending) Observe(string root,string workspaceId,string itemId,string title,string configuredFile,JsonElement configuredScenario,JsonElement request,string selectedPath) {
        Fields(request,"version","operationId","phase","scenario");if(request.GetProperty("version").GetInt32()!=1)throw new InvalidDataException("Unsupported leaf observation version.");
        var scenario=Validate(request.GetProperty("scenario"),title);var configured=Validate(configuredScenario,title);if(scenario!=configured)throw new InvalidDataException("Leaf scenario changed.");ValidateConfig(configuredFile,title,configuredScenario);
        var operation=request.GetProperty("operationId").GetString()!;var requested=request.GetProperty("phase").GetString()!;
        if(!Regex.IsMatch(operation,"^lm-[a-f0-9]{32}$")||requested is not ("before" or "after"))throw new InvalidDataException("Invalid leaf observation request.");
        root=Path.GetFullPath(root);RetainedFileReplacement.CheckPath(root);var parent=Path.Combine(root,scenario.Source.Split('/')[0]);RetainedFileReplacement.CheckPath(parent);
        var parentStamp=RetainedFileReplacement.Fingerprint(parent)??throw new IOException("Fixture parent missing.");var names=Directory.GetFileSystemEntries(parent);if(names.Length!=1)throw new IOException("Unknown or duplicate fixture membership preserved.");
        var relative=Path.GetRelativePath(root,names[0]).Replace('\\','/');if(relative!=scenario.Source&&relative!=scenario.Destination)throw new IOException("Unknown leaf preserved.");
        if(selectedPath!=scenario.Source&&selectedPath!=scenario.Destination)throw new IOException("Live selected session escaped the declared endpoints.");
        var sourcePresent=relative==scenario.Source;var destinationPresent=relative==scenario.Destination;var phase=sourcePresent?"before":"after";
        if(requested=="before"&&(phase!="before"||selectedPath!=scenario.Source))throw new IOException("Initial leaf was already moved.");
        var path=names[0];RetainedFileReplacement.CheckPath(path);if((File.GetAttributes(path)&(FileAttributes.Directory|FileAttributes.ReparsePoint))!=0)throw new IOException("Fixture leaf must be a regular file.");
        var stamp=RetainedFileReplacement.Fingerprint(path)??throw new IOException("Fixture file identity missing.");if(stamp.Length>64*1024*1024)throw new IOException("Fixture exceeds bound.");
        using var held=File.OpenHandle(path,FileMode.Open,FileAccess.Read,FileShare.Read);
        if(OperatingSystem.IsWindows()&&(!GetFileInformationByHandle(held,out var actual)||actual.Links!=1||actual.Volume!=stamp.Volume||((ulong)actual.IndexHigh<<32|actual.IndexLow)!=stamp.FileId))throw new IOException("Fixture must be a single stable file identity.");
        var bytes=File.ReadAllBytes(path);
        if(stamp!=RetainedFileReplacement.Fingerprint(path)||TextPackStore.Identity(bytes)!=itemId)throw new IOException("Fixture changed while observed.");
        var prefix=TextPackStore.DocumentPrefix(bytes);using var zip=new ZipArchive(new MemoryStream(bytes));var docEntry=zip.GetEntry(prefix+"document.json")??throw new IOException("Canonical document missing.");
        if(docEntry.Length>1024*1024||zip.Entries.Count>128)throw new IOException("Canonical archive exceeds observation bounds.");using var input=docEntry.Open();using var doc=JsonDocument.Parse(input);if(doc.RootElement.GetProperty("schemaVersion").GetInt32()!=1||doc.RootElement.GetProperty("content").GetProperty("title").GetString()!=title)throw new IOException("Immutable document title changed.");
        var assets=new SortedDictionary<string,string>(StringComparer.Ordinal);foreach(var entry in zip.Entries){if(!entry.FullName.StartsWith(prefix+"assets/",StringComparison.Ordinal)||entry.FullName.EndsWith('/'))continue;if(assets.Count>=32||entry.Length>64*1024*1024)throw new IOException("Asset count exceeds bound.");using var stream=entry.Open();using var data=new MemoryStream();stream.CopyTo(data);assets.Add(entry.FullName[prefix.Length..],TextPackStore.Hash(data.ToArray()));}
        var documentHash=TextPackStore.Hash(Canonical(doc.RootElement));
        UniqueIdentity(root,itemId,relative);
        if(stamp!=RetainedFileReplacement.Fingerprint(path)||Directory.GetFileSystemEntries(parent).Length!=1||parentStamp!=RetainedFileReplacement.Fingerprint(parent))throw new IOException("Fixture changed after observation.");
        return(new{version=1,kind="filesystem",operationId=operation,phase,workspaceId,itemId,source=scenario.Source,destination=scenario.Destination,relativePath=relative,sourcePresent,destinationPresent,fileIdentity=$"{stamp.Volume}:{stamp.FileId}",archiveSha256=TextPackStore.Hash(bytes),documentSha256=documentHash,assetHashes=assets,selectedItemId=itemId,selectedPath},requested=="after"&&(phase!="after"||selectedPath!=scenario.Destination));
    }
    internal static byte[] Canonical(JsonElement value) {using var stream=new MemoryStream();using(var writer=new Utf8JsonWriter(stream,new JsonWriterOptions{Encoder=System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping})){void Write(JsonElement v){if(v.ValueKind==JsonValueKind.Object){writer.WriteStartObject();foreach(var p in v.EnumerateObject().OrderBy(p=>p.Name,StringComparer.Ordinal)){writer.WritePropertyName(p.Name);Write(p.Value);}writer.WriteEndObject();}else if(v.ValueKind==JsonValueKind.Array){writer.WriteStartArray();foreach(var x in v.EnumerateArray())Write(x);writer.WriteEndArray();}else v.WriteTo(writer);}Write(value);}return stream.ToArray();}
}
