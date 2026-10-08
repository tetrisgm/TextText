import { authorizeVault } from "../auth";
import { readBoundedJson } from "@/lib/http/bounded-json";
import { fetchArticle } from "@/lib/reading/fetch-article.server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
export async function POST(request: Request) {
  const access = await authorizeVault(request);
  if (access instanceof Response) return access;
  const input = await readBoundedJson<{ sourceURL?: unknown }>(request, 8192);
  if ("error" in input || typeof input.value?.sourceURL !== "string") return Response.json({ error: "A source link is required." }, { status: 400, headers });
  try { return Response.json(await fetchArticle(input.value.sourceURL, undefined, request.signal), { headers }); }
  catch { return Response.json({ error: "This article could not be captured. Your link is saved; you can open the original or retry." }, { status: 422, headers }); }
}
