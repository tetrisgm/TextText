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
/**
 * URLs are tiny (a long one is ~100 bytes), so depth here is nearly free and
 * this is the number that decides how far back a relaunched app can walk.
 * 200 steps is well under any storage concern and past what a session uses.
 */
const MAX_ENTRIES = 200;

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

// The visit log: every view the person actually landed on, in order, append
// only. This is NOT the back-stack. The browser's stack truncates the forward
// entries every time you go somewhere new, so open A, back, open B, back
// leaves nothing behind you even though you looked at A a moment ago. The log
// remembers that, and a back gesture falls through to it once the real stack
// is exhausted, which is what makes a branching session retraceable.
const VISIT_PREFIX = "texttext:visit-log:";
/** Hrefs are small; this is a long session's worth without being unbounded. */
const MAX_VISITS = 300;

export type VisitLog = {
  /** Landed hrefs in the order they were visited, oldest first. */
  entries: string[];
  /** Where a back-walk has reached; the end of the list when idle. */
  cursor: number;
};

export function readVisitLog(scope: string): VisitLog {
  try {
    const raw = window.localStorage.getItem(`${VISIT_PREFIX}${scope}`);
    if (!raw) return { entries: [], cursor: -1 };
    const parsed = JSON.parse(raw) as Partial<VisitLog>;
    if (!parsed || !Array.isArray(parsed.entries)) return { entries: [], cursor: -1 };
    const entries: string[] = [];
    for (let i = 0; i < parsed.entries.length; i += 1) {
      const entry = parsed.entries[i];
      if (typeof entry !== "string") return { entries: [], cursor: -1 };
      entries.push(entry);
    }
    const cursor =
      typeof parsed.cursor === "number" &&
      parsed.cursor >= -1 &&
      parsed.cursor < entries.length
        ? parsed.cursor
        : entries.length - 1;
    return { entries, cursor };
  } catch {
    return { entries: [], cursor: -1 };
  }
}

export function writeVisitLog(scope: string, log: VisitLog): void {
  try {
    let { entries, cursor } = log;
    for (let i = 0; i < entries.length; i += 1) {
      if (typeof entries[i] !== "string") return;
    }
    if (entries.length > MAX_VISITS) {
      const drop = entries.length - MAX_VISITS;
      entries = entries.slice(drop);
      cursor = Math.max(-1, cursor - drop);
    }
    window.localStorage.setItem(
      `${VISIT_PREFIX}${scope}`,
      JSON.stringify({ entries, cursor }),
    );
  } catch {
    /* private mode or quota: the visit log is a convenience */
  }
}
