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
 * Derived from the same two properties the browser assistant already screens
 * itself on. A command is available when it is not confirmation-gated and does
 * not fetch a URL the model chose. That keeps delete, publish, restore,
 * sharing and the two bookmark-fetching commands out, for the reasons those
 * flags exist.
 *
 * Derived rather than listed so it cannot drift: a command joins this surface
 * by declaring what it is, not by someone remembering to edit a list. The old
 * list had already drifted - it allowed `search` and `read_item` for a
 * read-scoped token and nothing else, so any further read command would have
 * been refused with "cannot change the workspace".
 *
 * This is the authority for both the route and its checks. Asserting against
 * the route's SOURCE TEXT was how the previous check worked, and it passed on
 * the presence of five string literals rather than on what the route does.
 */
export const LOCAL_AGENT_COMMANDS: ReadonlySet<WorkspaceToolName> = new Set(
  WORKSPACE_TOOL_NAMES.filter((name) => {
    const definition = WORKSPACE_TOOL_DEFINITIONS[name];
    return (
      definition.confirmation === "none" && !definition.annotations.openWorldHint
    );
  }),
);

/** Which of those a read-scoped connection may still call. */
export const LOCAL_AGENT_READ_ONLY_COMMANDS: ReadonlySet<WorkspaceToolName> =
  new Set(
    [...LOCAL_AGENT_COMMANDS].filter(
      (name) => WORKSPACE_TOOL_DEFINITIONS[name].mutability === "read",
    ),
  );
