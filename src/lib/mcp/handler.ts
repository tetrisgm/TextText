// The one place the MCP route handler is assembled.
//
// MCP 2026-07-28 is stateless, so there is no server object to build and no
// per-endpoint instance to bind: one function answers every request. The
// `endpoint` argument the old mcp-handler factory needed is gone with it.

export { handleMcpRequest } from "./streamable-http";
