import{test}from'node:test';import assert from'node:assert/strict';import{EventEmitter}from'node:events';
import{validateOwnedBrowserProcess,crashOwnedBrowser}from'./browser-lifecycle.mjs';
const profile='/fixture/owned-profile';
test('process proof refuses missing ambiguous wrong profile and unsafe PID evidence',()=>{
 const valid=[{type:'browser',id:345678}];const args=['chrome','--user-data-dir='+profile];const canonical=value=>value;
 assert.equal(validateOwnedBrowserProcess(valid,args,profile,canonical).pid,345678);
 for(const [processes,arguments_]of [[[],args],[[...valid,valid[0]],args],[[{type:'browser',id:process.pid}],args],[valid,['--user-data-dir=/other']],[valid,[...args,args[1]]],[valid,[]]])assert.throws(()=>validateOwnedBrowserProcess(processes,arguments_,profile,canonical),/PID|profile/);
});
test('no CDP or disconnected browser refuses before any signal',async()=>{
 let signals=0;await assert.rejects(crashOwnedBrowser({browser:()=>null},profile,{signal:()=>signals++}),/CDP/);assert.equal(signals,0);
});

test('verified owned kill waits for actual disappearance and refuses changed PID before signal',async()=>{
 const{mkdtempSync}=await import('node:fs');const{tmpdir}=await import('node:os');const{join}=await import('node:path');const actual=mkdtempSync(join(tmpdir(),'texttext-browser-lifecycle-unit-'));
 function fixture(change=false){const browser=new EventEmitter();browser.connected=true;browser.isConnected=()=>browser.connected;let reads=0;
 browser.newBrowserCDPSession=async()=>({send:async method=>method==='SystemInfo.getProcessInfo'?{processInfo:[{type:'browser',id:345678+(change&&reads++>0?1:0)}]}:{arguments:['--user-data-dir='+actual]},detach:async()=>{}});return browser;}
 const browser=fixture(),signals=[];await crashOwnedBrowser({browser:()=>browser},actual,{signal:(pid,kind)=>{signals.push(kind);if(kind==='SIGKILL'){browser.connected=false;browser.emit('disconnected');}else{const error=new Error();error.code='ESRCH';throw error;}}});assert.deepEqual(signals,['SIGKILL',0]);
 let unsafeSignals=0;const changed=fixture(true);await assert.rejects(crashOwnedBrowser({browser:()=>changed},actual,{signal:()=>unsafeSignals++}),/changed/);assert.equal(unsafeSignals,0);
});

test('transport disconnect alone never counts as verified process exit',async()=>{
 const{mkdtempSync}=await import('node:fs');const{tmpdir}=await import('node:os');const{join}=await import('node:path');const actual=mkdtempSync(join(tmpdir(),'texttext-browser-exit-unit-'));
 const browser=new EventEmitter();browser.connected=true;browser.isConnected=()=>browser.connected;browser.newBrowserCDPSession=async()=>({send:async method=>method==='SystemInfo.getProcessInfo'?{processInfo:[{type:'browser',id:345678}]}:{arguments:['--user-data-dir='+actual]},detach:async()=>{}});
 let clock=0,kills=0;await assert.rejects(crashOwnedBrowser({browser:()=>browser},actual,{now:()=>clock,sleep:async ms=>{clock+=ms;},signal:(_pid,kind)=>{if(kind==='SIGKILL'){kills++;browser.connected=false;browser.emit('disconnected');}}}),/did not exit/);assert.equal(kills,1);assert.ok(clock>=10000);
});
