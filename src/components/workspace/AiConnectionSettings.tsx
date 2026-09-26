"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  nativeAssistantAvailable,
  nativeEmbeddedAssistantAvailable,
  requestNativeAssistant,
  subscribeNativeAssistant,
} from "@/lib/ai/native-client";
import { nativeDeviceAuthorization, type AiConnectionSnapshot } from "@/lib/ai/connection-state";
import { AGENT_CONNECTION_CHECK_PROMPT } from "@/lib/agent-integrations";
import styles from "./AiConnectionSettings.module.css";

type TextTextEdition = "unknown" | "native-available" | "native-unavailable";

export const TRY_AI_IN_TEXTTEXT_EVENT = "texttext:try-ai-in-workspace";
export const AI_CONNECTION_PROOF_PROMPT = AGENT_CONNECTION_CHECK_PROMPT;

function subscribeNativeEdition() {
  return () => undefined;
}

function nativeEditionSnapshot(): TextTextEdition {
  if (typeof window === "undefined") return "unknown";
  if (!nativeAssistantAvailable()) return "native-unavailable";
  return nativeEmbeddedAssistantAvailable()
    ? "native-available"
    : "native-unavailable";
}

export function AiConnectionSettings({
  cloudConfigured = false,
  cloudState,
  cloudFailureMessage,
  onTryInTextText,
  onConnectionChange,
}: {
  /** Whether this workspace already has a provider key saved. */
  cloudConfigured?: boolean;
  cloudState?: "not-set-up" | "unchecked" | "ready" | "needs-attention";
  cloudFailureMessage?: string;
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
        phase: event.phase ?? null,
        verificationUrl: event.verificationUrl ?? null,
        userCode: event.userCode ?? null,
        message: event.message ?? null,
        diagnosticId: event.diagnosticId ?? null,
        model: event.model ?? current?.model ?? null,
        kind: event.kind ?? current?.kind ?? "native-codex",
        providerLabel:
          event.providerLabel ?? current?.providerLabel ?? "Codex with ChatGPT",
        accountEmail: event.accountEmail !== undefined ? event.accountEmail : current?.accountEmail ?? null,
        planLabel: event.planLabel !== undefined ? event.planLabel : current?.planLabel ?? null,
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

  const embeddedAgent = edition === "native-available" && connection?.embeddedChatSupported !== false;
  const ready = connection?.state === "ready";
  const pending = connection?.state === "connecting";
  const authorization = nativeDeviceAuthorization(connection);
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
          {/* Pitching "Recommended: set it up" at someone who already set it
              up reads as a page that does not know its own state. */}
          <p className={styles.kicker}>
            {ready || (!embeddedAgent && cloudState === "ready")
              ? "Connected"
              : pending ? connection?.phase === "checking" ? "Checking connection" : "Authorizing"
              : connection?.state === "failed" ? "Needs attention"
              : cloudState === "needs-attention" ? "Needs attention"
              : cloudConfigured ? "Not checked"
              : "Recommended"}
          </p>
          <h3 id="ai-connection-heading">Write with AI inside TextText</h3>
          <p>
            {embeddedAgent
              ? ready
                ? `Connected${connection?.accountEmail ? ` as ${connection.accountEmail}` : ""}. The agent is ready in the right sidebar.`
                : connection?.message ?? (pending
                  ? connection?.phase === "checking" ? "Checking that your account can generate an answer." : "Finish signing in to continue."
                  : "Connect once, then ask the agent to read or change the document you have open.")
              : cloudState === "ready"
                ? "The selected provider answered a generation request. Ask it to read or change the document you have open."
                : cloudState === "needs-attention"
                  ? cloudFailureMessage ?? "This connection needs attention. Check the provider key below."
                  : cloudConfigured
                    ? "A provider key is saved. Try your request to check that it can generate an answer."
                    : "ChatGPT account connection is unavailable in this edition. You can use the advanced provider key option below."}
          </p>
          {authorization ? <p role="status">Enter <strong>{authorization.code}</strong> at <a href={authorization.url} target="_blank" rel="noreferrer">ChatGPT authorization</a>.</p> : null}
          {connection?.diagnosticId && connection.state === "failed" ? <details><summary>Connection details</summary><p>Reference: {connection.diagnosticId}</p></details> : null}
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
              disabled={pending}
              onClick={() =>
                ready
                  ? onTryInTextText?.()
                  : requestNativeAssistant("assistantConnect")
              }
            >
              {ready ? "Try in TextText" : pending ? connection?.phase === "checking" ? "Checking connection" : "Authorizing" : connection?.accountEmail ? "Check connection" : "Continue with ChatGPT"}
            </button>
            {pending ? <button type="button" className={styles.disconnect} onClick={() => requestNativeAssistant("assistantCancelSetup")}>Cancel setup</button> : null}
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
        ) : cloudConfigured ? (
          <button
            type="button"
            className={styles.primary}
            onClick={() => onTryInTextText?.()}
          >
            Try in TextText
          </button>
        ) : (
          <a className={styles.secondary} href="#api-key-connections">
            Add a provider key
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
            Connect an external agent
          </summary>
          <p>
            Connect another AI app to read and edit the items you give it access to. This is separate from the assistant inside TextText.
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
