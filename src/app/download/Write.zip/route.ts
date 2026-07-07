// Stable app-zip URL: redirects to the current "latest" Blob zip. The appcast
// references the immutable per-version zip directly; this is the human link.

import { releaseZipUrl } from "@/lib/app-release";

export const dynamic = "force-dynamic";

export async function GET() {
  const url = releaseZipUrl();
  if (!url) return new Response("No app release published", { status: 404 });
  return Response.redirect(url, 302);
}
