using System.Text.Json;
using System.Reflection;
using TextText.Core;
static class LocalHandoffProfileTests {
 public static void Run(string temp,Action<bool,string> check) {
  void Refuse(Action f,string label){try{f();}catch(Exception error)when(error is IOException or InvalidDataException){check(true,label);return;}throw new Exception(label);}
  void Prior(TextPackStore store,string method){try{typeof(RetainedReplacementProfile).GetMethod(method,BindingFlags.Static|BindingFlags.NonPublic)!.Invoke(null,[store,null]);}catch(TargetInvocationException error)when(error.InnerException is not null){System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(error.InnerException).Throw();}}
  string Profile(TextPackStore s)=>Path.Combine(s.StateDirectory,"retained-replacement-profile","profile.json");
  var root=Path.Combine(temp,"handoff-root");var a=new TextPackStore(root,Path.Combine(temp,"handoff-a"));var b=new TextPackStore(root,Path.Combine(temp,"handoff-b"));
  var origin=new Uri("https://fixture.test");AccountRootOwnership.Open(a,origin,"workspace","account-a");AccountRootOwnership.Open(b,origin,"workspace","account-a");
  Prior(b,"PrepareFolderSync");var other=File.ReadAllBytes(Profile(b));
  check(RetainedReplacementProfile.SupportsLocalHandoff(a)&&!File.Exists(Profile(a)),"handoff config verifies owned private state without floor publication");
  Prior(a,"PrepareFolderSync");var prior=File.ReadAllBytes(Profile(a));var owner=File.ReadAllBytes(Path.Combine(a.StateDirectory,AccountRootOwnership.FileName));
  var pending=Path.Combine(a.StateDirectory,"pending-proof.bin");File.WriteAllText(pending,"exact pending bytes");
  RetainedReplacementProfile.PrepareLocalHandoff(a);var marker=JsonSerializer.Deserialize<RetainedReplacementProfile.Marker>(File.ReadAllBytes(Profile(a)))!;
  check(marker.Version==4&&File.ReadAllBytes(Path.Combine(Path.GetDirectoryName(Profile(a))!,"profile-v3.json")).SequenceEqual(prior),"handoff floor four retains exact prior profile three");
  check(File.ReadAllBytes(Path.Combine(a.StateDirectory,AccountRootOwnership.FileName)).SequenceEqual(owner)&&File.ReadAllText(pending)=="exact pending bytes","handoff floor preserves owner and pending data");
  Prior(a,"PrepareFolderCase");Prior(a,"PrepareFolderSync");AccountRootOwnership.Open(a,origin,"workspace","account-a");
  check(File.ReadAllBytes(Profile(b)).SequenceEqual(other)&&!Directory.Exists(Path.Combine(root,".texttext","retained-replacement-profile")),"handoff floor remains private to one device state");
  if(OperatingSystem.IsWindows()) {
   byte[] Pack(string body){using var output=new MemoryStream();using(var zip=new System.IO.Compression.ZipArchive(output,System.IO.Compression.ZipArchiveMode.Create,true))using(var writer=new StreamWriter(zip.CreateEntry("text.md").Open()))writer.Write("---\ntextTextId: \"stable-lease\"\n---\n"+body);return output.ToArray();}
   var initial=a.Write("Stable.textpack",Pack("before"));var stableProfile=File.ReadAllBytes(Profile(a));
   using(var reader=new FileStream(Path.Combine(a.StateDirectory,"retained-replacement-profile.lock"),FileMode.Open,FileAccess.Read,FileShare.Read)) {
    RetainedReplacementProfile.PrepareLocalHandoff(a);
    var next=Pack("after");var saved=a.Write(initial.Path,next,initial.Hash);
    check(saved.Hash!=initial.Hash&&a.Read(saved.Path).SequenceEqual(next),"stable shared reader permits exact actual store write");
    check(File.ReadAllBytes(Profile(a)).SequenceEqual(stableProfile),"stable reader saves do not republish profile");
   }
  }
  var inside=new TextPackStore(Path.Combine(temp,"handoff-inside"),Path.Combine(temp,"handoff-inside","private"));check(!RetainedReplacementProfile.SupportsLocalHandoff(inside),"portable in-root state cannot advertise handoff");Refuse(()=>RetainedReplacementProfile.PrepareLocalHandoff(inside),"portable state cannot publish handoff floor");
  foreach(var boundary in new[]{"localHandoffProfilePreserved","localHandoffProfileStaged","beforeLocalHandoffProfilePublication","localHandoffProfilePublished"}) {
   var suffix=Guid.NewGuid().ToString("N");var s=new TextPackStore(Path.Combine(temp,"handoff-crash-root-"+suffix),Path.Combine(temp,"handoff-crash-state-"+suffix));AccountRootOwnership.Open(s,origin,"workspace","account-a");Prior(s,"PrepareFolderSync");var original=File.ReadAllBytes(Profile(s));
   Refuse(()=>RetainedReplacementProfile.PrepareLocalHandoff(s,point=>{if(point==boundary)throw new IOException("fixture interruption");}),"handoff upgrade interruption "+boundary);
   RetainedReplacementProfile.PrepareLocalHandoff(s);check(File.ReadAllBytes(Path.Combine(Path.GetDirectoryName(Profile(s))!,"profile-v3.json")).SequenceEqual(original),"handoff restart retains exact prior profile "+boundary);
  }
  File.WriteAllBytes(Profile(a),JsonSerializer.SerializeToUtf8Bytes(marker with{Version=7}));Refuse(()=>RetainedReplacementProfile.SupportsLocalHandoff(a),"future handoff profile refuses without rewriting");
 }
}
