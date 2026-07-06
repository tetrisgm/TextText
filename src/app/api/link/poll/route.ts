// The app's polling half of the device link. The poll secret is the
// credential; an approved link mints the api_token exactly once, here.

import { pollDeviceLink } from "@/lib/device-link";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let pollToken = "";
  try {
    const body = (await request.json()) as { pollToken?: unknown };
    if (typeof body?.pollToken === "string") pollToken = body.pollToken.trim();
  } catch {
    // fall through to the 400 below
  }
  if (!pollToken) {
    return Response.json({ error: "pollToken is required" }, { status: 400 });
  }

  const result = await pollDeviceLink(pollToken);
  return Response.json(result);
}
