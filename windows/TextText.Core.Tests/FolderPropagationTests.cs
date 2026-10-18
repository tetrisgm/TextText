using System.Runtime.InteropServices;
using System.Text.Json;
using TextText.Core;
static class FolderPropagationTests
{
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool MoveFileW(string source,string target);
    public static async Task Run(string temp,string fixturePath,Action<bool,string> check)
    {
        if(!OperatingSystem.IsWindows())throw new IOException("Actual Windows is required for this cross-store regression.");
        using var fixture=JsonDocument.Parse(File.ReadAllBytes(fixturePath));var f=fixture.RootElement;
        var source=f.GetProperty("sourceFolder").GetString()!;var destination=f.GetProperty("destinationFolder").GetString()!;var filename=f.GetProperty("filename").GetString()!;var item=f.GetProperty("itemId").GetString()!;var bytes=Convert.FromBase64String(f.GetProperty("bytesBase64").GetString()!);
        var store=new TextPackStore(Path.Combine(temp,"propagation-native"),Path.Combine(temp,"propagation-native-state"));AccountRootOwnership.Open(store,new Uri("https://texttext.test"),"propagation-workspace","propagation-account");
        var original=store.Write(source+"/"+filename,bytes);store.EnsureFolders([source+"/Empty child"]);
        var state=new SyncEngine.State();var before=f.GetProperty("before");var initial=before.GetProperty("items").EnumerateArray().Single(x=>x.GetProperty("itemId").GetString()==item);state.Items[item]=new(original.Path,original.Hash,initial.GetProperty("revision").GetString()!);state.ManagedFolders=before.GetProperty("folders").EnumerateArray().Select(x=>x.GetString()!).ToList();TextPackStore.AtomicWrite(Path.Combine(store.StateDirectory,"sync.json"),JsonSerializer.SerializeToUtf8Bytes(state));
        if(!MoveFileW(store.Resolve(source),store.Resolve(destination)))throw new IOException("Fixture ordinary directory rename failed: "+Marshal.GetLastWin32Error());
        var after=f.GetProperty("after");var remoteItem=after.GetProperty("items").EnumerateArray().Single(x=>x.GetProperty("itemId").GetString()==item);var folders=after.GetProperty("folders").EnumerateArray().Select(x=>x.GetString()!).ToArray();
        check(folders.Contains(source)&&folders.Contains(destination),"real case-sensitive server per-item move advertises both old and new folder spellings");
        var remote=new Test.Fake{Data=bytes,Item=new(item,remoteItem.GetProperty("relativePath").GetString()!,remoteItem.GetProperty("revision").GetString()!),Folders=folders,AuthoritativeFolders=folders};var refused=false;try{await Test.NewSync(store,remote).SyncAsync();}catch(IOException){refused=true;}
        check(refused&&File.ReadAllBytes(store.Resolve(destination+"/"+filename)).SequenceEqual(bytes)&&Directory.Exists(store.Resolve(destination+"/Empty child")),"actual native catalog refuses contradictory aliases and preserves the locally moved pack and empty child");
        check(refused,"per-item fallback is refused; a source-qualified whole-folder command is required");
    }
}
