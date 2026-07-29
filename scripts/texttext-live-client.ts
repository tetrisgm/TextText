// A minimal authenticated client for driving a local Texttext server the way
// a real agent does: NextAuth dev-login for a browser session, a wsk_ token
// minted through the app-token route, and tool calls over the hosted MCP
// endpoint speaking protocol 2026-07-28. Shared by the template showcase and
// the live generation proof so both exercise the exact same surfaces.

export const MCP_PROTOCOL_VERSION = "2026-07-28";

export class TexttextClient {
  private readonly jar = new Map<string, string>();
  private rpcId = 0;

  constructor(readonly origin: string) {}

  private storeCookies(res: Response) {
    for (const header of res.headers.getSetCookie?.() ?? []) {
      const [pair] = header.split(";");
      const eq = pair.indexOf("=");
      this.jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1));
    }
  }

  private cookieHeader() {
    return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  async http(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(`${this.origin}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), cookie: this.cookieHeader() },
      redirect: "manual",
    });
    this.storeCookies(res);
    return res;
  }

  async signIn(email: string, name: string) {
    const csrfRes = await this.http("/api/auth/csrf");
    const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
    await this.http("/api/auth/callback/dev-login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrfToken, email, name, callbackUrl: "/" }),
    });
    const session = (await (await this.http("/api/auth/session")).json()) as {
      user?: unknown;
    };
    if (!session?.user) throw new Error("dev login failed");
  }

  async mintToken(device = "live-client"): Promise<string> {
    const res = await this.http("/api/app/token", {
      method: "POST",
      headers: { "x-write-app": "1", "x-write-device": device },
    });
    const body = (await res.json()) as { token?: string; accessToken?: string };
    const token = body.token ?? body.accessToken;
    if (!token) throw new Error(`token mint failed: ${JSON.stringify(body)}`);
    return token;
  }

  async tool(
    token: string,
    name: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    this.rpcId += 1;
    const res = await fetch(`${this.origin}/api/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
        "Mcp-Method": "tools/call",
        "Mcp-Name": name,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: this.rpcId,
        method: "tools/call",
        params: {
          name,
          arguments: args,
          _meta: {
            "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION,
            "io.modelcontextprotocol/clientCapabilities": {},
            "io.modelcontextprotocol/clientInfo": {
              name: "texttext-live-client",
              version: "1",
            },
          },
        },
      }),
    });
    const body = (await res.json()) as {
      result?: { isError?: boolean; content?: { text?: string }[] };
      error?: { message?: string };
    };
    if (body.error) throw new Error(`${name}: ${body.error.message}`);
    const text = body.result?.content?.[0]?.text ?? "";
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      parsed = { error: text };
    }
    if (body.result?.isError || parsed.error) {
      throw new Error(`${name}: ${String(parsed.error ?? text).slice(0, 300)}`);
    }
    return parsed;
  }
}
