// Local MCP tools, for the assistant rung that runs inside the Mac app.
//
// The hosted assistant executes its tools on our server, which is why a server
// on your own machine is invisible to it. The native rung executes tools in the
// app's web view, on your machine, so it is the only place a local server can
// be used at all. Same namespacing and same untrusted-data framing as the
// hosted side, because a server being local makes it convenient, not trusted.

import {
  callLocalTool,
  listLocalTools,
  localMcpAvailable,
  type LocalConnection,
} from "@/lib/mcp/local-client";
import { isLoopbackUrl } from "@/lib/mcp/local-transport";
import {
  describeRemoteTool,
  remoteToolName,
  type RemoteTool,
} from "@/lib/mcp/outbound-protocol";

export type LocalToolDefinition = {
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

/**
 * Discover what the local servers offer and build the tool set.
 *
 * A server that is not running is the normal case, not an error: the design app
 * is closed. It is reported so the assistant can say "Paper is not running"
 * instead of behaving as though the capability never existed.
 */
export async function loadLocalTools(
  connections: LocalConnection[],
): Promise<LocalToolSet> {
  if (!localMcpAvailable() || connections.length === 0) return EMPTY;

  const definitions: LocalToolDefinition[] = [];
  const connectionNames: string[] = [];
  const unreachable: string[] = [];
  const routes = new Map<string, { connection: LocalConnection; tool: string }>();

  await Promise.all(
    connections.map(async (connection) => {
      try {
        const { tools } = await listLocalTools(connection);
        if (tools.length === 0) return;
        connectionNames.push(connection.name);
        for (const tool of tools) {
          const name = remoteToolName(connection.name, tool.name);
          routes.set(name, { connection, tool: tool.name });
          definitions.push({
            name,
            description: describeRemoteTool(connection.name, tool as RemoteTool),
            inputSchema: tool.inputSchema,
          });
        }
      } catch {
        unreachable.push(connection.name);
      }
    }),
  );

  return {
    definitions,
    connectionNames,
    unreachable,
    run: (name, args) => {
      const route = routes.get(name);
      if (!route) return null;
      return callLocalTool(route.connection, route.tool, args).then((result) => {
        if (result.status === "input_required") {
          const asked = result.asked.length
            ? ` It asked: ${result.asked.join("; ")}`
            : "";
          return `NOT DONE. ${route.connection.name} needs more information before it can run this.${asked} Tell the person what was asked for; do not claim the action happened.`;
        }
        return result.text;
      });
    },
  };
}

export { isRemoteToolName } from "@/lib/mcp/outbound-protocol";
