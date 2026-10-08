// Bounded transport/engine regression against an existing local standalone production build.
// The diagnostic URL bypasses authentication only inside this isolated child process.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { build } from 'esbuild';
const server = process.argv[2];
const injectLifecycle = process.argv[3] === '--inject-lifecycle';
if (process.argv.length > 4 || process.argv[3] && !injectLifecycle) throw new Error('Only --inject-lifecycle is supported for testing an older build.');
if (!server || !path.isAbsolute(server)) throw new Error('Pass an absolute local standalone server.js path.');
const dir = await mkdtemp(path.join(tmpdir(), 'texttext-read-drain-'));
let child; const agent = new http.Agent({ keepAlive: true });
try {
 await symlink(path.join(process.cwd(), 'node_modules'), path.join(dir, 'node_modules'));
 await writeFile(path.join(dir, 'entry.ts'), `import {listVaultTextpacks,waitVaultTextpacks} from ${JSON.stringify(path.join(process.cwd(),'src/sync/engine/store.ts'))}; export {installReadDrain} from ${JSON.stringify(path.join(process.cwd(),'src/sync/engine/read-drain.ts'))}; export async function poll(root:string){const location={root,workspaceId:'fixture'};const initial=await listVaultTextpacks(location);return waitVaultTextpacks({...location,revision:initial.revision,waitMs:25000});}`);
 await build({entryPoints:[path.join(dir,'entry.ts')],outfile:path.join(dir,'engine.cjs'),bundle:true,platform:'node',format:'cjs',packages:'external',tsconfig:path.join(process.cwd(),'tsconfig.json'),logLevel:'silent'});
 await writeFile(path.join(dir, 'preload.cjs'), `const http=require('node:http');const engine=require('./engine.cjs');${injectLifecycle ? 'engine.installReadDrain();' : ''}const emit=http.Server.prototype.emit;const close=http.Server.prototype.close;let polls=0;http.Server.prototype.emit=function(event,...args){if(event==='request'&&args[0].url==='/__texttext_read_drain_probe'){if(!globalThis[Symbol.for('texttext.read-poll-drain')]?.installed){args[1].statusCode=500;args[1].end('lifecycle missing');console.log('PROBE lifecycle-missing');return true;}engine.poll(${JSON.stringify(path.join(dir,'vault'))}).then(()=>{args[1].end('done');console.log('PROBE poll-finished');}).catch(()=>{args[1].statusCode=500;args[1].end('failed');});setTimeout(()=>console.log('PROBE poll-waiting'),100);return true;}return emit.call(this,event,...args);};http.Server.prototype.close=function(cb){console.log('PROBE close-start');return close.call(this,(...args)=>{console.log('PROBE close-finished');cb?.(...args);});};`);
 // Let the OS assign a loopback port, then release it immediately before starting the child.
 const reservation = http.createServer(); await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
 const port=reservation.address().port; await new Promise(resolve=>reservation.close(resolve));
 child=spawn(process.execPath,['--require',path.join(dir,'preload.cjs'),server],{env:{PATH:process.env.PATH,NODE_ENV:'production',HOSTNAME:'127.0.0.1',PORT:String(port),DATABASE_URL:'postgresql://probe:probe@127.0.0.1:5432/nonexistent_shutdown_probe',AUTH_SECRET:'isolated-shutdown-probe-only',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
 let requested=false, signalled=false, started=0, output='';
 const result=await new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Production shutdown exceeded 12 seconds: '+output));},12000);
  child.stdout.on('data',buffer=>{
   const text=buffer.toString();output+=text;
   if(text.includes('Ready')&&!requested){
    requested=true;
    // Next initializes instrumentation on its first real request. An intercepted
    // diagnostic request alone bypasses that lifecycle and can give false results.
    http.get(`http://127.0.0.1:${port}/signin`,{agent},response=>{
     response.resume();
     response.on('end',()=>{
      if(response.statusCode!==200){reject(new Error('Production warm-up failed'));return;}
      http.get(`http://127.0.0.1:${port}/__texttext_read_drain_probe`,{agent},poll=>{
       poll.resume();if(poll.statusCode!==200)reject(new Error('Production drain lifecycle was not installed'));
      }).on('error',reject);
     });
    }).on('error',reject);
   }
   if(text.includes('PROBE poll-waiting')&&!signalled){signalled=true;started=Date.now();child.kill('SIGTERM');}
  });
  child.stderr.on('data',buffer=>{output+=buffer.toString();});
  child.on('error',reject);child.on('exit',(code,signal)=>{clearTimeout(timeout);resolve({code,signal,elapsed:Date.now()-started});});
 });
 assert.equal(result.code,143,output);assert.equal(result.signal,null,output);
 assert.ok(output.includes('PROBE poll-finished'),output);assert.ok(output.includes('PROBE close-finished'),output);
 assert.ok(result.elapsed<10000,JSON.stringify(result));
 console.log(`PASS production read drain: actual 25-second vault poll woke on SIGTERM, HTTP closed, exit143 in ${result.elapsed}ms without SIGKILL.`);
} finally {if(child&&child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');agent.destroy();await rm(dir,{recursive:true,force:true});}
