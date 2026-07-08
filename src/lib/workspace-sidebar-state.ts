export const WORKSPACE_SIDEBAR_STORAGE_KEY =
  "write:workspace-sidebar-collapsed";
export const WORKSPACE_SIDEBAR_COOKIE = "wr_sidebar_collapsed";
export const WORKSPACE_SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 5;

export function parseWorkspaceSidebarCollapsed(
  value: string | null | undefined,
): boolean {
  if (value === "0") return false;
  if (value === "1") return true;
  return false;
}
