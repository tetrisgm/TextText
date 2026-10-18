// Kill only the browser process belonging to this owned persistent context.
// CDP must prove its exact profile immediately before the signal. No fallback
// process-name matching, profile deletion, graceful close or login exchange.
import { realpathSync } from 'node:fs';
import { sha256 } from './identity-observation.mjs';
export function validateOwnedBrowserProcess(processes, args, profile, canonical = realpathSync) {
  if (!Array.isArray(processes) || !Array.isArray(args) || args.some(arg=>typeof arg!=='string')) throw new Error('Owned browser process evidence unavailable');
  const browsers=processes.filter(process=>process.type==='browser');
  const paths=args.filter(arg=>arg.startsWith('--user-data-dir='));
  const pid=Number(browsers[0]?.id);
  if(browsers.length!==1||!Number.isSafeInteger(pid)||pid<=1||pid===process.pid||paths.length!==1
    ||canonical(paths[0].slice('--user-data-dir='.length))!==canonical(profile)) throw new Error('Owned browser PID or exact profile mismatch');
  return {pid,profileScopeHash:sha256(canonical(profile))};
}
export async function observeOwnedBrowser(context, profile) {
  const browser=context.browser();
  if(!browser?.isConnected()||typeof browser.newBrowserCDPSession!=='function')throw new Error('Owned Chromium browser CDP unavailable');
  const session=await browser.newBrowserCDPSession();
  try {
    const [processes,command]=await Promise.all([session.send('SystemInfo.getProcessInfo'),session.send('Browser.getBrowserCommandLine')]);
    return validateOwnedBrowserProcess(processes.processInfo,command.arguments,profile);
  } finally {await session.detach().catch(()=>{});}
}
export async function crashOwnedBrowser(context,profile,{signal=(pid,kind)=>process.kill(pid,kind),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),now=()=>performance.now()}={}) {
  const first=await observeOwnedBrowser(context,profile),browser=context.browser();
  let disconnected=!browser.isConnected();const mark=()=>{disconnected=true;};browser.on('disconnected',mark);
  try {
    const fresh=await observeOwnedBrowser(context,profile);
    if(disconnected||fresh.pid!==first.pid||fresh.profileScopeHash!==first.profileScopeHash)throw new Error('Owned browser changed before kill');
    signal(fresh.pid,'SIGKILL');
    const deadline=now()+10000;
    for(;;){
      let gone=false;
      try{signal(fresh.pid,0);}catch(error){if(error.code==='ESRCH')gone=true;else throw new Error('Owned browser exit could not be verified');}
      if(gone&&disconnected)return{...fresh,method:'SIGKILL',exited:true};
      if(now()>=deadline)throw new Error('Owned browser did not exit after kill');
      await sleep(25);
    }
  } finally {browser.off('disconnected',mark);}
}

// Normal page close is deliberately distinct from a crash. A production
// beforeunload refusal fails without forcing the page or closing its context.
export async function closeOwnedBrowser(context,page,profile,{signal=(pid,kind)=>process.kill(pid,kind),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),now=()=>performance.now()}={}) {
  if(!page||page.isClosed())throw new Error('Owned browser page unavailable before normal close');
  const first=await observeOwnedBrowser(context,profile),browser=context.browser();
  let blocked=false,closed=false;
  const bounded=async action=>{let timer;try{return await Promise.race([action(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Normal browser close request timed out')),10000);})]);}finally{clearTimeout(timer);}};
  const dialog=async value=>{blocked=true;await value.dismiss().catch(()=>{});};
  const didClose=()=>{closed=true;};page.on('dialog',dialog);page.on('close',didClose);
  try {
    const fresh=await observeOwnedBrowser(context,profile);
    if(fresh.pid!==first.pid||fresh.profileScopeHash!==first.profileScopeHash||page.isClosed())throw new Error('Owned browser changed before normal close');
    await bounded(()=>page.close({runBeforeUnload:true}));
    const deadline=now()+10000;
    while(!closed&&!page.isClosed()){
      if(blocked)throw new Error('Production beforeunload refused normal browser close');
      if(now()>=deadline)throw new Error('Normal browser page close was not observed');
      await sleep(25);
    }
    if(blocked)throw new Error('Production beforeunload refused normal browser close');
    await bounded(()=>context.close());
    for(;;){
      let gone=false;
      try{signal(fresh.pid,0);}catch(error){if(error.code==='ESRCH')gone=true;else throw new Error('Normal owned browser exit could not be verified');}
      if(gone&&!browser.isConnected())return{...fresh,method:'normal-close',runBeforeUnload:true,pageClosed:true,contextClosed:true,exited:true};
      if(now()>=deadline)throw new Error('Normal owned browser exit was not observed');
      await sleep(25);
    }
  }catch(error){
    if(!page.isClosed()&&browser.isConnected()){
      const retained=await observeOwnedBrowser(context,profile);
      if(retained.pid===first.pid&&retained.profileScopeHash===first.profileScopeHash)error.retention={schemaVersion:1,driverPid:process.pid,browserPid:retained.pid,profileScopeHash:retained.profileScopeHash,pageRetained:true,contextRetained:true};
    }
    throw error;
  }finally{page.off('dialog',dialog);page.off('close',didClose);}
}

// A refused close is a human-review boundary, not permission for runner cleanup
// to destroy the guarded page. Keep the owned driver until its browser closes.
export function retainGuardedBrowser(context,{onExit=()=>process.exit(1)}={}) {
  const browser=context.browser();
  if(!browser?.isConnected())throw new Error('Guarded browser unavailable for retention');
  const hold=setInterval(()=>{},60000);
  browser.once('disconnected',()=>{clearInterval(hold);onExit();});
}
