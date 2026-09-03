// Durable back/forward trail across app quit and reopen.
//
// The swipe navigates the browser's session history (history.back/forward
// keyed by a ttNavIndex in each entry's state). That history survives a
// reload but NOT a fresh app launch: the Mac shell reopens with a new
// webView.load, so the back-stack is empty and a swipe has nowhere to go.
//
// So the sequence of visited view URLs is mirrored to localStorage as it
// changes, and on launch - when the loaded URL matches where the person left
// off - the browser back-stack is rebuilt from it by replaying pushState
// (the same raw pushState navigateToView already uses). After that the
// ordinary swipe walks the real trail again, no special cases downstream.

const KEY_PREFIX = "texttext:nav-trail:";
/** URLs are tiny; a few dozen steps is plenty and bounds the stored size. */
const MAX_ENTRIES = 50;

export type NavTrail = {
  /** Visited hrefs, indexed by ttNavIndex. */
  entries: string[];
  /** Where in `entries` the person currently is. */
  index: number;
};

function keyFor(scope: string): string {
  return `${KEY_PREFIX}${scope}`;
}

export function readNavTrail(scope: string): NavTrail | null {
  try {
    const raw = window.localStorage.getItem(keyFor(scope));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<NavTrail>;
    if (
      !parsed ||
      !Array.isArray(parsed.entries) ||
      typeof parsed.index !== "number" ||
      parsed.entries.some((e) => typeof e !== "string")
    ) {
      return null;
    }
    if (parsed.index < 0 || parsed.index >= parsed.entries.length) return null;
    return { entries: parsed.entries as string[], index: parsed.index };
  } catch {
    return null;
  }
}

export function writeNavTrail(scope: string, trail: NavTrail): void {
  try {
    // Keep the most recent window if the trail grows long, re-basing the
    // index so it still points at the current entry.
    let { entries, index } = trail;
    if (entries.length > MAX_ENTRIES) {
      const drop = entries.length - MAX_ENTRIES;
      entries = entries.slice(drop);
      index = Math.max(0, index - drop);
    }
    window.localStorage.setItem(
      keyFor(scope),
      JSON.stringify({ entries, index }),
    );
  } catch {
    /* private mode, quota, or no storage: the trail is a convenience */
  }
}
