// The stub installer zip, published only once an installer build exists.

import { releaseInstallerUrl } from "@/lib/app-release";

export const dynamic = "force-dynamic";

export async function GET() {
  const url = releaseInstallerUrl();
  if (!url) return new Response("Not found", { status: 404 });
  return Response.redirect(url, 302);
}
