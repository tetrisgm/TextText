// The Mac app's push-channel substitute: the sync client already talks to
// this server constantly, so instead of a long-poll it reads the advertised
// version here and triggers a throttled Sparkle check when the pointer is
// strictly newer than the running build.

import { getCurrentAppRelease } from "@/lib/app-release";

export const dynamic = "force-dynamic";

export async function GET() {
  const release = await getCurrentAppRelease();
  if (!release) {
    return Response.json({ error: "No app release published" }, { status: 404 });
  }

  return Response.json(
    { version: release.version, buildNumber: release.buildNumber },
    { headers: { "Cache-Control": "public, max-age=120" } },
  );
}
