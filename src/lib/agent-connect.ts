import { TEXTTEXT_CLAUDE_CODE_MCP_CONFIG, TEXTTEXT_CODEX_MCP_CONFIG, TEXTTEXT_CURSOR_MCP_CONFIG } from "./agent-mcp-configs";
import { TEXTTEXT_HOSTED_MCP_URL } from "./agent-integrations";
export const AGENT_CLIENTS = ["Claude Code", "Codex", "Claude Desktop", "Cursor", "Other MCP client"] as const;
export type AgentClient = typeof AGENT_CLIENTS[number];
export function agentClient(value: unknown): AgentClient {
  if (!AGENT_CLIENTS.includes(value as AgentClient)) throw new Error("Choose an agent client");
  return value as AgentClient;
}
export function localAgentSupported(client: AgentClient): boolean {
  return client === "Claude Code" || client === "Codex" || client === "Cursor";
}
export function localAgentInstruction(itemId: string, name: string): string {
  // Arguments are JSON and shell quoted, with no item title or other untrusted content.
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  return `Use the signed-in TextText app on this Mac. Run /Applications/TextText.app/Contents/Helpers/texttext --as ${quote(name)} do read_item --args ${quote(JSON.stringify({ id: itemId }))}. Keep this --as name for this session. Read this exact item, then wait for my editing instructions. If the signed-in CLI is unavailable, report that without creating a credential or bridge.`;
}
export function remoteAgentInstruction(itemId: string, role: "read" | "edit" = "edit"): string {
  return `Use the TextText MCP connection for item ${itemId}. Call read_item with ${JSON.stringify({ id: itemId })}, then wait for my editing instructions. This connection cannot search the workspace. ${role === "read" ? "This connection is read-only." : "For edits, use update_item with a guarded section or text_edit, or append_to_item."} Never request or repeat the bearer token.`;
}
export function agentClientConfiguration(client: AgentClient, tokenId: string, origin?: string): { text: string; help: string } {
  const endpoint = origin ? `${new URL(origin).origin}/api/mcp` : TEXTTEXT_HOSTED_MCP_URL;
  const suffix = tokenId.replaceAll("-", "").toUpperCase();
  const variable = `TEXTTEXT_ITEM_${suffix}`;
  const source = client === "Codex" ? TEXTTEXT_CODEX_MCP_CONFIG : client === "Claude Code" ? TEXTTEXT_CLAUDE_CODE_MCP_CONFIG : client === "Cursor" ? TEXTTEXT_CURSOR_MCP_CONFIG : null;
  if (!source) return { text: `Endpoint: ${endpoint}\nTransport: Streamable HTTP\nAuthorization: Bearer <protected credential>`, help: "Use only a client with a protected bearer credential field. Paste the token there, never in a chat or configuration file." };
  return { text: source.replaceAll(TEXTTEXT_HOSTED_MCP_URL, endpoint).replaceAll("TEXTTEXT_WORKSPACE_TOKEN", variable).replaceAll('"texttext":', `"texttext-item-${suffix.toLowerCase()}":`).replace("add texttext --", `add texttext-item-${suffix.toLowerCase()} --`),
    help: `Store the token as ${variable} in the protected environment manager that launches ${client}. ${client === "Codex" ? "Run this non-secret configuration command." : `Save this non-secret configuration in ${client === "Cursor" ? ".cursor/mcp.json" : ".mcp.json"}, merging with any existing servers.`} Restart the client. Never replace the variable placeholder with the token.` };
}
export const OPEN_ADD_AGENT_EVENT = "texttext:open-add-agent";
