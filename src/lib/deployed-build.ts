// Whether the page you are looking at is still the build the origin serves.
//
// A Mac window keeps the bundle it loaded for as long as it stays open, so a
// deploy never reaches it. On 2026-08-27 that cost hours: a fix shipped at
// 12:33, the deployed artifact demonstrably contained it, and an app open
// since before that still showed the old behaviour at 14:15. Every "reload and
// try" is load-bearing while nothing compares the two, and every bug report is
// ambiguous about which code it describes.
//
// The comparison is kept here, away from React and the network, because the
// interesting part is the decision and it should be testable without either.

/** The build this page was compiled from. Inlined by next.config.ts. */
export const RUNNING_BUILD_ID =
  process.env.NEXT_PUBLIC_BUILD_ID ?? "development";

export type BuildComparison =
  | { state: "current" }
  /** The origin serves a different build than this page is running. */
  | { state: "stale"; running: string; serving: string }
  /** Nothing usable came back. Say nothing rather than nag. */
  | { state: "unknown" };

/**
 * A local build has no identity worth comparing: `next dev` reports
 * "development" forever while the code under it changes on every save, so a
 * mismatch there would mean nothing and a match would prove nothing.
 */
export function comparableBuild(id: string | null | undefined): string | null {
  const trimmed = typeof id === "string" ? id.trim() : "";
  if (!trimmed || trimmed === "development") return null;
  return trimmed;
}

export function compareBuild(
  running: string | null | undefined,
  serving: unknown,
): BuildComparison {
  const here = comparableBuild(running);
  const there = comparableBuild(
    typeof serving === "string"
      ? serving
      : ((serving as { buildId?: unknown } | null)?.buildId as string),
  );
  if (!here || !there) return { state: "unknown" };
  if (here === there) return { state: "current" };
  return { state: "stale", running: here, serving: there };
}
