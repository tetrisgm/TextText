// Sign-in for the native app, without the device-code detour.
//
// The app opens this in an ASWebAuthenticationSession: a system browser sheet,
// not an embedded web view, so Apple and Google both allow their sign-in pages
// in it and the person's existing Safari session usually means no typing at
// all. When the sheet lands here signed in, this hands a one-time secret back
// to the app over its registered URL scheme and the sheet closes itself.
//
// Why there is no "link this Mac?" confirmation here, when /connect/link has
// one: that page exists because a device code is typed by a human, so the
// browser cannot know which device asked, and confirming is the only thing
// standing between the person and approving a stranger's device. Here the
// secret is never shown to anyone. It goes to the redirect target and nowhere
// else, and the redirect target is not negotiable:
//
//   - The callback scheme is hard-coded below. This route MUST NOT ever read a
//     redirect_uri from the request; that single line is what keeps the secret
//     from being pointed at an attacker.
//   - macOS delivers texttext-app:// to the copy of TextText installed on that
//     machine, so only the local app can receive it.
//   - The app generates `state` and rejects any callback whose state it did not
//     issue, so a session someone else started cannot complete into a token.
//
// Which leaves the worst an attacker can do by luring somebody here: cause a
// short-lived row that only the victim's own app could ever claim, and it
// expires unclaimed.

import { getCurrentUser } from "@/lib/session";
import {
  approveDeviceLink,
  cleanAppName,
  startDeviceLink,
} from "@/lib/device-link";
import { getUserIdBySub } from "@/lib/store";
import { recordAction } from "@/lib/audit";
import { resolveOwnedWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

/** Hard-coded on purpose. See the note above before touching this. */
const CALLBACK_URL = "texttext-app://auth";

/** Opaque to us; the app is the only thing that reads it back. */
const STATE_PATTERN = /^[A-Za-z0-9._~-]{16,128}$/;

function selfPath(state: string, device: string | null): string {
  const params = new URLSearchParams({ state });
  if (device) params.set("device", device);
  return `/connect/app/native?${params.toString()}`;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  if (!STATE_PATTERN.test(state)) {
    return new Response("Bad sign-in request", { status: 400 });
  }
  const device = url.searchParams.get("device");

  const user = await getCurrentUser();
  if (!user) {
    // Straight into the normal sign-in, then back here. Every provider works
    // in this sheet, which is the entire point of using one.
    const back = selfPath(state, device);
    return new Response(null, {
      status: 303,
      headers: { Location: `/signin?callbackUrl=${encodeURIComponent(back)}` },
    });
  }

  // Same first-touch work the typed-code approval does: make sure the user and
  // a workspace exist, claiming the browser's guest blog when there is one, so
  // the app's token lands on the workspace the person can already see.
  await resolveOwnedWorkspace(user);
  const userId = await getUserIdBySub(user.sub);
  if (!userId) {
    return new Response("Could not complete sign-in", { status: 500 });
  }

  const appName = cleanAppName(device);
  const link = await startDeviceLink(appName);
  // Approving on the person's behalf is exactly what the sheet's sign-in was:
  // they signed in, in a browser they control, in a sheet this app opened.
  if (!(await approveDeviceLink(link.code, userId))) {
    return new Response("Could not complete sign-in", { status: 500 });
  }
  await recordAction({
    actorUserId: userId,
    actorType: "human",
    actionName: "approve_app_sign_in",
    targetType: "workspace",
    inputSummary: appName,
  });

  const callback = new URL(CALLBACK_URL);
  callback.searchParams.set("code", link.pollToken);
  callback.searchParams.set("state", state);
  return new Response(null, {
    status: 303,
    headers: {
      Location: callback.toString(),
      // The secret is in this URL; keep it out of shared caches.
      "Cache-Control": "no-store",
    },
  });
}
