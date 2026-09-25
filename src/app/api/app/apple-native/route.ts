// Mac App Store Sign in with Apple. The app sends Apple's single-use code and
// nonce; the server exchanges the code with Apple and verifies the signed ID
// token before creating a TextText app token. No browser callback is involved.

import { createApiToken } from "@/lib/api-tokens";
import { exchangeNativeAppleCode } from "@/lib/native-apple-auth";
import {
  clearAccountTombstone,
  findAccountTombstone,
  getUserIdBySub,
} from "@/lib/store";
import { resumeAccountDeletion } from "@/lib/account-deletion";
import { resolveOwnedWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

const CODE_PATTERN = /^[\x21-\x7E]{8,4096}$/;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

export async function POST(request: Request): Promise<Response> {
  if (Number(request.headers.get("content-length")) > 8192) {
    return new Response("Bad sign-in request", { status: 400 });
  }
  let code: unknown;
  let nonce: unknown;
  let rawName: unknown;
  try {
    const text = await request.text();
    if (text.length > 8192) return new Response("Bad sign-in request", { status: 400 });
    const body = JSON.parse(text) as Record<string, unknown>;
    code = body.code;
    nonce = body.nonce;
    rawName = body.name;
  } catch {
    return new Response("Bad sign-in request", { status: 400 });
  }
  if (typeof code !== "string" || !CODE_PATTERN.test(code) ||
      typeof nonce !== "string" || !NONCE_PATTERN.test(nonce)) {
    return new Response("Bad sign-in request", { status: 400 });
  }

  const apple = await exchangeNativeAppleCode(code, nonce);
  if (!apple) return new Response("Apple sign-in did not complete", { status: 401 });
  const name = typeof rawName === "string"
    ? rawName.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100) || undefined
    : undefined;

  // Mirror Auth.js's intentional re-sign-in behavior after account deletion.
  const tombstone = await findAccountTombstone(apple.sub);
  if (tombstone) {
    if (!tombstone.completedAt && !(await resumeAccountDeletion(apple.sub))) {
      return new Response("Account deletion is still in progress", { status: 409 });
    }
    await clearAccountTombstone(apple.sub);
  }

  await resolveOwnedWorkspace({ sub: apple.sub, email: apple.email, name });
  const userId = await getUserIdBySub(apple.sub);
  if (!userId) return new Response("Could not complete sign-in", { status: 500 });

  const tokenName = "TextText on Mac";
  const { raw } = await createApiToken(userId, tokenName, { kind: "app" });
  return Response.json({ token: raw, tokenName }, {
    headers: { "Cache-Control": "no-store" },
  });
}
