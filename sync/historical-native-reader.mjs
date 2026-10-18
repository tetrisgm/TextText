// Human-invoked historical-source characterization, never an installed-app gate.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, realpath, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const revision='65417abd';
const commit=execFileSync('git',['rev-parse',`${revision}^{commit}`],{encoding:'utf8'}).trim();
const work=await realpath(await mkdtemp(join(tmpdir(),'texttext-historical-reader-')));
const source=join(work,'source');await mkdir(source);
const archive=execFileSync('git',['archive',commit,'windows/TextText.Core'],{maxBuffer:8*1024*1024});
execFileSync('tar',['-x','-C',source],{input:archive});
const current=join(work,'current-core');await mkdir(current);
const currentFiles=(await readdir('windows/TextText.Core')).filter(name=>name.endsWith('.cs')||name.endsWith('.csproj'));
const currentHashes={};
const { createHash }=await import('node:crypto');
for(const name of currentFiles){const bytes=await readFile(join('windows/TextText.Core',name));currentHashes[name]=createHash('sha256').update(bytes).digest('hex');await writeFile(join(current,name),bytes);}
const producer=join(work,'producer');await mkdir(producer);
const project=reference=>`<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings><Nullable>enable</Nullable></PropertyGroup><ItemGroup><ProjectReference Include="${reference}" /></ItemGroup></Project>`;
await writeFile(join(producer,'Producer.csproj'),project('../current-core/TextText.Core.csproj'));
const schema=execFileSync(process.execPath,['--import','tsx','--input-type=module','-e',"import model from './src/lib/documents/model.ts';console.log(JSON.stringify(model.emptyDocumentSnapshot()));"],{encoding:'utf8'});
await writeFile(join(work,'document.json'),schema);
await writeFile(join(producer,'Program.cs'),String.raw`
using System.IO.Compression;using System.Text;using System.Text.Json;using System.Text.Json.Nodes;using System.Reflection;using TextText.Core;
var fixture=Path.Combine(args[0],"fixture");var root=Path.Combine(fixture,"root");var state=Path.Combine(fixture,"state");var store=new TextPackStore(root,state);AccountRootOwnership.Open(store,new Uri("https://historical-reader.test"),"fixture","fixture-account");
if(args[1]=="produce"){
 var doc=JsonNode.Parse(File.ReadAllText(Path.Combine(args[0],"document.json")))!;doc["content"]!["title"]="Historical compatibility fixture";doc["content"]!["body"]="Original body";
 using var bytes=new MemoryStream();using(var zip=new ZipArchive(bytes,ZipArchiveMode.Create,true)){using(var text=new StreamWriter(zip.CreateEntry("text.md").Open(),new UTF8Encoding(false))){text.Write("---\ntextTextId: historical-fixture\n---\nOriginal body");}using(var writer=new StreamWriter(zip.CreateEntry("document.json").Open())){writer.Write(doc.ToJsonString());}}
 store.Write("one.textpack",bytes.ToArray());RetainedReplacementProfile.Prepare(store);
 typeof(RetainedReplacementProfile).GetMethod("PrepareFolderCase",BindingFlags.NonPublic|BindingFlags.Static)!.Invoke(null,[store,null]);
 AccountRootOwnership.Open(new TextPackStore(root,state),new Uri("https://historical-reader.test"),"fixture","fixture-account");
 var owner=JsonSerializer.Deserialize<AccountRootOwnership.Owner>(File.ReadAllBytes(Path.Combine(state,AccountRootOwnership.FileName)))!;if(owner.Version!=2)throw new Exception("Owner floor not produced");
 var profile=JsonSerializer.Deserialize<RetainedReplacementProfile.Marker>(File.ReadAllBytes(Path.Combine(state,"retained-replacement-profile","profile.json")))!;if(profile.Version!=2)throw new Exception("Profile floor not produced");
 RetainedReplacementProfile.Verify(state,owner,owner.RootHash);if(store.Describe("one.textpack").ItemId!="historical-fixture")throw new Exception("New reader refused fixture");Console.WriteLine("PASS production current Core creates and reopens actual owner2/profile2 and schema-v1 pack");
}else{
 var bytes=store.Read("one.textpack");if(!TextPackStore.Markdown(bytes).Contains("Historical writer changed body"))throw new Exception("External bytes lost");
 using var zip=new ZipArchive(new MemoryStream(bytes));using var reader=new StreamReader(zip.GetEntry("document.json")!.Open());using var doc=JsonDocument.Parse(reader.ReadToEnd());if(doc.RootElement.GetProperty("content").GetProperty("body").GetString()!="Historical writer changed body")throw new Exception("Canonical body lost");
 if(store.Describe("one.textpack").ItemId!="historical-fixture")throw new Exception("Identity changed");Console.WriteLine("PASS current Core reopens historical external edit with protected state intact; provenance is not detectable from valid bytes alone");
}
`);
const runner=join(work,'runner');await mkdir(runner);
await writeFile(join(runner,'Reader.csproj'),project('../source/windows/TextText.Core/TextText.Core.csproj'));
await writeFile(join(runner,'Program.cs'),String.raw`
using System.IO.Compression;
using System.Text;
using System.Text.Json;
using TextText.Core;
var fixture=Path.Combine(args[0],"fixture");var root=Path.Combine(fixture,"root");var state=Path.Combine(fixture,"state");Directory.CreateDirectory(root);Directory.CreateDirectory(state);
var path=Path.Combine(root,"one.textpack");var original=File.ReadAllBytes(path);
Dictionary<string,string> Metadata()=>Directory.EnumerateFiles(state,"*",SearchOption.AllDirectories).ToDictionary(x=>Path.GetRelativePath(state,x),x=>TextPackStore.Hash(File.ReadAllBytes(x)));
void Check(bool ok,string label){if(!ok)throw new Exception(label);Console.WriteLine("PASS "+label);}
var metadata=Metadata();var old=new TextPackStore(root,state);Check(old.Read("one.textpack").SequenceEqual(original),"historical reader opens bytes despite owner-v2/profile-v2 metadata");
Check(old.Describe("one.textpack").ItemId=="historical-fixture","historical reader recognizes fixture identity");
Check(Metadata().OrderBy(x=>x.Key).SequenceEqual(metadata.OrderBy(x=>x.Key)),"read leaves exact protected metadata unchanged");
using var doc=JsonDocument.Parse(new ZipArchive(new MemoryStream(original)).GetEntry("document.json")!.Open());var canonical=System.Text.Json.Nodes.JsonNode.Parse(doc.RootElement.GetRawText())!;canonical["content"]!["body"]="Historical writer changed body";
var changed=TextPackStore.WithDocument(original,TextPackStore.Markdown(original).Replace("Original body","Historical writer changed body"),canonical.ToJsonString());old.Write("one.textpack",changed,TextPackStore.Hash(original));Check(File.ReadAllBytes(path).SequenceEqual(changed),"historical writer does not refuse new protected profile");
foreach(var item in metadata)Check(TextPackStore.Hash(File.ReadAllBytes(Path.Combine(state,item.Key)))==item.Value,"historical writer leaves protected metadata "+item.Key);
// Unknown future metadata is likewise invisible to this historical reader.
var ownerPath=Path.Combine(state,"account-owner.json");var savedOwner=File.ReadAllBytes(ownerPath);try{File.WriteAllText(ownerPath,"{\"Version\":999}");Check(new TextPackStore(root,state).Read("one.textpack").SequenceEqual(changed),"historical reader also ignores unknown future ownership metadata");}finally{File.WriteAllBytes(ownerPath,savedOwner);}
Console.WriteLine("CHARACTERIZATION ONLY: incompatible rollback writer; fixture scratch="+fixture);
`);
const dotnet=process.env.TEXTTEXT_DOTNET||'dotnet';
const run=(folder,file,args)=>execFileSync(dotnet,['run','--project',join(folder,file),'-c','Release','--',work,...args],{encoding:'utf8',maxBuffer:2*1024*1024,timeout:120000});
const produced=run(producer,'Producer.csproj',['produce']);
const output=run(runner,'Reader.csproj',[]);
const reopened=run(producer,'Producer.csproj',['verify']);
assert.match(output,/historical writer does not refuse new protected profile/);
await writeFile(join(work,'current-source-hashes.json'),JSON.stringify(currentHashes,null,2));
console.log(JSON.stringify({kind:'historical-source-reader-characterization',commit,platform:process.platform,scratch:resolve(work),currentSourceHashes:currentHashes}));console.log(produced.trim());console.log(output.trim());console.log(reopened.trim());
