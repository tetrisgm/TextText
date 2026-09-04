// Which modifier means "add this one to the selection".
//
// On a Mac it is OPTION (the same key others label alt). Not Cmd, which now
// opens a background tab the way it opens any link, and not Ctrl, which is
// macOS's secondary-click alias and would raise a context menu on every pick.
// Elsewhere Ctrl is the platform norm and carries no such baggage, so both
// are accepted and each is right where it runs.

type ClickModifiers = {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
};

function onApplePlatform(): boolean {
  if (typeof navigator === "undefined") return true;
  const source =
    (navigator as { userAgentData?: { platform?: string } }).userAgentData
      ?.platform ??
    navigator.platform ??
    navigator.userAgent ??
    "";
  return /mac|iphone|ipad|ipod/i.test(source);
}

/** Toggle this row in the selection without disturbing the rest. */
export function isSelectionToggleClick(event: ClickModifiers): boolean {
  if (event.altKey) return true;
  return !onApplePlatform() && event.ctrlKey;
}

/** Extend the selection from the anchor to this row. */
export function isSelectionRangeClick(event: ClickModifiers): boolean {
  return event.shiftKey;
}

/** Open in a background tab, as Cmd or Ctrl click opens a link elsewhere. */
export function isNewTabClick(event: ClickModifiers & { button: number }): boolean {
  if (event.button !== 0) return false;
  if (event.altKey || event.shiftKey) return false;
  return onApplePlatform() ? event.metaKey : event.ctrlKey;
}
