import { serveReleaseDownload } from "@/lib/release-download.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ filename: string }> };

export async function GET(request: Request, context: Context) {
  const { filename } = await context.params;
  return serveReleaseDownload(filename, { method: "GET", range: request.headers.get("range") });
}

export async function HEAD(_request: Request, context: Context) {
  const { filename } = await context.params;
  return serveReleaseDownload(filename, { method: "HEAD" });
}
