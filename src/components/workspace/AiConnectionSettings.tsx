"use client";

import { useEffect, useState } from "react";
import { nativeAssistantAvailable, requestNativeAssistant, subscribeNativeAssistant } from "@/lib/ai/native-client";
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

  const isMac = nativeAssistantAvailable();
  const ready = connection?.state === "ready";
  return (
    <div className={styles.grid}>
      <article className={styles.card}>
        <div>
          <p className={styles.kicker}>Inside TextText</p>
          <h3>TextText Agent</h3>
          <p>
            {ready
              ? `Connected${connection?.accountEmail ? ` as ${connection.accountEmail}` : ""}. Use your ChatGPT plan directly in the assistant.`
              : isMac
                ? "Use your eligible ChatGPT or Codex plan directly inside TextText. No API credits are required."
                : "The embedded agent is available in the TextText Mac app."}
          </p>
        </div>
        <button type="button" className={styles.primary} onClick={() => requestNativeAssistant("assistantConnect")} disabled={!isMac || ready}>
          {ready ? "Connected" : "Continue with ChatGPT"}
        </button>
      </article>
      <article className={styles.card}>
        <div>
          <p className={styles.kicker}>From another app</p>
          <h3>Claude, Codex, ChatGPT, or MCP</h3>
          <p>Keep the conversation in the AI app you already use, while TextText supplies the durable workspace.</p>
        </div>
        <a className={styles.secondary} href="/connect">Open connection center</a>
      </article>
      <details className={styles.advanced}>
        <summary>Advanced: use an API key</summary>
        <p>API usage is billed separately by the provider. Configure a key below when you want TextText to call Anthropic or OpenAI directly.</p>
      </details>
      <a className={styles.secondary} href="/docs">Read the AI documentation</a>
    </div>
  );
}
