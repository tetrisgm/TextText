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
    // A sparse or malformed trail must NEVER overwrite a good stored one.
    // JSON turns an array hole into null, readNavTrail rejects null entries,
    // and the person's whole back/forward history is gone. That happened on
    // every reload: the in-memory trail starts empty and only the current
    // index gets filled in, leaving holes in front of it. Refuse the write
    // instead, and let the next real navigation rebuild a dense trail.
    // Index-read the array rather than .some(): some() SKIPS holes.
    for (let i = 0; i < trail.entries.length; i += 1) {
      if (typeof trail.entries[i] !== "string") return;
    }
    if (
      trail.entries.length === 0 ||
      !Number.isInteger(trail.index) ||
      trail.index < 0 ||
      trail.index >= trail.entries.length
    ) {
      return;
    }
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

// Remembered scroll positions, keyed by the same view keys the shell uses
// (list views by section, items by post id). Persisted so reopening an item
// after a quit resumes where the reading left off.
const SCROLL_PREFIX = "texttext:scroll-memory:";
/** Enough for a long session; oldest entries fall off first. */
const MAX_SCROLL_ENTRIES = 120;

export function readScrollMemory(scope: string): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(`${SCROLL_PREFIX}${scope}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        out[key] = value;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function writeScrollMemory(
  scope: string,
  entries: Record<string, number>,
): void {
  try {
    let pairs = Object.entries(entries).filter(
      ([, top]) => Number.isFinite(top) && top > 0,
    );
    if (pairs.length > MAX_SCROLL_ENTRIES) {
      pairs = pairs.slice(pairs.length - MAX_SCROLL_ENTRIES);
    }
    window.localStorage.setItem(
      `${SCROLL_PREFIX}${scope}`,
      JSON.stringify(Object.fromEntries(pairs)),
    );
  } catch {
    /* private mode or quota: scroll memory is a convenience */
  }
}
