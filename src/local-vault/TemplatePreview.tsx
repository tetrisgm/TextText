import { useEffect, useMemo, useState } from "react";
import { DocumentRenderer } from "@/components/document/DocumentRenderer";
import { vaultRequest, type VaultFile } from "./bridge";
import { readDocument, readTemplate } from "./model";
import { prepareTemplateProposal, type TemplateProposal } from "./template-proposal";

function substitute<T>(value: T, urls: Map<string, string>): T {
  if (typeof value === "string") { let text = value as string; for (const [path, url] of urls) text = text.split(path).join(url); return text as T; }
  if (Array.isArray(value)) return value.map((entry) => substitute(entry, urls)) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, substitute(entry, urls)])) as T;
  return value;
}

function PreviewContent({ file, proposal, original }: { file: VaultFile; proposal: TemplateProposal; original: boolean }) {
  const prepared = useMemo(() => prepareTemplateProposal(file, proposal), [file, proposal]);
  const urls = useMemo(() => {
    const urls = new Map<string, string>();
    for (const asset of file.assets ?? []) {
      const bytes = Uint8Array.from(atob(asset.data), (character) => character.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: asset.contentType }));
      urls.set(`assets/${asset.filename}`, url);
      if (asset.remoteURL) urls.set(asset.remoteURL, url);
    }
    return urls;
  }, [file]);
  useEffect(() => () => { for (const url of new Set(urls.values())) URL.revokeObjectURL(url); }, [urls]);
  const document = original ? readDocument(file) : prepared.document;
  return <DocumentRenderer document={substitute(document, urls)} template={original ? readTemplate(file, document) : prepared.template} />;
}

export function TemplatePreview({ proposal, working, beforeKeep, onKeep, onCancel }: {
  proposal: TemplateProposal; working: boolean; beforeKeep: () => Promise<boolean>; onKeep: () => void; onCancel: () => void;
}) {
  const [file, setFile] = useState<VaultFile | null>(null);
  const [error, setError] = useState("");
  const [original, setOriginal] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    void vaultRequest<VaultFile>("read", { path: proposal.path }).then((value) => {
      prepareTemplateProposal(value, proposal);
      if (active) setFile(value);
    }).catch((error: Error) => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [proposal]);
  const keep = async () => {
    if (!file || saving || working) return;
    setSaving(true); setError("");
    try {
      if (!await beforeKeep()) throw new Error("Save or resolve the current document first.");
      const current = await vaultRequest<VaultFile>("read", { path: proposal.path });
      const { payload } = prepareTemplateProposal(current, proposal);
      const saved = await vaultRequest<VaultFile>("write", payload);
      if (saved.templateJSON !== payload.templateJSON) throw new Error("The saved design did not match the preview. Reopen the file to inspect it.");
      window.dispatchEvent(new Event("texttext:vault-changed")); onKeep();
    } catch (error) { setError(error instanceof Error ? error.message : "This design could not be saved."); }
    finally { setSaving(false); }
  };
  return <section className="vault-design-preview" aria-label="Design preview">
    <header><h2>Preview</h2><p>{proposal.path}</p>{proposal.request && <details><summary>Your request</summary><p>{proposal.request}</p></details>}<p>Only this file. Your writing and images stay unchanged.</p>
      <button aria-pressed={original} onClick={() => setOriginal((value) => !value)}>{original ? "Show proposed design" : "Compare original"}</button>
      <button disabled={!file || saving || working} onClick={() => void keep()}>{saving ? "Saving…" : "Keep this design"}</button>
      <button disabled={saving || working} onClick={onCancel}>Cancel design</button>
      <p>Ask the assistant for changes to refine this preview.</p>
      {error && <p role="alert">{error}</p>}
    </header>
    {file && <PreviewContent file={file} proposal={proposal} original={original} />}
  </section>;
}
