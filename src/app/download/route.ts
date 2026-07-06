// /download is the URL people say out loud. It lands on the stub installer
// (Safari auto-extracts the zip; one double-click, no wizard), or the raw
// app zip if no installer build has been published yet.

import { getCurrentAppRelease } from "@/lib/app-release";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const release = await getCurrentAppRelease();
  if (!release) return new Response("No app release published", { status: 404 });

  const target = release.installerZipUrl
    ? "/download/install-write.zip"
    : "/download/Write.zip";
  return Response.redirect(new URL(target, request.url), 302);
}
