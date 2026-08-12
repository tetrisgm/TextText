"use client";

import type { AiConnectionSnapshot } from "@/lib/ai/connection-state";
import styles from "./AiGettingStartedCard.module.css";

export function AiGettingStartedCard({
  connection,
  settingsHref,
  onConnect,
  onOpenAssistant,
}: {
  connection: AiConnectionSnapshot | null;
  settingsHref: string;
  onConnect?: () => void;
  onOpenAssistant: () => void;
}) {
  const ready = connection?.state === "ready";
  const canEmbed = connection?.embeddedChatSupported === true;

  return (
    <section className={styles.card} aria-labelledby="start-with-ai-title">
      <div className={styles.copy}>
        <p className={styles.kicker}>AI collaborator</p>
        <h2 id="start-with-ai-title">{ready ? "Keep writing with your agent" : "Write with an agent"}</h2>
        <p>
          {ready
            ? "Your ChatGPT-powered agent is ready inside TextText. Ask it to find, draft, reshape, and organize your workspace."
            : "Connect an agent once, then work with it directly beside your TextText documents. Your files stay in your workspace."}
        </p>
      </div>
      <div className={styles.actions}>
        {ready ? (
          <button type="button" className={styles.primary} onClick={onOpenAssistant}>
            Open assistant
          </button>
        ) : canEmbed && onConnect ? (
          <button type="button" className={styles.primary} onClick={onConnect}>
            Continue with ChatGPT
          </button>
        ) : null}
        <a href="/connect" className={styles.secondary}>Connect another AI app</a>
        <a href={settingsHref} className={styles.secondary}>AI settings</a>
      </div>
      <div className={styles.prompts} aria-label="Prompt starters">
        <span>Try asking</span>
        <button type="button" onClick={onOpenAssistant}>Turn these notes into an article</button>
        <button type="button" onClick={onOpenAssistant}>Find everything about this project</button>
        <button type="button" onClick={onOpenAssistant}>Create a clean outline</button>
      </div>
    </section>
  );
}
