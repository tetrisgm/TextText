import { afterEach, expect, it, vi } from "vitest";
import { appleCallbackPage, resumeAppleCallback } from "../apple-callback-resume";
const origin="https://texttext.app";
const request=(data:Record<string,string>,headers:Record<string,string>={})=>new Request(`${origin}/api/auth/apple-resume`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded",...headers},body:new URLSearchParams(data)});
afterEach(()=>vi.unstubAllEnvs());
it("escapes every provider field, constrains script/form, and never exposes callback credentials in a URL",async()=>{
  const attack='\"><script>alert(1)</script><input name="url" value="https://evil.test">';
  const response=await appleCallbackPage(request({state:"nonce",code:attack,user:attack}));const html=await response.text();
  expect(response.status).toBe(200);expect(html).not.toContain(attack);expect(html).toContain("&lt;script&gt;");
  expect(html).toContain('action="/api/auth/apple-resume"');expect(html.match(/<script /g)).toHaveLength(1);
  expect(response.headers.get("Content-Security-Policy")).toMatch(/default-src 'none'; script-src 'nonce-[^']+'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'/);
  expect(response.headers.get("Cache-Control")).toBe("no-store");expect(response.headers.get("Referrer-Policy")).toBe("same-origin");expect(response.headers.has("Set-Cookie")).toBe(false);
});
it("enforces actual byte limit, duplicate/unknown fields and form encoding",async()=>{
  expect((await appleCallbackPage(request({state:"x",code:"x".repeat(33000)}))).status).toBe(413);
  expect((await appleCallbackPage(request({state:"x",code:"x",url:"https://evil.test"}))).status).toBe(400);
  expect((await appleCallbackPage(new Request(origin,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:"state=x&state=y&code=z"}))).status).toBe(400);
  expect((await appleCallbackPage(new Request(origin,{method:"POST",body:"{}"}))).status).toBe(415);
});
it("resumes once into the canonical Auth.js callback carrying cookies and original form fields",async()=>{
  const handler=vi.fn(async(req:Request)=>{expect(req.url).toBe(`${origin}/api/auth/callback/apple`);expect(req.headers.get("cookie")).toBe("session=fixture; intent=fixture");expect(Object.fromEntries(await req.formData())).toEqual({state:"nonce",code:"secret",user:'{"name":"A & B"}'});return new Response(null,{status:303,headers:{Location:"/start"}});});
  const result=await resumeAppleCallback(request({state:"nonce",code:"secret",user:'{"name":"A & B"}'},{Origin:origin,Cookie:"session=fixture; intent=fixture"}),handler);
  expect(handler).toHaveBeenCalledTimes(1);expect(result.status).toBe(303);expect(result.headers.get("Location")).toBe("/start");
});
it.each([undefined,"https://evil.test","null"])("rejects resume from origin %s before Auth.js",async source=>{
  const handler=vi.fn();expect((await resumeAppleCallback(request({state:"nonce",code:"secret"},source?{Origin:source}:{}),handler)).status).toBe(403);expect(handler).not.toHaveBeenCalled();
});
it("preserves provider denial fields for Auth.js error handling",async()=>{
  const handler=vi.fn(async(req:Request)=>{expect(Object.fromEntries(await req.formData())).toEqual({state:"nonce",error:"user_cancelled_authorize",error_description:"Cancelled"});return new Response(null,{status:303});});
  expect((await resumeAppleCallback(request({state:"nonce",error:"user_cancelled_authorize",error_description:"Cancelled"},{Origin:origin}),handler)).status).toBe(303);
});
