// Human-invoked old-source -> current-source pending migration fixture. No user state.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp,mkdir,readFile,writeFile,readdir,realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { createHash } from 'node:crypto';
import * as Y from 'yjs';
const root=process.cwd();const commit=execFileSync('git',['rev-parse','65417abd^{commit}'],{encoding:'utf8'}).trim();
const work=await realpath(await mkdtemp(join(tmpdir(),'texttext-historical-pending-')));const fixture=join(work,'fixture');await mkdir(fixture);
const old=join(work,'old');await mkdir(old);execFileSync('tar',['-x','-C',old],{input:execFileSync('git',['archive',commit,'windows/TextText.Core'],{maxBuffer:8*1024*1024})});
const current=join(work,'current-core');await mkdir(current);const hashes={};
for(const name of (await readdir('windows/TextText.Core')).filter(name=>name.endsWith('.cs')||name.endsWith('.csproj'))){const bytes=await readFile(join('windows/TextText.Core',name));hashes[name]=createHash('sha256').update(bytes).digest('hex');await writeFile(join(current,name),bytes);}
await writeFile(join(fixture,'document.json'),execFileSync(process.execPath,['--import','tsx','--input-type=module','-e',"import model from './src/lib/documents/model.ts';console.log(JSON.stringify(model.emptyDocumentSnapshot()));"],{encoding:'utf8'}));
const d=new Y.Doc();d.getText('fixture').insert(0,'Retained historical pending update');await writeFile(join(fixture,'update.txt'),Buffer.from(Y.encodeStateAsUpdate(d)).toString('base64'));d.destroy();
const project=reference=>`<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings><Nullable>enable</Nullable></PropertyGroup><ItemGroup><ProjectReference Include="${reference}" /></ItemGroup></Project>`;
for(const [name,reference] of [['Producer','../old/windows/TextText.Core/TextText.Core.csproj'],['Consumer','../current-core/TextText.Core.csproj']]){
 const folder=join(work,name);await mkdir(folder);await writeFile(join(folder,name+'.csproj'),project(reference));await writeFile(join(folder,'Program.cs'),await readFile('sync/fixtures/historical-pending-upgrade/'+name+'.cs'));
 if(name==='Consumer'){
  const host=(await readFile('windows/TextText.Core.Tests/NativePolicyTestHost.cs','utf8')).replace('new DirectoryInfo(AppContext.BaseDirectory)','new DirectoryInfo(Environment.GetEnvironmentVariable("TEXTTEXT_POLICY_SOURCE_ROOT")??throw new IOException("Missing isolated fixture policy source"))');
  await writeFile(join(folder,'NativePolicyTestHost.cs'),host);hashes.NativePolicyTestHost=createHash('sha256').update(host).digest('hex');
 }
}
const run=(name,phase)=>execFileSync(process.env.TEXTTEXT_DOTNET||'dotnet',['run','--project',join(work,name,name+'.csproj'),'-c','Release','--',fixture,...(phase?[phase]:[])],{encoding:'utf8',timeout:120000,maxBuffer:2*1024*1024,env:{...process.env,TEXTTEXT_POLICY_SOURCE_ROOT:root}});
console.log(JSON.stringify({kind:'historical-pending-upgrade',oldCommit:commit,platform:process.platform,scratch:work,currentSourceHashes:hashes}));
console.log(run('Producer').trim());for(const phase of ['interrupt','resume','reopen'])console.log(run('Consumer',phase).trim());
const receipt=JSON.parse(await readFile(join(fixture,'replay.json'),'utf8'));assert.equal(receipt.Uploads,1);
await writeFile(join(work,'current-source-hashes.json'),JSON.stringify(hashes,null,2));
console.log('PASS historical pending upgrade: actual old API persistence, unbound/foreign refusal, explicit interrupted adoption and separate-process resume, exact once controlled replay.');
