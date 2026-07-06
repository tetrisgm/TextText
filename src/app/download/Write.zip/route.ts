// Stable app-zip URL: the appcast and the docs may link here forever while
// the pointer decides which immutable versioned Blob URL is current.

import { getCurrentAppRelease } from "@/lib/app-release";

export const dynamic = "force-dynamic";

export async function GET() {
  const release = await getCurrentAppRelease();
  if (!release) return new Response("No app release published", { status: 404 });
  return Response.redirect(release.zipUrl, 302);
}
