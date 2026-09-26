"use client";

import { useEffect, useRef, useState } from "react";
import { saveWorkspaceAiSettingsAction, type WorkspaceAiSettingsState } from "@/app/editor/ai-config-actions";
import { CLOUD_AI_CATALOG, defaultCloudAiModel, type CloudAiProvider } from "@/lib/ai/provider-catalog";
import { nativeDeviceAuthorization, type AiConnectionSnapshot } from "@/lib/ai/connection-state";
import styles from "./ItemTypeStudio.module.css";

/** Setup remains inside the original preview task. Credentials live only in
 * this form until the existing protected configuration action accepts them. */
export function ItemTypeAgentSetup({ handle, nativeAvailable, nativeConnection, preferredConnection, settings,
  onConnectNative, onChooseConnection, onReady, onCancel,
}: {
  handle: string;
  nativeAvailable: boolean;
  nativeConnection?: AiConnectionSnapshot | null;
  preferredConnection: "native" | "api-key";
  settings: WorkspaceAiSettingsState | null;
  onConnectNative?: () => void;
  onChooseConnection: (connection: "native" | "api-key") => void;
  onReady: (settings: WorkspaceAiSettingsState) => void;
  onCancel: () => void;
}) {
  const [provider, setProvider] = useState<CloudAiProvider>(settings?.provider ?? "anthropic");
  const [model, setModel] = useState(settings?.model ?? defaultCloudAiModel(provider));
  const [key, setKey] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const edited = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    if (edited.current || !settings?.provider) return;
    setProvider(settings.provider);
    setModel(settings.model ?? defaultCloudAiModel(settings.provider));
  }, [settings?.provider, settings?.model]);
  const native = preferredConnection === "native" && nativeAvailable;
  const status = nativeConnection as AiConnectionSnapshot & {
    phase?: "authorizing" | "checking" | null; verificationUrl?: string | null;
    userCode?: string | null; message?: string | null; diagnosticId?: string | null;
  } | null | undefined;
  const pending = status?.state === "connecting" || Boolean(status?.phase);
  const authorization = nativeDeviceAuthorization(status);
  return <section className={styles.setupPanel} aria-label="Connect an agent for this request">
    <h2>Connect to continue this request</h2>
    <p>Your request and preview are saved here. Setup will return to this document automatically.</p>
    {nativeAvailable ? <div className={styles.setupChoices}>
      <button type="button" aria-pressed={native} onClick={() => onChooseConnection("native")}>ChatGPT account</button>
      <button type="button" aria-pressed={!native} onClick={() => onChooseConnection("api-key")}>Advanced: provider key</button>
    </div> : <p>Account connection is unavailable in this edition. A provider API key is the supported advanced option here.</p>}
    {native ? <>
      <p role="status">{status?.message ?? (status?.phase === "checking" ? "Checking the connection…" : pending ? "Finish signing in to continue." : "Use your supported ChatGPT account with TextText.")}</p>
      {authorization ? <div><p>1. Open ChatGPT using the button below.</p><p>2. Enter this code: <strong>{authorization.code}</strong></p><p>3. Finish signing in, then return here. Your request will continue automatically.</p><a className={styles.doneButton} href={authorization.url} target="_blank" rel="noreferrer">Open ChatGPT to sign in</a></div> : null}
      {!authorization && <button type="button" className={styles.doneButton} disabled={pending} onClick={onConnectNative}>
        {pending ? "Connecting…" : status?.accountEmail ? "Check connection" : "Continue with ChatGPT"}
      </button>}
      {status?.diagnosticId ? <details><summary>Connection details</summary><p>Reference: {status.diagnosticId}</p></details> : null}
    </> : <>
      {settings?.configured && settings.connectionState !== "needs-attention" ? <button type="button" className={styles.doneButton} onClick={() => onReady(settings)}>
        Continue with saved {settings.provider === "openai" ? "OpenAI" : "Anthropic"} connection
      </button> : null}
      <form onSubmit={async (event) => {
      event.preventDefault();
      if (checking) return;
      setChecking(true); setError(null);
      try {
        const result = await saveWorkspaceAiSettingsAction(handle, provider, model, key);
        if (!active.current) return;
        if (result.failure) { setError(result.failure.message); return; }
        if (result.connectionState !== "ready") { setError("The connection is not ready. Check your account and model, then try again."); return; }
        setKey("");
        window.dispatchEvent(new Event("texttext:ai-connection-changed"));
        onReady(result);
      } catch {
        if (active.current) setError("The connection check could not finish. Your request is preserved. Retry when your connection is available.");
      } finally { if (active.current) setChecking(false); }
    }}>
      <div className={styles.twoColumns}>
        <label><span>Provider</span><select value={provider} disabled={checking} onChange={(event) => {
          const next = event.currentTarget.value as CloudAiProvider;
          edited.current = true;
          setProvider(next); setModel(defaultCloudAiModel(next)); setKey("");
        }}>{Object.entries(CLOUD_AI_CATALOG).map(([id, value]) => <option key={id} value={id}>{value.label}</option>)}</select></label>
        <label><span>Model</span><select value={model} disabled={checking} onChange={(event) => { edited.current = true; setModel(event.currentTarget.value); }}>
          {CLOUD_AI_CATALOG[provider].models.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
        </select></label>
      </div>
      <label><span>Provider API key</span><input type="password" autoComplete="new-password" spellCheck={false} value={key} onChange={(event) => { edited.current = true; setKey(event.currentTarget.value); }} disabled={checking} /></label>
      <p>Provider API usage is billed separately from consumer subscriptions. This checks the selected model with one short request.</p>
      <button type="submit" className={styles.doneButton} disabled={checking || !key.trim()}>{checking ? "Checking connection…" : "Check and continue"}</button>
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    </form></>}
    <button type="button" className={styles.quietButton} onClick={onCancel}>Cancel setup, keep draft</button>
  </section>;
}
