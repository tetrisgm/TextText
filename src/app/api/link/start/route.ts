// Start a device link: the app calls this, keeps the poll secret, and opens
// the verify URL in the owner's browser. Unauthenticated by design (the app
// has no credential yet); the short TTL, single-use code, and the fact that
// approval happens in a signed-in browser session bound the risk.

import { isAuthConfigured } from "@/auth";
import {
  DEVICE_LINK_TTL_SECONDS,
  cleanAppName,
  startDeviceLink,
} from "@/lib/device-link";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isAuthConfigured) {
    return Response.json(
      { error: "Linking requires the server to have sign-in configured" },
      { status: 503 },
    );
  }

  let name = "A device";
  try {
    const body = (await request.json()) as { name?: unknown };
    name = cleanAppName(body?.name);
  } catch {
    // No body is fine; the default name stands.
  }

  const link = await startDeviceLink(name);
  const origin = new URL(request.url).origin;
  return Response.json({
    code: link.code,
    pollToken: link.pollToken,
    verifyUrl: `${origin}/connect/link?code=${encodeURIComponent(link.code)}`,
    expiresAt: link.expiresAt.toISOString(),
    interval: 3,
  });
}
