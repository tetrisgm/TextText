import { readPublicVaultAsset } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ workspaceId: string; itemId: string; assetPath: string[] }> };
const noStore = { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin" };

async function deliver(request: Request, context: Context, head = false) {
  const { workspaceId, itemId, assetPath } = await context.params;
  const asset = await readPublicVaultAsset({ workspaceId, itemId, assetPath: `assets/${assetPath.join("/")}` }).catch(() => null);
  if (!asset) return new Response(null, { status: 404, headers: noStore });
  const length = asset.data.byteLength;
  const headers = new Headers({ ...noStore, "Content-Type": asset.contentType,
    "Content-Length": String(length), "Accept-Ranges": "bytes",
    ...(asset.download ? { "Content-Disposition": "attachment" } : {}) });
  const range = request.headers.get("range");
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) return new Response(null, { status: 416, headers: { ...noStore, "Content-Range": `bytes */${length}` } });
    const suffix = !match[1] ? Number(match[2]) : null;
    const start = suffix !== null ? Math.max(0, length - suffix) : Number(match[1]);
    const end = suffix !== null ? length - 1 : match[2] ? Math.min(length - 1, Number(match[2])) : length - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= length) {
      return new Response(null, { status: 416, headers: { ...noStore, "Content-Range": `bytes */${length}` } });
    }
    headers.set("Content-Range", `bytes ${start}-${end}/${length}`);
    headers.set("Content-Length", String(end - start + 1));
    return new Response(head ? null : new Uint8Array(asset.data.slice(start, end + 1)), { status: 206, headers });
  }
  return new Response(head ? null : new Uint8Array(asset.data), { status: 200, headers });
}

export const GET = (request: Request, context: Context) => deliver(request, context);
export const HEAD = (request: Request, context: Context) => deliver(request, context, true);
