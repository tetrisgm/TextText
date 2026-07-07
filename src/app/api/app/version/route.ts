// The Mac app's push-channel substitute: the sync client reads the advertised
// version here and triggers a throttled Sparkle check when it is newer than
// the running build. Parsed straight from the live appcast.

import { getAdvertisedVersion } from "@/lib/app-release";

export const dynamic = "force-dynamic";

export async function GET() {
  const advertised = await getAdvertisedVersion();
  if (!advertised) {
    return Response.json({ error: "No app release published" }, { status: 404 });
  }
  return Response.json(
    { version: advertised.version, buildNumber: advertised.buildNumber },
    { headers: { "Cache-Control": "public, max-age=120" } },
  );
}
