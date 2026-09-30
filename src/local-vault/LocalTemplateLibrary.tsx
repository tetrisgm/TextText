import { useCallback, useEffect, useId, useRef, useState } from "react";
import { BUILTIN_TEMPLATES } from "@/lib/presentation/templates";
import { validateTemplateDefinition, type TemplateDefinition } from "@/lib/presentation/schema";
import { useDialogFocus } from "@/components/accessibility/useDialogFocus";
import { useEscapeLayer } from "./LocalKeyboard";
import { vaultRequest, type VaultListing } from "./bridge";

export type VaultLook = { template: TemplateDefinition; sourceJSON?: string | null; path?: string };
type TemplateMetadata = { path: string; hash: string; templateJSON?: string | null; templateAuthoringSourceJSON?: string | null };
const MAX_TEMPLATE_FILES = 100;

/** Read only template metadata, one file at a time. Never load previews or attachments. */
export function useVaultTemplates(refreshKey?: string) {
  const [looks, setLooks] = useState<VaultLook[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [generation, setGeneration] = useState(0);
  const reload = useCallback(() => setGeneration((value) => value + 1), []);
  useEffect(() => {
    window.addEventListener("texttext:vault-changed", reload);
    return () => window.removeEventListener("texttext:vault-changed", reload);
  }, [reload]);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      setLoading(true); setLooks([]); setNotice("");
      const listing = await vaultRequest<VaultListing>("list");
      const files = listing.items.filter((item) => /^Templates\//i.test(item.path));
      const found: VaultLook[] = [];
      let skipped = 0;
      for (const item of files.slice(0, MAX_TEMPLATE_FILES)) {
        if (!active) return;
        try {
          const metadata = await vaultRequest<TemplateMetadata>("template", { path: item.path });
          if (!metadata.templateJSON) { skipped++; continue; }
          found.push({ template: validateTemplateDefinition(JSON.parse(metadata.templateJSON)), sourceJSON: metadata.templateAuthoringSourceJSON, path: item.path });
        } catch { skipped++; }
      }
      if (!active) return;
      setLooks(found);
      const notices = [];
      if (files.length > MAX_TEMPLATE_FILES) notices.push(`Showing the first ${MAX_TEMPLATE_FILES} template files.`);
      if (skipped) notices.push(`${skipped} template ${skipped === 1 ? "file could" : "files could"} not be read.`);
      setNotice(notices.join(" "));
    }).catch((error: unknown) => {
      if (active) setNotice(error instanceof Error ? error.message : "Template files could not be read.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refreshKey, generation]);
  return { looks, loading, notice, reload };
}

/** Lightweight layout sketches keep a full catalog inexpensive to open. */
export function VaultTemplateCards({ looks, onChoose, actionLabel = "Use template", disabled = false }: {
  looks: VaultLook[];
  onChoose: (look: VaultLook) => void;
  actionLabel?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return <div className="vault-template-grid">{looks.map((look, index) =>
    <button className="vault-template-card" key={look.path ?? look.template.id} disabled={disabled}
      aria-label={look.template.name} aria-describedby={`${id}-${index}`} title={look.path}
      onClick={() => onChoose(look)}>
      <span className="vault-template-preview" data-template={look.template.id.replace(/^texttext\./, "")} aria-hidden="true">
        <span className="vault-template-preview-heading" /><span className="vault-template-preview-body" />
        <span className="vault-template-preview-detail" /><span className="vault-template-preview-footer" />
      </span>
      <span className="vault-template-name">{look.template.name}</span>
      <span className="vault-template-description" id={`${id}-${index}`}>{look.template.description || "Your own reusable document template."}</span>
      <span className="vault-template-action">{actionLabel} <span aria-hidden="true">↗</span></span>
    </button>,
  )}</div>;
}

export function WorkspaceTypeLibrary({ onApply, onClose, currentTemplate, onCreateFromFile }: {
  onApply: (template: TemplateDefinition, sourceJSON?: string | null) => void;
  onClose: () => void;
  currentTemplate?: TemplateDefinition;
  onCreateFromFile?: (path: string) => void;
}) {
  const { looks, loading, notice, reload } = useVaultTemplates();
  const [query, setQuery] = useState("");
  const dialog = useRef<HTMLDivElement>(null);
  const title = onCreateFromFile ? "New from template" : "Choose a look";
  useDialogFocus(dialog, true); useEscapeLayer(true, title, onClose);
  const matches = (look: VaultLook) => `${look.template.name} ${look.template.description ?? ""} ${look.path ?? ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const visible = looks.filter(matches);
  const included = onCreateFromFile ? [] : BUILTIN_TEMPLATES
    .filter((template) => !looks.some((look) => look.template.id === template.id))
    .map((template) => ({ template })).filter(matches);
  const current = !onCreateFromFile && currentTemplate &&
    !looks.some((look) => look.template.id === currentTemplate.id && look.template.version === currentTemplate.version) &&
    !BUILTIN_TEMPLATES.some((template) => template.id === currentTemplate.id) ? [{ template: currentTemplate }].filter(matches) : [];
  const choose = (look: VaultLook) => {
    if (onCreateFromFile && look.path) onCreateFromFile(look.path);
    else onApply(look.template, look.sourceJSON ?? null);
  };
  return <div ref={dialog} className="vault-template-dialog vault-template-library" role="dialog" aria-modal="true" aria-label={title}>
    <header className="vault-template-header"><div><h2>{title}</h2>
      <p>{onCreateFromFile ? "Start with a ready-made document. Make it yours as you write." : "Choose how this document reads. Your content stays with it."}</p></div>
      <button onClick={onClose}>Close</button></header>
    <input className="vault-template-search" type="search" aria-label="Search templates" placeholder="Search templates" value={query} onChange={(event) => setQuery(event.target.value)} />
    {loading && <p role="status">Reading template files…</p>}
    {!loading && !looks.length && !notice && <p>Your reusable documents live in the Templates folder. Save a look from any document to add your own.</p>}
    {visible.length > 0 && <><h3>In your Templates folder</h3><VaultTemplateCards looks={visible} onChoose={choose} actionLabel={onCreateFromFile ? "Create document" : "Apply look"} /></>}
    {current.length > 0 && <><h3>This item</h3><VaultTemplateCards looks={current} onChoose={choose} actionLabel="Apply look" /></>}
    {included.length > 0 && <><h3>Included looks</h3><VaultTemplateCards looks={included} onChoose={choose} actionLabel="Apply look" /></>}
    {!loading && query.trim() && visible.length + included.length + current.length === 0 && <p>No templates match “{query.trim()}”. Try another name.</p>}
    {notice && <div className="vault-template-notice"><p role="status">{notice}</p><button onClick={reload}>Read templates again</button></div>}
    <p className="vault-template-help">Each saved template is a TextPack file. Edit it yourself or ask the assistant to customize it.</p>
  </div>;
}
