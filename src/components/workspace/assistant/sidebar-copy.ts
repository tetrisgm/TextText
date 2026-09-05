import type { AssistantContext } from "./context";

export function assistantComposerPlaceholder(
  context: AssistantContext | null | undefined,
): string {
  if (context?.kind === "item") return "Ask or change this item";
  if (context?.kind === "folder") return "Ask or work with this collection";
  return "Find, create, or change anything";
}
