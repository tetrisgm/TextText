export const API_TOKEN_KINDS = [
  "manual",
  "mcp",
  "cli",
  "native",
  "app",
  "other",
] as const;

export type ApiTokenKind = (typeof API_TOKEN_KINDS)[number];

export function apiTokenKindLabel(kind: ApiTokenKind): string {
  switch (kind) {
    case "mcp":
      return "Hosted MCP client";
    case "cli":
      return "TextText CLI";
    case "native":
      return "Native agent";
    case "app":
      return "TextText app";
    case "other":
      return "Other client";
    case "manual":
    default:
      return "Workspace token";
  }
}
