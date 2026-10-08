import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { BUILTIN_TEMPLATES, templateExperience } from "@/lib/presentation/templates";
import { validateTemplateDefinition, type TemplateDefinition } from "@/lib/presentation/schema";
import { useDialogFocus } from "@/components/accessibility/useDialogFocus";
import { useEscapeLayer } from "./LocalKeyboard";
import { vaultRequest, type VaultListing } from "./bridge";

type TemplatePreviewContent = { title?: string; subtitle?: string; body?: string; sourceUrl?: string; tag?: string };
export type VaultLook = { template: TemplateDefinition; sourceJSON?: string | null; path?: string; preview?: TemplatePreviewContent };
type TemplateMetadata = { path: string; hash: string; templateJSON?: string | null; templateAuthoringSourceJSON?: string | null; preview?: TemplatePreviewContent };
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
          found.push({ template: validateTemplateDefinition(JSON.parse(metadata.templateJSON)), sourceJSON: metadata.templateAuthoringSourceJSON, path: item.path, preview: metadata.preview });
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

/** Small, content-shaped previews distinguish each creation path without loading assets. */
function TemplatePreview({ template, preview }: { template: TemplateDefinition; preview?: TemplatePreviewContent }) {
  const kind = templateExperience(template) ?? template.id.replace(/^texttext\./, "");
  const body = preview?.body?.split("\n").map(line => line.trim()).find(Boolean)?.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+)/, "") || "";
  let host = "example.com";
  if (preview?.sourceUrl) { try { host = new URL(preview.sourceUrl).hostname; } catch { /* Keep a neutral fallback. */ } }
  return <span className="vault-template-preview" data-template={kind} aria-hidden="true">
    {kind === "article" ? <span className="preview-story"><span className="preview-eyebrow">Draft story</span><strong>{preview?.title || "A story worth telling"}</strong><em>{preview?.subtitle || "A thought to carry into the article"}</em>{body ? <span className="preview-excerpt">{body}</span> : <><span className="preview-line" /><span className="preview-line short" /></>}</span>
      : kind === "note" ? <span className="preview-note"><strong>{preview?.title || "A useful thought"}</strong><span>{body || "Capture it while it is fresh."}</span><small>{preview?.tag || "Ideas"}</small></span>
      : kind === "bookmark" ? <span className="preview-bookmark"><span className="preview-site">◉ {host}</span><strong>{preview?.title || "An article to keep"}</strong><span>{body || "Open in a clean reader whenever you return."}</span></span>
      : kind === "gallery" ? <span className="preview-gallery"><span /><span /><span /><span /></span>
      : kind === "talk" ? <span className="preview-talk"><strong>{preview?.title || "Make your point."}</strong><span>{preview?.subtitle || "One idea per slide"}</span></span>
      : <span className="preview-generic"><strong>{preview?.title || template.name}</strong>{body ? <span className="preview-excerpt">{body}</span> : <><span className="preview-line" /><span className="preview-line short" /></>}</span>}
  </span>;
}

export function VaultTemplateCards({ looks, onChoose, actionLabel = "Use template", disabled = false, extra }: {
  looks: VaultLook[];
  onChoose: (look: VaultLook) => void;
  actionLabel?: string;
  disabled?: boolean;
  extra?: ReactNode;
}) {
  const id = useId();
  return <div className="vault-template-grid">{looks.map((look, index) =>
    <button className="vault-template-card" key={look.path ?? look.template.id} disabled={disabled}
      aria-label={look.template.name} aria-describedby={`${id}-${index}`}
      onClick={() => onChoose(look)}>
      <TemplatePreview template={look.template} preview={look.preview} />
      <span className="vault-template-name">{look.template.name}</span>
      <span className="vault-template-description" id={`${id}-${index}`}>{look.template.description || "Your own reusable document template."}</span>
      <span className="vault-template-action">{actionLabel} <span aria-hidden="true">↗</span></span>
    </button>,
  )}{extra}</div>;
}

export function WorkspaceTypeLibrary({ onApply, onClose, currentTemplate, onCreateFromFile, onCreateFromBuiltIn, onCreateFeed, initialQuery = "" }: {
  onApply: (template: TemplateDefinition, sourceJSON?: string | null) => void;
  onClose: () => void;
  currentTemplate?: TemplateDefinition;
  onCreateFromFile?: (path: string) => void;
  onCreateFromBuiltIn?: (template: TemplateDefinition) => void;
  onCreateFeed?: () => void;
  initialQuery?: string;
}) {
  const { looks, loading, notice, reload } = useVaultTemplates();
  const [query, setQuery] = useState(initialQuery);
  const dialog = useRef<HTMLDivElement>(null);
  const title = onCreateFromFile ? "New from template" : "Choose a look";
  useDialogFocus(dialog, true); useEscapeLayer(true, title, onClose);
  const matches = (look: VaultLook) => `${look.template.name} ${look.template.description ?? ""} ${look.path ?? ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const retiredStarterIds = new Set(["texttext.timeline", "texttext.page", "texttext.casestudy", "texttext.project", "texttext.brief", "texttext.todo"]);
  const visible = looks.filter(look => !retiredStarterIds.has(look.template.id) && matches(look));
  const included = BUILTIN_TEMPLATES
    .filter((template) => !retiredStarterIds.has(template.id) && !looks.some((look) => look.template.id === template.id))
    .map((template) => ({ template })).filter(matches);
  const showFeed = Boolean(onCreateFromFile && onCreateFeed && (!query.trim() || /feed|news|source|publisher|rss|atom/i.test(query)));
  const feedCard = showFeed && <button className="vault-template-card" type="button" aria-label="Follow a feed" onClick={onCreateFeed}>
    <span className="vault-template-preview" data-template="feed" aria-hidden="true"><span className="preview-feed"><span>For You　 Headlines</span><strong>Stories from your sources</strong><small>◉ Publisher　·　Latest story</small><small>◉ Another source　·　More to read</small></span></span>
    <span className="vault-template-name">Feeds</span><span className="vault-template-description">Follow a site and read its latest stories in Feeds.</span>
    <span className="vault-template-action">Add source <span aria-hidden="true">↗</span></span>
  </button>;
  const current = !onCreateFromFile && currentTemplate &&
    !looks.some((look) => look.template.id === currentTemplate.id && look.template.version === currentTemplate.version) &&
    !BUILTIN_TEMPLATES.some((template) => template.id === currentTemplate.id) ? [{ template: currentTemplate }].filter(matches) : [];
  const choose = (look: VaultLook) => {
    if (onCreateFromFile && look.path) onCreateFromFile(look.path);
    else if (onCreateFromFile && onCreateFromBuiltIn) onCreateFromBuiltIn(look.template);
    else onApply(look.template, look.sourceJSON ?? null);
  };
  return <div ref={dialog} className="vault-template-dialog vault-template-library" role="dialog" aria-modal="true" aria-label={title}>
    <header className="vault-template-header"><div><h2>{title}</h2>
      <p>{onCreateFromFile ? "Start with a ready-made document. Make it yours as you write." : "Choose how this document reads. Your content stays with it."}</p></div>
      <button onClick={onClose}>Close</button></header>
    <input className="vault-template-search" type="search" aria-label="Search templates" placeholder="Search templates" value={query} onChange={(event) => setQuery(event.target.value)} />
    {loading && <p role="status">Reading template files…</p>}
    {!loading && !looks.length && !notice && !onCreateFromFile && <p>Save a look from any document to add your own.</p>}
    {visible.length > 0 && <><h3>Your templates</h3><VaultTemplateCards looks={visible} onChoose={choose} actionLabel={onCreateFromFile ? "Create document" : "Apply look"} /></>}
    {current.length > 0 && <><h3>This item</h3><VaultTemplateCards looks={current} onChoose={choose} actionLabel="Apply look" /></>}
    {(included.length > 0 || showFeed) && <><h3>{onCreateFromFile ? "Ready to create" : "Included looks"}</h3><VaultTemplateCards looks={included} onChoose={choose} actionLabel={onCreateFromFile ? "Create document" : "Apply look"} extra={feedCard} /></>}
    {!loading && query.trim() && visible.length + included.length + current.length === 0 && !showFeed && <p>No templates match “{query.trim()}”. Try another name.</p>}
    {notice && <div className="vault-template-notice"><p role="status">{notice}</p><button onClick={reload}>Read templates again</button></div>}
    <p className="vault-template-help">Edit a saved template yourself or ask the assistant to customize it.</p>
  </div>;
}
