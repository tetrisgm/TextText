import { describe, expect, it, vi } from "vitest";
import { createWebAssistant } from "./web-assistant";
const id="4c417b9d-f935-40c4-a537-7cb70658f898";
const read=vi.fn(async()=>({markdown:`---\ntextTextId: "${id}"\n---\nBody`}));
describe("web assistant transport",()=>{
  it("cancels a running request and fences late responses after workspace destruction",async()=>{
    for(const destroy of [false,true]){
      const events:Record<string,unknown>[]=[];let resolve!:(r:Response)=>void;let signal:AbortSignal|undefined;
      const fetcher=vi.fn(async(_url:unknown,init?:RequestInit)=>{signal=init?.signal as AbortSignal;return new Promise<Response>(r=>{resolve=r})});
      const adapter=createWebAssistant("test",read,fetcher as typeof fetch,e=>events.push(e));
      const run=adapter.request("agentSend",{taskId:"turn",path:"Notes/A.textpack",prompt:"read"});
      await vi.waitFor(()=>expect(fetcher).toHaveBeenCalled());
      if(destroy)adapter.destroy();else await adapter.request("agentCancel",{taskId:"turn"});
      expect(signal?.aborted).toBe(true);
      resolve(new Response(JSON.stringify({type:"complete",text:"Late answer"})+"\n"));await run;
      expect(events.map(e=>e.type)).toEqual(["turn-cancelled"]);
      if(destroy)await expect(adapter.request("agentStatus",{})).rejects.toThrow("closed");
    }
  });
  it("retains bounded follow-up history only for the current target",async()=>{
    const bodies: {messages:unknown[]}[]=[];
    const fetcher=vi.fn(async(_url:unknown,init?:RequestInit)=>{bodies.push(JSON.parse(String(init?.body)));return new Response(JSON.stringify({type:"complete",text:"Saved answer"})+"\n")});
    const adapter=createWebAssistant("test",read,fetcher as typeof fetch,()=>{});
    await adapter.request("agentSend",{taskId:"one",path:"Notes/A.textpack",prompt:"Read"});
    await adapter.request("agentSend",{taskId:"two",path:"Notes/A.textpack",prompt:"Explain that"});
    expect(bodies[1].messages).toEqual([{role:"user",content:"Read"},{role:"assistant",content:"Saved answer"},{role:"user",content:"Explain that"}]);
    await adapter.request("agentRetarget",{path:"Notes/B.textpack"});
    await adapter.request("agentRetarget",{path:"Notes/A.textpack"});
    await adapter.request("agentSend",{taskId:"three",path:"Notes/A.textpack",prompt:"Other"});
    expect(bodies[2].messages).toEqual([{role:"user",content:"Other"}]);
    for(let i=0;i<8;i++)await adapter.request("agentSend",{taskId:String(i),path:"Notes/B.textpack",prompt:"Next"});
    expect(bodies.at(-1)!.messages.length).toBe(9);
  });
  it("does not cancel a different task and always requests read-only canonical context",async()=>{
    const events:Record<string,unknown>[]=[];
    const fetcher=vi.fn(async(_url:unknown,init?:RequestInit)=>{const body=JSON.parse(String(init?.body));expect(body.context).toEqual({postId:id,includeItem:true,mode:"read_only"});return new Response(JSON.stringify({type:"complete",text:"Read"})+"\n")});
    const adapter=createWebAssistant("test",read,fetcher as typeof fetch,e=>events.push(e));
    await adapter.request("agentCancel",{taskId:"other"});await adapter.request("agentSend",{taskId:"turn",path:"Notes/A.textpack",prompt:"read"});
    expect(events.map(e=>e.type)).toEqual(["final-text","turn-completed"]);
  });
});
