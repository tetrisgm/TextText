// Compile against the exact prior Windows product sources, never the new
// profile reader. Both inputs are independently produced owned private fixtures.
using System.Security.Cryptography;
using System.Text.Json;
using TextText.Windows;

if(args.Length!=3)throw new ArgumentException("mode root state are required");
var mode=args[0];if(mode is not ("floor4-control" or "floor5-refuse"))throw new ArgumentException("Invalid mode");
var root=Path.GetFullPath(args[1]);var state=Path.GetFullPath(args[2]);
Dictionary<string,string> Inventory() {
    var result=new Dictionary<string,string>();
    foreach(var pair in new[]{("root",root),("state",state)}) {
        foreach(var path in Directory.EnumerateFileSystemEntries(pair.Item2,"*",SearchOption.AllDirectories)) {
            var attributes=File.GetAttributes(path);
            if((attributes&FileAttributes.ReparsePoint)!=0)throw new IOException("Linked fixture path");
            result[pair.Item1+"/"+Path.GetRelativePath(pair.Item2,path)]=(attributes&FileAttributes.Directory)!=0?"directory":Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes(path)));
        }
    }
    return result;
}
var before=Inventory();var tokenCalls=0;var created=false;var refused=false;
try {
    var context=new WorkspaceContext(root,"workspace",new Uri("https://fixture.test"),()=>{Interlocked.Increment(ref tokenCalls);throw new Exception("Unexpected network credential request");},(_,_)=>Task.CompletedTask,AccountId:"account");
    var bridge=new WindowsBridge(context,null,state);created=true;
    await bridge.RetireAsync();
} catch(InvalidDataException error) when(mode=="floor5-refuse" && error.Message=="Replacement profile scope cannot be verified.") {refused=true;}
var after=Inventory();var unchanged=before.Count==after.Count&&before.All(pair=>after.TryGetValue(pair.Key,out var hash)&&hash==pair.Value);
Console.WriteLine(JsonSerializer.Serialize(new {mode,created,refused,tokenCalls,unchanged,beforeCount=before.Count,afterCount=after.Count}));
if(tokenCalls!=0||mode=="floor4-control"&&!created||mode=="floor5-refuse"&&(!refused||created||!unchanged))throw new Exception("Prior supported Windows factory compatibility check failed");
