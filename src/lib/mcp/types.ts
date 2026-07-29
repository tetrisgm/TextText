// The MCP shapes this server actually uses.
//
// These came from `@modelcontextprotocol/sdk` until 0.151. That package models
// the pre-2026-07-28 protocol: a stateful `McpServer` you register onto, an
// `initialize` handshake, and a session. None of that exists any more, so the
// only thing we were importing was five type aliases, and carrying a whole SDK
// for them meant the obsolete protocol stayed in the dependency tree and in
// every editor's autocomplete. They are written out here instead.
//
// The wire contract lives in protocol.ts. This file is only the shapes the tool
// layer passes around.

/** A verified bearer token. `extra` carries the workspace identity the tool
 * layer resolves permissions from; nothing here is client-supplied. */
export type AuthInfo = {
  token: string;
  clientId: string;
  scopes: string[];
  expiresAt?: number;
  extra?: Record<string, unknown>;
};

export type TextContent = { type: "text"; text: string };

export type ImageContent = {
  type: "image";
  data: string;
  mimeType: string;
};

export type ResourceLinkContent = {
  type: "resource_link";
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
};

export type ContentBlock = TextContent | ImageContent | ResourceLinkContent;

/** The result of `tools/call`. The transport wraps this with `resultType` and
 * `serverInfo` before it goes on the wire. */
export type CallToolResult = {
  content: ContentBlock[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
};

/** Behavioral hints on a tool. The spec is explicit that these are untrusted
 * from an untrusted server, so they are advisory for clients and never a
 * permission decision here. */
export type ToolAnnotations = {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

/** A resource whose URI carries `{variable}` segments, such as
 * `texttext://items/{id}`. The SDK had a class for this; a template is a
 * string, so this is one. */
export class ResourceTemplate {
  constructor(readonly uriTemplate: string) {}
  toString() {
    return this.uriTemplate;
  }
}

/** What `registerAgentSurface` declares into. `registry.ts` implements it for
 * real; the release gate implements it with a counter. */
export type CapabilityCollector = {
  registerResource(
    name: string,
    uriOrTemplate: string | ResourceTemplate,
    config: { title?: string; description?: string; mimeType?: string },
    handler: (
      uri: URL,
      variablesOrExtra: unknown,
      maybeExtra?: unknown,
    ) => Promise<{ contents: unknown[] }>,
  ): void;
  registerPrompt(
    name: string,
    config: {
      title?: string;
      description?: string;
      argsSchema?: Record<string, unknown>;
    },
    handler: (args: Record<string, string>) => Promise<{ messages: unknown[] }>,
  ): void;
};
