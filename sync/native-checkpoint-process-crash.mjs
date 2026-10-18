// Actual owned-process termination after production native checkpoint returns.
import assert from 'node:assert/strict';
import { execFileSync,spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash,randomUUID } from 'node:crypto';
import { mkdtemp,mkdir,readdir,readFile,writeFile,realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as Y from 'yjs';
const repo=process.cwd();const work=await realpath(await mkdtemp(join(tmpdir(),'texttext-checkpoint-process-')));const core=join(work,'Core');const runner=join(work,'Runner');await mkdir(core);await mkdir(runner);
const hashes={};for(const name of (await readdir('windows/TextText.Core')).filter(name=>name.endsWith('.cs')||name.endsWith('.csproj'))){const bytes=await readFile(join('windows/TextText.Core',name));hashes[name]=createHash('sha256').update(bytes).digest('hex');await writeFile(join(core,name),bytes);}
await writeFile(join(runner,'Worker.cs'),await readFile('sync/fixtures/native-checkpoint-crash/Worker.cs'));
const host=(await readFile('windows/TextText.Core.Tests/NativePolicyTestHost.cs','utf8')).replace('new DirectoryInfo(AppContext.BaseDirectory)','new DirectoryInfo(Environment.GetEnvironmentVariable("TEXTTEXT_POLICY_SOURCE_ROOT")??throw new IOException("Missing fixture source"))');await writeFile(join(runner,'NativePolicyTestHost.cs'),host);
await writeFile(join(runner,'Runner.csproj'),'<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings><Nullable>enable</Nullable></PropertyGroup><ItemGroup><ProjectReference Include="../Core/TextText.Core.csproj" /></ItemGroup></Project>');
const dotnet=process.env.TEXTTEXT_DOTNET||'dotnet';const environment={...process.env,TEXTTEXT_POLICY_SOURCE_ROOT:repo};
execFileSync(dotnet,['build',join(runner,'Runner.csproj'),'-c','Release'],{encoding:'utf8',timeout:120000,maxBuffer:2*1024*1024});const dll=join(runner,'bin','Release','net10.0','Runner.dll');
const document=execFileSync(process.execPath,['--import','tsx','--input-type=module','-e',"import model from './src/lib/documents/model.ts';console.log(JSON.stringify(model.emptyDocumentSnapshot()));"],{encoding:'utf8'});
const d=new Y.Doc();d.getText('fixture').insert(0,'Actual process kill retained update');const update=Buffer.from(Y.encodeStateAsUpdate(d)).toString('base64');d.destroy();
for(const mode of ['pending-before-release','queued-ack','after-close']){
 const fixture=join(work,'case-'+mode);await mkdir(fixture);const nonce=randomUUID();await writeFile(join(fixture,'fixture-nonce'),nonce,{flag:'wx'});await writeFile(join(fixture,'document.json'),document);await writeFile(join(fixture,'update.txt'),update);
 const child=spawn(dotnet,[dll,fixture,mode,nonce,'worker'],{env:environment,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
 const exited=once(child,'exit');const ready=new Promise((resolve,reject)=>{
  child.once('error',reject);child.stdout.on('data',bytes=>{stdout+=bytes;if(stdout.length>65536)return reject(Error('Worker output exceeded bound'));const line=stdout.split('\n').find(line=>line.startsWith('READY '));if(line){try{resolve(JSON.parse(line.slice(6)));}catch(error){reject(error);}}});
  child.stderr.on('data',bytes=>{stderr+=bytes;if(stderr.length>65536)reject(Error('Worker error output exceeded bound'));});child.once('exit',()=>reject(Error('Worker exited before owned kill: '+stderr.slice(-3000))));
 });
 let timer;try{
  const receipt=await Promise.race([ready,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Worker READY deadline: '+stderr.slice(-3000))),15000);})]);clearTimeout(timer);
  assert.equal(await readFile(join(fixture,'fixture-nonce'),'utf8'),nonce);assert.equal(receipt.pid,child.pid);assert.equal(receipt.nonce,nonce);assert.equal(receipt.mode,mode);assert.equal(receipt.returned,true);assert.equal(receipt.generation,9);assert.equal(receipt.sessionReleased,mode==='after-close');assert.equal(receipt.queuedAcknowledgement,mode==='queued-ack');
  assert.equal(child.exitCode,null);assert.equal(child.signalCode,null);assert.equal(child.kill('SIGKILL'),true);const [code,signal]=await exited;assert.equal(signal,'SIGKILL');assert.equal(code,null);
  console.log('KILLED '+JSON.stringify({mode,pid:receipt.pid,returned:true,generation:receipt.generation,sessionReleased:receipt.sessionReleased,queuedAcknowledgement:receipt.queuedAcknowledgement}));
  const recovered=execFileSync(dotnet,[dll,fixture,mode,nonce,'reopen'],{env:environment,encoding:'utf8',timeout:20000,maxBuffer:65536});assert.match(recovered,/RECOVERED/);console.log(recovered.trim());
 }finally{clearTimeout(timer);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}}
}
await writeFile(join(work,'current-source-hashes.json'),JSON.stringify(hashes,null,2));console.log(JSON.stringify({kind:'native-checkpoint-process-kill',platform:process.platform,scratch:work,currentSourceHashes:hashes}));
console.log('PASS actual native process kill: returned pending checkpoint, queued background ACK, and after Close; no power-loss or installed-app claim.');
