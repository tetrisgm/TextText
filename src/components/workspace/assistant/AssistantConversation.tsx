"use client";

import { useEffect, useRef } from "react";
import type { AssistantMessage } from "./useNativeAssistant";
import type { NativeAICapabilities } from "@/lib/ai/native";
import styles from "./AssistantConversation.module.css";

// The transcript inside the assistant sidebar: user and assistant turns,
// lightweight progress rows while the on-device model drives tools, and an
// empty state that says where the answers come from.
export function AssistantConversation({
  capabilities,
  messages,
  submitting,
}: {
  capabilities: NativeAICapabilities | null;
  messages: AssistantMessage[];
  submitting: boolean;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, submitting]);

  if (messages.length === 0) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyTitle}>
          {capabilities?.available
            ? "Private, on this Mac"
            : "Ask about your workspace"}
        </p>
        <p className={styles.emptyBody}>
          {capabilities?.available
            ? "Answers and edits run on Apple's on-device model. Nothing leaves this Mac, and it works offline."
            : "Inside the Mac app, the assistant runs on Apple's on-device model: private, offline, free."}
        </p>
        <ul className={styles.examples}>
          <li>Give this post a better title</li>
          <li>Summarize this article</li>
          <li>Create three draft posts about...</li>
        </ul>
      </div>
    );
  }

  return (
    <div className={styles.thread} aria-live="polite">
      {messages.map((message) => {
        if (message.role === "progress") {
          return (
            <div key={message.id} className={styles.progress}>
              {message.text}
            </div>
          );
        }
        return (
          <div
            key={message.id}
            className={
              message.role === "user"
                ? styles.userTurn
                : message.role === "error"
                  ? styles.errorTurn
                  : styles.assistantTurn
            }
          >
            {message.text}
          </div>
        );
      })}
      {submitting && <div className={styles.progress}>Thinking on this Mac</div>}
      <div ref={endRef} />
    </div>
  );
}
