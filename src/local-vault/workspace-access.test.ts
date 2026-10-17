import { afterEach, describe, expect, it } from "vitest";
import { watchWorkspaceAccess } from "./workspace-access";
import { vaultCommentCapabilities } from "./vault-comments";
import type { VaultAccess } from "./shared-vaults";
const owner: VaultAccess = {fullAccess:true,isOwner:true,canEditContent:true,canComment:true,canManageShares:true,grants:[]};
const ticks = async () => { for(let n=0;n<12;n++) await Promise.resolve(); };
const stops: (()=>void)[]=[];
afterEach(()=>{for(const stop of stops.splice(0))stop();});
function harness() {
  const events=new EventTarget();const values:(VaultAccess|null)[]=[];const failures:unknown[]=[];
  const pending:{signal:AbortSignal;resolve:(value:unknown)=>void;reject:(error:unknown)=>void}[]=[];
  const stop=watchWorkspaceAccess({events,changed:value=>values.push(value),failed:error=>failures.push(error),
    read:signal=>new Promise((resolve,reject)=>pending.push({signal,resolve,reject}))});stops.push(stop);
  return {events,values,failures,pending,stop};
}
describe("shared authenticated workspace capabilities",()=>{
  it.each(["viewer","commenter","editor"] as const)("derives %s actions from the same server grant on every host",async role=>{
    const h=harness();await ticks();const access:VaultAccess={fullAccess:false,isOwner:false,canEditContent:false,canComment:false,canManageShares:false,grants:[{scopeType:"folder",scopeKey:"Shared",role}]};
    h.pending[0].resolve(access);await ticks();expect(h.values).toEqual([access]);
    expect(vaultCommentCapabilities(h.values[0],"item","Shared/Note.textpack")).toEqual({canComment:role!=="viewer",canResolve:role==="editor"});
    expect(vaultCommentCapabilities(h.values[0],"item","Private/Note.textpack")).toEqual({canComment:false,canResolve:false});
    expect(h.values[0]?.canManageShares).toBe(false);
  });
  it("allows owner actions and removes them after revoked/invalid refresh without modifying content",async()=>{
    const h=harness();await ticks();h.pending[0].resolve(owner);await ticks();expect(h.values.at(-1)?.canManageShares).toBe(true);
    h.events.dispatchEvent(new Event("focus"));await ticks();h.pending[1].reject(new Error("403"));await ticks();expect(h.values.at(-1)).toBeNull();
    h.events.dispatchEvent(new Event("online"));await ticks();h.pending[2].resolve({...owner,canManageShares:"yes"});await ticks();expect(h.values.at(-1)).toBeNull();expect(h.failures).toHaveLength(2);
  });
  it("coalesces an event storm into one followup without overlapping or starving a slow read",async()=>{
    const h=harness();await ticks();
    for(let i=0;i<100;i++){h.events.dispatchEvent(new Event("texttext:vault-sync-status"));await ticks();}
    expect(h.pending).toHaveLength(1);expect(h.pending[0].signal.aborted).toBe(false);
    h.pending[0].resolve(owner);await ticks();expect(h.values).toEqual([owner]);expect(h.pending).toHaveLength(2);
    h.pending[1].reject(new Error("revoked"));await ticks();expect(h.values).toEqual([owner,null]);expect(h.pending).toHaveLength(2);
  });
  it("ignores an in-flight permission reply after going offline",async()=>{
    const h=harness();await ticks();h.events.dispatchEvent(new Event("offline"));h.pending[0].resolve(owner);await ticks();
    expect(h.pending[0].signal.aborted).toBe(true);expect(h.values).toEqual([null]);
  });
  it("retains current confirmed controls during a routine refresh, without replacing them with a stale response",async()=>{
    const h=harness();await ticks();h.pending[0].resolve(owner);await ticks();h.events.dispatchEvent(new Event("focus"));await ticks();
    expect(h.values).toEqual([owner]);h.pending[1].resolve({...owner,canManageShares:false});await ticks();expect(h.values.at(-1)?.canManageShares).toBe(false);
  });
  it("cannot adopt the old account/workspace response after its lifetime is replaced",async()=>{
    const old=harness();await ticks();old.stop();const next=harness();await ticks();
    old.pending[0].resolve(owner);next.pending[0].resolve({...owner,isOwner:false,canManageShares:false});await ticks();
    expect(old.pending[0].signal.aborted).toBe(true);expect(old.values).toEqual([]);expect(next.values.at(-1)?.canManageShares).toBe(false);
    old.events.dispatchEvent(new Event("online"));await ticks();expect(old.pending).toHaveLength(1);
  });
  it("fails closed offline, does not start a queued offline read, and resumes on reconnect",async()=>{
    const h=harness();h.events.dispatchEvent(new Event("offline"));await ticks();expect(h.pending).toHaveLength(0);expect(h.values).toEqual([null]);
    h.events.dispatchEvent(new Event("focus"));await ticks();expect(h.pending).toHaveLength(0);
    h.events.dispatchEvent(new Event("online"));await ticks();expect(h.pending).toHaveLength(1);h.pending[0].resolve(owner);await ticks();expect(h.values.at(-1)).toEqual(owner);
  });
});
