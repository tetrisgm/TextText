import { useEffect, useRef, useState } from "react";
import { BUILTIN_TEMPLATES } from "@/lib/presentation/templates";
import { validateTemplateDefinition, type TemplateDefinition } from "@/lib/presentation/schema";
import { useDialogFocus } from "@/components/accessibility/useDialogFocus";
import { useEscapeLayer } from "./LocalKeyboard";
import { vaultRequest, type VaultListing } from "./bridge";

export type VaultLook = { template: TemplateDefinition; sourceJSON?: string | null; path?: string };
type TemplateMetadata = { path: string; hash: string; templateJSON?: string | null; templateAuthoringSourceJSON?: string | null };
const MAX_TEMPLATE_FILES = 100;

export function WorkspaceTypeLibrary({ onApply, onClose, currentTemplate, onCreateFromFile }: {
  onApply: (template: TemplateDefinition, sourceJSON?: string | null) => void;
  onClose: () => void;
  currentTemplate?: TemplateDefinition;
  onCreateFromFile?: (path: string) => void;
}) {
  const [looks, setLooks] = useState<VaultLook[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const dialog = useRef<HTMLDivElement>(null);
  useDialogFocus(dialog, true); useEscapeLayer(true, "Choose a look", onClose);
  useEffect(() => {
    let active = true;
    void (async () => {
      const listing = await vaultRequest<VaultListing>("list");
      const files = listing.items.filter((item) => /^Templates\//i.test(item.path));
      const found: VaultLook[] = [];
      let skipped = 0;
      for (const item of files.slice(0, MAX_TEMPLATE_FILES)) {
        if (!active) return;
        try {
          const metadata = await vaultRequest<TemplateMetadata>("template", { path: item.path });
          if (!metadata.templateJSON) continue;
          found.push({ template: validateTemplateDefinition(JSON.parse(metadata.templateJSON)), sourceJSON: metadata.templateAuthoringSourceJSON, path: item.path });
        } catch { skipped++; }
      }
      if (!active) return;
      setLooks(found);
      if (files.length > MAX_TEMPLATE_FILES) setNotice(`Showing the first ${MAX_TEMPLATE_FILES} template files.`);
      else if (skipped) setNotice(`${skipped} template ${skipped === 1 ? "file could" : "files could"} not be read.`);
    })().catch((error: Error) => { if (active) setNotice(error.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  return <div ref={dialog} className="vault-template-dialog" role="dialog" aria-modal="true" aria-label={onCreateFromFile ? "New from template" : "Choose a look"}>
    <button onClick={onClose}>Close</button><h2>{onCreateFromFile ? "New from template" : "Choose a look"}</h2>
    <h3>Your templates</h3>
    {loading && <p>Reading template files…</p>}
    {!loading && !looks.length && <p>Save a look to keep it in your Templates folder. You and your agent can edit that TextPack.</p>}
    {looks.map((look) => <button key={look.path} title={look.path} onClick={() => onCreateFromFile && look.path ? onCreateFromFile(look.path) : onApply(look.template, look.sourceJSON)}>{look.template.name}</button>)}
    {!onCreateFromFile && currentTemplate && !looks.some((look) => look.template.id === currentTemplate.id && look.template.version === currentTemplate.version) && !BUILTIN_TEMPLATES.some((template) => template.id === currentTemplate.id) &&
      <button onClick={() => onApply(currentTemplate)}>{currentTemplate.name} (this item)</button>}
    {notice && <p role="status">{notice}</p>}
    {!onCreateFromFile && <><h3>Included looks</h3>
    {BUILTIN_TEMPLATES.map((template) => <button key={template.id} onClick={() => onApply(template, null)}>{template.name}</button>)}</> }
  </div>;
}
