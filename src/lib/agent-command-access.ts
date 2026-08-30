import {
  WORKSPACE_TOOL_DEFINITIONS,
  WORKSPACE_TOOL_NAMES,
  type WorkspaceToolName,
} from "@/lib/ai/tools";

/**
 * What an agent running on this Mac may do through the local CLI.
 *
 * It was five commands, hand-listed in the route: search, read, create, update,
 * append. So "Codex, tidy up my notes folder" could not move an item, comment
 * on one, or restyle anything, and the owner's description of what agents are
 * for - work on a note the way a person would - was not reachable from the
 * surface agents actually use on this machine.
 *
 * EXPLICIT, not derived. The first version of this widening computed the set
 * from `confirmation === "none" && !openWorldHint`, which reads well and is
 * wrong: `confirmation` DEFAULTS to "none" (`tools.ts:64`). So any command
 * added later without thinking about this file would have joined the local
 * agent's authority silently. An authorization boundary must not be a side
 * effect of a defaulted annotation.
 *
 * Every command in the registry appears in exactly one of the two lists below,
 * and a test fails when one appears in neither. Adding a command is therefore a
 * decision about what an agent on this machine may do with it, made once, in
 * writing.
 */

/** Reads. Nothing here changes anything. */
const LOCAL_READS: readonly WorkspaceToolName[] = [
  "get_workspace",
  "list_folders",
  "list_items",
  "list_trash",
  "list_comments",
  "list_responses",
  "list_access",
  "list_document_templates",
  "read_item",
  "review_brief_sources",
  "search",
  // Publishes a focus event so the person's app follows the agent to the item
  // it is working on. A read of the item, and a nudge to a window the owner is
  // already looking at.
  "open_item",
];

/**
 * Writes an agent may make here: content, organisation, discussion, and looks.
 *
 * What is deliberately absent, and why, is the more useful half of this list.
 * Deleting and restoring, publishing and unpublishing, granting and revoking
 * access: each changes who can see something, or removes it, and this route
 * has no way to ask the owner first. Adding an asset and recapturing a bookmark
 * fetch a URL the model chose, which is an outbound channel a prompt injection
 * could steer. Those stay on the surfaces that can confirm.
 */
const LOCAL_WRITES: readonly WorkspaceToolName[] = [
  "create_item",
  "update_item",
  "append_to_item",
  "move_item",
  // Tagging and filing many at once. It changes how items are labelled and
  // where they live, never what they say, and every write is revision-guarded.
  "organize_items",
  "create_folder",
  "rename_folder",
  "add_comment",
  "set_comment_resolved",
  "create_item_type",
  "update_item_type",
  "save_item_as_look",
  "set_folder_template",
  "set_item_template",
];

/** Refused here, each for a reason stated above. */
export const LOCAL_AGENT_DENIED: readonly WorkspaceToolName[] = [
  "delete_item",
  // Batch deletion is confirmation-gated like the single one. It reaches this
  // machine through a staged proposal the owner approves in the app, not by
  // being executed straight off a command the agent sent.
  "delete_items",
  "empty_trash",
  "restore_item",
  "delete_folder",
  "restore_folder",
  "set_item_status",
  "set_access",
  "revoke_access",
  "retire_document_template",
  "add_item_asset",
  "remove_item_asset",
  "recapture_bookmark",
];

export const LOCAL_AGENT_COMMANDS: ReadonlySet<WorkspaceToolName> = new Set([
  ...LOCAL_READS,
  ...LOCAL_WRITES,
]);

/** Which of those a read-scoped connection may still call. */
export const LOCAL_AGENT_READ_ONLY_COMMANDS: ReadonlySet<WorkspaceToolName> =
  new Set(LOCAL_READS);

/**
 * Commands the registry has that this file has not decided about.
 *
 * Empty is the only acceptable answer, and a test says so. The point is that a
 * new command cannot reach a local agent by being forgotten.
 */
export function undecidedLocalCommands(): WorkspaceToolName[] {
  const decided = new Set<WorkspaceToolName>([
    ...LOCAL_AGENT_COMMANDS,
    ...LOCAL_AGENT_DENIED,
  ]);
  return WORKSPACE_TOOL_NAMES.filter((name) => !decided.has(name));
}

/**
 * Allowed commands that carry a confirmation or open-world flag.
 *
 * The safety property the derived version got right, kept as a check rather
 * than as the mechanism. Empty is the only acceptable answer.
 */
export function unsafeLocalAllowances(): WorkspaceToolName[] {
  return [...LOCAL_AGENT_COMMANDS].filter((name) => {
    const definition = WORKSPACE_TOOL_DEFINITIONS[name];
    return (
      definition.confirmation !== "none" || definition.annotations.openWorldHint
    );
  });
}
