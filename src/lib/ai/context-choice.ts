/** Thread metadata only. Never store titles, excerpts, or selection text here. */
export type AssistantContextChoice = {
  includeItem: boolean;
  includeSelection: boolean;
  workspaceIndex: boolean;
  itemIds: string[];
};
export const DEFAULT_CONTEXT_CHOICE: AssistantContextChoice = {
  includeItem: true, includeSelection: true, workspaceIndex: false, itemIds: [],
};
export const MAX_PERSON_CONTEXT_ITEMS = 5;
export function cleanAssistantContextChoice(value: unknown): AssistantContextChoice | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  return {
    includeItem: v.includeItem !== false,
    includeSelection: v.includeSelection !== false,
    workspaceIndex: v.workspaceIndex === true,
    itemIds: Array.isArray(v.itemIds) ? [...new Set(v.itemIds.filter(
      (id): id is string => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
    ))].slice(0, MAX_PERSON_CONTEXT_ITEMS) : [],
  };
}
