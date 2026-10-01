"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { UnifiedDocumentEditor } from "@/components/document/UnifiedDocumentEditor";
import { DocumentRenderer } from "@/components/document/DocumentRenderer";
import { applyDocumentSnapshot, documentSnapshotFromYDoc } from "@/lib/collab/document";
import { validateTemplateDefinition } from "@/lib/presentation/schema";
import { authoringSourceSchema } from "@/lib/presentation/authoring-source";
import { compileItemTypeBlueprint } from "@/lib/presentation/item-type-blueprint";
import { BUILTIN_TEMPLATES } from "@/lib/presentation/templates";
import type { DocumentSnapshot } from "@/lib/documents/model";
import { FileCollaborationClient, type FileCollaborationStatus } from "./collaboration-client";
import { VaultError, vaultRequest, type VaultFile } from "./bridge";
import { asPost, localBlog, readDocument, readTemplate, writePayload } from "./model";
import { ArticleReader } from "./ArticleReader";
import { ArticleCapture } from "./ArticleCapture";
import { articleSource } from "@/lib/vault/article-capture";
import { WorkspaceTypeLibrary } from "./LocalTemplateLibrary";

export type VaultCollaborationConfig = { namespace: string; workspaceId: string; itemId: string };
export type VaultEditorProps = { initial: VaultFile; root: string; onChanged: () => void; onRemoved: () => void; registerFlush: (flush: () => Promise<boolean>, currentFile: () => VaultFile) => void };
function substitute<T>(value: T, assets: Map<string, string>): T {
  if (typeof value === "string") {
    let text = value as string;
    for (const [source, target] of assets) text = text.split(source).join(target);
    return text as T;
  }
  if (Array.isArray(value)) return value.map(entry => substitute(entry, assets)) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, substitute(entry, assets)])) as T;
  return value;
}

/** The relay owns shared writes; this component never snapshot-autosaves them. */
export function CollaborativeVaultEditor({ initial, config, registerFlush, onChanged }: VaultEditorProps & { config: VaultCollaborationConfig }) {
  const file = useRef(initial);
  const [opened, setOpened] = useState(initial);
  const [snapshot, setSnapshot] = useState(() => readDocument(initial));
  const [client, setClient] = useState<FileCollaborationClient | null>(null);
  const clientRef = useRef<FileCollaborationClient | null>(null);
  const [status, setStatus] = useState<FileCollaborationStatus>("offline");
  const [detail, setDetail] = useState("");
  const [canEdit, setCanEdit] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [reading, setReading] = useState(!!articleSource(snapshot));
  const [busy, setBusy] = useState(false);
  const latestSnapshot = useRef(snapshot);
  useEffect(() => { latestSnapshot.current = snapshot; }, [snapshot]);
  const template = useMemo(() => readTemplate(opened, snapshot), [opened, snapshot]);
  const assets = useMemo(() => {
    const mapping = new Map<string, string>(), urls: string[] = [];
    for (const asset of opened.assets ?? []) {
      const bytes = Uint8Array.from(atob(asset.data), character => character.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: asset.contentType || "application/octet-stream" })); urls.push(url);
      mapping.set(`assets/${asset.filename}`, url);
      if (asset.remoteURL) mapping.set(asset.remoteURL, url);
    }
    return { mapping, urls };
  }, [opened.assets]);
  useEffect(() => () => assets.urls.forEach(url => URL.revokeObjectURL(url)), [assets]);
  const resolveAssets = useCallback((document: DocumentSnapshot) => substitute(document, assets.mapping), [assets]);
  useEffect(() => {
    let stopped = false;
    const shared = new FileCollaborationClient({ server: config.namespace, workspaceId: config.workspaceId, itemId: config.itemId,
      active: document.visibilityState === "visible" && navigator.onLine,
      request: async (method, params, signal) => {
        try { return await vaultRequest(method === "read" ? "collaborationRead" : "collaborationPush", { ...params, itemId: config.itemId }, signal); }
        catch (error) {
          if (error instanceof VaultError) Object.assign(error, { status: error.code === "unauthorized" ? 401 : Number(error.code) || undefined });
          throw error;
        }
      },
      onChange: next => { if (!stopped) { latestSnapshot.current = next; setSnapshot(next); } },
      onStatus: (next, message) => { if (!stopped) { setStatus(next); setDetail(message ?? ""); setCanEdit(shared.canEdit); setClient(shared); } },
    });
    clientRef.current = shared;
    const visibility = () => shared.setActive(document.visibilityState === "visible" && navigator.onLine);
    document.addEventListener("visibilitychange", visibility); window.addEventListener("online", visibility); window.addEventListener("offline", visibility);
    void shared.start();
    return () => {
      stopped = true; shared.destroy(); clientRef.current = null;
      document.removeEventListener("visibilitychange", visibility); window.removeEventListener("online", visibility); window.removeEventListener("offline", visibility);
    };
  }, [config.namespace, config.workspaceId, config.itemId, generation]);
  const flush = useCallback(async () => {
    const shared = clientRef.current;
    if (!shared || (shared.hasPendingChanges && !await shared.flush())) return false;
    try {
      const next = await vaultRequest<VaultFile>("read", { path: shared.relativePath ?? file.current.path });
      file.current = next; setOpened(next);
    } catch { /* The journal is durable; a temporarily unavailable file replica must not lose edits. */ }
    onChanged(); return true;
  }, [onChanged]);
  useEffect(() => { registerFlush(flush, () => file.current); }, [flush, registerFlush]);
  const updateArticle = useCallback((transform: (document: DocumentSnapshot) => DocumentSnapshot) => {
    const shared = clientRef.current;
    if (!shared) throw new Error("The shared document is still opening.");
    shared.mutate(doc => applyDocumentSnapshot(doc, transform(documentSnapshotFromYDoc(doc)), "file-article-edit"));
  }, []);
  const reset = () => {
    const shared = clientRef.current;
    if (shared) { shared.destroy(); localStorage.removeItem(shared.journalKey); }
    setClient(null); setStatus("offline"); setDetail(""); setGeneration(value => value + 1);
  };
  const downloadRecovery = () => {
    const journal = clientRef.current?.recoveryJournal;
    const rawJournal = clientRef.current?.recoveryRawJournal;
    const url = URL.createObjectURL(new Blob([JSON.stringify({ document: latestSnapshot.current, journal, rawJournal }, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "TextText document recovery.json"; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const keepCopy = async () => {
    setBusy(true);
    try {
      const source = file.current, document = latestSnapshot.current;
      const fresh = await vaultRequest<VaultFile>("create", { title: `${document.content.title || "Untitled"} (recovered)`, folder: source.path.split("/").slice(0, -1).join("/"), sourcePath: source.path, sourceHash: source.hash });
      await vaultRequest("write", writePayload({ ...source, path: fresh.path, hash: fresh.hash, markdown: fresh.markdown }, document));
      onChanged(); reset();
    } catch (error) { setDetail(error instanceof Error ? error.message : "Could not save the recovery copy."); }
    finally { setBusy(false); }
  };
  const saveLook = async (name: string) => {
    if (!await flush()) return { ok: false, message: "Save this item before keeping its look." };
    const identity = { id: `local.${crypto.randomUUID()}`, version: 1 };
    let look = validateTemplateDefinition({ ...template, ...identity, name });
    let sourceJSON: string | null = null;
    if (file.current.templateAuthoringSourceJSON) {
      const source = authoringSourceSchema.parse(JSON.parse(file.current.templateAuthoringSourceJSON));
      source.blueprint.name = name;
      look = compileItemTypeBlueprint(source.blueprint, identity); sourceJSON = JSON.stringify(source);
    }
    const fresh = await vaultRequest<VaultFile>("create", { title: name, folder: "Templates", sourcePath: file.current.path, sourceHash: file.current.hash });
    const document = { ...latestSnapshot.current, presentation: { ...latestSnapshot.current.presentation, template: identity } };
    await vaultRequest("write", writePayload({ ...fresh, templateJSON: JSON.stringify(look), templateAuthoringSourceJSON: sourceJSON }, document, { template: look, sourceJSON }));
    onChanged(); return { ok: true, message: `Saved in ${fresh.path}` };
  };
  const blocked = status === "recovery" || status === "error";
  const ready = !!client?.hasBaseline;
  const editable = ready && canEdit && !blocked && !busy;
  const display = resolveAssets(snapshot);
  return <section className="vault-document">
    <header className="vault-document-path">{client?.relativePath ?? opened.path}</header>
    {(!ready || blocked || status === "offline" || detail) && <div className="vault-notice" role="status">
      {detail || (ready ? "Offline. Edits are kept on this device." : "Opening the shared document…")}
      {blocked ? <><button onClick={downloadRecovery}>Download recovery</button><button disabled={busy || client?.hasUnreadableJournal} onClick={() => void keepCopy()}>Save a copy and reopen</button>{!client?.hasPendingChanges && <button onClick={reset}>Reopen file</button>}</> : status === "offline" && <button onClick={() => void clientRef.current?.start()}>Retry</button>}
    </div>}
    {ready && <>
      {editable && <ArticleCapture document={snapshot} readCurrent={() => latestSnapshot.current} update={updateArticle} beforeCapture={flush} />}
      {articleSource(snapshot) && <div className="vault-reading-switch"><button aria-pressed={reading} onClick={() => setReading(true)}>Read</button>{editable && <button aria-pressed={!reading} onClick={() => setReading(false)}>Edit</button>}</div>}
      {!editable || reading ? (articleSource(snapshot) ? <ArticleReader document={display} template={template} update={editable ? updateArticle : undefined} /> : <DocumentRenderer document={display} template={template} />) :
        <UnifiedDocumentEditor key={`${config.itemId}:${generation}`} transport="local" localDocument={client.doc} resolveDocumentAssets={resolveAssets}
          onSaveAsLook={saveLook} blog={localBlog} post={asPost(snapshot, config.itemId)} template={template} availableTemplates={[template, ...BUILTIN_TEMPLATES.filter(value => value.id !== template.id)]}
          collab={{ postId: `${config.namespace}:${config.workspaceId}:${config.itemId}`, userName: "You", color: "#3970c5", canEdit: true }} onDone={async () => { await flush(); }}
          renderTemplateLibrary={props => <WorkspaceTypeLibrary currentTemplate={template} onClose={props.onClose} onApply={(nextTemplate, sourceJSON) => {
            props.onClose(); setBusy(true);
            void (async () => {
              if (!await flush()) throw new Error("Save pending edits before changing the look.");
              const source = await vaultRequest<VaultFile>("read", { path: file.current.path });
              // The file can be newer than the last relay response. Change only
              // its presentation, with the same file's revision guarding the write.
              const current = readDocument(source);
              const next = { ...current, presentation: { ...current.presentation, template: { id: nextTemplate.id, version: nextTemplate.version } } };
              const written = await vaultRequest<VaultFile>("write", writePayload(source, next, { template: nextTemplate, sourceJSON }));
              file.current = written; setOpened(written); setSnapshot(next); onChanged(); reset();
            })().catch(error => setDetail(error.message)).finally(() => setBusy(false));
          }} />} />}
    </>}
  </section>;
}
