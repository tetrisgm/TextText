type ToolArguments = Record<string, unknown>;

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Translate implementation-level tool calls into one short, visible account
 * of what the agent is doing. The rail should name the writing operation, not
 * narrate retries, protocols, or provider internals.
 */
export function workspaceToolProgress(
  tool: string,
  args: ToolArguments,
): string | null {
  switch (tool) {
    case "list_folders":
      return "Finding the source folders";
    case "list_items": {
      const folder = nonEmptyString(args.folder_path);
      return folder ? `Reading items in ${folder}` : "Reading the source list";
    }
    case "search":
      return "Finding supporting passages";
    case "read_item":
      return "Reading an exact source document";
    case "review_brief_sources":
      return "Checking source versions against the claims";
    case "create_item":
      return args.template_id === "texttext.brief"
        ? "Building the sourced Living brief"
        : "Creating the new document";
    case "update_item":
      return nonEmptyString(args.section)
        ? `Updating only ${String(args.section).trim()}`
        : "Updating the requested passage";
    case "append_to_item":
      return "Adding the requested passage";
    default:
      return null;
  }
}
