import { useRef, useState } from "react";
import { useVaultTemplates } from "./LocalTemplateLibrary";
import { vaultRequest, type VaultFile } from "./bridge";
import { readDocument, writePayload } from "./model";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { getBuiltinTemplate } from "@/lib/presentation/templates";
import { validateTemplateDefinition } from "@/lib/presentation/schema";

export type NoteTemplatePickerProps = { body: string; onPick: (body: string) => void; onCancel: () => void };
import { noteTemplateBody } from "./note-template-body";
export function VaultNoteTemplatePicker({ body, onPick, onCancel }: NoteTemplatePickerProps) {
  const { looks, loading, notice, reload } = useVaultTemplates();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const created = useRef<VaultFile | null>(null);
  const run = async (operation: () => Promise<void>) => { setBusy(true); setError(""); try { await operation(); } catch (error) { setError(error instanceof Error ? error.message : "Template could not be opened."); } finally { setBusy(false); } };
  const save = () => run(async () => {
    const text = noteTemplateBody(body), name = query.trim().slice(0, 120);
    if (!name) throw new Error("Name this template.");
    const fresh = created.current ?? await vaultRequest<VaultFile>("create", { title: name, folder: "Templates" });
    created.current = fresh;
    const template = validateTemplateDefinition({ ...getBuiltinTemplate("texttext.note", 1), id: `local.${crypto.randomUUID()}`, name });
    const document = emptyDocumentSnapshot({ id: template.id, version: template.version });
    document.content.title = name; document.content.body = text;
    await vaultRequest("write", writePayload({ ...fresh, templateJSON: JSON.stringify(template) }, document, { template, sourceJSON: null }));
    created.current = null; reload(); onCancel(); window.dispatchEvent(new CustomEvent("texttext:vault-changed"));
  });
  return <div className="tt-note-template-picker" role="group" aria-label="Text templates" onKeyDown={event => { if (event.key === "Escape" && !busy) { event.preventDefault(); event.stopPropagation(); onCancel(); } }}>
    <label>Text templates<input autoFocus type="search" aria-label="Find or name a text template" value={query} disabled={busy} onChange={event => setQuery(event.target.value)} /></label>
    <p>Insert saved text at the cursor. Text and web or card links are supported; images and attachments stay in the original card.</p>
    {loading && <p role="status">Loading templates…</p>}{notice && <p role="status">{notice}</p>}
    {looks.filter(look => look.path && look.template.name.toLowerCase().includes(query.toLowerCase())).map(look => <button type="button" key={look.path} disabled={busy} onClick={() => void run(async () => { const file = await vaultRequest<VaultFile>("read", { path: look.path }); onPick(noteTemplateBody(readDocument(file).content.body)); })}>Insert {look.template.name}</button>)}
    {query.trim() && <button type="button" disabled={busy || !body.trim()} onClick={() => void save()}>Save current text as {query.trim().slice(0,120)}</button>}
    <button type="button" disabled={busy} onClick={onCancel}>Cancel template</button>{error && <p role="alert">{error}</p>}
  </div>;
}
