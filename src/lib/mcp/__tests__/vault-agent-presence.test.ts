import { afterEach, beforeEach, expect, it, vi } from "vitest";
const store=vi.hoisted(()=>({joinVaultPresence:vi.fn(),leaveVaultPresence:vi.fn(),readVaultCollaboration:vi.fn(),updateVaultPresence:vi.fn()}));
vi.mock("@/lib/store",()=>store);
import { withVaultAgentPresence } from "../vault-agent-presence";
import { decodePresenceAwareness } from "@/lib/collab/presence-awareness";
const context=()=>({root:"/fixture",workspaceId:"workspace",itemId:"item",actorUserId:"trusted-owner",connectionName:"Codex",connectionId:"authenticated-connection",ownerDisplayName:"Owner",authorize:vi.fn().mockResolvedValue(undefined)});
beforeEach(()=>{vi.clearAllMocks();store.readVaultCollaboration.mockResolvedValue({epoch:4,relativePath:"Notes/Item.textpack"});store.joinVaultPresence.mockResolvedValue({});store.updateVaultPresence.mockResolvedValue({});store.leaveVaultPresence.mockResolvedValue({});});
afterEach(()=>vi.useRealTimers());
it("joins attributed agent awareness before mutation and leaves on success",async()=>{
 const input=context();await expect(withVaultAgentPresence(input,async()=>{expect(store.updateVaultPresence).toHaveBeenCalledTimes(1);return "saved";})).resolves.toBe("saved");
 const join=store.joinVaultPresence.mock.calls[0][0];expect(join).toMatchObject({epoch:4,role:"editor"});expect(join.principal).toContain("trusted-owner");expect(join.sessionExpiresAt).toBeGreaterThan(Date.now());
 const awareness=decodePresenceAwareness(store.updateVaultPresence.mock.calls[0][0].awareness);expect(awareness.state?.user).toMatchObject({participantType:"agent",provider:"codex"});expect(join.userName).toContain("Owner");expect(store.leaveVaultPresence).toHaveBeenCalledWith(join);
});
it("cleans up failed mutations and does not mask successful writes when leave fails",async()=>{
 await expect(withVaultAgentPresence(context(),async()=>{throw Error("mutation failed");})).rejects.toThrow("mutation failed");expect(store.leaveVaultPresence).toHaveBeenCalledTimes(1);
 store.leaveVaultPresence.mockRejectedValue(Error("offline"));await expect(withVaultAgentPresence(context(),async()=>"saved")).resolves.toBe("saved");
});
it("reauthorizes bounded heartbeats, stops on revocation, and cancels timers after completion",async()=>{
 vi.useFakeTimers();const input=context();let finish!:()=>void;const run=withVaultAgentPresence(input,()=>new Promise<void>(resolve=>{finish=resolve;}));await vi.advanceTimersByTimeAsync(0);
 await vi.advanceTimersByTimeAsync(10_000);expect(store.updateVaultPresence).toHaveBeenCalledTimes(2);
 input.authorize.mockRejectedValue(Error("revoked"));await vi.advanceTimersByTimeAsync(30_000);expect(store.updateVaultPresence).toHaveBeenCalledTimes(2);finish();await run;expect(vi.getTimerCount()).toBe(0);
});
it("parallel commands cannot remove each other's sessions",async()=>{
 await Promise.all([withVaultAgentPresence(context(),async()=>1),withVaultAgentPresence(context(),async()=>2)]);
 const sessions=store.joinVaultPresence.mock.calls.map(([input])=>input.clientId);expect(new Set(sessions).size).toBe(2);expect(store.leaveVaultPresence.mock.calls.map(([input])=>input.clientId).sort()).toEqual(sessions.sort());
});
it("refuses absent authority before reading content or running action",async()=>{
 const input=context();input.authorize.mockRejectedValue(Error("denied"));const action=vi.fn();await expect(withVaultAgentPresence(input,action)).rejects.toThrow("denied");expect(action).not.toHaveBeenCalled();expect(store.readVaultCollaboration).not.toHaveBeenCalled();
});
it("exposes agent attribution through the real presence store and expires abandoned sessions",async()=>{
 const engine=await import("@/lib/vault/server-store");const {mkdtemp,rm}=await import("node:fs/promises");const os=await import("node:os");const path=await import("node:path");const {buildTextpack}=await import("@/lib/github/textpack");const {emptyDocumentSnapshot}=await import("@/lib/documents/model");
 const root=await mkdtemp(path.join(os.tmpdir(),"hosted-agent-presence-"));const input={...context(),root};
 try{
  await engine.writeVaultTextpack({...input,operationId:"seed",relativePath:"Notes/Item.textpack",baseRevision:null,bytes:buildTextpack("Item",{markdown:"---\ntextTextId: item\n---\n",document:emptyDocumentSnapshot({id:"texttext.note",version:1})})});
  store.readVaultCollaboration.mockImplementation(engine.readVaultCollaboration);store.joinVaultPresence.mockImplementation(engine.joinVaultPresence);store.updateVaultPresence.mockImplementation(engine.updateVaultPresence);store.leaveVaultPresence.mockImplementation(engine.leaveVaultPresence);
  await withVaultAgentPresence(input,async()=>{const peers=await engine.readVaultPresence(input);expect(peers?.presence).toHaveLength(1);expect(decodePresenceAwareness(peers!.presence[0].awareness!).state?.user).toMatchObject({participantType:"agent"});});
  expect((await engine.readVaultPresence(input))?.presence).toHaveLength(0);
  const identity=store.joinVaultPresence.mock.calls[0][0];await engine.joinVaultPresence(identity);
  const realNow=Date.now;const now=realNow();const spy=vi.spyOn(Date,"now").mockReturnValue(now+31_000);
  try{expect((await engine.readVaultPresence(input))?.presence).toHaveLength(0);}finally{spy.mockRestore();}
 }finally{await rm(root,{recursive:true,force:true});}
});
