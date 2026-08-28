// Local MCP tools are intentionally disabled.
//
// The former native path executed a third-party tool inside an agent turn and
// bypassed the durable exact-argument review used for hosted outbound MCP. A
// local address is not a trust boundary, so the standalone app exposes no
// local tool definitions until it can use the same durable proposal surface.

/**
 * A connection only the Mac app can reach.
 *
 * Was its own module with a full JSON-RPC client beside it. The loopback
 * client is retired (agents on this Mac use the texttext CLI), and once its
 * three functions went, the file was one type, a dead private helper, and a
 * re-export nobody imported. The type lives here now, with its only user.
 */
type LocalConnection = {
  id: string;
  name: string;
  url: string;
  token?: string | null;
};
import { isLoopbackUrl } from "@/lib/mcp/local-transport";

type LocalToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type LocalToolSet = {
  definitions: LocalToolDefinition[];
  /** Connection names whose tools are in play, for the system note. */
  connectionNames: string[];
  /** Names that did not answer, so the assistant can say so. */
  unreachable: string[];
  /** Run one, by its namespaced name. Null when the name is not ours. */
  run: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<string> | null;
};

const EMPTY: LocalToolSet = {
  definitions: [],
  connectionNames: [],
  unreachable: [],
  run: () => null,
};

/** The connections only this Mac can reach, from what Settings already returns. */
export function localConnectionsFrom(
  connections: ReadonlyArray<{
    id: string;
    name: string;
    url: string;
    enabled: boolean;
  }>,
): LocalConnection[] {
  return connections
    .filter((entry) => entry.enabled && isLoopbackUrl(entry.url))
    .map((entry) => ({ id: entry.id, name: entry.name, url: entry.url }));
}

/** Disabled until local external calls can use durable owner review. */
export async function loadLocalTools(
  connections: LocalConnection[],
): Promise<LocalToolSet> {
  void connections;
  return EMPTY;
}

export { isRemoteToolName } from "@/lib/mcp/outbound-protocol";
