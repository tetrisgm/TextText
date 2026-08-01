import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isAuthConfigured } from "@/auth";
import {
  appSessionHasSyncScope,
  createAppSessionCookie,
  safeAppSessionNextPath,
} from "@/lib/app-session";
import { resolveApiToken } from "@/lib/api-tokens";

export const dynamic = "force-dynamic";

function authSecret(): string | null {
  return process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? null;
}

export async function POST(request: NextRequest) {
  if (request.headers.get("x-texttext-app") !== "1") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!isAuthConfigured || !authSecret()) {
    return NextResponse.json(
      { error: "Sign-in is not configured" },
      { status: 503 },
    );
  }

  const identity = await resolveApiToken(request.headers.get("authorization"));
  if (!identity) {
    return NextResponse.json({ error: "Sign in again" }, { status: 401 });
  }
  if (!appSessionHasSyncScope(identity.scopes)) {
    return NextResponse.json(
      { error: "This app token cannot open a workspace session" },
      { status: 403 },
    );
  }

  const secure = request.nextUrl.protocol === "https:";
  const sessionCookie = await createAppSessionCookie(identity, {
    secure,
    secret: authSecret()!,
  });
  const destination = new URL(
    safeAppSessionNextPath(request.nextUrl.searchParams.get("next")),
    request.url,
  );
  const response = new NextResponse(null, {
    status: 303,
    headers: {
      "cache-control": "no-store",
      location: destination.toString(),
    },
  });
  response.cookies.set({
    name: sessionCookie.name,
    value: sessionCookie.value,
    httpOnly: true,
    secure: sessionCookie.secure,
    sameSite: "lax",
    path: "/",
    maxAge: sessionCookie.maxAge,
  });
  return response;
}
