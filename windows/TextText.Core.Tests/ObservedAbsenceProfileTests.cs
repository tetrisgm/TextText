using System.Text.Json;
using TextText.Core;
static class ObservedAbsenceProfileTests {
 public static void Run(string temp,Action<bool,string> check) {
  var store=new TextPackStore(Path.Combine(temp,"absence-profile-root"),Path.Combine(temp,"absence-profile-state"));
  AccountRootOwnership.Open(store,new("https://profile.test"),"workspace","account");RetainedReplacementProfile.PrepareSharedRename(store);
  var directory=Path.Combine(store.StateDirectory,"retained-replacement-profile");var profile=Path.Combine(directory,"profile.json");var before=File.ReadAllBytes(profile);
  var pending=Path.Combine(store.StateDirectory,"private-pending.bin");File.WriteAllBytes(pending,[0,255,72,19]);var bytes=File.ReadAllBytes(pending);
  RetainedReplacementProfile.PrepareObservedAbsenceRename(store);
  check(JsonSerializer.Deserialize<RetainedReplacementProfile.Marker>(File.ReadAllBytes(profile))!.Version==6,"absent saved rename publishes verified floor6");
  check(File.ReadAllBytes(Path.Combine(directory,"profile-v5.json")).SequenceEqual(before)&&File.ReadAllBytes(Path.Combine(directory,"profile-v5-displaced.json")).SequenceEqual(before),"floor6 retains exact prior and displaced floor5 profile");
  if(OperatingSystem.IsWindows()) {
   store.EnsureFolders(["AbsenceCaseFolder"]);store.EnsureFolders(["absencecasefolder"]);
   check(Directory.GetDirectories(store.Root).Any(path=>Path.GetFileName(path)=="absencecasefolder"),"native folder case operation remains supported at verified floor6");
  }
  var current=File.ReadAllBytes(profile);RetainedReplacementProfile.PrepareSharedRename(store);RetainedReplacementProfile.PrepareObservedAbsenceRename(store);
  check(File.ReadAllBytes(profile).SequenceEqual(current)&&File.ReadAllBytes(pending).SequenceEqual(bytes),"preparation never downgrades6 or changes retained pending bytes");
  var owner=JsonSerializer.Deserialize<AccountRootOwnership.Owner>(File.ReadAllBytes(Path.Combine(store.StateDirectory,AccountRootOwnership.FileName)))!;
  foreach(var authority in new[]{profile,Path.Combine(directory,"profile-v5.json"),Path.Combine(directory,"owner-v1.json")}) {
   var original=File.ReadAllBytes(authority);var text=System.Text.Encoding.UTF8.GetString(original);var duplicate=text.Insert(1,"\"Version\":1,");File.WriteAllText(authority,duplicate);
   var rejected=false;try{RetainedReplacementProfile.Verify(store.StateDirectory,owner,owner.RootHash);}catch(InvalidDataException){rejected=true;}
   check(rejected&&File.ReadAllText(authority)==duplicate&&File.ReadAllBytes(pending).SequenceEqual(bytes),"duplicate profile authority fields refuse without recovery or pending mutation");File.WriteAllBytes(authority,original);
  }
  var marker=JsonSerializer.Deserialize<RetainedReplacementProfile.Marker>(current)!;File.WriteAllBytes(profile,JsonSerializer.SerializeToUtf8Bytes(marker with{Version=7}));
  var refused=false;try{RetainedReplacementProfile.PrepareObservedAbsenceRename(store);}catch(InvalidDataException){refused=true;}
  check(refused&&File.ReadAllBytes(pending).SequenceEqual(bytes),"unknown future floor refuses before changing pending work");
 }
}
