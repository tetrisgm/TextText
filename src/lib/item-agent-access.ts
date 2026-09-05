/** Item grants use the existing hashed bearer tokens, never the broad sync scope. */
export const ITEM_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export type ItemAgentAccess = { itemId: string; role: "read" | "edit" };
export function itemAgentScope(itemId: string, role: "read" | "edit"): string {
  if (!ITEM_ID_RE.test(itemId)) throw new Error("Item not found");
  return `item:${itemId}:${role}`;
}
export function hasItemAgentScope(scopes: readonly string[] = []): boolean {
  return scopes.some((scope) => scope.startsWith("item:"));
}
export function itemAgentAccess(scopes: readonly string[] = []): ItemAgentAccess | null {
  if (scopes.length !== 1) return null;
  const match = /^item:([0-9a-f-]+):(read|edit)$/.exec(scopes[0]);
  return match && ITEM_ID_RE.test(match[1])
    ? { itemId: match[1], role: match[2] as "read" | "edit" } : null;
}
/** Explicit allowlist: new tools cannot silently join an item's authority. */
export function itemAgentAllows(scopes: readonly string[], name: string, args: Record<string, unknown>): boolean {
  const access = itemAgentAccess(scopes);
  if (!access || args.id !== access.itemId) return false;
  if (name === "read_item") return true;
  if (access.role !== "edit") return false;
  if (name === "append_to_item") return true;
  if (name !== "update_item") return false;
  return Object.keys(args).every((key) => ["id", "title", "excerpt", "body", "section", "expected_section_body", "text_edit", "if_match_hash"].includes(key));
}
