import type { Profile } from "next-auth";

/**
 * The stable subject an OAuth sign-in maps to. Apple keeps its raw sub because
 * existing users are keyed by it; the others are prefixed so no two providers
 * can ever collide on a number. GitHub profiles carry `id`, not `sub`, so the
 * account's providerAccountId is the source there.
 */
export function oauthSubjectFor(
  provider: string,
  providerAccountId: string | undefined,
  profile: Profile | undefined,
): string | null {
  if (provider === "google") return profile?.sub ? `google:${profile.sub}` : null;
  if (provider === "github") return providerAccountId ? `github:${providerAccountId}` : null;
  return profile?.sub ?? null;
}

