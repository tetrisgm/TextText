import { afterEach, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { applyDocumentBaseline, documentSnapshotFromYDoc, documentText } from "@/lib/collab/document";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { outboxIndexedDB } from "./helpers/outbox-indexeddb";

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((fn) => fn());
  vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();
});
async function tick() { for (let i=0;i<60;i++) await Promise.resolve(); }
async function setup(postId: string) {
  vi.useFakeTimers();
  const storage=outboxIndexedDB();vi.stubGlobal("indexedDB",storage.indexedDB);
  const providerModule=await import("@/lib/collab/provider");
  const baseline=new Y.Doc(),snapshot=emptyDocumentSnapshot();snapshot.content.body="alpha";
  applyDocumentBaseline(baseline,snapshot,`${postId}:1`);
  const encoded=Buffer.from(Y.encodeStateAsUpdate(baseline)).toString("base64");
  let respond!:(response:Response)=>void;
  const pending=new Promise<Response>((resolve)=>{respond=resolve;});
  const fetcher=vi.fn(async(input: RequestInfo | URL,init?:RequestInit)=>{
    const url=String(input);
    if(url.endsWith("/presence"))return Response.json({presence:[]});
    if(url.endsWith("/materialize"))throw new Error("offline materialization");
    if(init?.method==="POST")return pending;
    if(url.includes("wait=0"))return Response.json({updates:[],seq:0,epoch:5,baseline:{update:encoded,revision:1}});
    return new Promise<Response>(()=>{});
  });
  vi.stubGlobal("fetch",fetcher);
  const retired=vi.fn(),doc=new Y.Doc();
  const provider=new providerModule.CollabProvider(doc,{postId,userName:"Probe",color:"#000000",canPush:true,onRetired:retired});
  cleanups.push(()=>{provider.destroy();doc.destroy();baseline.destroy();});
  await provider.start();
  documentText(doc,"body").insert(5," LOCAL ONLY");
  await vi.advanceTimersByTimeAsync(400);
  const outbox=(provider as unknown as {outbox:{pending:Uint8Array[];subscribers:Map<symbol,unknown>}}).outbox;
  expect(outbox.pending.length).toBeGreaterThan(0);
  expect(storage.records.has(postId)).toBe(true);
  await expect(provider.materialize("probe",true)).rejects.toThrow("offline materialization");
  provider.destroy();
  expect(outbox.subscribers.size).toBe(0);
  return {providerModule,storage,provider,doc,retired,outbox,fetcher,respond};
}

it("commits quarantine before clearing an unmounted queue, then exposes it after a module restart",async()=>{
  const postId="quarantine-unmounted",h=await setup(postId);
  h.storage.holdRetirement();
  h.respond(Response.json({retired:true,epoch:6}));await tick();
  // Neither memory nor disk loses the queue while quarantine is uncommitted.
  expect(h.outbox.pending.length).toBeGreaterThan(0);
  expect(h.storage.records.has(postId)).toBe(true);
  expect([...h.storage.records.keys()].filter((key)=>key.startsWith("retired:"))).toHaveLength(0);
  h.storage.release();await tick();
  expect(h.outbox.pending).toEqual([]);
  expect(h.retired).not.toHaveBeenCalled();
  expect(h.storage.records.has(postId)).toBe(false);
  const stored=[...h.storage.records.values()] as {copy:{state:string;updates:string[];epoch:number;baselineRevision:number}}[];
  expect(stored).toHaveLength(1);
  expect(stored[0].copy).toMatchObject({epoch:5,baselineRevision:1});
  expect(stored[0].copy.updates.length).toBeGreaterThan(0);
  const recovered=new Y.Doc();Y.applyUpdate(recovered,Buffer.from(stored[0].copy.state,"base64"));
  expect(documentSnapshotFromYDoc(recovered).content.body).toBe("alpha LOCAL ONLY");recovered.destroy();

  // Discard all provider module state while preserving only the IDB backing map.
  vi.resetModules();
  const reopened=await import("@/lib/collab/provider");
  const recovery=await reopened.readRetiredOutboxes(postId);
  expect(recovery.durable).toBe(true);
  expect(recovery.copies[0].document?.content.body).toBe("alpha LOCAL ONLY");
  const onRecovery=vi.fn(),fresh=new Y.Doc();
  const provider=new reopened.CollabProvider(fresh,{postId,userName:"Probe",color:"#000000",canPush:true,onRecovery});
  const calls=h.fetcher.mock.calls.length;
  await provider.start();
  expect(onRecovery).toHaveBeenCalledExactlyOnceWith(recovery.copies,true);
  expect(h.fetcher.mock.calls.length).toBe(calls); // no replay under the replacement epoch
  expect(provider.materializationBlocked).toBe(true);
  expect(await reopened.acknowledgeRetiredOutboxes(recovery.copies)).toBe(true);
  expect((await reopened.readRetiredOutboxes(postId)).copies).toEqual([]);
  provider.destroy();fresh.destroy();
});

it("retains both durable and in-memory queues when quarantine aborts, without retrying stale operations",async()=>{
  const postId="quarantine-abort",h=await setup(postId);
  h.storage.failRetirement();h.respond(Response.json({retired:true,epoch:6}));await tick();
  expect(h.outbox.pending.length).toBeGreaterThan(0);
  expect(h.storage.records.has(postId)).toBe(true);
  const recovery=await h.providerModule.readRetiredOutboxes(postId);
  expect(recovery.durable).toBe(false);
  expect(recovery.copies[0].document?.content.body).toBe("alpha LOCAL ONLY");
  const calls=h.fetcher.mock.calls.length;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(h.fetcher.mock.calls).toHaveLength(calls);
});

it("retains remote dependencies used by local edits and exposes recovery on reopening",async()=>{
  const postId="quarantine-dependencies",h=await setup(postId);
  // Reopen the same pending epoch, then edit a peer insertion whose identities
  // are absent from the original canonical baseline.
  const peer=new Y.Doc();Y.applyUpdate(peer,Y.encodeStateAsUpdate(h.doc));
  documentText(peer,"body").insert(0,"REMOTE ");
  const doc=new Y.Doc(),provider=new h.providerModule.CollabProvider(doc,{postId,userName:"Probe",color:"#000000",canPush:true});
  await provider.start();
  Y.applyUpdate(doc,Y.encodeStateAsUpdate(peer),"collab-remote");
  documentText(doc,"body").delete(0,6); // depends on the unseen peer insertion
  documentText(doc,"body").insert(0,"EDITED");
  provider.destroy();
  h.respond(Response.json({retired:true,epoch:6}));await tick();
  const recovery=await h.providerModule.readRetiredOutboxes(postId);
  expect(recovery.copies[0].document?.content.body).toBe("EDITED alpha LOCAL ONLY");
  peer.destroy();doc.destroy();
});

it("does not let an old push acknowledgment drain a queue while quarantine is committing",async()=>{
  const postId="quarantine-late-ack",h=await setup(postId);
  h.storage.holdRetirement();
  h.fetcher.mockImplementation(async(input)=>{
    if(String(input).includes("wait=0")) return Response.json({updates:[],seq:0,epoch:6});
    return new Promise<Response>(()=>{});
  });
  const doc=new Y.Doc(),remount=new h.providerModule.CollabProvider(doc,{postId,userName:"Probe",color:"#000000",canPush:true});
  const start=remount.start();await tick();
  h.respond(Response.json({epoch:5,seq:1}));await tick();
  expect(h.outbox.pending.length).toBeGreaterThan(0);
  expect(h.storage.records.has(postId)).toBe(true);
  h.storage.release();await start;await tick();
  expect(h.outbox.pending).toEqual([]);
  expect((await h.providerModule.readRetiredOutboxes(postId)).copies[0].document?.content.body).toBe("alpha LOCAL ONLY");
  remount.destroy();doc.destroy();
});

it("quarantines the persisted old baseline after restart before applying a replacement baseline",async()=>{
  const postId="quarantine-restarted-pending",h=await setup(postId);
  // No retirement response was ever received by the first process.
  vi.resetModules();
  const restarted=await import("@/lib/collab/provider");
  const replacement=new Y.Doc(),snapshot=emptyDocumentSnapshot();snapshot.content.body="REPLACEMENT";
  applyDocumentBaseline(replacement,snapshot,`${postId}:2`);
  h.fetcher.mockImplementation(async(input)=>{
    if(String(input).includes("wait=0")) return Response.json({updates:[],seq:0,epoch:6,
      baseline:{update:Buffer.from(Y.encodeStateAsUpdate(replacement)).toString("base64"),revision:2}});
    return new Promise<Response>(()=>{});
  });
  const doc=new Y.Doc(),retired=vi.fn();
  const provider=new restarted.CollabProvider(doc,{postId,userName:"Probe",color:"#000000",canPush:true,onRetired:retired});
  await provider.start();
  expect(retired).toHaveBeenCalledExactlyOnceWith(5);
  const recovery=await restarted.readRetiredOutboxes(postId);
  expect(recovery.copies[0].document?.content.body).toBe("alpha LOCAL ONLY");
  expect(recovery.copies[0].baselineRevision).toBe(1);
  expect(h.storage.records.has(postId)).toBe(false);
  provider.destroy();doc.destroy();replacement.destroy();
});

it("never clears an unmounted queue when IndexedDB is unavailable",async()=>{
  const postId="quarantine-no-storage",h=await setup(postId);
  vi.stubGlobal("indexedDB",undefined);
  h.respond(Response.json({retired:true,epoch:6}));await tick();
  expect(h.outbox.pending.length).toBeGreaterThan(0);
  expect(h.storage.records.has(postId)).toBe(true);
  const recovery=await h.providerModule.readRetiredOutboxes(postId);
  expect(recovery.durable).toBe(false);
  expect(recovery.copies[0].document?.content.body).toBe("alpha LOCAL ONLY");
});


it("quarantine and its acknowledgment preserve a newer durable queue written by another tab",async()=>{
  const postId="quarantine-newer-tab",h=await setup(postId);
  const newer={postId,epoch:6,epochKnown:true,baselineRevision:2,updates:["newer tab operation"]};
  h.storage.records.set(postId,newer);
  h.respond(Response.json({retired:true,epoch:6}));await tick();
  expect(h.outbox.pending).toEqual([]);
  expect(h.storage.records.get(postId)).toEqual(newer);
  const recovery=await h.providerModule.readRetiredOutboxes(postId);
  expect(recovery.copies[0].document?.content.body).toBe("alpha LOCAL ONLY");
  expect(await h.providerModule.acknowledgeRetiredOutboxes(recovery.copies)).toBe(true);
  expect(h.storage.records.get(postId)).toEqual(newer);
});
