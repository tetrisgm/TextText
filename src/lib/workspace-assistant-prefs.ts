// First-paint memory for the assistant rail.
//
// The rail's resolved state (pinned or hidden) is a mix of an explicit choice
// in localStorage and a window-width default that is deliberately never
// persisted (a window size is a fact about right now, not a decision - see
// the note in PostWorkspaceShell). The server knows neither, so SSR used to
// paint every workspace without the rail and hydration popped it in, resizing
// the document the person had already started reading.
//
// This cookie is a FACT CACHE, not a preference: the client records what this
// browser last resolved, and the server paints that first. The client still
// recomputes on every load exactly as before; a stale cookie (window resized
// since last visit) costs one corrective reflow instead of being wrong.

export const WORKSPACE_ASSISTANT_STATE_COOKIE = "wr_assistant_state";
export const WORKSPACE_ASSISTANT_WIDTH_COOKIE = "wr_assistant_width";
export const WORKSPACE_ASSISTANT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Wide bounds; the client clamps again with the live constants. */
const WIDTH_FLOOR = 200;
const WIDTH_CEILING = 800;

export function parseAssistantStateCookie(
  value: string | null | undefined,
): "hidden" | "pinned" | null {
  if (value === "hidden" || value === "pinned") return value;
  return null;
}

export function parseAssistantWidthCookie(
  value: string | null | undefined,
): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed);
  if (rounded < WIDTH_FLOOR || rounded > WIDTH_CEILING) return null;
  return rounded;
}
