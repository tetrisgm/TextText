// Is this request being served from the developer's own machine?
//
// Its own module so it can be tested without loading Auth.js, and so the rule
// has one definition rather than one per caller.

/**
 * True for the hosts a developer's own machine answers on.
 *
 * Handles the three shapes a Host header actually takes: a name with an
 * optional port, a bracketed IPv6 literal with an optional port, and a bare
 * IPv6 literal. Splitting naively on ":" turns "::1" into an empty string and
 * "[::1]:3000" into "[", so both would be read as public.
 */
export function isLoopbackHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const trimmed = host.trim().toLowerCase();
  if (!trimmed) return false;

  const bracketed = trimmed.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketed) return bracketed[1] === "::1";

  // A bare IPv6 literal: more than one colon and no brackets.
  if (trimmed.indexOf(":") !== trimmed.lastIndexOf(":")) {
    return trimmed === "::1";
  }

  const name = trimmed.split(":")[0] ?? "";
  return (
    name === "localhost" ||
    name === "127.0.0.1" ||
    name.endsWith(".localhost")
  );
}
