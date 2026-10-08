"use client";

import { useEffect, useRef, useState } from "react";
import { CLOUD_AI_CATALOG, defaultCloudAiModel, type CloudAiProvider } from "@/lib/ai/provider-catalog";
import styles from "./AccountMenu.module.css";

export type AiSettingsStatus = {
  allowed: boolean; configured: boolean; provider: CloudAiProvider | null; model: string | null;
  connectionState: "not-set-up" | "unchecked" | "ready" | "needs-attention";
  failure?: { message: string };
};
export type AiSettingsActions = {
  read(): Promise<AiSettingsStatus>;
  save(provider: CloudAiProvider, model: string, apiKey: string): Promise<AiSettingsStatus>;
  remove(): Promise<AiSettingsStatus>;
};

/** Credentials are write-only. This component never receives a saved key. */
export function AiProviderSettings({ actions }: { actions: AiSettingsActions }) {
  const [status, setStatus] = useState<AiSettingsStatus | null>(null);
  const [provider, setProvider] = useState<CloudAiProvider>("openai");
  const [model, setModel] = useState(defaultCloudAiModel("openai"));
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    void actions.read().then(value => {
      if (generation.current !== current) return;
      setStatus(value);
      if (value.provider) { setProvider(value.provider); setModel(value.model ?? defaultCloudAiModel(value.provider)); }
    }).catch(() => { if (generation.current === current) setMessage("AI settings could not be loaded. Close Settings and try again."); });
    return () => { generation.current = current + 1; };
  }, [actions]);
  const perform = async (remove = false) => {
    if (busy || !status?.allowed) return;
    const current = generation.current;
    const key = apiKey;
    setApiKey(""); setBusy(true); setMessage("");
    try {
      const value = remove ? await actions.remove() : await actions.save(provider, model, key);
      if (generation.current !== current) return;
      setStatus(value);
      setMessage(value.failure?.message ?? (remove ? "Provider disconnected." : value.connectionState === "ready" ? "Provider connected. You can return to your conversation." : "The provider could not be connected."));
      window.dispatchEvent(new Event("texttext:ai-settings-changed"));
    } catch {
      if (generation.current === current) setMessage("The provider could not be saved. Check your connection and try again.");
    } finally { if (generation.current === current) setBusy(false); }
  };
  return <section aria-labelledby="cloud-ai-settings-heading" data-ai-settings>
    <h3 id="cloud-ai-settings-heading" tabIndex={-1}>AI on the web</h3>
    <p className={styles.muted}>Use your own provider account to ask about your files. Provider usage is billed to that account.</p>
    {!status && !message && <p role="status">Loading AI settings…</p>}
    {status && !status.allowed && <p>Only the workspace owner can manage this connection.</p>}
    {status?.allowed && <form className={styles.aiForm} onSubmit={event => { event.preventDefault(); void perform(); }}>
      {status.configured && <p role="status">{status.provider ? CLOUD_AI_CATALOG[status.provider].label : "Provider"} · {status.model} · {status.connectionState === "ready" ? "Connected" : "Needs attention"}</p>}
      <label>Provider<select disabled={busy} value={provider} onChange={event => { const next = event.target.value as CloudAiProvider; setProvider(next); setModel(defaultCloudAiModel(next)); }}>
        {Object.entries(CLOUD_AI_CATALOG).map(([id, entry]) => <option key={id} value={id}>{entry.label}</option>)}
      </select></label>
      <label>Model<select disabled={busy} value={model} onChange={event => setModel(event.target.value)}>{CLOUD_AI_CATALOG[provider].models.map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</select></label>
      <label>{status.configured ? "New API key" : "API key"}<input type="password" autoComplete="off" spellCheck={false} required minLength={20} maxLength={512} disabled={busy} value={apiKey} onChange={event => setApiKey(event.target.value)} /></label>
      <p className={styles.muted}>The key is encrypted on the server and is never shown again. Saving checks the connection with a small provider request.</p>
      <div className={styles.aiActions}><button type="submit" disabled={busy}>{busy ? "Checking…" : status.configured ? "Update connection" : "Connect provider"}</button>
      {status.configured && <button type="button" disabled={busy} onClick={() => void perform(true)}>Disconnect provider</button>}</div>
    </form>}
    {message && <p role="status">{message}</p>}
  </section>;
}
