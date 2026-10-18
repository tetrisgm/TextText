// Owned-process real HTTP fixture. No real accounts, SQL metadata, TLS, desktop
// actor, deployed server, or four/six-client acceptance claim.
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,readdir,readFile,writeFile,realpath,rename,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
if(process.argv.includes('--pc-client')) { await import('./fixtures/folder-case-http/Remote.mjs'); } else {
const repo=process.cwd(),work=await realpath(await mkdtemp(join(tmpdir(),'texttext-native-folder-http-'))),nonce=randomUUID();
await writeFile(join(work,'fixture-nonce'),nonce,{flag:'wx'});
const sourceHashes={},hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const capture=async path=>{const bytes=await readFile(path);sourceHashes[path]=hash(bytes);return bytes;};
const core=join(work,'Core'),runner=join(work,'Runner');await mkdir(core);await mkdir(runner);
for(const name of (await readdir('windows/TextText.Core')).filter(name=>name.endsWith('.cs')||name.endsWith('.csproj'))){const path=join('windows/TextText.Core',name);await writeFile(join(core,name),await capture(path));}
await writeFile(join(runner,'Worker.cs'),await capture('sync/fixtures/folder-case-http/Worker.cs'));
const policy=(await capture('windows/TextText.Core.Tests/NativePolicyTestHost.cs')).toString().replace('new DirectoryInfo(AppContext.BaseDirectory)','new DirectoryInfo(Environment.GetEnvironmentVariable("TEXTTEXT_POLICY_SOURCE_ROOT")??throw new IOException("Missing fixture source"))');
await writeFile(join(runner,'NativePolicyTestHost.cs'),policy);
await writeFile(join(runner,'Runner.csproj'),'<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings><Nullable>enable</Nullable></PropertyGroup><ItemGroup><ProjectReference Include="../Core/TextText.Core.csproj" /></ItemGroup></Project>');
for(const path of ['sync/native-folder-case-http.mjs','scripts/vault-http-test-server.ts','src/sync/engine/store.ts','src/sync/engine/folder-move-plan.ts','src/lib/vault/server-store.ts','src/lib/github/textpack.ts','src/lib/documents/model.ts','sync/native-policy-test-host.mjs'])await capture(path);
const dotnet=process.env.TEXTTEXT_DOTNET||'dotnet',environment={...process.env,TEXTTEXT_POLICY_SOURCE_ROOT:repo};
const build=execFileSync(dotnet,['build',join(runner,'Runner.csproj'),'-c','Release'],{env:environment,encoding:'utf8',timeout:120000,maxBuffer:2*1024*1024});await writeFile(join(work,'build.log'),build);
const dll=join(runner,'bin','Release','net10.0','Runner.dll'),coreDll=join(runner,'bin','Release','net10.0','TextText.Core.dll');
const seed=execFileSync(process.execPath,['--import','tsx','--input-type=module','-e',`import p from './src/lib/github/textpack.ts';import m from './src/lib/documents/model.ts';const d=m.emptyDocumentSnapshot();d.content.body='Real native HTTP folder fixture ${nonce}';process.stdout.write(Buffer.from(p.buildTextpack('One',{document:d,markdown:'---\\ntextTextId: folder-http-item\\n---\\n'+d.content.body,files:{'assets/exact.bin':new Uint8Array([0,255,7,19])}})).toString('base64'));`],{cwd:repo,encoding:'utf8',timeout:15000,maxBuffer:2*1024*1024});
const archive=Buffer.from(seed,'base64');await writeFile(join(work,'archive.textpack'),archive,{flag:'wx'});
if(process.argv.includes('--prepare-client')){const prepared={scratch:work,nonce,dll,archiveHash:hash(archive),runnerDllHash:hash(await readFile(dll)),coreDllHash:hash(await readFile(coreDll)),sourceHashes};await writeFile(join(work,'prepared.json'),JSON.stringify(prepared,null,2));console.log('PREPARED '+JSON.stringify(prepared));process.exit(0);}
const serverRoot=join(work,'server'),ready=join(work,'ready.json');await mkdir(join(serverRoot,'contract-workspace','Parent','Case','Empty child'),{recursive:true});
const server=spawn(process.execPath,['--import','tsx','scripts/vault-http-test-server.ts',serverRoot,ready],{cwd:repo,stdio:['ignore','ignore','pipe']});let diagnostics='';server.stderr.on('data',bytes=>{diagnostics=(diagnostics+bytes).slice(-8192);});
const serverExit=once(server,'exit');const results=[];let origin;
try{
 for(let i=0;i<400&&!origin;i++){if(server.exitCode!==null)throw Error('Owned HTTP fixture exited: '+diagnostics);try{origin=JSON.parse(await readFile(ready,'utf8')).origin;}catch(error){if(error.code!=='ENOENT')throw error;}if(!origin)await new Promise(resolve=>setTimeout(resolve,25));}
 assert.ok(origin,'Owned server readiness deadline: '+diagnostics);const actual=new URL(origin);assert.equal(actual.hostname,'127.0.0.1');
 const request=async path=>{const response=await fetch(origin+path,{headers:{Authorization:'Bearer vault-http-fixture'},signal:AbortSignal.timeout(10000)});const text=await response.text();assert.equal(response.status,200,path+': '+text.slice(0,2048));return JSON.parse(text);};
 const initial=await request('/api/vault/contract-workspace/items');assert.equal(initial.syncCapabilities,undefined);await request('/__test/folder-case?enabled=1');
 const run=mode=>{const output=execFileSync(dotnet,[dll,mode,work,nonce,origin+'/'],{cwd:repo,env:environment,encoding:'utf8',timeout:45000,maxBuffer:2*1024*1024});const lines=output.split('\n').filter(line=>line.startsWith('RESULT '));assert.equal(lines.length,1,mode+' exact result line');const result=JSON.parse(lines[0].slice(7));results.push(result);console.log('PHASE '+JSON.stringify(result));return result;};
 const exactDirectories=async(root,expected)=>assert.deepEqual((await readdir(join(root,'Parent'))).filter(name=>!name.startsWith('.')).sort(),[expected]);
 const sameArchive=async(root,path)=>assert.deepEqual(await readFile(join(root,...path.split('/'))),archive);
 if(process.platform!=='win32'){
  run('wire-seed');await request('/__test/lose-next-reply');const lost=run('wire-lost');const replay=run('wire-resume');assert.equal(lost.operationId,replay.operationId);const manifest=await request('/api/vault/contract-workspace/items');assert.deepEqual(manifest.folders,['Parent','Parent/CASE','Parent/CASE/Empty child']);await exactDirectories(join(serverRoot,'contract-workspace'),'CASE');await sameArchive(join(serverRoot,'contract-workspace'),'Parent/CASE/one.textpack');
  const before=await request('/__test/stats');await request('/api/vault/contract-workspace/items');await request('/api/vault/contract-workspace/items');const idle=await request('/__test/stats');for(const key of ['uploads','renames','deletions','folderRequests','folderPublications'])assert.equal(idle[key],before[key],key+' portable wire idle');assert.equal(idle.folderPublications,1);
  results.push({qualification:'portable production HTTP transport; not Windows observer/outbox or two-native convergence',before,idle});
 }else{
  run('a-seed');run('b-seed');const a=join(work,'native-a'),b=join(work,'native-b');await sameArchive(a,'Parent/Case/one.textpack');await sameArchive(b,'Parent/Case/one.textpack');const aIdentity=await stat(join(a,'Parent','Case'),{bigint:true}),bIdentity=await stat(join(b,'Parent','Case'),{bigint:true});
  await request('/__test/lose-next-reply');await rename(join(a,'Parent','Case'),join(a,'Parent','CASE'));const aAfter=await stat(join(a,'Parent','CASE'),{bigint:true});assert.equal(aAfter.dev,aIdentity.dev);assert.equal(aAfter.ino,aIdentity.ino);await exactDirectories(a,'CASE');
  const lost=run('a-lost'),pending=await readFile(join(work,'native-lost-command.json'));const committed=await request('/__test/stats');assert.equal(committed.folderPublications,1);const resumed=run('a-resume');assert.equal(resumed.pending,false);assert.deepEqual(await readFile(join(work,'native-lost-command.json')),pending);run('b-converge');const bAfter=await stat(join(b,'Parent','CASE'),{bigint:true});assert.equal(bAfter.dev,bIdentity.dev);assert.equal(bAfter.ino,bIdentity.ino);
  for(const root of [a,b,join(serverRoot,'contract-workspace')]){await exactDirectories(root,'CASE');await sameArchive(root,'Parent/CASE/one.textpack');assert.ok((await stat(join(root,'Parent','CASE','Empty child'))).isDirectory());}
  const converged=await request('/__test/stats');assert.equal(converged.folderPublications,1);assert.equal(converged.renames,0);assert.equal(converged.deletions,0);assert.equal(converged.uploads,1);
  await request('/__test/folder-case-race');await rename(join(a,'Parent','CASE'),join(a,'Parent','cASE'));const race=run('a-race');run('a-cancel');await sameArchive(a,'Parent/cASE/one.textpack');await exactDirectories(a,'cASE');run('a-replay-cancelled');await rename(join(a,'Parent','cASE'),join(a,'Parent','CASE'));run('a-restored');run('b-idle');
  const beforeIdle=await request('/__test/stats');for(let i=0;i<2;i++){run('a-idle');run('b-idle');}const idle=await request('/__test/stats');for(const key of ['uploads','downloads','renames','deletions','folderRequests','folderPublications','folderRecoveries'])assert.equal(idle[key],beforeIdle[key],key+' native idle');assert.equal(idle.folderPublications,1);
  const manifest=await request('/api/vault/contract-workspace/items');assert.equal(manifest.items.length,1);assert.equal(manifest.items[0].itemId,'folder-http-item');assert.equal(manifest.items[0].relativePath,'Parent/CASE/one.textpack');assert.ok(manifest.folders.includes('Parent/CASE/Empty child'));for(const root of [a,b,join(serverRoot,'contract-workspace')])await sameArchive(root,'Parent/CASE/one.textpack');
  results.push({qualification:'two actual Windows production Core participants; real HTTP/engine; no SQL/auth/TLS/desktop claim',lostOperation:lost.operationId,rejectedOperation:race.operationId,converged,beforeIdle,idle,filesystemActions:3});
 }
 const sourceStable={};for(const [path,before]of Object.entries(sourceHashes)){sourceStable[path]=hash(await readFile(path));assert.equal(sourceStable[path],before,'Fixture source changed: '+path);}
 const receipt={kind:'native-folder-case-http',platform:process.platform,scratch:work,serverPID:server.pid,archiveHash:hash(archive),runnerDllHash:hash(await readFile(dll)),coreDllHash:hash(await readFile(coreDll)),sdk:execFileSync(dotnet,['--version'],{encoding:'utf8'}).trim(),sourceHashes,results};await writeFile(join(work,'receipt.json'),JSON.stringify(receipt,null,2));console.log('RECEIPT '+JSON.stringify(receipt));console.log('PASS owned real HTTP folder fixture; qualification is platform-specific and excludes four/six-client acceptance.');
}finally{if(server.exitCode===null){server.kill('SIGTERM');await serverExit;}await writeFile(join(work,'server-stderr.log'),diagnostics);}

}
