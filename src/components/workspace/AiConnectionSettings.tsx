"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  nativeAssistantAvailable,
  nativeEmbeddedAssistantAvailable,
  requestNativeAssistant,
  subscribeNativeAssistant,
} from "@/lib/ai/native-client";
import type { AiConnectionSnapshot } from "@/lib/ai/connection-state";
import { AGENT_CONNECTION_CHECK_PROMPT } from "@/lib/agent-integrations";
import styles from "./AiConnectionSettings.module.css";

type TextTextEdition = "unknown" | "standalone" | "store-or-browser";

export const TRY_AI_IN_TEXTTEXT_EVENT = "texttext:try-ai-in-workspace";
export const AI_CONNECTION_PROOF_PROMPT = AGENT_CONNECTION_CHECK_PROMPT;

function subscribeNativeEdition() {
  return () => undefined;
}

function nativeEditionSnapshot(): TextTextEdition {
  if (typeof window === "undefined") return "unknown";
  if (!nativeAssistantAvailable()) return "store-or-browser";
  return nativeEmbeddedAssistantAvailable()
    ? "standalone"
    : "store-or-browser";
}

export function AiConnectionSettings({
  onTryInTextText,
  onConnectionChange,
}: {
  onTryInTextText?: () => void;
  onConnectionChange?: (connection: AiConnectionSnapshot) => void;
}) {
  const [connection, setConnection] = useState<AiConnectionSnapshot | null>(
    null,
  );
  const edition = useSyncExternalStore(
    subscribeNativeEdition,
    nativeEditionSnapshot,
    () => "unknown",
  );

  useEffect(() => {
    const unsubscribe = subscribeNativeAssistant((event) => {
      if (event.type !== "status") return;
      setConnection((current) => ({
        state: event.state ?? current?.state ?? "unavailable",
        kind: event.kind ?? current?.kind ?? "native-codex",
        providerLabel:
          event.providerLabel ?? current?.providerLabel ?? "Codex with ChatGPT",
        accountEmail: event.accountEmail ?? current?.accountEmail ?? null,
        planLabel: event.planLabel ?? current?.planLabel ?? null,
        runtimeVersion: event.runtimeVersion ?? current?.runtimeVersion ?? null,
        rateLimitResetAt:
          event.rateLimitResetAt ?? current?.rateLimitResetAt ?? null,
        lastHealthCheckAt:
          event.lastHealthCheckAt ?? current?.lastHealthCheckAt ?? null,
        embeddedChatSupported:
          event.embeddedChatSupported ??
          current?.embeddedChatSupported ??
          false,
        recoveryAction: event.recoveryAction ?? current?.recoveryAction ?? null,
      }));
    });
    if (nativeAssistantAvailable()) {
      requestNativeAssistant("assistantStatus");
    }
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (connection) onConnectionChange?.(connection);
  }, [connection, onConnectionChange]);

  const embeddedAgent = edition === "standalone";
  const ready = connection?.state === "ready";
  const canDisconnect =
    embeddedAgent &&
    (ready ||
      connection?.state === "rate-limited" ||
      Boolean(connection?.accountEmail));
  return (
    <section
      className={styles.settings}
      aria-labelledby="ai-connection-heading"
    >
      <article className={styles.primaryCard}>
        <div>
          <p className={styles.kicker}>Recommended</p>
          <h3 id="ai-connection-heading">Write with AI inside TextText</h3>
          <p>
            {embeddedAgent
              ? ready
                ? `Connected${connection?.accountEmail ? ` as ${connection.accountEmail}` : ""}. The agent is ready in the right sidebar.`
                : "Connect once, then ask the agent to read or change the document you have open."
              : "Add one provider key, then ask the agent to read or change the document you have open."}
          </p>
          {ready && connection?.lastHealthCheckAt ? (
            <p className={styles.verification}>
              Verified {new Date(connection.lastHealthCheckAt).toLocaleString()}
              {connection.runtimeVersion ? ` · Runtime ${connection.runtimeVersion}` : ""}
            </p>
          ) : null}
        </div>
        {embeddedAgent ? (
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primary}
              onClick={() =>
                ready
                  ? onTryInTextText?.()
                  : requestNativeAssistant("assistantConnect")
              }
            >
              {ready ? "Try in TextText" : "Continue with ChatGPT"}
            </button>
            {canDisconnect && (
              <button
                type="button"
                className={styles.disconnect}
                onClick={() => requestNativeAssistant("assistantDisconnect")}
              >
                Disconnect
              </button>
            )}
          </div>
        ) : (
          <a className={styles.secondary} href="#api-key-connections">
            Set up the in-app assistant
          </a>
        )}
      </article>
      {canDisconnect && (
        <p className={styles.disconnectNote}>
          Disconnect stops TextText using this Codex session. It does not sign
          you out of Codex in other apps.
        </p>
      )}
      {edition !== "unknown" ? (
        <details className={styles.alternative}>
          <summary>
            {embeddedAgent
              ? "Use Claude or Codex on this Mac"
              : "Connect a remote agent"}
          </summary>
          <p>
            {embeddedAgent
              ? "The standalone Mac edition includes a local TextText plugin for Claude and Codex."
              : "A remote client that accepts bearer-authenticated MCP can connect through the hosted TextText endpoint."}
          </p>
          <a className={styles.secondary} href="/connect">
            Open connection setup
          </a>
        </details>
      ) : null}
      <p className={styles.footnote}>
        <a href="/docs/ai">Read the AI documentation</a>
      </p>
    </section>
  );
}
