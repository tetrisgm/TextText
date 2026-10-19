using System.Reflection;
using System.Text.Json;
using TextText.Core;
static class AssetProofProfile6Tests {
 public static void Run(Action<bool,string> check) {
  var basis=Path.GetTempPath();if(OperatingSystem.IsMacOS()&&basis.StartsWith("/var/",StringComparison.Ordinal))basis="/private"+basis;
  var parent=Path.Combine(basis,"texttext-asset-profile6-"+Guid.NewGuid().ToString("N"));var store=new TextPackStore(Path.Combine(parent,"vault"),Path.Combine(parent,"device"));
  AccountRootOwnership.Open(store,new("https://profile.test"),"workspace","account");RetainedReplacementProfile.PrepareObservedAbsenceRename(store);
  var owner=JsonSerializer.Deserialize<AccountRootOwnership.Owner>(File.ReadAllBytes(Path.Combine(store.StateDirectory,AccountRootOwnership.FileName)))!;
  var method=typeof(AssetProofObservation).GetMethod("ProfileProof",BindingFlags.Static|BindingFlags.NonPublic)!;
  Dictionary<string,string> Inventory()=>Directory.GetFiles(store.StateDirectory,"*",SearchOption.AllDirectories).ToDictionary(path=>path, path=>TextPackStore.Hash(File.ReadAllBytes(path)));
  var before=Inventory();var proof=method.Invoke(null,[store,owner]) as string;
  check(proof is {Length:64}&&before.OrderBy(p=>p.Key).SequenceEqual(Inventory().OrderBy(p=>p.Key)),"actual asset producer accepts complete floor6 chain without profile mutation");
  var unknown=Path.Combine(store.StateDirectory,"retained-replacement-profile","unknown-future-profile.json");File.WriteAllText(unknown,"retained unknown bytes");var observed=Inventory();var refused=false;
  try{method.Invoke(null,[store,owner]);}catch(TargetInvocationException e)when(e.InnerException is IOException or InvalidDataException){refused=true;}
  check(refused&&observed.OrderBy(p=>p.Key).SequenceEqual(Inventory().OrderBy(p=>p.Key)),"asset producer refuses unknown profile filename without repair or mutation");
 }
}
