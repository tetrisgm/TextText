"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  nativeAssistantAvailable,
  nativeEmbeddedAssistantAvailable,
  requestNativeAssistant,
  subscribeNativeAssistant,
} from "@/lib/ai/native-client";
import type { AiConnectionSnapshot } from "@/lib/ai/connection-state";
import styles from "./AiConnectionSettings.module.css";

type TextTextEdition = "unknown" | "standalone" | "store-or-browser";

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

export function AiConnectionSettings() {
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

  const embeddedAgent = edition === "standalone";
  const ready = connection?.state === "ready";
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
        </div>
        {embeddedAgent ? (
          <button
            type="button"
            className={styles.primary}
            onClick={() => requestNativeAssistant("assistantConnect")}
            disabled={ready}
          >
            {ready ? "Connected" : "Continue with ChatGPT"}
          </button>
        ) : (
          <a className={styles.secondary} href="#api-key-connections">
            Set up the in-app assistant
          </a>
        )}
      </article>
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
