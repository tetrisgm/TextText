// Sparkle's feed URL, served on the product domain. Proxies the signed appcast
// from its fixed Blob path so SUFeedURL stays one stable committed URL.

import { releaseAppcastUrl } from "@/lib/app-release";

export const dynamic = "force-dynamic";

export async function GET() {
  const url = releaseAppcastUrl();
  if (!url) return new Response("Not found", { status: 404 });
  try {
    const upstream = await fetch(url, { cache: "no-store" });
    if (!upstream.ok) return new Response("Appcast unavailable", { status: 502 });
    return new Response(await upstream.text(), {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch {
    return new Response("Appcast unavailable", { status: 502 });
  }
}
