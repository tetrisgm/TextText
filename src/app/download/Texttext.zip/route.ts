// Stable app-zip URL: redirects to the current immutable Texttext release.

import { releaseZipUrl } from "@/lib/app-release";

export const dynamic = "force-dynamic";

export async function GET() {
  const url = releaseZipUrl();
  if (!url) return new Response("No app release published", { status: 404 });
  return Response.redirect(url, 302);
}
