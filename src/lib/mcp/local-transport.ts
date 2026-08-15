// Reaching an MCP server running on this Mac.
//
// The hosted assistant cannot: a server in a data centre fetching 127.0.0.1
// reaches its own container. The browser cannot either, because an https page
// fetching http://127.0.0.1 is mixed content. So in the Mac app the request is
// handed to Swift, which has neither problem, and comes back through the same
// event channel the native assistant already uses.
//
// This module is the transport only. What it returns is a raw JSON-RPC reply,
// parsed by the same code that reads a hosted server's, so a local server and a
// remote one are the same thing to everything above.

export type LocalMcpWindow = Window & {
  __TEXTTEXT_APP__?: boolean;
  webkit?: {
    messageHandlers?: {
      textTextApp?: { postMessage: (message: unknown) => void };
    };
  };
};

/** Loopback, and therefore only reachable from the app on that machine. */
export function isLoopbackUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  return (
    host === "127.0.0.1" ||
    host === "localhost" ||
    host === "::1" ||
    host === "[::1]" ||
    host.endsWith(".localhost")
  );
}

export function localMcpAvailable(): boolean {
  if (typeof window === "undefined") return false;
  const current = window as LocalMcpWindow;
  return (
    current.__TEXTTEXT_APP__ === true &&
    Boolean(current.webkit?.messageHandlers?.textTextApp)
  );
}

const REQUEST_TIMEOUT_MS = 30_000;
let counter = 0;

type BridgeEvent = {
  type?: string;
  requestId?: string;
  text?: string;
  error?: string;
};

/**
 * One request to a local server, through Swift.
 *
 * Each call carries its own id and listens for exactly that id, because two
 * tool calls can be in flight at once and the event channel is shared with the
 * native assistant's own traffic.
 */
export function sendLocalMcpRequest(
  url: string,
  body: Record<string, unknown>,
  options: { token?: string | null; headers?: Record<string, string> } = {},
): Promise<string> {
  if (!localMcpAvailable()) {
    return Promise.reject(
      new Error("A server on this Mac can only be reached from the TextText Mac app."),
    );
  }
  if (!isLoopbackUrl(url)) {
    return Promise.reject(new Error("That address is not on this Mac."));
  }

  const handler = (window as LocalMcpWindow).webkit?.messageHandlers?.textTextApp;
  if (!handler) {
    return Promise.reject(new Error("The Mac app bridge is unavailable."));
  }

  counter += 1;
  const requestId = `local-mcp-${counter}-${Date.now()}`;

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.removeEventListener("texttext:assistant", onEvent as EventListener);
      fn();
    };

    const onEvent = (event: Event) => {
      const detail = (event as CustomEvent<BridgeEvent>).detail;
      if (detail?.type !== "local-mcp-response") return;
      if (detail.requestId !== requestId) return;
      if (typeof detail.error === "string") {
        finish(() => reject(new Error(detail.error as string)));
        return;
      }
      finish(() => resolve(typeof detail.text === "string" ? detail.text : ""));
    };

    const timer = window.setTimeout(() => {
      finish(() => reject(new Error("That server did not answer.")));
    }, REQUEST_TIMEOUT_MS);

    window.addEventListener("texttext:assistant", onEvent as EventListener);
    handler.postMessage({
      action: "localMcpRequest",
      requestId,
      url,
      body,
      token: options.token ?? null,
      headers: options.headers ?? {},
    });
  });
}
