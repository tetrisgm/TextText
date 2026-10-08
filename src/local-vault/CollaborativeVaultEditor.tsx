"use client";
import { VaultNoteTemplatePicker } from "./VaultNoteTemplatePicker";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { UnifiedDocumentEditor, type EditorImagePasteRequest, type EditorImagePasteResult } from "@/components/document/UnifiedDocumentEditor";
import { DocumentRenderer } from "@/components/document/DocumentRenderer";
import { applyDocumentSnapshot, documentSnapshotFromYDoc } from "@/lib/collab/document";
import { validateTemplateDefinition } from "@/lib/presentation/schema";
import { authoringSourceSchema } from "@/lib/presentation/authoring-source";
import { compileItemTypeBlueprint } from "@/lib/presentation/item-type-blueprint";
import { BUILTIN_TEMPLATES, templateExperience } from "@/lib/presentation/templates";
import type { DocumentSnapshot } from "@/lib/documents/model";
import { FileCollaborationClient, type FileCollaborationStatus } from "./collaboration-client";
import { FilePresenceClient, type FilePresenceMethod } from "./presence-client";
import type { PresencePeer } from "@/lib/collab/provider";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { VaultError, vaultRequest, type VaultFile } from "./bridge";
import { asPost, localBlog, readDocument, readTemplate, writePayload } from "./model";
import { ArticleReader } from "./ArticleReader";
import { toggleNoteTask, VaultNoteDisplay } from "./VaultNoteDisplay";
import { VaultStoryDisplay } from "./VaultStoryDisplay";
import { ArticleCapture } from "./ArticleCapture";
import { articleSource } from "@/lib/vault/article-capture";
import { WorkspaceTypeLibrary } from "./LocalTemplateLibrary";
import { flushForNavigation } from "./navigation-flush";
import { DetachedFileSaveProof } from "./detached-file-save";
import { prepareEditorImagePaste } from "./editor-image-paste";
import { queueArticleEnrichment } from "./article-enrichment";
import { currentVaultWindowActive } from "./window-activity";
import { applyStoryDetails, type StoryDetails } from "./story-details";

export type VaultCollaborationConfig = { namespace: string; workspaceId: string; itemId: string; localFiles?: boolean };
type NativeSharedSession = { sessionToken: string; path: string; hash: string; acknowledgedRevision: string; journal: string | null; retiredReason: string | null };
export type VaultEditorProps = {
  referenceChoices?: readonly import("@/lib/presentation/workspace-reference-choices").WorkspaceReferenceChoice[];
  readOnly?: boolean; initial: VaultFile; root: string; onChanged: () => void; onRemoved: () => void; onTitleChange?: (path: string, title: string) => void; registerFlush: (flush: (navigation?: boolean) => Promise<boolean>, currentFile: () => VaultFile, publishFlush: () => Promise<string | false>, saveStoryDetails: (details: StoryDetails) => Promise<string | false>) => void; startEditing?: boolean; focusNewNote?: boolean; focusNewNoteTitle?: boolean; focusNewNoteOrigin?: HTMLElement | null; focusNewNoteSelection?: { anchor: number; head: number } | null; onNewNoteFocusHandled?: () => void };
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
export function CollaborativeVaultEditor({ referenceChoices, readOnly: permissionReadOnly = false, initial, root, config, registerFlush, onChanged, onTitleChange, onLocalFallback, startEditing, focusNewNote, focusNewNoteTitle, focusNewNoteOrigin, focusNewNoteSelection, onNewNoteFocusHandled }: VaultEditorProps & { config: VaultCollaborationConfig; onLocalFallback?: () => void }) {
  const file = useRef(initial);
  const [opened, setOpened] = useState(initial);
  const [snapshot, setSnapshot] = useState(() => readDocument(initial));
  const [client, setClient] = useState<FileCollaborationClient | null>(null);
  const awareness = useMemo(() => client ? new Awareness(client.doc) : null, [client]);
  const presenceRef = useRef<FilePresenceClient | null>(null);
  const [presencePeers, setPresencePeers] = useState<PresencePeer[]>([]);
  const clientRef = useRef<FileCollaborationClient | null>(null);
  const nativeSessionRef = useRef<NativeSharedSession | null>(null);
  const [status, setStatus] = useState<FileCollaborationStatus>("reconnecting");
  const [detail, setDetail] = useState("");
  const [canEdit, setCanEdit] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [reading, setReading] = useState(() => !startEditing && Boolean(articleSource(snapshot) ||
    (["article", "note"].includes(templateExperience(readTemplate(initial, snapshot)) ?? "") && !focusNewNote && !focusNewNoteTitle &&
      (snapshot.content.title.trim() || snapshot.content.body.trim()))));
  const [busy, setBusy] = useState(false);
  const [waitingForExternalSync, setWaitingForExternalSync] = useState(false);
  const externalReloadRef = useRef(false);
  const detachedSaveRef = useRef(new DetachedFileSaveProof());
  const autoResettingRef = useRef(false);
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
      currentVaultWindowActive());
    active();
    document.addEventListener("visibilitychange", active);
    window.addEventListener("focus", active); window.addEventListener("blur", active);
    window.addEventListener("online", active); window.addEventListener("offline", active);
    return () => {
      document.removeEventListener("visibilitychange", active);
      window.removeEventListener("focus", active); window.removeEventListener("blur", active);
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
    const visibility = () => shared?.setActive(currentVaultWindowActive(), navigator.onLine ? "paused" : "offline");
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
      active: currentVaultWindowActive(),
      inactiveReason: navigator.onLine ? "paused" : "offline",
      retainedJournal: native?.journal,
      localRevision: native?.acknowledgedRevision,
      initialRetirement: native?.retiredReason ?? undefined,
      checkpoint: native ? async ({ journal, document: next }) => {
        const active = native;
        if (!active) throw new Error("The local shared file session has closed. Your journal is kept.");
        const payload = writePayload({ ...file.current, ...journal.presentation }, next);
        const saved = await vaultRequest<{ path: string; hash: string }>("collaborationCheckpoint", {
          itemId: config.itemId, sessionToken: active.sessionToken, hash: file.current.hash,
          epoch: journal.epoch, seq: journal.seq, revision: journal.revision,
          journalGeneration: journal.journalGeneration, journal: JSON.stringify(journal),
          pending: Boolean(journal.batch || journal.pending.length || journal.unqueuedDirty),
          markdown: payload.markdown, documentJSON: payload.documentJSON,
        });
        file.current = { ...file.current, ...journal.presentation, ...saved, markdown: payload.markdown, documentJSON: payload.documentJSON };
      } : undefined,
      request: async (method, params, signal) => {
        try { return await vaultRequest(method === "read" ? "collaborationRead" : "collaborationPush", { ...params, itemId: config.itemId }, signal); }
        catch (error) {
          if (error instanceof VaultError) Object.assign(error, { status: error.code === "unauthorized" ? 401 : Number(error.code) || undefined });
          throw error;
        }
      },
      onChange: (next, presentation) => { if (!stopped) { if (presentation) { file.current = { ...file.current, ...presentation }; setOpened(file.current); } latestSnapshot.current = next; setSnapshot(next); onTitleChange?.(file.current.path, next.content.title); } },
      onStatus: (next, message) => { if (!stopped && shared) { setStatus(next); setDetail(message ?? ""); setCanEdit(shared.canEdit); setClient(shared); } },
    });
    detachedSaveRef.current.clear();
    clientRef.current = shared;
    document.addEventListener("visibilitychange", visibility); window.addEventListener("online", visibility); window.addEventListener("offline", visibility);
    window.addEventListener("focus", visibility); window.addEventListener("blur", visibility);
    await shared.start();
    if (!stopped) externalReloadRef.current = false;
    };
    void begin().catch(error => {
      if (stopped) return;
      if (config.localFiles && externalReloadRef.current && error instanceof VaultError && error.code === "local_changed") {
        setWaitingForExternalSync(true); setStatus("offline"); setDetail("Waiting for the updated file to sync…");
      } else { detachedSaveRef.current.clear(); setStatus("error"); setDetail(error instanceof Error ? error.message : "Could not open the shared file."); }
    });
    return () => {
      stopped = true;
      const saved = shared?.flushLocal() ?? Promise.resolve(true);
      shared?.destroy(); clientRef.current = null;
      void saved.finally(closeNative);
      document.removeEventListener("visibilitychange", visibility); window.removeEventListener("online", visibility); window.removeEventListener("offline", visibility);
      window.removeEventListener("focus", visibility); window.removeEventListener("blur", visibility);
    };
  }, [config.namespace, config.workspaceId, config.itemId, config.localFiles, generation, onTitleChange]);
  useEffect(() => {
    if (!config.localFiles) return;
    let stopped = false, reading = false, queued = false;
    const check = async () => {
      if (reading) return;
      reading = true;
      try {
        while (queued && !stopped) {
          queued = false;
          const shared = clientRef.current;
          if (!shared?.hasBaseline || shared.status === "stale-file") return;
          try {
            const latest = await vaultRequest<VaultFile>("read", { path: file.current.path });
            if (!stopped && latest.hash !== file.current.hash) { shared.notifyExternalFileChange(); return; }
          } catch { /* A missing or unavailable file keeps the existing recovery path. */ }
        }
      } finally { reading = false; }
    };
    const changed = () => {
      queued = true;
      void check();
    };
    window.addEventListener("texttext:vault-changed", changed);
    return () => { stopped = true; window.removeEventListener("texttext:vault-changed", changed); };
  }, [config.localFiles, generation]);
  const flush = useCallback(async (navigation = false) => {
    const shared = clientRef.current;
    if (!shared) return Boolean(config.localFiles && waitingForExternalSync && !nativeSessionRef.current && detachedSaveRef.current.matches(file.current));
    if (navigation && !config.localFiles) return flushForNavigation(shared, onChanged);
    if (config.localFiles) {
      if (navigator.onLine && shared.hasPendingChanges) await shared.flush();
      if (!await shared.flushLocal()) return false;
    } else if (shared.hasPendingChanges && !await shared.flush()) return false;
    try {
      const next = await vaultRequest<VaultFile>("read", { path: shared.relativePath ?? file.current.path });
      file.current = next; setOpened(next);
    } catch { /* The journal is durable; a temporarily unavailable file replica must not lose edits. */ }
    onChanged(); return true;
  }, [config.localFiles, waitingForExternalSync, onChanged]);
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
  const updateArticle = useCallback((transform: (document: DocumentSnapshot) => DocumentSnapshot) => {
    const shared = clientRef.current;
    if (!shared) throw new Error("The shared document is still opening.");
    shared.mutate(doc => applyDocumentSnapshot(doc, transform(documentSnapshotFromYDoc(doc)), "file-article-edit"));
  }, []);
  const saveStoryDetails = useCallback(async (details: StoryDetails) => {
    if (!await publishFlush()) return false;
    updateArticle(document => applyStoryDetails(document, details));
    return publishFlush();
  }, [publishFlush, updateArticle]);
  useEffect(() => { registerFlush(flush, () => file.current, publishFlush, saveStoryDetails); }, [flush, publishFlush, registerFlush, saveStoryDetails]);
  const reset = useCallback(async (recovered = false, waitForSync = false) => {
    detachedSaveRef.current.clear();
    const shared = clientRef.current;
    try {
      const native = nativeSessionRef.current;
      if (native) {
        if (shared && !await shared.flushLocal() && (shared.hasPendingChanges || shared.hasUnreadableJournal)) throw new Error("Save or recover the pending local file before reopening.");
        await vaultRequest("collaborationClose", { itemId: config.itemId, sessionToken: native.sessionToken });
        nativeSessionRef.current = null;
      }
      const fresh = await vaultRequest<VaultFile>("read", { path: shared?.relativePath ?? file.current.path });
      const freshSnapshot = readDocument(fresh);
      if (shared) {
        if (recovered) shared.clearRetiredAfterRecovery();
        else if (waitForSync && config.localFiles) detachedSaveRef.current.retire(shared, fresh);
        else shared.discardCleanJournal();
        shared.destroy();
        if (clientRef.current === shared) clientRef.current = null;
      }
      file.current = fresh; setOpened(fresh); setSnapshot(freshSnapshot);
      setClient(null); setStatus("offline");
      if (waitForSync) {
        externalReloadRef.current = true;
        setDetail("Waiting for the updated file to sync…"); setWaitingForExternalSync(true);
      } else {
        externalReloadRef.current = false; setWaitingForExternalSync(false);
        setDetail(""); setGeneration(value => value + 1);
      }
      onChanged();
    } catch (error) {
      detachedSaveRef.current.clear();
      if (waitForSync) setStatus("error");
      setDetail(error instanceof Error ? error.message : "Could not reopen the file.");
    }
  }, [config.itemId, config.localFiles, onChanged]);
  const pasteImages = useCallback(async (request: EditorImagePasteRequest): Promise<EditorImagePasteResult> => {
    let closedNativeSession = false;
    try {
      const shared = clientRef.current;
      if (!shared?.hasBaseline || !shared.canEdit) throw new Error("The shared document is not ready for image paste.");
      if (!await flush() || shared.hasPendingChanges) throw new Error("Finish saving shared text before pasting an image.");
      const source = await vaultRequest<VaultFile>("read", { path: shared.relativePath ?? file.current.path });
      const sourceDocument = readDocument(source);
      if (JSON.stringify(sourceDocument) !== JSON.stringify(request.document) ||
          JSON.stringify(documentSnapshotFromYDoc(shared.doc)) !== JSON.stringify(request.document)) {
        throw new Error("The shared document changed. Paste the image again.");
      }
      const edit = await prepareEditorImagePaste({
        document: sourceDocument,
        selection: request.selection,
        files: request.files,
        occupiedFilenames: source.assets?.map(asset => asset.filename),
      });
      if (JSON.stringify(documentSnapshotFromYDoc(shared.doc)) !== JSON.stringify(request.document)) {
        throw new Error("The shared document changed. Paste the image again.");
      }
      const native = nativeSessionRef.current;
      if (native) {
        shared.setActive(false);
        if (!await shared.flushLocal()) throw new Error("Finish saving the local file before pasting an image.");
        await vaultRequest("collaborationClose", { itemId: config.itemId, sessionToken: native.sessionToken });
        nativeSessionRef.current = null;
        closedNativeSession = true;
      }
      const written = await vaultRequest<VaultFile>("write", {
        ...writePayload(source, edit.document),
        addedAssets: edit.addedAssets,
      });
      file.current = written;
      latestSnapshot.current = edit.document;
      setOpened(written);
      setSnapshot(edit.document);
      onChanged();
      await reset();
      return { caret: edit.caret };
    } catch (error) {
      if (closedNativeSession) await reset().catch(() => {});
      setDetail(error instanceof Error ? error.message : "The image could not be pasted. Your text is still here.");
      return undefined;
    }
  }, [config.itemId, flush, onChanged, reset]);
  useEffect(() => {
    if (status !== "stale-session" || !config.localFiles || autoResettingRef.current) return;
    autoResettingRef.current = true;
    void reset().finally(() => { autoResettingRef.current = false; });
  }, [status, config.localFiles, reset]);
  useEffect(() => {
    if (status !== "stale-file" || !config.localFiles || autoResettingRef.current) return;
    autoResettingRef.current = true;
    void reset(false, true).finally(() => { autoResettingRef.current = false; });
  }, [status, config.localFiles, reset]);
  useEffect(() => {
    if (status !== "stale-file" || config.localFiles || autoResettingRef.current) return;
    // The client reaches stale-file only with a clean journal. Web workspaces
    // already have the changed TextPack on the server, so reopen it directly.
    autoResettingRef.current = true;
    void reset().finally(() => { autoResettingRef.current = false; });
  }, [status, config.localFiles, reset]);
  useEffect(() => {
    if (!waitingForExternalSync || !config.localFiles) return;
    let stopped = false, running = false;
    const check = () => {
      if (stopped || running) return;
      running = true;
      void (async () => {
        const path = file.current.path;
        const candidate = await vaultRequest<VaultCollaborationConfig | null>("collaborationConfig", { path, readyOnly: true });
        if (!candidate || candidate.itemId !== config.itemId || candidate.workspaceId !== config.workspaceId || candidate.namespace !== config.namespace) return;
        const fresh = await vaultRequest<VaultFile>("read", { path });
        const confirmed = await vaultRequest<VaultCollaborationConfig | null>("collaborationConfig", { path, readyOnly: true });
        if (stopped || fresh.path !== path || !confirmed || confirmed.itemId !== candidate.itemId || confirmed.workspaceId !== candidate.workspaceId || confirmed.namespace !== candidate.namespace) return;
        stopped = true;
        file.current = fresh; setOpened(fresh); setSnapshot(readDocument(fresh));
        setWaitingForExternalSync(false); setDetail(""); setGeneration(value => value + 1);
      })().catch(() => { /* A sync completion or connection change will check again. */ })
        .finally(() => { running = false; });
    };
    const onSync = (event: Event) => { if ((event as CustomEvent<{ connected?: boolean }>).detail?.connected) check(); };
    window.addEventListener("texttext:vault-sync-status", onSync);
    check();
    return () => { stopped = true; window.removeEventListener("texttext:vault-sync-status", onSync); };
  }, [waitingForExternalSync, config.localFiles, config.itemId, config.workspaceId, config.namespace]);
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
    let look = validateTemplateDefinition({ ...template, ...identity, name, experience: templateExperience(template) ?? undefined });
    let sourceJSON: string | null = null;
    if (file.current.templateAuthoringSourceJSON) {
      const source = authoringSourceSchema.parse(JSON.parse(file.current.templateAuthoringSourceJSON));
      source.blueprint.name = name;
      look = validateTemplateDefinition({ ...compileItemTypeBlueprint(source.blueprint, identity), experience: templateExperience(template) ?? undefined }); sourceJSON = JSON.stringify(source);
    }
    const fresh = await vaultRequest<VaultFile>("create", { title: name, folder: "Templates", sourcePath: file.current.path, sourceHash: file.current.hash });
    const document = { ...latestSnapshot.current, presentation: { ...latestSnapshot.current.presentation, template: identity } };
    await vaultRequest("write", writePayload({ ...fresh, templateJSON: JSON.stringify(look), templateAuthoringSourceJSON: sourceJSON }, document, { template: look, sourceJSON }));
    onChanged(); return { ok: true, message: `Saved in ${fresh.path}` };
  };
  const blocked = status === "recovery" || status === "error";
  const ready = !!client?.hasBaseline;
  const editable = ready && canEdit && !permissionReadOnly && !blocked && !busy;
  const readOnly = ready && !canEdit && !detail && status !== "offline" && !blocked;
  const display = useMemo(() => resolveAssets(snapshot), [snapshot, resolveAssets]);
  const experience = templateExperience(template);
  return <section className="vault-document">
    {presencePeers.length > 0 && <div className="vault-document-presence"><span aria-label={`${presencePeers.length} ${presencePeers.length === 1 ? "person" : "people"} here: ${presencePeers.slice(0, 3).map(peer => peer.userName).join(", ")}${presencePeers.length > 3 ? ` and ${presencePeers.length - 3} more` : ""}`}
        style={{ display: "inline-flex", alignItems: "center", flexShrink: 0, gap: 3 }}>
        {presencePeers.slice(0, 3).map(peer => <span key={peer.clientId} title={`${peer.userName} is here`}
          style={{ display: "inline-grid", placeItems: "center", width: 22, height: 22, borderRadius: "50%",
            background: peer.color, color: avatarTextColor(peer.color), fontSize: 11, fontWeight: 700 }} aria-hidden="true">
          {peer.userName.trim().slice(0, 1).toUpperCase() || "?"}
        </span>)}
        <span style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {presencePeers.length > 3 ? `+${presencePeers.length - 3}` : presencePeers.length === 1 ? presencePeers[0].userName : `${presencePeers.length} here`}
        </span>
      </span></div>}
    {(!ready || blocked || status === "offline" || detail || readOnly) && <div className="vault-notice" role="status">
      {detail || (readOnly ? "Read only. You don’t have editing access." : ready ? "Offline. Edits are kept on this device." : "Opening the shared document…")}
      {config.localFiles && status === "offline" && !ready && client && !client.hasPendingChanges && !client.hasUnreadableJournal &&
        <button onClick={onLocalFallback}>Edit local file</button>}
      {waitingForExternalSync && !client && onLocalFallback && <button onClick={onLocalFallback}>Edit local file</button>}
      {blocked ? <><button onClick={downloadRecovery}>Download recovery</button><button disabled={busy || client?.hasUnreadableJournal} onClick={() => void keepCopy()}>Save a copy and reopen</button>{!client?.hasPendingChanges && <button onClick={() => void reset()}>Reopen file</button>}</> : status === "offline" && !waitingForExternalSync && <button onClick={() => void clientRef.current?.retry()}>Retry</button>}
    </div>}
    {ready && <>
      {editable && <ArticleCapture document={snapshot} readCurrent={() => latestSnapshot.current} update={updateArticle} beforeCapture={flush} onMediaPending={() => queueArticleEnrichment(root, file.current.path)} />}
      {articleSource(snapshot) && <div className="vault-reading-switch"><button aria-pressed={reading} onClick={() => setReading(true)}>Read</button>{editable && <button aria-pressed={!reading} onClick={() => setReading(false)}>Edit</button>}</div>}
      {!editable || reading ? (articleSource(snapshot) ? <ArticleReader document={display} template={template} update={editable ? updateArticle : undefined} /> : experience === "note" ? <VaultNoteDisplay document={display} sourceBody={snapshot.content.body} template={template} onEdit={editable ? () => setReading(false) : undefined} onToggleTask={editable ? (index, body) => updateArticle(current => current.content.body !== body ? current : { ...current, content: { ...current.content, body: toggleNoteTask(body, index) ?? body } }) : undefined} /> : experience === "article" ? <VaultStoryDisplay document={display} template={template} onEdit={editable ? () => setReading(false) : undefined} /> : <DocumentRenderer document={display} template={template} />) :
        <UnifiedDocumentEditor referenceChoices={referenceChoices} renderNoteTemplatePicker={props => <VaultNoteTemplatePicker {...props} />} key={`${config.itemId}:${generation}`} transport="local" localDocument={client.doc} localPresence={awareness ? { awareness, peers: presencePeers } : undefined} resolveDocumentAssets={resolveAssets}
          focusNewNote={focusNewNote} focusNewNoteTitle={focusNewNoteTitle} focusNewNoteOrigin={focusNewNoteOrigin} focusNewNoteSelection={focusNewNoteSelection} onNewNoteFocusHandled={onNewNoteFocusHandled}
          onPasteImages={pasteImages} onSaveAsLook={saveLook} blog={localBlog} post={asPost(snapshot, config.itemId)} template={template} availableTemplates={[template, ...BUILTIN_TEMPLATES.filter(value => value.id !== template.id)]}
          collab={{ postId: `${config.namespace}:${config.workspaceId}:${config.itemId}`, userName: "You", color: "#3970c5", canEdit: true }} onDone={async () => { if (await flush() && (experience === "note" || experience === "article")) setReading(true); }}
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
