import { useEffect, useState } from "react";
import { BUILTIN_TEMPLATES } from "@/lib/presentation/templates";
import { vaultRequest, type VaultFile, type VaultItem } from "./bridge";
import type { FolderPreview } from "./folder-collection";
import { ArticleReader } from "./ArticleReader";
import { readDocument, writePayload } from "./model";
import type { DocumentSnapshot } from "@/lib/documents/model";

function host(url?: string): string {
  try { return url ? new URL(url).hostname.replace(/^www\./, "") : "Saved link"; }
  catch { return "Saved link"; }
}

export function VaultBookmarkLibrary({ items, previews, busy, previewOnly, onOpen }: {
  items: VaultItem[]; previews: Record<string, FolderPreview>; busy: boolean; previewOnly: boolean; onOpen: (path: string) => void;
}) {
  const [selected, setSelected] = useState("");
  const current = items.find(item => item.path === selected) || items[0];
  const preview = current && previews[current.path];
  const [opened, setOpened] = useState<{ path: string; file: VaultFile; document: DocumentSnapshot; urls: string[] } | null>(null);
  const [flags, setFlags] = useState<Record<string, { favorite: boolean; readAt: string | null }>>({});
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!current) return;
    let active = true;
    const controller = new AbortController();
    void vaultRequest<VaultFile>("read", { path: current.path }, controller.signal)
      .then(file => {
        if (!active) return;
        const urls: string[] = [];
        const replacements = new Map<string, string>();
        for (const asset of file.assets ?? []) {
          const bytes = Uint8Array.from(atob(asset.data), character => character.charCodeAt(0));
          const url = URL.createObjectURL(new Blob([bytes], { type: asset.contentType || "application/octet-stream" }));
          urls.push(url);
          replacements.set(`assets/${asset.filename}`, url);
          if (asset.remoteURL) replacements.set(asset.remoteURL, url);
        }
        let serialized = JSON.stringify(readDocument(file));
        for (const [source, target] of replacements) serialized = serialized.split(source).join(target);
        setOpened({ path: file.path, file, document: JSON.parse(serialized) as DocumentSnapshot, urls });
      }).catch(() => { if (active) setOpened(null); });
    return () => { active = false; controller.abort(); };
  }, [current?.path]);
  useEffect(() => () => { opened?.urls.forEach(url => URL.revokeObjectURL(url)); }, [opened?.urls]);
  const template = BUILTIN_TEMPLATES.find(item => item.id === "texttext.bookmark");
  const document = opened?.path === current?.path ? opened.document : null;
  const favorite = Boolean(document?.content.fields.texttextBookmarkFavorite);
  const readAt = typeof document?.content.fields.texttextBookmarkReadAt === "string" ? document.content.fields.texttextBookmarkReadAt : null;
  const changeFlag = async (field: "texttextBookmarkFavorite" | "texttextBookmarkReadAt") => {
    if (!opened || opened.path !== current?.path || updating || busy || previewOnly) return;
    setUpdating(true); setError("");
    try {
      const canonical = readDocument(opened.file);
      const nextFields = { ...canonical.content.fields, [field]: field === "texttextBookmarkFavorite" ? !Boolean(canonical.content.fields[field])
        : typeof canonical.content.fields[field] === "string" ? null : new Date().toISOString() };
      const updated = await vaultRequest<VaultFile>("write", writePayload(opened.file, { ...canonical, content: { ...canonical.content, fields: nextFields } }));
      setOpened(previous => previous?.path === updated.path ? { ...previous, file: updated, document: { ...previous.document, content: { ...previous.document.content, fields: nextFields } } } : previous);
      setFlags(previous => ({ ...previous, [updated.path]: { favorite: Boolean(nextFields.texttextBookmarkFavorite), readAt: typeof nextFields.texttextBookmarkReadAt === "string" ? nextFields.texttextBookmarkReadAt : null } }));
      window.dispatchEvent(new Event("texttext:vault-changed"));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Bookmark status could not be saved."); }
    finally { setUpdating(false); }
  };
  return <div className="vault-bookmark-library">
    <div className="vault-bookmark-list" role="listbox" aria-label="Saved bookmarks">
      <div className="vault-bookmark-day">Saved links</div>
      {items.map(item => { const entry = previews[item.path]; const title = entry?.title || item.title || item.path.split("/").at(-1)?.replace(/\.textpack$/i, "") || "Untitled";
        const itemFavorite = flags[item.path]?.favorite ?? Boolean(entry?.document?.content.fields.texttextBookmarkFavorite);
        const itemRead = flags[item.path] ? flags[item.path].readAt : (typeof entry?.document?.content.fields.texttextBookmarkReadAt === "string" ? entry.document.content.fields.texttextBookmarkReadAt : null);
        return <button role="option" aria-selected={current?.path === item.path} key={item.path} disabled={busy || previewOnly} onClick={() => setSelected(item.path)} onDoubleClick={() => onOpen(item.path)}>
          <span className="vault-bookmark-mark" aria-hidden="true">{host(entry?.sourceURL).slice(0, 1).toUpperCase()}</span>
          <span className="vault-bookmark-copy"><strong>{title}</strong><small>{host(entry?.sourceURL)}{itemRead ? " · Read" : ""}</small></span>{itemFavorite && <span className="vault-bookmark-favorite" aria-label="Favorite">★</span>}
        </button>; })}
    </div>
    <article className="vault-bookmark-reader" aria-label="Bookmark reader">
      {current && <header><span>Reader</span><div><button disabled={busy || previewOnly || updating || !document} aria-pressed={favorite} onClick={() => void changeFlag("texttextBookmarkFavorite")}>{favorite ? "★ Favorite" : "☆ Favorite"}</button><button disabled={busy || previewOnly || updating || !document} onClick={() => void changeFlag("texttextBookmarkReadAt")}>{readAt ? "Mark unread" : "Mark read"}</button><button disabled={busy || previewOnly} onClick={() => onOpen(current.path)}>Edit</button>{preview?.sourceURL && <a href={preview.sourceURL} target="_blank" rel="noopener noreferrer">Original ↗</a>}</div></header>}
      {error && <p role="alert" className="vault-bookmark-error">{error}</p>}
      {document && template ? <ArticleReader document={document} template={template} /> : <p>{current ? "Reading saved page…" : "Save a link to start reading."}</p>}
    </article>
  </div>;
}
