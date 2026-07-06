// Stable stub-installer URL. The installer zip is rebuilt rarely (it always
// downloads the latest payload at run time), so the pointer's installer URL
// is optional and this route 404s until one has been published.

import { getCurrentAppRelease } from "@/lib/app-release";

export const dynamic = "force-dynamic";

export async function GET() {
  const release = await getCurrentAppRelease();
  if (!release?.installerZipUrl) {
    return new Response("No installer published", { status: 404 });
  }
  return Response.redirect(release.installerZipUrl, 302);
}
