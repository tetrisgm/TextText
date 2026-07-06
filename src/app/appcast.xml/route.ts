// Sparkle's feed URL, served on the product domain. The release script
// uploads the signed appcast to Blob next to the zip; this route proxies the
// current release's appcast so SUFeedURL stays one stable committed URL.

import { getCurrentAppRelease } from "@/lib/app-release";

export const dynamic = "force-dynamic";

export async function GET() {
  const release = await getCurrentAppRelease();
  if (!release) return new Response("Not found", { status: 404 });

  let upstream: Response;
  try {
    upstream = await fetch(release.appcastUrl, { cache: "no-store" });
  } catch {
    return new Response("Appcast unavailable", { status: 502 });
  }
  if (!upstream.ok) return new Response("Appcast unavailable", { status: 502 });

  return new Response(await upstream.text(), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
