export const WORKSPACE_SIDEBAR_STORAGE_KEY =
  "texttext:workspace-sidebar-collapsed";
export const WORKSPACE_SIDEBAR_COOKIE = "wr_sidebar_collapsed";
export const WORKSPACE_SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 5;

export function parseWorkspaceSidebarCollapsed(
  value: string | null | undefined,
): boolean {
  if (value === "0") return false;
  if (value === "1") return true;
  return false;
}

export const WORKSPACE_SIDEBAR_WIDTH_COOKIE = "wr_sidebar_width";

/**
 * First-paint fact cache for the dragged sidebar width. The live value lives
 * in localStorage (client-only), so without this cookie the server painted
 * the default width and the whole content margin jumped when the client
 * applied the real one - the "everything moves for a moment" on every
 * reload.
 */
export function parseWorkspaceSidebarWidth(
  value: string | null | undefined,
): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  if (parsed < 220 || parsed > 420) return undefined;
  return Math.round(parsed);
}
