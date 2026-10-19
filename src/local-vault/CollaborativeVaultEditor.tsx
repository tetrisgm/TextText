"use client";
import { HostedVaultEditor } from "./editor-surface-host";
import { VaultNoteTemplatePicker } from "./VaultNoteTemplatePicker";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { EditorImagePasteRequest, EditorImagePasteResult, LocalDocumentRebind } from "@/components/document/UnifiedDocumentEditor";
import { DocumentRenderer } from "@/components/document/DocumentRenderer";
import { applyDocumentSnapshot, documentSnapshotFromYDoc } from "@/lib/collab/document";
import { validateTemplateDefinition } from "@/lib/presentation/schema";
import { prepareSavedLook } from "./saved-look";
import { BUILTIN_TEMPLATES, templateExperience } from "@/lib/presentation/templates";
import type { DocumentSnapshot } from "@/lib/documents/model";
import { FileCollaborationClient, type FileCollaborationStatus } from "./collaboration-client";
import { fileCollaborationJournalKey, hasPendingFileCollaborationJournal } from "@/sync/engine/client";
import type { PresencePeer } from "@/lib/collab/provider";
import type { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { VaultError, vaultRequest, type VaultFile } from "./bridge";
import { asPost, localBlog, readDocument, readTemplate, writePayload } from "./model";
import { ArticleReader } from "./ArticleReader";
import { toggleNoteTask, VaultNoteDisplay } from "./VaultNoteDisplay";
import { VaultStoryDisplay } from "./VaultStoryDisplay";
import { ArticleCapture } from "./ArticleCapture";
import { articleSource } from "@/lib/vault/article-capture";
import { WorkspaceTypeLibrary } from "./LocalTemplateLibrary";
import { flushForNavigation, flushNativeForNavigation } from "./navigation-flush";
import { DetachedFileSaveProof } from "./detached-file-save";
import { prepareEditorImagePaste } from "./editor-image-paste";
import { queueArticleEnrichment } from "./article-enrichment";
import { packIdentity } from "./pack";
import type { NativeSharedSession } from "./shared-open";
import { acquireVaultDocument, type VaultDocumentHandle } from "./document-session";
import { applyStoryDetails, type StoryDetails } from "./story-details";
import { closeFileMutationOwner, guardFileMutationInput } from "./file-mutation-handoff";

export type VaultCollaborationConfig = { localHandoff?: import("./local-handoff-capability").LocalHandoffCapability; namespace: string; workspaceId: string; itemId: string; accountId?: string; localFiles?: boolean };
export type VaultEditorProps = {
  documentReferences?: import("@/lib/presentation/workspace-reference-choices").DocumentReferenceSource;
  onOpenReference?: (id: string) => void;
  referenceChoices?: readonly import("@/lib/presentation/workspace-reference-choices").WorkspaceReferenceChoice[];
  readOnly?: boolean; initial: VaultFile; root: string; onChanged: () => void; onRemoved: () => void; onTitleChange?: (path: string, title: string) => void; registerFlush: (flush: (navigation?: boolean) => Promise<boolean>, currentFile: () => VaultFile, publishFlush: () => Promise<string | false>, saveStoryDetails: (details: StoryDetails) => Promise<string | false>, durabilityResult?: () => Promise<import("@/sync/engine/client").FileCollaborationDurabilityResult | null>, mode?: "local-file") => void; startEditing?: boolean; focusNewNote?: boolean; focusNewNoteTitle?: boolean; focusNewNoteOrigin?: HTMLElement | null; focusNewNoteSelection?: { anchor: number; head: number; direction?: "forward" | "backward" | "none" } | null; onNewNoteFocusHandled?: () => void };
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
export function CollaborativeVaultEditor({ documentReferences, onOpenReference, referenceChoices, readOnly: permissionReadOnly = false, initial, root, config, registerFlush, onChanged, onRemoved, onTitleChange, onLocalFallback, startEditing, focusNewNote, focusNewNoteTitle, focusNewNoteOrigin, focusNewNoteSelection, onNewNoteFocusHandled, onSessionAcquired, inactiveHandoff = false }: VaultEditorProps & { config: VaultCollaborationConfig; onLocalFallback?: (fresh?: VaultFile) => void; onSessionAcquired?: (handle: VaultDocumentHandle) => void; inactiveHandoff?: boolean }) {
  const file = useRef(initial);
  const acquiredRef = useRef(onSessionAcquired); acquiredRef.current = onSessionAcquired;
  const surfaceRef = useRef<HTMLElement | null>(null);
  const [opened, setOpened] = useState(initial);
  const [snapshot, setSnapshot] = useState(() => readDocument(initial));
  const [client, setClient] = useState<FileCollaborationClient | null>(null);
  // The bound document and its awareness. Automatic epoch recovery replaces
  // both while the client and the mounted editor stay; see onDocumentReplaced.
  const [bound, setBound] = useState<{ doc: Y.Doc; awareness: Awareness } | null>(null);
  const boundRef = useRef(bound);
  const bind = useCallback((doc: Y.Doc | null, awareness?: Awareness) => {
    if (boundRef.current?.doc === doc) return;
    if (doc && !awareness) throw new Error("The document owner has not supplied its presence state.");
    boundRef.current = doc ? { doc, awareness: awareness! } : null;
    setBound(boundRef.current);
  }, []);
  const awareness = bound?.awareness ?? null;
  const rebindRef = useRef<LocalDocumentRebind | null>(null);
  const registerRebind = useCallback((rebind: LocalDocumentRebind | null) => { rebindRef.current = rebind; }, []);
  const [presencePeers, setPresencePeers] = useState<PresencePeer[]>([]);
  const clientRef = useRef<FileCollaborationClient | null>(null);
  const nativeSessionRef = useRef<NativeSharedSession | null>(null);
  const sessionRef = useRef<VaultDocumentHandle | null>(null);
  const failedNativeOpenRef = useRef<VaultDocumentHandle | null>(null);
  const localFallbackRef = useRef(onLocalFallback); localFallbackRef.current = onLocalFallback;
  const viewEpochRef = useRef(0);
  const mountedRef = useRef(true);
  const mutationInputGuardRef = useRef<(() => void) | null>(null);
  const viewKey = JSON.stringify([config.namespace, config.accountId ?? null, config.workspaceId, config.itemId, config.localFiles ? root : null]);
  const viewKeyRef = useRef(viewKey); viewKeyRef.current = viewKey;
  const reopenRef = useRef<{ key: string; generation: number; handle?: VaultDocumentHandle; resolve: () => void; reject: (error: Error) => void } | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; mutationInputGuardRef.current?.(); mutationInputGuardRef.current = null; reopenRef.current?.reject(new Error("The document view changed.")); reopenRef.current = null; };
  }, []);
  useEffect(() => {
    if (packIdentity(initial.markdown) === config.itemId && packIdentity(file.current.markdown) === config.itemId) {
      file.current = { ...file.current, path: initial.path };
      sessionRef.current?.session.replaceFile(file.current);
    }
  }, [initial.path, initial.markdown, config.itemId]);
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
    ++viewEpochRef.current;
    if (reopenRef.current && (reopenRef.current.key !== viewKey || reopenRef.current.generation !== generation)) {
      reopenRef.current.reject(new Error("The document view changed. Its saved file is kept.")); reopenRef.current = null;
    }
    const reopening = reopenRef.current;
    let handle: VaultDocumentHandle;
    try { handle = acquireVaultDocument(config, file.current, root); }
    catch (error) { if (reopenRef.current === reopening) { reopening?.reject(error instanceof Error ? error : new Error("Could not open the shared file.")); reopenRef.current = null; } setStatus("error"); setDetail(error instanceof Error ? error.message : "Could not open the shared file."); return; }
    sessionRef.current = handle; failedNativeOpenRef.current = null; acquiredRef.current?.(handle);
    const unsubscribe = handle.session.subscribe({
      changed: session => {
        if (stopped) return;
        file.current = session.file; setOpened(session.file);
        latestSnapshot.current = session.snapshot; setSnapshot(session.snapshot);
        nativeSessionRef.current = session.native;
        if (!session.hasClient) { clientRef.current = null; setClient(null); setCanEdit(false); setStatus(session.status); setDetail(session.detail); return; }
        clientRef.current = session.client; setClient(session.client);
        setStatus(session.status); setDetail(session.detail); setCanEdit(session.client.canEdit);
        setPresencePeers(session.peers); bind(session.client.doc, session.awareness ?? undefined); onTitleChange?.(session.file.path, session.snapshot.content.title);
      },
      replaced: async (next, previous, awareness) => {
        if (stopped) return;
        if (boundRef.current?.doc !== previous) throw new Error("The editor is no longer bound to the previous document.");
        try { await rebindRef.current?.(next, awareness); }
        finally { if (!stopped) bind(next, awareness); }
      },
    });
    void handle.ready.then(() => {
      if (!stopped) {
        externalReloadRef.current = false;
        if (reopening && reopenRef.current === reopening) {
          if (handle.session.hasClient && handle.session.client.hasBaseline &&
              !handle.session.client.hasUnreadableJournal && !["error", "recovery", "stale-file", "stale-session"].includes(handle.session.status) &&
              (!config.localFiles || handle.session.native)) { reopening.handle = handle; reopening.resolve(); }
          else reopening.reject(new Error("The saved file could not finish reopening. Keep this window open and retry."));
          reopenRef.current = null;
        }
      }
    }).catch(async error => {
      if (stopped) return;
      if (reopenRef.current === reopening) { reopening?.reject(error instanceof Error ? error : new Error("Could not reopen the file.")); reopenRef.current = null; }
      if (config.localFiles && error instanceof VaultError && error.code === "local_changed" &&
          (externalReloadRef.current || !handle.session.hasClient && !handle.session.native)) {
        if (!handle.session.hasClient && !handle.session.native) failedNativeOpenRef.current = handle;
        if (failedNativeOpenRef.current === handle && localFallbackRef.current && !handle.session.identity.requireLocalHandoff) {
          try {
            const draftKey = `texttext:vault-item-draft:${JSON.stringify([root, config.itemId])}`;
            const legacyDraftKey = `texttext:vault-draft:${root}:${file.current.path}`;
            const hasDraft = () => localStorage.getItem(draftKey) !== null || localStorage.getItem(legacyDraftKey) !== null;
            const journalKey = fileCollaborationJournalKey({ server: config.namespace, workspaceId: config.workspaceId, itemId: config.itemId, accountId: config.accountId });
            if (hasDraft() || await hasPendingFileCollaborationJournal(journalKey) || hasDraft())
              throw new Error("Saved edits are still waiting to reconnect. Their recovery copy is kept.");
            if (stopped || sessionRef.current !== handle || handle.session.hasClient || handle.session.native) return;
            if (!await handle.closeExclusive()) throw new Error("The document session could not finish closing.");
            const fresh = await vaultRequest<VaultFile>("read", { path: file.current.path });
            if (stopped || sessionRef.current !== handle) return;
            if (fresh.path !== file.current.path || packIdentity(fresh.markdown) !== config.itemId || hasDraft() || await hasPendingFileCollaborationJournal(journalKey) || hasDraft())
              throw new Error("The saved file changed before local editing could open.");
            if (stopped || sessionRef.current !== handle) return;
            sessionRef.current = null; failedNativeOpenRef.current = null;
            localFallbackRef.current(fresh); return;
          } catch (failure) {
            if (!stopped) { setStatus("error"); setDetail(failure instanceof Error ? failure.message : "Could not open the local file."); }
            return;
          }
        }
        setWaitingForExternalSync(true); setStatus("offline"); setDetail("Waiting for the updated file to sync…");
      } else { setStatus("error"); setDetail(error instanceof Error ? error.message : "Could not open the shared file."); }
    });
    return () => {
      stopped = true; ++viewEpochRef.current;
      const plannedReopen = viewKeyRef.current === viewKey && reopenRef.current?.key === viewKey && reopenRef.current.generation === generation + 1;
      if (!plannedReopen) { mutationInputGuardRef.current?.(); mutationInputGuardRef.current = null; }
      unsubscribe();
      if (sessionRef.current === handle) sessionRef.current = null;
      if (handle.session.hasClient && clientRef.current === handle.session.client) clientRef.current = null;
      if (nativeSessionRef.current === handle.session.native) nativeSessionRef.current = null;
      void handle.release();
    };
  }, [config.namespace, config.workspaceId, config.itemId, config.accountId, config.localFiles, root, generation, onTitleChange, bind]);
  const flush = useCallback(async (navigation = false) => {
    const shared = clientRef.current;
    if (!shared) return Boolean(config.localFiles && waitingForExternalSync && !nativeSessionRef.current && detachedSaveRef.current.matches(file.current));
    if (navigation && !config.localFiles) return flushForNavigation(shared, onChanged);
    if (navigation && config.localFiles) {
      // Closing or changing files only requires the durable local TextPack and
      // journal. Remote upload remains queued; a slow connection must not keep
      // a locally saved editor open behind the native close dialog.
      return flushNativeForNavigation(shared, onChanged);
    }
    if (config.localFiles) {
      if (navigator.onLine && shared.hasPendingChanges) await shared.flush();
      if (!await shared.flushLocal()) return false;
    } else if (shared.hasPendingChanges && !await shared.flush()) return false;
    try {
      const next = await vaultRequest<VaultFile>("read", { path: shared.relativePath ?? file.current.path });
      file.current = next; setOpened(next);
      sessionRef.current?.session.replaceFile(next);
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
  useEffect(() => { registerFlush(flush, () => file.current, publishFlush, saveStoryDetails, async () => clientRef.current?.flushLocalResult() ?? null); }, [flush, publishFlush, registerFlush, saveStoryDetails]);
  const reset = useCallback(async (recovered = false, waitForSync = false) => {
    const epoch = viewEpochRef.current, key = viewKey;
    const current = () => mountedRef.current && viewEpochRef.current === epoch && viewKeyRef.current === key;
    const assertCurrent = () => { if (!current()) throw new Error("The document view changed. Its saved file is kept."); };
    detachedSaveRef.current.clear();
    const shared = clientRef.current;
    try {
      const fresh = await vaultRequest<VaultFile>("read", { path: shared?.relativePath ?? file.current.path });
      assertCurrent();
      const freshSnapshot = readDocument(fresh);
      if (!shared && sessionRef.current) {
        const handle = sessionRef.current;
        if (failedNativeOpenRef.current !== handle || handle.session.hasClient || handle.session.native)
          throw new Error("The shared editor is still opening. Its saved file is kept.");
        if (!await handle.closeExclusive(() => {
          assertCurrent();
          if (failedNativeOpenRef.current !== handle || handle.session.hasClient || handle.session.native)
            throw new Error("The document session changed before retrying.");
        })) throw new Error("The document session could not finish closing. Its saved file is kept.");
        assertCurrent(); failedNativeOpenRef.current = null;
        if (sessionRef.current === handle) sessionRef.current = null;
      }
      if (shared) {
        const handle = sessionRef.current;
        if (!handle) throw new Error("The document session changed. Reopen this document.");
        if (!await handle.closeExclusive(async () => {
          if (recovered) await shared.clearRetiredAfterRecoveryDurably();
          else if (waitForSync && config.localFiles) await detachedSaveRef.current.retireDurably(shared, fresh);
          else await shared.discardCleanJournalDurably();
        })) throw new Error("Save or recover the pending edits before reopening.");
        assertCurrent();
        if (sessionRef.current === handle) sessionRef.current = null;
        if (clientRef.current === shared) clientRef.current = null;
      }
      assertCurrent();
      file.current = fresh; setOpened(fresh); setSnapshot(freshSnapshot);
      setClient(null); bind(null); setStatus("offline");
      if (waitForSync) {
        externalReloadRef.current = true;
        setDetail("Waiting for the updated file to sync…"); setWaitingForExternalSync(true);
      } else {
        externalReloadRef.current = false; setWaitingForExternalSync(false);
        setDetail(""); setGeneration(value => value + 1);
      }
      onChanged();
      return true;
    } catch (error) {
      if (!current()) return false;
      detachedSaveRef.current.clear();
      if (waitForSync) setStatus("error");
      setDetail(error instanceof Error ? error.message : "Could not reopen the file.");
      return false;
    }
  }, [config.itemId, config.localFiles, onChanged, bind, viewKey]);
  const detachClosedOwner = useCallback((handle: VaultDocumentHandle) => {
    if (sessionRef.current !== handle || handle.phase !== "closed") throw new Error("The document session changed.");
    sessionRef.current = null; clientRef.current = null; nativeSessionRef.current = null;
    setClient(null); bind(null); setCanEdit(false);
  }, [bind]);
  const withFileMutation = useCallback(async <T,>(action: (handle: VaultDocumentHandle, assertCurrent: () => void) => Promise<T>, reopenAfterClose = true): Promise<T> => {
    const handle = sessionRef.current;
    if (!handle) throw new Error("The document session is still opening.");
    const epoch = viewEpochRef.current, surface = surfaceRef.current;
    const assertCurrent = () => {
      if (!mountedRef.current || viewEpochRef.current !== epoch ||
          (sessionRef.current !== handle && !(handle.phase === "closed" && sessionRef.current === null)))
        throw new Error("The document view changed. Its saved file is kept.");
    };
    if (surface) surface.inert = true;
    const removeInputGuard = surface ? guardFileMutationInput(surface) : () => {};
    mutationInputGuardRef.current = removeInputGuard;
    handle.session.pausePresence(true);
    let result!: T, failure: unknown, reopened = false;
    try {
      try { result = await handle.runExclusive(() => action(handle, assertCurrent)); }
      catch (error) { failure = error; }
      // runExclusive has released its closing tombstone before a new owner can
      // acquire. Keep the old input surface inert until the new owner is ready.
      if (reopenAfterClose && handle.phase === "closed" && mountedRef.current && viewEpochRef.current === epoch) {
        if (sessionRef.current === handle) detachClosedOwner(handle);
        let waiter!: NonNullable<typeof reopenRef.current>;
        const ready = new Promise<void>((resolve, reject) => { waiter = { key: viewKey, generation: generation + 1, resolve, reject }; reopenRef.current = waiter; });
        void ready.catch(() => {});
        if (!await reset()) {
          waiter.reject(new Error("Could not reopen the saved file."));
          if (reopenRef.current === waiter) reopenRef.current = null;
        }
        try {
          await ready;
          if (!mountedRef.current || viewKeyRef.current !== viewKey || sessionRef.current !== waiter.handle)
            throw new Error("The document view changed. Its saved file is kept.");
          // Commit the newly bound editor (including a busy caller's controls)
          // before releasing inert/input exclusion. This is outside React render.
          flushSync(() => setBusy(false));
          reopened = true;
        }
        catch (error) { failure ??= error; if (mountedRef.current && viewKeyRef.current === viewKey) setStatus("error"); }
      }
      if (failure) throw failure;
      if (reopenAfterClose && handle.phase === "closed" && !reopened) throw new Error("The document view changed. Its saved file is kept.");
      return result;
    } finally {
      // On failed reopen, commit removal of the destroyed old editor before
      // restoring access to recovery controls. Never leave those controls inert.
      if (handle.phase === "closed" && !reopened) flushSync(() => {});
      removeInputGuard();
      if (mutationInputGuardRef.current === removeInputGuard) mutationInputGuardRef.current = null;
      if (surface) surface.inert = false;
      if (handle.phase !== "closed") handle.session.pausePresence(false);
    }
  }, [detachClosedOwner, generation, reset, viewKey]);
  const pasteImages = useCallback(async (request: EditorImagePasteRequest): Promise<EditorImagePasteResult> => {
    const mutationView = viewKeyRef.current;
    try { return await withFileMutation(async (handle, assertCurrent) => {
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
      assertCurrent();
      await closeFileMutationOwner(handle, source, request.document, assertCurrent);
      assertCurrent();
      detachClosedOwner(handle);
      const written = await vaultRequest<VaultFile>("write", {
        ...writePayload(source, edit.document),
        addedAssets: edit.addedAssets,
      });
      assertCurrent();
      file.current = written;
      latestSnapshot.current = edit.document;
      setOpened(written);
      setSnapshot(edit.document);
      onChanged();
      return { caret: edit.caret };
    } catch (error) {
      throw error;
    }
    }); } catch (error) {
      if (mountedRef.current && viewKeyRef.current === mutationView) setDetail(error instanceof Error ? error.message : "The image could not be pasted.");
      return undefined;
    }
  }, [config.itemId, detachClosedOwner, flush, onChanged, withFileMutation]);
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
        if (!candidate || candidate.itemId !== config.itemId || candidate.workspaceId !== config.workspaceId || candidate.namespace !== config.namespace || candidate.accountId !== config.accountId) return;
        const fresh = await vaultRequest<VaultFile>("read", { path });
        const confirmed = await vaultRequest<VaultCollaborationConfig | null>("collaborationConfig", { path, readyOnly: true });
        if (stopped || fresh.path !== path || !confirmed || confirmed.itemId !== candidate.itemId || confirmed.workspaceId !== candidate.workspaceId || confirmed.namespace !== candidate.namespace) return;
        // Close the rejected owner before acquiring the replacement. A render
        // generation alone can race the old handle's asynchronous release.
        if (await reset()) stopped = true;
      })().catch(() => { /* A sync completion or connection change will check again. */ })
        .finally(() => { running = false; });
    };
    const onSync = (event: Event) => { if ((event as CustomEvent<{ connected?: boolean }>).detail?.connected) check(); };
    window.addEventListener("texttext:vault-sync-status", onSync);
    check();
    return () => { stopped = true; window.removeEventListener("texttext:vault-sync-status", onSync); };
  }, [waitingForExternalSync, config.localFiles, config.itemId, config.workspaceId, config.namespace, config.accountId, reset]);
  const downloadRecovery = () => {
    const journal = clientRef.current?.recoveryJournal;
    const rawJournal = clientRef.current?.recoveryRawJournal;
    const checkpointFailure = clientRef.current?.recoveryCheckpointFailure ?? null;
    const url = URL.createObjectURL(new Blob([JSON.stringify({ document: latestSnapshot.current, journal, rawJournal, checkpointFailure }, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "TextText document recovery.json"; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const keepCopy = async () => {
    const mutationView = viewKeyRef.current;
    setBusy(true);
    try {
      await withFileMutation(async (handle, assertCurrent) => {
        const source = file.current, document = latestSnapshot.current;
        const fresh = await vaultRequest<VaultFile>("create", { title: `${document.content.title || "Untitled"} (recovered)`, folder: source.path.split("/").slice(0, -1).join("/"), sourcePath: source.path, sourceHash: source.hash });
        const recovered = await vaultRequest<VaultFile>("write", writePayload({ ...source, path: fresh.path, hash: fresh.hash, markdown: fresh.markdown }, document));
        assertCurrent();
        await handle.session.recoverTo(recovered);
        assertCurrent();
        if (!await handle.closeExclusive(() => handle.session.hasClient ? handle.session.client.clearRetiredAfterRecoveryDurably() : undefined))
          throw new Error("The recovery copy is saved. Reopen the original after its journal finishes saving.");
        assertCurrent(); detachClosedOwner(handle); onChanged(); onRemoved();
      }, false);
    } catch (error) { if (mountedRef.current && viewKeyRef.current === mutationView) setDetail(error instanceof Error ? error.message : "Could not save the recovery copy."); }
    finally { setBusy(false); }
  };
  const saveLook = async (name: string) => {
    if (!await flush()) return { ok: false, message: "Save this item before keeping its look." };
    const metadata = prepareSavedLook(latestSnapshot.current, template, name, file.current.templateAuthoringSourceJSON);
    const fresh = await vaultRequest<VaultFile>("create", { title: name, folder: "Templates", sourcePath: file.current.path, sourceHash: file.current.hash,
      ...metadata });
    onChanged(); return { ok: true, message: `Saved in ${fresh.path}` };
  };
  const blocked = status === "recovery" || status === "error";
  const ready = !!client?.hasBaseline;
  const editable = ready && canEdit && !permissionReadOnly && !blocked && !busy;
  const readOnly = ready && !canEdit && !detail && status !== "offline" && !blocked;
  const display = useMemo(() => resolveAssets(snapshot), [snapshot, resolveAssets]);
  const experience = templateExperience(template);
  return <section ref={surfaceRef} className="vault-document" data-collaboration-state={status} data-collaboration-item={config.itemId}>
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
        <button onClick={() => onLocalFallback?.()}>Edit local file</button>}
      {waitingForExternalSync && !client && onLocalFallback && <button onClick={() => onLocalFallback?.()}>Edit local file</button>}
      {blocked ? <><button onClick={downloadRecovery}>Download recovery</button><button disabled={busy || client?.hasUnreadableJournal} onClick={() => void keepCopy()}>Save a recovery copy</button>{!client?.hasPendingChanges && <button onClick={() => void reset()}>Reopen file</button>}</> : status === "offline" && !waitingForExternalSync && <button onClick={() => void clientRef.current?.retry()}>Retry</button>}
    </div>}
    {ready && <>
      {editable && !inactiveHandoff && <ArticleCapture document={snapshot} readCurrent={() => latestSnapshot.current} update={updateArticle} beforeCapture={flush} onMediaPending={() => queueArticleEnrichment(root, file.current.path)} />}
      {articleSource(snapshot) && <div className="vault-reading-switch"><button aria-pressed={reading} onClick={() => setReading(true)}>Read</button>{editable && <button aria-pressed={!reading} onClick={() => setReading(false)}>Edit</button>}</div>}
      {!editable || reading ? (articleSource(snapshot) ? <ArticleReader document={display} template={template} update={editable ? updateArticle : undefined} /> : experience === "note" ? <VaultNoteDisplay document={display} sourceBody={snapshot.content.body} template={template} onEdit={editable ? () => setReading(false) : undefined} onToggleTask={editable ? (index, body) => updateArticle(current => current.content.body !== body ? current : { ...current, content: { ...current.content, body: toggleNoteTask(body, index) ?? body } }) : undefined} /> : experience === "article" ? <VaultStoryDisplay document={display} template={template} onEdit={editable ? () => setReading(false) : undefined} /> : <DocumentRenderer document={display} template={template} />) :
        <HostedVaultEditor surfaceResetKey={generation > 0 ? `${config.itemId}:${generation}` : undefined} onOpenReference={onOpenReference} referenceChoices={referenceChoices} documentReferences={documentReferences} renderNoteTemplatePicker={props => <VaultNoteTemplatePicker {...props} />} key={`${config.itemId}:${generation}`} transport="local" localDocument={bound?.doc ?? client.doc} localPresence={awareness ? { awareness, peers: presencePeers } : undefined} registerLocalRebind={registerRebind} resolveDocumentAssets={resolveAssets}
          focusNewNote={focusNewNote} focusNewNoteTitle={focusNewNoteTitle} focusNewNoteOrigin={focusNewNoteOrigin} focusNewNoteSelection={focusNewNoteSelection} onNewNoteFocusHandled={onNewNoteFocusHandled}
          onPasteImages={pasteImages} onSaveAsLook={saveLook} blog={localBlog} post={asPost(snapshot, config.itemId)} template={template} availableTemplates={[template, ...BUILTIN_TEMPLATES.filter(value => value.id !== template.id)]}
          collab={{ postId: `${config.namespace}:${config.workspaceId}:${config.itemId}`, userName: "You", color: "#3970c5", canEdit: true }} onDone={async () => { if (await flush() && (experience === "note" || experience === "article")) setReading(true); }}
          renderTemplateLibrary={props => <WorkspaceTypeLibrary currentTemplate={template} onClose={props.onClose} onApply={(nextTemplate, sourceJSON) => {
            const mutationView = viewKeyRef.current;
            props.onClose(); setBusy(true);
            void withFileMutation(async (handle, assertCurrent) => {
              if (!await flush()) throw new Error("Save pending edits before changing the look.");
              if (clientRef.current?.hasPendingChanges) throw new Error("Reconnect and finish sharing pending edits before changing the look.");
              const source = await vaultRequest<VaultFile>("read", { path: file.current.path });
              // The file can be newer than the last relay response. Change only
              // its presentation, with the same file's revision guarding the write.
              const current = readDocument(source);
              const next = { ...current, presentation: { ...current.presentation, template: { id: nextTemplate.id, version: nextTemplate.version } } };
              assertCurrent();
              await closeFileMutationOwner(handle, source, current, assertCurrent);
              assertCurrent(); detachClosedOwner(handle);
              const written = await vaultRequest<VaultFile>("write", writePayload(source, next, { template: nextTemplate, sourceJSON }));
              assertCurrent();
              file.current = written; setOpened(written); setSnapshot(next); onChanged();
            }).catch(error => { if (mountedRef.current && viewKeyRef.current === mutationView) setDetail(error.message); }).finally(() => setBusy(false));
          }} />} />}
    </>}
  </section>;
}
