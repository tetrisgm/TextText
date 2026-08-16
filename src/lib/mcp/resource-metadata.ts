// Shared CORS shape for the discovery documents an MCP client may fetch before
// it has a token.
//
// This module used to serve RFC 9728 protected-resource metadata, whose whole
// job was to point a client at an OAuth authorization server so it could walk
// register, authorize and token on its own. TextText no longer runs one (owner
// ruling 2026-08-15): an agent authenticates with a workspace token you create
// and paste. Advertising an authorization server that does not exist would send
// every well-behaved client down a chain that dead-ends in a 404.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, MCP-Protocol-Version",
} as const;

export function metadataOptionsResponse(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export { CORS_HEADERS };
