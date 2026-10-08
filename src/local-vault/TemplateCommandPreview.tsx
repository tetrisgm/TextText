import { useEffect, useState } from "react";
import { vaultRequest, type VaultFile, type VaultListing } from "./bridge";
import { packIdentity } from "./pack";
import { prepareTemplateCommandPreview } from "./template-command-preview";
import styles from "./TemplateCommandPreview.module.css";
import { PreviewContent } from "./TemplatePreview";

export function TemplateCommandPreview({ tool, args, path, busy, canApprove, registerGuard, onKeep }: {
  tool: string; args: Record<string, unknown>; path: string; busy: boolean; canApprove: boolean;
  registerGuard: (guard: (() => Promise<void>) | null) => void; onKeep: () => void;
}) {
  const [preview, setPreview] = useState<{ file: VaultFile; proposal: ReturnType<typeof prepareTemplateCommandPreview>["proposal"] } | null>(null);
  const [error, setError] = useState("");
  const [original, setOriginal] = useState(false);
  useEffect(() => {
    let active = true;
    registerGuard(null);
    void (async () => {
      const file = await vaultRequest<VaultFile>("read", { path });
      if (file.path !== path) throw new Error("The preview target changed.");
      let source: VaultFile | undefined;
      if (tool === "update_item_type") {
        const listing = await vaultRequest<VaultListing>("list");
        const item = listing.items.find(item => item.itemId === args.source_item_id);
        if (!item) throw new Error("The template source is unavailable.");
        source = await vaultRequest<VaultFile>("read", { path: item.path });
        if (packIdentity(source.markdown) !== args.source_item_id) throw new Error("The template source changed.");
      }
      const prepared = prepareTemplateCommandPreview(tool, args, file, source);
      if (!active) return;
      setPreview({ file, proposal: prepared.proposal });
      registerGuard(async () => {
        const current = await vaultRequest<VaultFile>("read", { path });
        if (current.path !== file.path || current.hash !== file.hash) throw new Error("This file changed since the preview. Ask for a new proposal.");
        if (source) {
          const currentSource = await vaultRequest<VaultFile>("read", { path: source.path });
          if (currentSource.hash !== source.hash || packIdentity(currentSource.markdown) !== args.source_item_id) throw new Error("The template source changed. Ask for a new proposal.");
        }
      });
    })().catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "Preview unavailable."); });
    return () => { active = false; registerGuard(null); };
  }, [tool, args, path, registerGuard]);
  return <section className={styles.preview} aria-label="Template preview">
    <header><p>Preview on this file. Keeping this design saves a reusable template. This file stays unchanged.</p>
    {error && <p role="alert">{error}</p>}
    {preview && <><button aria-pressed={original} onClick={() => setOriginal(value => !value)}>{original ? "Show proposed design" : "Compare original"}</button>
      {canApprove && <button disabled={busy} onClick={onKeep}>Keep this design</button>}</>}
    </header>
    {preview && <details open><summary>Preview design</summary><div className={styles.document}><PreviewContent file={preview.file} proposal={preview.proposal} original={original} /></div></details>}
  </section>;
}
