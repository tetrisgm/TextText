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

test('normal close uses beforeunload and only observes exact owned PID exit',async()=>{
 const {mkdtempSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const actual=mkdtempSync(join(tmpdir(),'texttext-browser-normal-unit-'));
 const {closeOwnedBrowser}=await import('./browser-lifecycle.mjs');
 const browser=new EventEmitter();browser.connected=true;browser.isConnected=()=>browser.connected;
 browser.newBrowserCDPSession=async()=>({send:async method=>method==='SystemInfo.getProcessInfo'?{processInfo:[{type:'browser',id:345678}]}:{arguments:['--user-data-dir='+actual]},detach:async()=>{}});
 const page=new EventEmitter();page.closed=false;page.isClosed=()=>page.closed;page.close=async options=>{assert.deepEqual(options,{runBeforeUnload:true});page.closed=true;page.emit('close');};
 let contextCloses=0;const signals=[];const context={browser:()=>browser,close:async()=>{contextCloses++;browser.connected=false;}};
 const proof=await closeOwnedBrowser(context,page,actual,{signal:(_pid,kind)=>{signals.push(kind);const error=new Error();error.code='ESRCH';throw error;}});
 assert.equal(proof.method,'normal-close');assert.equal(proof.runBeforeUnload,true);assert.equal(proof.pageClosed,true);assert.equal(proof.exited,true);assert.equal(contextCloses,1);assert.deepEqual(signals,[0]);
});
test('beforeunload refusal retains actual live page/context and returns bounded ownership without force',async()=>{
 const {mkdtempSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const actual=mkdtempSync(join(tmpdir(),'texttext-browser-guard-unit-'));
 const {closeOwnedBrowser}=await import('./browser-lifecycle.mjs');const browser=new EventEmitter();browser.isConnected=()=>true;
 browser.newBrowserCDPSession=async()=>({send:async method=>method==='SystemInfo.getProcessInfo'?{processInfo:[{type:'browser',id:345678}]}:{arguments:['--user-data-dir='+actual]},detach:async()=>{}});
 let dismissed=0,contextCloses=0,signals=0;const page=new EventEmitter();page.isClosed=()=>false;page.close=async()=>{page.emit('dialog',{dismiss:async()=>{dismissed++;}});};
 await assert.rejects(closeOwnedBrowser({browser:()=>browser,close:async()=>{contextCloses++;}},page,actual,{signal:()=>{signals++;}}),error=>{assert.equal(error.retention.browserPid,345678);assert.equal(error.retention.driverPid,process.pid);assert.equal(error.retention.pageRetained,true);assert.equal(error.retention.contextRetained,true);return /beforeunload refused/.test(error.message);});
 assert.equal(dismissed,1);assert.equal(contextCloses,0);assert.equal(signals,0);assert.equal(page.isClosed(),false);
});

async function normalAutoExitFixture() {
 const {mkdtempSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const actual=mkdtempSync(join(tmpdir(),'texttext-browser-autoexit-unit-'));
 const browser=new EventEmitter();browser.connected=true;browser.isConnected=()=>browser.connected;
 browser.newBrowserCDPSession=async()=>({send:async method=>method==='SystemInfo.getProcessInfo'?{processInfo:[{type:'browser',id:345678}]}:{arguments:['--user-data-dir='+actual]},detach:async()=>{}});
 const page=new EventEmitter();page.closed=false;page.isClosed=()=>page.closed;page.close=async options=>{assert.deepEqual(options,{runBeforeUnload:true});page.closed=true;page.emit('close');};
 return {actual,browser,page};
}
const alreadyClosedMessage='browserContext.close: Target page, context or browser has been closed';
test('natural persistent Edge autoexit tolerates only the redundant already-closed context error',async()=>{
 const {closeOwnedBrowser}=await import('./browser-lifecycle.mjs');const {actual,browser,page}=await normalAutoExitFixture();let closes=0,probes=0;
 const proof=await closeOwnedBrowser({browser:()=>browser,close:async()=>{closes++;browser.connected=false;throw new Error(alreadyClosedMessage);}},page,actual,{signal:(_pid,kind)=>{assert.equal(kind,0);probes++;throw Object.assign(new Error(),{code:'ESRCH'});}});
 assert.equal(proof.exited,true);assert.equal(proof.contextAlreadyClosed,true);assert.equal(closes,1);assert.equal(probes,1);
});
test('arbitrary context errors and an already-closed claim while still connected refuse',async()=>{
 const {closeOwnedBrowser}=await import('./browser-lifecycle.mjs');
 for(const [message,disconnect]of [['unrelated failure',true],[alreadyClosedMessage,false]]){
  const {actual,browser,page}=await normalAutoExitFixture();let probes=0;
  await assert.rejects(closeOwnedBrowser({browser:()=>browser,close:async()=>{if(disconnect)browser.connected=false;throw new Error(message);}},page,actual,{signal:()=>{probes++;}}),error=>error.message===message);
  assert.equal(probes,0);
 }
});
test('already-closed context plus disconnect still requires exact owned process disappearance',async()=>{
 const {closeOwnedBrowser}=await import('./browser-lifecycle.mjs');const {actual,browser,page}=await normalAutoExitFixture();let clock=0,probes=0;
 await assert.rejects(closeOwnedBrowser({browser:()=>browser,close:async()=>{browser.connected=false;throw new Error(alreadyClosedMessage);}},page,actual,{signal:(_pid,kind)=>{assert.equal(kind,0);probes++;},now:()=>clock,sleep:async ms=>{clock+=ms;}}),/exit was not observed/);
 assert.ok(clock>=10000);assert.ok(probes>0);
});
