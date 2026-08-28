const DOCUMENT_CAPABILITY_COOKIE_PREFIX = "tt_cap_";

export function documentCapabilityCookieName(itemId: string): string {
  const safe = itemId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  if (!safe) throw new Error("A valid item ID is required");
  return `${DOCUMENT_CAPABILITY_COOKIE_PREFIX}${safe}`;
}
