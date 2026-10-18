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
