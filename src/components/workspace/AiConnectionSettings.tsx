"use client";

import { useEffect, useState } from "react";
import {
  nativeAssistantAvailable,
  nativeEmbeddedAssistantAvailable,
  requestNativeAssistant,
  subscribeNativeAssistant,
} from "@/lib/ai/native-client";
import type { AiConnectionSnapshot } from "@/lib/ai/connection-state";
import styles from "./AiConnectionSettings.module.css";

export function AiConnectionSettings() {
  const [connection, setConnection] = useState<AiConnectionSnapshot | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeNativeAssistant((event) => {
      if (event.type !== "status") return;
      setConnection((current) => ({
        state: event.state ?? current?.state ?? "unavailable",
        kind: event.kind ?? current?.kind ?? "native-codex",
        providerLabel: event.providerLabel ?? current?.providerLabel ?? "Codex with ChatGPT",
        accountEmail: event.accountEmail ?? current?.accountEmail ?? null,
        planLabel: event.planLabel ?? current?.planLabel ?? null,
        runtimeVersion: event.runtimeVersion ?? current?.runtimeVersion ?? null,
        rateLimitResetAt: event.rateLimitResetAt ?? current?.rateLimitResetAt ?? null,
        lastHealthCheckAt: event.lastHealthCheckAt ?? current?.lastHealthCheckAt ?? null,
        embeddedChatSupported: event.embeddedChatSupported ?? current?.embeddedChatSupported ?? false,
        recoveryAction: event.recoveryAction ?? current?.recoveryAction ?? null,
      }));
    });
    if (nativeAssistantAvailable()) requestNativeAssistant("assistantStatus");
    return unsubscribe;
  }, []);

  const embeddedAgent = nativeEmbeddedAssistantAvailable();
  const ready = connection?.state === "ready";
  return (
    <div className={styles.grid}>
      <article className={styles.card}>
        <div>
          <p className={styles.kicker}>Inside TextText</p>
          <h3>{embeddedAgent ? "TextText Agent" : "In-app assistant"}</h3>
          <p>
            {embeddedAgent
              ? ready
                ? `Connected${connection?.accountEmail ? ` as ${connection.accountEmail}` : ""}. Use your ChatGPT plan directly in the assistant.`
                : "Use your eligible ChatGPT or Codex plan directly inside TextText. No API credits are required."
              : "Add an Anthropic or OpenAI API key to write with AI directly beside your documents."}
          </p>
        </div>
        {embeddedAgent ? (
          <button type="button" className={styles.primary} onClick={() => requestNativeAssistant("assistantConnect")} disabled={ready}>
            {ready ? "Connected" : "Continue with ChatGPT"}
          </button>
        ) : (
          <a className={styles.secondary} href="#api-key-connections">
            Set up in-app AI
          </a>
        )}
      </article>
      <article className={styles.card}>
        <div>
          <p className={styles.kicker}>From another app</p>
          <h3>Claude, Codex, ChatGPT, or MCP</h3>
          <p>Keep the conversation in the AI app you already use, while TextText supplies the durable workspace.</p>
        </div>
        <a className={styles.secondary} href="/connect">Open connection center</a>
      </article>
      {/* No "Advanced: use an API key" disclosure here. It opened onto a
          sentence and nothing else, while the key form it described sat below
          it, always visible: a control that hid nothing and could not be the
          way in. The API key section says the same thing where the keys are. */}
      <p className={styles.footnote}>
        <a href="/docs/ai">Read the AI documentation</a>
      </p>
    </div>
  );
}
