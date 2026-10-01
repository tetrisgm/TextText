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
import { FilePresenceClient, type FilePresenceMethod } from "./presence-client";
import type { PresencePeer } from "@/lib/collab/provider";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { VaultError, vaultRequest, type VaultFile } from "./bridge";
import { asPost, localBlog, readDocument, readTemplate, writePayload } from "./model";
import { ArticleReader } from "./ArticleReader";
import { ArticleCapture } from "./ArticleCapture";
import { articleSource } from "@/lib/vault/article-capture";
import { WorkspaceTypeLibrary } from "./LocalTemplateLibrary";

export type VaultCollaborationConfig = { namespace: string; workspaceId: string; itemId: string; localFiles?: boolean };
type NativeSharedSession = { sessionToken: string; path: string; hash: string; acknowledgedRevision: string; journal: string | null; retiredReason: string | null };
export type VaultEditorProps = { initial: VaultFile; root: string; onChanged: () => void; onRemoved: () => void; registerFlush: (flush: () => Promise<boolean>, currentFile: () => VaultFile, publishFlush: () => Promise<string | false>) => void; focusNewNote?: boolean; focusNewNoteOrigin?: HTMLElement | null; onNewNoteFocusHandled?: () => void };
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
function avatarTextColor(color: string): string {
  const rgb = [1, 3, 5].map(index => Number.parseInt(color.slice(index, index + 2), 16) / 255);
  const linear = rgb.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722 > 0.179 ? "#000" : "#fff";
}

/** The relay owns shared writes; this component never snapshot-autosaves them. */
export function CollaborativeVaultEditor({ initial, config, registerFlush, onChanged, onLocalFallback, focusNewNote, focusNewNoteOrigin, onNewNoteFocusHandled }: VaultEditorProps & { config: VaultCollaborationConfig; onLocalFallback?: () => void }) {
  const file = useRef(initial);
  const [opened, setOpened] = useState(initial);
  const [snapshot, setSnapshot] = useState(() => readDocument(initial));
  const [client, setClient] = useState<FileCollaborationClient | null>(null);
  const awareness = useMemo(() => client ? new Awareness(client.doc) : null, [client]);
  const presenceRef = useRef<FilePresenceClient | null>(null);
  const [presencePeers, setPresencePeers] = useState<PresencePeer[]>([]);
  const clientRef = useRef<FileCollaborationClient | null>(null);
  const nativeSessionRef = useRef<NativeSharedSession | null>(null);
  const [status, setStatus] = useState<FileCollaborationStatus>("offline");
  const [detail, setDetail] = useState("");
  const [canEdit, setCanEdit] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [reading, setReading] = useState(!!articleSource(snapshot));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!awareness || !client?.hasBaseline) return;
    const presence = new FilePresenceClient({ itemId: config.itemId, awareness,
      request: (method: FilePresenceMethod, params, signal) => vaultRequest(method, params, signal),
      onPresence: setPresencePeers,
    });
    presenceRef.current = presence;
    return () => { presence.destroy(); if (presenceRef.current === presence) presenceRef.current = null; };
  }, [awareness, client?.hasBaseline, config.itemId]);
  useEffect(() => () => awareness?.destroy(), [awareness]);
  useEffect(() => {
    const active = () => presenceRef.current?.setActive(status === "ready" && !busy &&
      document.visibilityState === "visible" && navigator.onLine);
    active();
    document.addEventListener("visibilitychange", active);
    window.addEventListener("online", active); window.addEventListener("offline", active);
    return () => {
      document.removeEventListener("visibilitychange", active);
      window.removeEventListener("online", active); window.removeEventListener("offline", active);
    };
  }, [awareness, status, busy]);
  useEffect(() => { if (reading || !canEdit) awareness?.setLocalStateField("selection", null); }, [awareness, reading, canEdit]);
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
    let shared: FileCollaborationClient | null = null;
    let native: NativeSharedSession | null = null;
    const closeNative = async () => {
      if (native) {
        const closing = native; native = null;
        if (nativeSessionRef.current === closing) nativeSessionRef.current = null;
        await vaultRequest("collaborationClose", { itemId: config.itemId, sessionToken: closing.sessionToken }).catch(() => {});
      }
    };
    const visibility = () => shared?.setActive(document.visibilityState === "visible" && navigator.onLine);
    const begin = async () => {
      if (config.localFiles) {
        native = await vaultRequest<NativeSharedSession>("collaborationOpen", { itemId: config.itemId, path: file.current.path, hash: file.current.hash });
        if (stopped) { await closeNative(); return; }
        nativeSessionRef.current = native;
        if (native.hash !== file.current.hash || native.path !== file.current.path) {
          const restored = await vaultRequest<VaultFile>("read", { path: native.path });
          if (stopped) { await closeNative(); return; }
          file.current = restored; setOpened(restored);
        }
      }
      shared = new FileCollaborationClient({ server: config.namespace, workspaceId: config.workspaceId, itemId: config.itemId,
      active: document.visibilityState === "visible" && navigator.onLine,
      retainedJournal: native?.journal,
      localRevision: native?.acknowledgedRevision,
      initialRetirement: native?.retiredReason ?? undefined,
      checkpoint: native ? async ({ journal, document: next }) => {
        const active = native;
        if (!active) throw new Error("The local shared file session has closed. Your journal is kept.");
        const payload = writePayload(file.current, next);
        const saved = await vaultRequest<{ path: string; hash: string }>("collaborationCheckpoint", {
          itemId: config.itemId, sessionToken: active.sessionToken, hash: file.current.hash,
          epoch: journal.epoch, seq: journal.seq, revision: journal.revision,
          journalGeneration: journal.journalGeneration, journal: JSON.stringify(journal),
          pending: Boolean(journal.batch || journal.pending.length || journal.unqueuedDirty),
          markdown: payload.markdown, documentJSON: payload.documentJSON,
        });
        file.current = { ...file.current, ...saved, markdown: payload.markdown, documentJSON: payload.documentJSON };
      } : undefined,
      request: async (method, params, signal) => {
        try { return await vaultRequest(method === "read" ? "collaborationRead" : "collaborationPush", { ...params, itemId: config.itemId }, signal); }
        catch (error) {
          if (error instanceof VaultError) Object.assign(error, { status: error.code === "unauthorized" ? 401 : Number(error.code) || undefined });
          throw error;
        }
      },
      onChange: next => { if (!stopped) { latestSnapshot.current = next; setSnapshot(next); } },
      onStatus: (next, message) => { if (!stopped && shared) { setStatus(next); setDetail(message ?? ""); setCanEdit(shared.canEdit); setClient(shared); } },
    });
    clientRef.current = shared;
    document.addEventListener("visibilitychange", visibility); window.addEventListener("online", visibility); window.addEventListener("offline", visibility);
    await shared.start();
    };
    void begin().catch(error => { if (!stopped) { setStatus("error"); setDetail(error instanceof Error ? error.message : "Could not open the shared file."); } });
    return () => {
      stopped = true;
      const saved = shared?.flushLocal() ?? Promise.resolve(true);
      shared?.destroy(); clientRef.current = null;
      void saved.finally(closeNative);
      document.removeEventListener("visibilitychange", visibility); window.removeEventListener("online", visibility); window.removeEventListener("offline", visibility);
    };
  }, [config.namespace, config.workspaceId, config.itemId, config.localFiles, generation]);
  const flush = useCallback(async () => {
    const shared = clientRef.current;
    if (!shared) return false;
    if (config.localFiles) {
      if (navigator.onLine && shared.hasPendingChanges) await shared.flush();
      if (!await shared.flushLocal()) return false;
    } else if (shared.hasPendingChanges && !await shared.flush()) return false;
    try {
      const next = await vaultRequest<VaultFile>("read", { path: shared.relativePath ?? file.current.path });
      file.current = next; setOpened(next);
    } catch { /* The journal is durable; a temporarily unavailable file replica must not lose edits. */ }
    onChanged(); return true;
  }, [config.localFiles, onChanged]);
  const publishFlush = useCallback(async () => {
    const shared = clientRef.current;
    if (!shared?.hasBaseline || !navigator.onLine || shared.status !== "ready") return false;
    if (!await shared.flush() || shared.hasPendingChanges) return false;
    if (config.localFiles && !await shared.flushLocal()) return false;
    const saved = await vaultRequest<{ revision: string }>("publicationRead", { itemId: config.itemId });
    if (!/^[a-f0-9]{64}$/.test(saved.revision)) return false;
    if (saved.revision !== shared.revision) {
      // Comments and publication markers can change a TextPack's ZIP hash
      // without changing its Yjs sequence. Compare the current server document
      // before allowing that newer revision to be published.
      const remote = await vaultRequest<{ revision: string; epoch: number; seq: number; update: string }>("collaborationRead", { itemId: config.itemId });
      if (remote.revision !== saved.revision || remote.epoch !== shared.epoch || remote.seq !== shared.sequence ||
        typeof remote.update !== "string" || remote.update.length > 8 * 1024 * 1024) return false;
      const check = new Y.Doc();
      try {
        Y.applyUpdate(check, Uint8Array.from(atob(remote.update), character => character.charCodeAt(0)));
        if (JSON.stringify(documentSnapshotFromYDoc(check)) !== JSON.stringify(documentSnapshotFromYDoc(shared.doc))) return false;
      } finally { check.destroy(); }
    }
    return !shared.hasPendingChanges && shared.status === "ready" ? saved.revision : false;
  }, [config.itemId, config.localFiles]);
  useEffect(() => { registerFlush(flush, () => file.current, publishFlush); }, [flush, publishFlush, registerFlush]);
  const updateArticle = useCallback((transform: (document: DocumentSnapshot) => DocumentSnapshot) => {
    const shared = clientRef.current;
    if (!shared) throw new Error("The shared document is still opening.");
    shared.mutate(doc => applyDocumentSnapshot(doc, transform(documentSnapshotFromYDoc(doc)), "file-article-edit"));
  }, []);
  const reset = async (recovered = false) => {
    const shared = clientRef.current;
    try {
      const native = nativeSessionRef.current;
      if (native) {
        if (shared && !await shared.flushLocal() && (shared.hasPendingChanges || shared.hasUnreadableJournal)) throw new Error("Save or recover the pending local file before reopening.");
        await vaultRequest("collaborationClose", { itemId: config.itemId, sessionToken: native.sessionToken });
        nativeSessionRef.current = null;
      }
      const fresh = await vaultRequest<VaultFile>("read", { path: shared?.relativePath ?? file.current.path });
      if (shared) {
        if (recovered) shared.clearRetiredAfterRecovery();
        else shared.discardCleanJournal();
        shared.destroy();
      }
      file.current = fresh; setOpened(fresh); setSnapshot(readDocument(fresh));
      setClient(null); setStatus("offline"); setDetail(""); setGeneration(value => value + 1);
    } catch (error) { setDetail(error instanceof Error ? error.message : "Could not reopen the file."); }
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
      const recovered = await vaultRequest<VaultFile>("write", writePayload({ ...source, path: fresh.path, hash: fresh.hash, markdown: fresh.markdown }, document));
      const native = nativeSessionRef.current;
      if (native) {
        await clientRef.current?.flushLocal();
        await vaultRequest("collaborationRecover", { itemId: config.itemId, sessionToken: native.sessionToken, recoveryPath: recovered.path, recoveryHash: recovered.hash });
        nativeSessionRef.current = null;
      }
      onChanged(); await reset(true);
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
    <header className="vault-document-path" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <span style={{ minWidth: 0 }}>{client?.relativePath ?? opened.path}</span>
      {presencePeers.length > 0 && <span aria-label={`${presencePeers.length} ${presencePeers.length === 1 ? "person" : "people"} here: ${presencePeers.slice(0, 3).map(peer => peer.userName).join(", ")}${presencePeers.length > 3 ? ` and ${presencePeers.length - 3} more` : ""}`}
        style={{ display: "inline-flex", alignItems: "center", flexShrink: 0, gap: 3 }}>
        {presencePeers.slice(0, 3).map(peer => <span key={peer.clientId} title={`${peer.userName} is here`}
          style={{ display: "inline-grid", placeItems: "center", width: 22, height: 22, borderRadius: "50%",
            background: peer.color, color: avatarTextColor(peer.color), fontSize: 11, fontWeight: 700 }} aria-hidden="true">
          {peer.userName.trim().slice(0, 1).toUpperCase() || "?"}
        </span>)}
        <span style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {presencePeers.length > 3 ? `+${presencePeers.length - 3}` : presencePeers.length === 1 ? presencePeers[0].userName : `${presencePeers.length} here`}
        </span>
      </span>}
    </header>
    {(!ready || blocked || status === "offline" || detail) && <div className="vault-notice" role="status">
      {detail || (ready ? "Offline. Edits are kept on this device." : "Opening the shared document…")}
      {config.localFiles && status === "offline" && !ready && client && !client.hasPendingChanges && !client.hasUnreadableJournal &&
        <button onClick={onLocalFallback}>Edit local file</button>}
      {blocked ? <><button onClick={downloadRecovery}>Download recovery</button><button disabled={busy || client?.hasUnreadableJournal} onClick={() => void keepCopy()}>Save a copy and reopen</button>{!client?.hasPendingChanges && <button onClick={() => void reset()}>Reopen file</button>}</> : status === "offline" && <button onClick={() => void clientRef.current?.retry()}>Retry</button>}
    </div>}
    {ready && <>
      {editable && <ArticleCapture document={snapshot} readCurrent={() => latestSnapshot.current} update={updateArticle} beforeCapture={flush} />}
      {articleSource(snapshot) && <div className="vault-reading-switch"><button aria-pressed={reading} onClick={() => setReading(true)}>Read</button>{editable && <button aria-pressed={!reading} onClick={() => setReading(false)}>Edit</button>}</div>}
      {!editable || reading ? (articleSource(snapshot) ? <ArticleReader document={display} template={template} update={editable ? updateArticle : undefined} /> : <DocumentRenderer document={display} template={template} />) :
        <UnifiedDocumentEditor key={`${config.itemId}:${generation}`} transport="local" localDocument={client.doc} localPresence={awareness ? { awareness, peers: presencePeers } : undefined} resolveDocumentAssets={resolveAssets}
          focusNewNote={focusNewNote} focusNewNoteOrigin={focusNewNoteOrigin} onNewNoteFocusHandled={onNewNoteFocusHandled}
          onSaveAsLook={saveLook} blog={localBlog} post={asPost(snapshot, config.itemId)} template={template} availableTemplates={[template, ...BUILTIN_TEMPLATES.filter(value => value.id !== template.id)]}
          collab={{ postId: `${config.namespace}:${config.workspaceId}:${config.itemId}`, userName: "You", color: "#3970c5", canEdit: true }} onDone={async () => { await flush(); }}
          renderTemplateLibrary={props => <WorkspaceTypeLibrary currentTemplate={template} onClose={props.onClose} onApply={(nextTemplate, sourceJSON) => {
            props.onClose(); setBusy(true);
            void (async () => {
              if (!await flush()) throw new Error("Save pending edits before changing the look.");
              if (clientRef.current?.hasPendingChanges) throw new Error("Reconnect and finish sharing pending edits before changing the look.");
              const source = await vaultRequest<VaultFile>("read", { path: file.current.path });
              // The file can be newer than the last relay response. Change only
              // its presentation, with the same file's revision guarding the write.
              const current = readDocument(source);
              const next = { ...current, presentation: { ...current.presentation, template: { id: nextTemplate.id, version: nextTemplate.version } } };
              const native = nativeSessionRef.current;
              if (native) {
                clientRef.current?.setActive(false);
                if (!await clientRef.current?.flushLocal()) throw new Error("Finish saving the local file before changing the look.");
                await vaultRequest("collaborationClose", { itemId: config.itemId, sessionToken: native.sessionToken });
                nativeSessionRef.current = null;
              }
              const written = await vaultRequest<VaultFile>("write", writePayload(source, next, { template: nextTemplate, sourceJSON }));
              file.current = written; setOpened(written); setSnapshot(next); onChanged(); await reset();
            })().catch(error => setDetail(error.message)).finally(() => setBusy(false));
          }} />} />}
    </>}
  </section>;
}
