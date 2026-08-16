"use client";

// The workspace's outbound MCP connections: servers the assistant may call.
//
// The switch is the consent, so it reads like one. A saved connection sits off
// until the owner turns it on, and the copy says plainly what turning it on
// means, because "connected" and "allowed to act on my documents' behalf" are
// different promises and only one of them is being made by saving a URL.

import { useCallback, useEffect, useState, useTransition } from "react";
import {
  addMcpConnectionAction,
  getMcpConnectionsAction,
  refreshMcpConnectionAction,
  removeMcpConnectionAction,
  setMcpConnectionEnabledAction,
  type McpConnectionsState,
} from "@/app/editor/mcp-connection-actions";
import type { McpConnectionView } from "@/lib/mcp/outbound.server";
import { ConfirmationDialog } from "@/components/ConfirmationDialog";
import styles from "./McpConnections.module.css";

/**
 * Servers worth offering by name, so adding one is not a memory test.
 *
 * A bare URL field assumes you know Linear's MCP address, which nobody does.
 * The local ones carry the address their desktop app listens on; they only
 * work from the Mac app, because a hosted TextText fetching 127.0.0.1 reaches
 * its own machine, not yours. Saying that here is better than letting somebody
 * paste it into the web app and conclude the feature is broken.
 */
const KNOWN_SERVERS: ReadonlyArray<{
  name: string;
  url: string;
  hint: string;
  local?: boolean;
}> = [
  {
    name: "Paper",
    url: "http://127.0.0.1:29979/mcp",
    hint: "Runs inside the Paper desktop app",
    local: true,
  },
  {
    name: "Linear",
    url: "https://mcp.linear.app/mcp",
    hint: "Needs an API key from Linear settings",
  },
  {
    name: "Sentry",
    url: "https://mcp.sentry.dev/mcp",
    hint: "Needs an auth token",
  },
];

/** Loopback, and therefore Mac-app-only and token-free. */
function isLocalAddress(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return (
      host === "127.0.0.1" ||
      host === "localhost" ||
      host === "::1" ||
      host.endsWith(".localhost")
    );
  } catch {
    return false;
  }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function checkedAgo(value: string | null): string {
  if (!value) return "Not checked yet";
  const when = new Date(value);
  if (Number.isNaN(when.getTime())) return "Not checked yet";
  return `Checked ${when.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })}`;
}

export function McpConnections({ handle }: { handle: string }) {
  const [state, setState] = useState<McpConnectionsState | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<McpConnectionView | null>(null);
  // The switch answers the click, not the network. A controlled checkbox whose
  // checked state only moves once the server replies reads as a dead control
  // for the length of a round trip, which is how a working feature gets
  // reported as broken. The override is dropped as soon as the server's own
  // answer arrives, so the truth still comes from the database.
  const [pendingEnabled, setPendingEnabled] = useState<Record<string, boolean>>(
    {},
  );
  const [, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await getMcpConnectionsAction(handle);
        if (!cancelled) setState(next);
      } catch {
        if (!cancelled) setState({ allowed: false, connections: [] });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [handle]);

  const run = useCallback(
    async (work: () => Promise<McpConnectionsState>, fallback: string) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        setState(await work());
      } catch (caught) {
        setError(errorMessage(caught, fallback));
      } finally {
        setBusy(false);
        setPendingEnabled({});
      }
    },
    [busy],
  );

  if (!state?.allowed) return null;

  const connections = state.connections;

  return (
    <section className={styles.section} aria-labelledby="settings-mcp">
      <div className={styles.header}>
        <div>
          <h2 id="settings-mcp">Connected MCP servers</h2>
          <p>
            Tools from other apps, available to your assistant. Figma, a
            calendar, anything that speaks MCP.
          </p>
        </div>
        {!adding && (
          <button
            type="button"
            className="ac-btn ac-btn-gray"
            onClick={() => {
              setAdding(true);
              setError(null);
            }}
          >
            Add server
          </button>
        )}
      </div>

      {connections.length === 0 && !adding && (
        <p className={styles.empty}>
          Nothing connected. Your assistant works on this workspace only.
        </p>
      )}

      {connections.length > 0 && (
        <ul className={styles.list}>
          {connections.map((connection) => (
            <li className={styles.row} key={connection.id}>
              <div className={styles.rowMain}>
                <div className={styles.rowHead}>
                  <span className={styles.rowName}>{connection.name}</span>
                  {(pendingEnabled[connection.id] ?? connection.enabled) ? (
                    <span className={`${styles.pill} ${styles.pillOn}`}>
                      Assistant can use it
                    </span>
                  ) : (
                    <span className={styles.pill}>Saved, not in use</span>
                  )}
                </div>
                <span className={styles.rowUrl}>{connection.url}</span>
                <span className={styles.rowMeta}>
                  {connection.toolNames.length > 0
                    ? `${connection.toolNames.length} tool${
                        connection.toolNames.length === 1 ? "" : "s"
                      }: ${connection.toolNames.slice(0, 4).join(", ")}${
                        connection.toolNames.length > 4 ? "..." : ""
                      }`
                    : "No tools offered"}
                  {connection.hasToken ? " / access token saved" : ""}
                  {" / "}
                  {checkedAgo(connection.lastCheckedAt)}
                </span>
                {connection.lastError && (
                  <span className={styles.rowError} role="alert">
                    {connection.lastError}
                  </span>
                )}
              </div>
              <div className={styles.rowActions}>
                <label className={styles.toggle}>
                  <input
                    type="checkbox"
                    checked={pendingEnabled[connection.id] ?? connection.enabled}
                    onChange={(event) => {
                      const enabled = event.currentTarget.checked;
                      setPendingEnabled((current) => ({
                        ...current,
                        [connection.id]: enabled,
                      }));
                      startTransition(() => {
                        void run(
                          () =>
                            setMcpConnectionEnabledAction(
                              handle,
                              connection.id,
                              enabled,
                            ),
                          "Could not change that.",
                        );
                      });
                    }}
                  />
                  <span>Allow</span>
                </label>
                <button
                  type="button"
                  className="ac-btn ac-btn-plain"
                  disabled={busy}
                  onClick={() =>
                    startTransition(() => {
                      void run(
                        () => refreshMcpConnectionAction(handle, connection.id),
                        "Could not reach it.",
                      );
                    })
                  }
                >
                  Check
                </button>
                <button
                  type="button"
                  className="ac-btn ac-btn-plain"
                  disabled={busy}
                  onClick={() => setRemoving(connection)}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            startTransition(() => {
              void run(async () => {
                const next = await addMcpConnectionAction(handle, name, url, token);
                setName("");
                setUrl("");
                setToken("");
                setAdding(false);
                return next;
              }, "Could not add that server.");
            });
          }}
        >
          <div className={styles.known}>
            <span className={styles.knownLabel}>Start from</span>
            <div className={styles.knownRow}>
              {KNOWN_SERVERS.map((server) => (
                <button
                  type="button"
                  key={server.name}
                  className="ac-btn ac-btn-gray"
                  title={server.hint}
                  onClick={() => {
                    setName(server.name);
                    setUrl(server.url);
                    if (isLocalAddress(server.url)) setToken("");
                  }}
                >
                  {server.name}
                  {server.local && <span className={styles.knownLocal}>local</span>}
                </button>
              ))}
            </div>
            {KNOWN_SERVERS.some((server) => server.url === url && server.local) && (
              <p className={styles.note}>
                This one runs on your own machine, so it works from the TextText
                Mac app. The web app cannot reach it.
              </p>
            )}
          </div>
          <label className={styles.field}>
            <span>Name</span>
            <input
              className="ac-field"
              value={name}
              placeholder="Figma"
              onChange={(event) => setName(event.currentTarget.value)}
              required
            />
          </label>
          <label className={styles.field}>
            <span>Server address</span>
            <input
              className="ac-field"
              type="url"
              value={url}
              placeholder="https://example.com/mcp"
              onChange={(event) => setUrl(event.currentTarget.value)}
              required
            />
          </label>
          {/* A server on this Mac is reached without a token, so the field is
              not offered for one: an input that silently does nothing is worse
              than an absent input. */}
          {!isLocalAddress(url) && (
            <label className={styles.field}>
              <span>Access token (optional)</span>
              <input
                className="ac-field"
                type="password"
                value={token}
                autoComplete="off"
                placeholder="Only if that server needs one"
                onChange={(event) => setToken(event.currentTarget.value)}
              />
            </label>
          )}
          <p className={styles.note}>
            We will connect once to see what it offers. It stays switched off
            until you allow it.
          </p>
          <div className={styles.formActions}>
            <button
              type="button"
              className="ac-btn ac-btn-plain"
              onClick={() => {
                setAdding(false);
                setError(null);
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="ac-btn ac-btn-filled"
              disabled={busy || !name.trim() || !url.trim()}
            >
              {busy ? "Connecting" : "Connect"}
            </button>
          </div>
        </form>
      )}

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <ConfirmationDialog
        open={Boolean(removing)}
        title="Remove this connection?"
        message={
          removing
            ? `${removing.name} will no longer be available to your assistant. Any saved access token is deleted.`
            : ""
        }
        confirmLabel="Remove"
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          const target = removing;
          setRemoving(null);
          if (!target) return;
          startTransition(() => {
            void run(
              () => removeMcpConnectionAction(handle, target.id),
              "Could not remove that.",
            );
          });
        }}
      />
    </section>
  );
}
