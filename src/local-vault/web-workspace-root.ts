/** Extract routing identity without changing the account-scoped storage root. */
export function workspaceIdFromWebRoot(root: string | null | undefined): string | null {
  if (typeof root !== "string" || !root.startsWith("vault:") || root.length > 1024) return null;
  const scope = root.slice("vault:".length);
  const valid = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
  if (!scope.startsWith("[")) return valid(scope) ? scope : null;
  try {
    const tuple: unknown = JSON.parse(scope);
    return Array.isArray(tuple) && tuple.length === 2 && tuple.every(valid) ? tuple[1] : null;
  } catch { return null; }
}
