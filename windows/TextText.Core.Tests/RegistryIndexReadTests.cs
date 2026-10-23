using System.Text.Json;
using TextText.Core;
static class RegistryIndexReadTests {
 public static void Run(string temporary,Action<bool,string> check) {
  var store=new TextPackStore(Path.Combine(temporary,"index-read-root"),Path.Combine(temporary,"index-read-state"));
  var reads=0;var validations=0;
  var registry=new ReplacementRecoveryRegistry(store.Root,store.StateDirectory,phase=>{if(phase=="registryRecordRead")reads++;if(phase=="registryEntryValidated")validations++;});
  var operations=new List<Guid>();const int count=24;
  for(var index=0;index<count;index++){var operation=Guid.NewGuid();operations.Add(operation);registry.Register(operation,"registry-"+index,"Notes/record-"+index+".textpack",new string('a',64),new string('b',64));}
  var records=registry.Entries();
  check(records.Count==count&&reads==count&&validations==count,"cold full registry validation reads and validates every record");
  reads=0;validations=0;var selected=registry.Entries("registry-0");
  check(selected.Count==1,"first selected registry lookup retains exact identity");
  if(OperatingSystem.IsWindows())check(reads==0&&validations==1,"first identity index reuses fingerprint-matched decoded records without redundant byte reads");
  else check(reads==count&&validations==count,"portable registry validation keeps uncached full-read behavior");
  var path=Path.Combine(store.StateDirectory,"replacement-index",operations[0].ToString("D")+".json");
  var changed=selected[0] with{ExpectedHash="invalid-changed-hash"};File.WriteAllText(path,JsonSerializer.Serialize(changed));
  reads=0;var refused=false;try{registry.Entries("registry-0");}catch(InvalidDataException){refused=true;}
  check(refused&&reads>0,"changed record stamp forces byte reread and rejects invalid scope");
  check(File.ReadAllText(path)==JsonSerializer.Serialize(changed),"failed validation preserves changed record evidence");
 }
}
