import { encode } from "@auth/core/jwt";
import type { ApiTokenIdentity } from "@/lib/api-tokens";

const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export type AppSessionCookie = {
  name: string;
  value: string;
  maxAge: number;
  secure: boolean;
};

export function appSessionCookieName(secure: boolean): string {
  return `${secure ? "__Secure-" : ""}authjs.session-token`;
}

export function safeAppSessionNextPath(value: string | null): string {
  if (
    !value ||
    value.length > 2_048 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  ) {
    return "/start?to=home";
  }
  return value;
}

export function appSessionHasSyncScope(scopes: string): boolean {
  return scopes.split(/\s+/).includes("sync");
}

export async function createAppSessionCookie(
  identity: Pick<ApiTokenIdentity, "sub" | "userId">,
  options: { secure: boolean; secret: string | string[] },
): Promise<AppSessionCookie> {
  const name = appSessionCookieName(options.secure);
  const value = await encode({
    salt: name,
    secret: options.secret,
    maxAge: SESSION_MAX_AGE_SECONDS,
    token: {
      sub: identity.sub,
      userId: identity.userId,
    },
  });
  return {
    name,
    value,
    maxAge: SESSION_MAX_AGE_SECONDS,
    secure: options.secure,
  };
}
