import { TEXTTEXT_HOSTED_MCP_URL } from "./agent-integrations";

export const TEXTTEXT_CODEX_MCP_CONFIG = `codex mcp add texttext --url ${TEXTTEXT_HOSTED_MCP_URL} --bearer-token-env-var TEXTTEXT_WORKSPACE_TOKEN`;

export const TEXTTEXT_CLAUDE_CODE_MCP_CONFIG = `{
  "mcpServers": {
    "texttext": {
      "type": "http",
      "url": "${TEXTTEXT_HOSTED_MCP_URL}",
      "headers": {
        "Authorization": "Bearer \${TEXTTEXT_WORKSPACE_TOKEN}"
      }
    }
  }
}`;

export const TEXTTEXT_CURSOR_MCP_CONFIG = `{
  "mcpServers": {
    "texttext": {
      "url": "${TEXTTEXT_HOSTED_MCP_URL}",
      "headers": {
        "Authorization": "Bearer \${env:TEXTTEXT_WORKSPACE_TOKEN}"
      }
    }
  }
}`;

export const TEXTTEXT_VSCODE_MCP_CONFIG = `{
  "inputs": [
    {
      "type": "promptString",
      "id": "texttext-token",
      "description": "TextText workspace token",
      "password": true
    }
  ],
  "servers": {
    "texttext": {
      "type": "http",
      "url": "${TEXTTEXT_HOSTED_MCP_URL}",
      "headers": {
        "Authorization": "Bearer \${input:texttext-token}"
      }
    }
  }
}`;
