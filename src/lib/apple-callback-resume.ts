import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { readBoundedText } from "./http/bounded-json";
import { requestPublicOrigin } from "./request-origin";

const callbackPath = "/api/auth/callback/apple";
const resumePath = "/api/auth/apple-resume";
const fields = new Set(["code", "id_token", "state", "user", "error", "error_description", "error_uri"]);
const privateHeaders = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
const fail = (status: number) => new Response("Invalid Apple sign-in response", { status, headers: privateHeaders });
const escape = (value: string) => value.replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c]!);

async function form(request: Request): Promise<URLSearchParams | Response> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/x-www-form-urlencoded") return fail(415);
  const text = await readBoundedText(request, 32 * 1024);
  if ("error" in text) return fail(413);
  const data = new URLSearchParams(text.value);
  const seen = new Set<string>();
  for (const [key, value] of data) {
    if (!fields.has(key) || seen.has(key) || value.length > 24 * 1024) return fail(400);
    seen.add(key);
  }
  if (!data.get("state") || !(data.get("code") || data.get("error"))) return fail(400);
  return data;
}

/** The first Apple POST is cross-site, so Lax cookies may be absent. An inert first-party page resumes without changing their protections. */
export async function appleCallbackPage(request: Request): Promise<Response> {
  const data = await form(request);
  if (data instanceof Response) return data;
  const nonce = randomBytes(24).toString("base64");
  const inputs = [...data].map(([name,value]) => `<input type="hidden" name="${escape(name)}" value="${escape(value)}">`).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="same-origin"><title>Continue to TextText</title></head><body><form id="apple-resume" method="post" action="${resumePath}">${inputs}<button type="submit">Continue to TextText</button></form><script nonce="${nonce}">document.getElementById("apple-resume").submit();</script></body></html>`;
  return new Response(html, { headers: { ...privateHeaders, "Referrer-Policy":"same-origin", "Content-Type":"text/html; charset=utf-8",
    "Content-Security-Policy":`default-src 'none'; script-src 'nonce-${nonce}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'` } });
}

export async function resumeAppleCallback(request: Request, handler: (request: NextRequest) => Response | Promise<Response>): Promise<Response> {
  const origin = requestPublicOrigin(request);
  if (request.headers.get("origin") !== origin) return fail(403);
  const data = await form(request);
  if (data instanceof Response) return data;
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  headers.set("content-type", "application/x-www-form-urlencoded");
  // Call Auth.js directly with its canonical callback URL; never re-enter the first-hop route.
  const response = await handler(new NextRequest(new URL(callbackPath, origin), { method:"POST", headers, body:data.toString() }));
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
