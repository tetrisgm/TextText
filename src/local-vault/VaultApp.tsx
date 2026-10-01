"use client";

import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { UnifiedDocumentEditor } from "@/components/document/UnifiedDocumentEditor";
import { DocumentEngineStyles } from "@/components/document/DocumentEngineStyles";
import { validateTemplateDefinition } from "@/lib/presentation/schema";
import { authoringSourceSchema } from "@/lib/presentation/authoring-source";
import { compileItemTypeBlueprint } from "@/lib/presentation/item-type-blueprint";
import { BUILTIN_TEMPLATES } from "@/lib/presentation/templates";
import type { DocumentSnapshot } from "@/lib/documents/model";
import { reconcileDocumentSnapshots } from "@/lib/vault/reconcile";
import { VaultError, vaultRequest, type VaultFile, type VaultListing } from "./bridge";
import { asPost, localBlog, readDocument, readTemplate, writePayload, VaultRepresentationConflict, type VaultTemplateSelection } from "./model";
import { WorkspaceTypeLibrary as LocalTemplateLibrary } from "./LocalTemplateLibrary";
import { WorkspaceOverview } from "./WorkspaceOverview";
import { NativeConnection } from "./NativeConnection";
import { NativeAssistant, type NativeAssistantRequest } from "./NativeAssistant";
import { ParticipantsRow as LocalParticipantsRow } from "./LocalParticipants";
import { FolderNavigation } from "./FolderNavigation";
import { folderTree, folderPaths, folderForItem } from "./folders";
import { ArticleReader } from "./ArticleReader";
import { articleSource } from "@/lib/vault/article-capture";
import { readFeedSubscription } from "@/lib/vault/rss";
import { activeBodySelection } from "@/lib/document-history-events";
import { ArticleCapture } from "./ArticleCapture";
import { CaptureDialog } from "./CaptureDialog";
import { FeedSubscribeDialog, FeedSubscriptionReader } from "./VaultFeeds";
import { RecoveryDialog } from "./RecoveryDialog";
import { CollaborativeVaultEditor, type VaultCollaborationConfig, type VaultEditorProps } from "./CollaborativeVaultEditor";
import { packIdentity } from "./pack";
import { prepareSharedNote } from "./new-note-promotion";
import { readFolderView, resolveFolderView, type FolderViewMetadata } from "./folder-view";
import { VaultSearch, type VaultSearchAction } from "./VaultSearch";
import { VaultShareDialog, type VaultShareScope } from "./VaultShareDialog";
import { VaultPublishDialog } from "./VaultPublishDialog";
import { VaultComments } from "./VaultComments";
import { vaultCommentCapabilities } from "./vault-comments";
import { canCreateInVaultFolder, parseVaultAccess, sharedVaultHashTarget, type VaultAccess } from "./shared-vaults";
import { prepareImagePack, encodeBase64, MAX_IMAGE_BYTES, IMAGE_ACCEPT } from "./image-import";
import { readVaultLocation, resolveVaultLocation, writeVaultLocation } from "./vault-location";
import { REQUEST_ADD_ITEM_AGENT_EVENT } from "./agent-task";
import "./style.css";

const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const readForOpen = (path: string, web: boolean) => vaultRequest<VaultFile>("read", {
  path, ...(web ? { prefetchCollaboration: true } : {}),
});
function focusedControl(): HTMLElement | null {
  const active = document.activeElement;
  return active instanceof HTMLElement && active !== document.body ? active : null;
}
function restoreDialogFocus(...targets: (HTMLElement | null)[]) {
  requestAnimationFrame(() => { targets.find(target => target?.isConnected)?.focus(); });
}
function mapStrings<T>(value: T, substitutions: Map<string, string>): T {
  if (typeof value === "string") {
    let mapped = value as string;
    for (const [source, target] of substitutions) mapped = mapped.split(source).join(target);
    return mapped as T;
  }
  if (Array.isArray(value)) return value.map((entry) => mapStrings(entry, substitutions)) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, mapStrings(entry, substitutions)])) as T;
  return value;
}

function VaultEditor({ initial, root, onChanged, onRemoved, registerFlush, focusNewNote, focusNewNoteOrigin, focusNewNoteSelection, onNewNoteFocusHandled }: VaultEditorProps) {
  const recoveryKey = `texttext:vault-draft:${root}:${initial.path}`;
  const initialDocument = useMemo(() => readDocument(initial), [initial]);
  const initialTemplate = useMemo(() => readTemplate(initial, initialDocument), [initial, initialDocument]);
  const [templates, setTemplates] = useState(() => [initialTemplate, ...BUILTIN_TEMPLATES.filter((template) => template.id !== initialTemplate.id || template.version !== initialTemplate.version)]);
  const pendingLook = useRef<VaultTemplateSelection | null>(null);
  const file = useRef(initial);
  const baseline = useRef(initialDocument);
  const current = useRef(initialDocument);
  const running = useRef<Promise<boolean> | null>(null);
  const refreshing = useRef(false);
  const conflict = useRef(false);
  const missing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [external, setExternal] = useState(initialDocument);
  const [reading, setReading] = useState(!!articleSource(initialDocument));
  const [notice, setNotice] = useState("");
  const [hasConflict, setHasConflict] = useState(false);
  const [copying, setCopying] = useState(false);
  const [openedFile, setOpenedFile] = useState(initial);
  const assets = useMemo(() => {
    const forward = new Map<string, string>(), backward = new Map<string, string>();
    for (const asset of openedFile.assets ?? []) {
      const bytes = Uint8Array.from(atob(asset.data), (character) => character.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: asset.contentType || "application/octet-stream" }));
      const reference = `assets/${asset.filename}`;
      forward.set(reference, url);
      if (asset.remoteURL) forward.set(asset.remoteURL, url);
      backward.set(url, asset.remoteURL ?? reference);
    }
    return { forward, backward };
  }, [openedFile.assets]);
  useEffect(() => () => { for (const url of assets.backward.keys()) URL.revokeObjectURL(url); }, [assets]);
  const remember = useCallback(() => {
    try {
      if (equal(current.current, baseline.current) && !pendingLook.current) localStorage.removeItem(recoveryKey);
      else localStorage.setItem(recoveryKey, JSON.stringify({ base: baseline.current, document: current.current, look: pendingLook.current }));
      return true;
    } catch { setNotice("The recovery copy could not be saved. Keep this document open until its file saves."); return false; }
  }, [recoveryKey]);
  const acceptRemote = useCallback((remote: VaultFile): boolean => {
    if (remote.hash === file.current.hash) return true;
    let remoteDocument: DocumentSnapshot;
    try { remoteDocument = readDocument(remote, file.current, baseline.current); }
    catch (error) {
      if (!(error instanceof VaultRepresentationConflict)) throw error;
      conflict.current = true; setHasConflict(true); setNotice(error.message);
      return false;
    }
    const result = reconcileDocumentSnapshots(baseline.current, current.current, remoteDocument);
    const competingLook = pendingLook.current && file.current.templateJSON !== remote.templateJSON &&
      JSON.stringify(pendingLook.current.template) !== remote.templateJSON;
    if (result.status === "conflict" || competingLook) {
      conflict.current = true; setHasConflict(true);
      setNotice("This file also changed outside TextText. Your edits are kept here. Save a separate copy to keep both versions.");
      return false;
    }
    file.current = remote; baseline.current = remoteDocument; current.current = result.document;
    const remoteTemplate = pendingLook.current?.template ?? readTemplate(remote, result.document);
    // Normalize only an observed representation divergence, so a JSON-only
    // agent edit becomes coherent text.md/document.json on the next file save.
    if (!equal(readDocument(remote), remoteDocument) && !pendingLook.current) pendingLook.current = { template: remoteTemplate, sourceJSON: remote.templateAuthoringSourceJSON };
    setTemplates((values) => [remoteTemplate, ...values.filter((value) => value.id !== remoteTemplate.id || value.version !== remoteTemplate.version)]);
    setOpenedFile(remote); setExternal(result.document); remember();
    return true;
  }, [remember]);
  const flush = useCallback((): Promise<boolean> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (running.current) return running.current;
    if (conflict.current) return Promise.resolve(false);
    const save = async () => {
      let retries = 0;
      while (!equal(current.current, baseline.current) || pendingLook.current) {
        if (conflict.current) return false;
        const submitted = current.current;
        const submittedLook = pendingLook.current;
        try {
          const written = await vaultRequest<VaultFile>("write", writePayload(file.current, submitted, submittedLook));
          baseline.current = submitted;
          if (pendingLook.current === submittedLook) pendingLook.current = null;
          if (!equal(readDocument(written), submitted)) {
            if (!acceptRemote(written)) return false;
          } else file.current = written;
          remember(); onChanged(); setNotice(""); retries = 0;
        } catch (error) {
          if (error instanceof VaultError && error.code === "conflict" && error.current && retries++ < 3) {
            if (acceptRemote(error.current)) continue;
          } else setNotice(error instanceof Error ? error.message : "The file could not be saved. Your edits are kept here.");
          return false;
        }
      }
      return true;
    };
    running.current = save().finally(() => { running.current = null; });
    return running.current;
  }, [acceptRemote, onChanged, remember]);
  const change = useCallback((display: DocumentSnapshot) => {
    const next = mapStrings(display, assets.backward);
    if (equal(next, current.current)) return;
    current.current = next; remember();
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, 350);
  }, [assets, flush, remember]);
  const readCurrent = useCallback(() => current.current, []);
  const updateArticle = useCallback((transform: (document: DocumentSnapshot) => DocumentSnapshot) => {
    if (conflict.current) throw new Error("Resolve the file conflict before capturing the article.");
    const next = transform(current.current);
    change(next); setExternal(next);
  }, [change]);
  const publishFlush = useCallback(async () => {
    if (!await flush()) return false;
    const itemId = packIdentity(file.current.markdown);
    const saved = await vaultRequest<{ revision: string }>("publicationRead", { itemId });
    return saved.revision === file.current.hash ? saved.revision : false;
  }, [flush]);
  useEffect(() => { registerFlush(flush, () => file.current, publishFlush); }, [flush, publishFlush, registerFlush]);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(recoveryKey);
      if (saved) {
        const draft = JSON.parse(saved);
        if (draft.look) {
          const template = validateTemplateDefinition(draft.look.template);
          pendingLook.current = { template, sourceJSON: draft.look.sourceJSON };
          // Hydrate a persisted recovery record from browser storage once per opened file.
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setTemplates((values) => [template, ...values.filter((value) => value.id !== template.id || value.version !== template.version)]);
        }
        const result = reconcileDocumentSnapshots(draft.base, draft.document, baseline.current);
        if (result.status === "merged") { current.current = result.document; setExternal(result.document); void flush(); }
        else { current.current = draft.document; setExternal(draft.document); conflict.current = true; setHasConflict(true); setNotice("A recovered draft and this file have different edits. Save a separate copy to keep both."); }
      }
    } catch (error) { setNotice(`Could not restore the draft: ${error instanceof Error ? error.message : "invalid recovery data"}`); }
    const changed = () => {
      if (refreshing.current) return;
      refreshing.current = true;
      void (async () => {
        for (let attempt = 0; attempt < 3; attempt++) {
          if (running.current) await running.current;
          if (conflict.current) return;
          const observedHash = file.current.hash;
          const latest = await vaultRequest<VaultFile>("read", { path: file.current.path });
          if (running.current) await running.current;
          // A save may have completed while read was in flight. Its reply is
          // newer than this read; obtain a fresh snapshot before reconciling.
          if (file.current.hash !== observedHash) continue;
          if (acceptRemote(latest)) await flush();
          return;
        }
      })().catch(async (error: Error) => {
        // A missing path may be a remote delete or move. Confirm against the
        // listing so an offline/read error never closes a recoverable draft.
        try {
          const listing = await vaultRequest<VaultListing>("list");
          if (!listing.items.some((item) => item.path === file.current.path)) {
            if (running.current) await running.current;
            if (equal(current.current, baseline.current) && !pendingLook.current) {
              onRemoved(); return;
            }
            missing.current = true; conflict.current = true; setHasConflict(true);
            remember();
            setNotice("This file was moved or deleted elsewhere. Your unsaved edits are kept here. Save them as a separate copy.");
            return;
          }
        } catch { /* Keep the editor when the listing is unavailable. */ }
        setNotice(error.message);
      }).finally(() => { refreshing.current = false; });
    };
    const blur = () => { void flush(); };
    window.addEventListener("texttext:vault-changed", changed);
    window.addEventListener("blur", blur);
    return () => { window.removeEventListener("texttext:vault-changed", changed); window.removeEventListener("blur", blur); if (timer.current) clearTimeout(timer.current); };
    // One subscription and recovery pass per opened file; callbacks use refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const saveCopy = async () => {
    setCopying(true);
    try {
      const fresh = await vaultRequest<VaultFile>("create", { title: `${current.current.content.title || "Untitled"} (conflict copy)`, folder: file.current.path.split("/").slice(0, -1).join("/"), sourcePath: file.current.path, sourceHash: file.current.hash });
      await vaultRequest<VaultFile>("write", { ...writePayload({ ...file.current, path: fresh.path, hash: fresh.hash, markdown: fresh.markdown }, current.current, pendingLook.current) });
      if (missing.current) {
        localStorage.removeItem(recoveryKey); onChanged(); onRemoved(); return;
      }
      const latest = await vaultRequest<VaultFile>("read", { path: file.current.path });
      file.current = latest; baseline.current = readDocument(latest); current.current = baseline.current;
      pendingLook.current = null;
      const latestTemplate = readTemplate(latest, current.current);
      setTemplates((values) => [latestTemplate, ...values.filter((value) => value.id !== latestTemplate.id || value.version !== latestTemplate.version)]);
      setOpenedFile(latest); setExternal(current.current); conflict.current = false; setHasConflict(false); remember(); onChanged(); setNotice("Your edits were saved in a conflict copy. This is the other version.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not save the copy. Your edits remain here."); }
    finally { setCopying(false); }
  };
  const saveLook = async (name: string) => {
    if (!await flush()) return { ok: false, message: "Save this item before keeping its look." };
    const original = readTemplate(file.current, current.current);
    const identity = { id: `local.${crypto.randomUUID()}`, version: 1 };
    let template = validateTemplateDefinition({ ...original, ...identity, name });
    let sourceJSON: string | null = null;
    if (file.current.templateAuthoringSourceJSON) {
      const source = authoringSourceSchema.parse(JSON.parse(file.current.templateAuthoringSourceJSON));
      source.blueprint.name = name;
      template = compileItemTypeBlueprint(source.blueprint, identity);
      sourceJSON = JSON.stringify(source);
    }
    const fresh = await vaultRequest<VaultFile>("create", { title: name, folder: "Templates", sourcePath: file.current.path, sourceHash: file.current.hash });
    const snapshot = { ...current.current, presentation: { ...current.current.presentation, template: identity } };
    await vaultRequest<VaultFile>("write", writePayload({ ...fresh, templateJSON: JSON.stringify(template), templateAuthoringSourceJSON: sourceJSON }, snapshot, { template, sourceJSON }));
    onChanged();
    return { ok: true, message: `Saved in ${fresh.path}` };
  };
  const display = useMemo(() => mapStrings(external, assets.forward), [external, assets]);
  const post = useMemo(() => asPost(display, initial.path), [display, initial.path]);
  return <section className="vault-document"><header className="vault-document-path">{initial.path}</header>{notice && <div className="vault-notice" role="status">{notice}{hasConflict ? <button disabled={copying} onClick={() => void saveCopy()}>{copying ? "Saving copy…" : "Save my edits as a copy"}</button> : <button onClick={() => void flush()}>Retry save</button>}</div>}<ArticleCapture document={external} readCurrent={readCurrent} update={updateArticle} beforeCapture={flush} />{articleSource(external) && <div className="vault-reading-switch"><button aria-pressed={reading} onClick={() => void flush().then((saved) => { if (saved) { setExternal(current.current); setReading(true); } })}>Read</button><button aria-pressed={!reading} onClick={() => setReading(false)}>Edit</button></div>}{reading ? <ArticleReader document={display} template={templates.find((template) => template.id === external.presentation.template.id && template.version === external.presentation.template.version) ?? initialTemplate} update={updateArticle} /> : <UnifiedDocumentEditor transport="local" leadingControls={<LocalParticipantsRow postId={initial.path} />} externalDocument={display} blog={localBlog} post={post} template={templates.find((template) => template.id === external.presentation.template.id && template.version === external.presentation.template.version) ?? initialTemplate} availableTemplates={templates} onSaveAsLook={saveLook} renderTemplateLibrary={(props) => <LocalTemplateLibrary currentTemplate={pendingLook.current?.template ?? readTemplate(file.current, current.current)} onClose={props.onClose} onApply={(template, sourceJSON) => {
    pendingLook.current = { template, sourceJSON };
    setTemplates((values) => [template, ...values.filter((value) => value.id !== template.id || value.version !== template.version)]);
    props.onApply(template); remember();
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, 350);
  }} />} focusNewNote={focusNewNote} focusNewNoteOrigin={focusNewNoteOrigin} focusNewNoteSelection={focusNewNoteSelection} onNewNoteFocusHandled={onNewNoteFocusHandled} collab={{ postId: initial.path, userName: "You", color: "#3970c5", canEdit: true }} onDocumentChange={change} onDone={async () => { await flush(); }} />}</section>;
}

function OpenVaultEditor(props: VaultEditorProps & { awaitSharedMode?: boolean; onSharedMode?: () => void }) {
  const { root, initial, awaitSharedMode, onSharedMode, registerFlush } = props;
  const path = initial.path;
  const markdown = initial.markdown;
  const [mode, setMode] = useState<VaultCollaborationConfig | "local" | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [promoting, setPromoting] = useState(false);
  const [sharedInitial, setSharedInitial] = useState<VaultFile | null>(null);
  const [resumeBody, setResumeBody] = useState<{ selection: { anchor: number; head: number } | null } | null>(null);
  const localRoot = useRef<HTMLDivElement>(null);
  const localFlush = useRef<(() => Promise<boolean>) | null>(null);
  const onSharedModeRef = useRef(onSharedMode);
  useEffect(() => { onSharedModeRef.current = onSharedMode; }, [onSharedMode]);
  const registerLocalFlush = useCallback<VaultEditorProps["registerFlush"]>((flush, currentFile, publishFlush) => {
    localFlush.current = flush;
    registerFlush(flush, currentFile, publishFlush);
  }, [registerFlush]);
  useEffect(() => {
    let stopped = false;
    const cacheKey = `texttext:collaboration-config:${root}:${packIdentity(markdown)}`;
    const draftKey = `texttext:vault-draft:${root}:${path}`;
    // Finish a recoverable file draft before switching its persistence mechanism.
    if (localStorage.getItem(draftKey)) {
      queueMicrotask(() => { if (!stopped) setMode("local"); });
      return () => { stopped = true; };
    }
    void vaultRequest<VaultCollaborationConfig | null>("collaborationConfig", { path }).then(async config => {
      if (stopped) return;
      if (config) {
        if (awaitSharedMode) {
          const ready = await prepareSharedNote({ path, candidate: config,
            flush: async () => true, hasDraft: () => Boolean(localStorage.getItem(draftKey)),
            read: () => vaultRequest<VaultFile>("read", { path }),
            config: () => vaultRequest<VaultCollaborationConfig | null>("collaborationConfig", { path }) });
          if (stopped) return;
          if (!ready) { setMode("local"); return; }
          setSharedInitial(ready.file); onSharedModeRef.current?.();
        }
        localStorage.setItem(cacheKey, JSON.stringify(config)); setMode(config); return;
      }
      const stored = localStorage.getItem(cacheKey);
      if (stored) {
        const previous = JSON.parse(stored) as VaultCollaborationConfig;
        const key = `texttext:file-collaboration:v1:${JSON.stringify([previous.namespace.replace(/\/$/, ""), previous.workspaceId, previous.itemId])}`;
        const raw = localStorage.getItem(key);
        if (raw) {
          try {
            const journal = JSON.parse(raw);
            if (journal.retired || journal.unqueuedDirty || journal.batch || journal.pending?.length) { setMode(previous); return; }
          } catch {
            // Let the shared client expose the intact unreadable journal for
            // recovery instead of silently opening another persistence path.
            setMode(previous); return;
          }
        }
      }
      setMode("local");
    }).catch(reason => {
      if (stopped) return;
      if (awaitSharedMode) setMode("local");
      else setError(reason instanceof Error ? reason.message : "Could not open this document.");
    });
    return () => { stopped = true; };
  }, [root, path, markdown, retry, awaitSharedMode]);
  useEffect(() => {
    if (mode !== "local" || !awaitSharedMode) return;
    let stopped = false, running = false, rerun = false;
    const draftKey = `texttext:vault-draft:${root}:${path}`;
    const config = () => vaultRequest<VaultCollaborationConfig | null>("collaborationConfig", { path });
    const read = () => vaultRequest<VaultFile>("read", { path });
    const check = () => {
      if (stopped) return;
      if (running) { rerun = true; return; }
      running = true;
      void (async () => {
        do {
          rerun = false;
          const candidate = await config();
          if (!candidate || stopped || !localFlush.current) continue;
          const focused = document.activeElement;
          const editingBody = focused instanceof HTMLElement && focused.getAttribute("aria-label") === "Document body" && localRoot.current?.contains(focused);
          const selection = editingBody ? activeBodySelection() : null;
          setPromoting(true);
          await new Promise<void>(resolve => {
            const frame = requestAnimationFrame(() => { clearTimeout(timer); resolve(); });
            const timer = setTimeout(() => { cancelAnimationFrame(frame); resolve(); }, 100);
          });
          if (stopped) return;
          const ready = await prepareSharedNote({ path, candidate, flush: localFlush.current,
            hasDraft: () => Boolean(localStorage.getItem(draftKey)), read, config });
          if (!ready || stopped) { setPromoting(false); continue; }
          setSharedInitial(ready.file);
          if (editingBody) setResumeBody({ selection });
          localStorage.setItem(`texttext:collaboration-config:${root}:${packIdentity(ready.file.markdown)}`, JSON.stringify(ready.config));
          onSharedModeRef.current?.();
          setMode(ready.config);
          return;
        } while (rerun && !stopped);
      })().catch(() => { /* Local editing remains available until sync can acknowledge these bytes. */ })
        .finally(() => { running = false; if (!stopped) setPromoting(false); });
    };
    const sync = (event: Event) => { if ((event as CustomEvent<{ connected?: boolean }>).detail?.connected) check(); };
    window.addEventListener("texttext:vault-sync-status", sync);
    window.addEventListener("texttext:vault-changed", check);
    check();
    return () => { stopped = true; window.removeEventListener("texttext:vault-sync-status", sync); window.removeEventListener("texttext:vault-changed", check); };
  }, [mode, awaitSharedMode, path, root]);
  if (mode === "local") return <><div ref={localRoot} inert={promoting}><VaultEditor {...props} registerFlush={registerLocalFlush} /></div>
    {promoting && <p className="vault-notice" role="status">Connecting this note…</p>}</>;
  if (mode) return <CollaborativeVaultEditor {...props} initial={sharedInitial ?? props.initial} config={mode}
    focusNewNote={Boolean(resumeBody) || props.focusNewNote} focusNewNoteOrigin={resumeBody ? null : props.focusNewNoteOrigin}
    focusNewNoteSelection={resumeBody?.selection} onNewNoteFocusHandled={() => { setResumeBody(null); props.onNewNoteFocusHandled?.(); }}
    onLocalFallback={() => setMode("local")} />;
  return <div className="vault-notice" role="status">{error || "Opening document…"}{error && <button onClick={() => { setError(""); setRetry(value => value + 1); }}>Retry</button>}</div>;
}

class DocumentBoundary extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: "" };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() { return this.state.error ? <div className="vault-notice" role="alert">This TextPack could not be opened: {this.state.error}</div> : this.props.children; }
}

export function VaultApp({ allowFolderPicker = true }: { allowFolderPicker?: boolean }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarReady, setSidebarReady] = useState(false);
  const sidebarReopenButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const saved = localStorage.getItem("texttext:vault-sidebar-open");
        setSidebarOpen(saved === null ? !window.matchMedia("(max-width: 700px)").matches : saved === "true");
      } catch { setSidebarOpen(!window.matchMedia("(max-width: 700px)").matches); }
      setSidebarReady(true);
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  const setSidebarVisible = useCallback((open: boolean, restoreFocus = false) => {
    setSidebarOpen(open);
    try { localStorage.setItem("texttext:vault-sidebar-open", String(open)); } catch { /* Local storage can be disabled. */ }
    if (!open && restoreFocus) requestAnimationFrame(() => sidebarReopenButton.current?.focus());
  }, []);
  useEffect(() => {
    if (!sidebarOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !window.matchMedia("(max-width: 700px)").matches ||
          document.querySelector('[role="dialog"][aria-modal="true"], dialog[open]')) return;
      event.preventDefault(); setSidebarVisible(false, true);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [sidebarOpen, setSidebarVisible]);
  const [listing, setListing] = useState<VaultListing | null>(null);
  const [selected, setSelectedState] = useState<VaultFile | null>(null);
  const selectedRef = useRef<VaultFile | null>(null);
  const setSelected = useCallback((file: VaultFile | null) => {
    selectedRef.current = file;
    setSelectedState(file);
  }, []);
  const restoredLocationRoot = useRef("");
  const [locationReadyRoot, setLocationReadyRoot] = useState("");
  const [newNoteFocus, setNewNoteFocus] = useState<{ file: VaultFile; root: string; itemId: string; origin: HTMLElement | null; focusPending: boolean; awaitSharedMode: boolean } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [destinationFolder, setDestinationFolder] = useState("");
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantRequest, setAssistantRequest] = useState<NativeAssistantRequest | null>(null);
  const assistantRequestId = useRef(0);
  useEffect(() => {
    if (!assistantOpen) return;
    const narrow = window.matchMedia("(max-width: 700px)");
    const closeForAssistant = () => { if (narrow.matches) setSidebarVisible(false); };
    const frame = requestAnimationFrame(closeForAssistant);
    narrow.addEventListener("change", closeForAssistant);
    return () => { cancelAnimationFrame(frame); narrow.removeEventListener("change", closeForAssistant); };
  }, [assistantOpen, setSidebarVisible]);
  const [templatePicker, setTemplatePicker] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [feedSubscribeOpen, setFeedSubscribeOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [recovery, setRecovery] = useState<{ path?: string } | null>(null);
  const [sharing, setSharing] = useState<VaultShareScope | null>(null);
  const [publishing, setPublishing] = useState<{ workspaceId: string; itemId: string; label: string } | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [fileAction, setFileAction] = useState<"rename" | "delete" | null>(null);
  const [newPath, setNewPath] = useState("");
  const imageInput = useRef<HTMLInputElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const feedSubscribeButton = useRef<HTMLButtonElement>(null);
  const searchReturnFocus = useRef<HTMLElement | null>(null);
  const feedSubscribeReturnFocus = useRef<HTMLElement | null>(null);
  const commentsButton = useRef<HTMLButtonElement>(null);
  const assistantReturnFocus = useRef<HTMLElement | null>(null);
  const importing = useRef(false);
  const [importStatus, setImportStatus] = useState("");
  const [webAccess, setWebAccess] = useState<{ workspaceId: string; value: VaultAccess } | null>(null);
  const [nativeConnection, setNativeConnection] = useState<{ root: string; workspaceId: string } | null>(null);
  const [nativePublishAccess, setNativePublishAccess] = useState<{ workspaceId: string; itemId: string; canPublish: boolean } | null>(null);
  const [nativePublishRefresh, setNativePublishRefresh] = useState(0);
  const currentFileRef = useRef<(() => VaultFile) | null>(null);
  const webWorkspaceId = !allowFolderPicker && listing?.root.startsWith("vault:") ? listing.root.slice("vault:".length) : null;
  const access = webWorkspaceId === webAccess?.workspaceId ? webAccess.value : null;
  const visibleListing = useMemo(() => {
    if (!listing || !access || access.fullAccess) return listing;
    const folders = access.grants.filter(grant => grant.scopeType === "folder").map(grant => grant.scopeKey);
    return { ...listing, folders: [...new Set([...(listing.folders ?? []), ...folders])] };
  }, [listing, access]);
  const tree = useMemo(() => folderTree(visibleListing?.items ?? [], visibleListing?.folders), [visibleListing]);
  const folders = useMemo(() => folderPaths(tree), [tree]);
  useEffect(() => {
    if (!visibleListing?.root || (!allowFolderPicker && !access) || restoredLocationRoot.current === visibleListing.root) return;
    const root = visibleListing.root;
    restoredLocationRoot.current = root;
    void Promise.resolve().then(() => {
      if (webWorkspaceId && sharedVaultHashTarget(window.location.hash, visibleListing.items.map(item => item.path), folders)) {
        setLocationReadyRoot(root);
        return;
      }
      const saved = readVaultLocation(localStorage, root);
      const location = resolveVaultLocation(saved, visibleListing.items.map(item => item.path), folders);
      setDestinationFolder(location.folder);
      if (!location.path) {
        setSelected(null);
        setLocationReadyRoot(root);
        return;
      }
      void readForOpen(location.path, !allowFolderPicker).then(file => {
        if (restoredLocationRoot.current === root) setSelected(file);
      }).catch(reason => {
        if (restoredLocationRoot.current === root) {
          setSelected(null);
          setError(reason instanceof Error ? `Could not reopen ${location.path}: ${reason.message}` : `Could not reopen ${location.path}.`);
        }
      }).finally(() => {
        if (restoredLocationRoot.current === root) setLocationReadyRoot(root);
      });
    });
  }, [access, allowFolderPicker, folders, setSelected, visibleListing, webWorkspaceId]);
  useEffect(() => {
    if (!listing?.root || locationReadyRoot !== listing.root) return;
    try {
      writeVaultLocation(localStorage, listing.root, selected
        ? { folder: folderForItem(selected.path), path: selected.path }
        : { folder: destinationFolder.trim() });
    } catch { /* Browsing still works when local storage is disabled. */ }
  }, [destinationFolder, listing?.root, locationReadyRoot, selected]);
  const flushRef = useRef<(navigation?: boolean) => Promise<boolean>>(async () => true);
  const publishFlushRef = useRef<() => Promise<string | false>>(async () => false);
  const registerFlush = useCallback((flush: (navigation?: boolean) => Promise<boolean>, currentFile: () => VaultFile, publishFlush: () => Promise<string | false>) => {
    flushRef.current = flush; publishFlushRef.current = publishFlush; currentFileRef.current = currentFile;
  }, []);
  const canCreate = allowFolderPicker || canCreateInVaultFolder(access, destinationFolder.trim());
  const canManageFiles = allowFolderPicker || Boolean(access?.fullAccess && access.canEditContent);
  const canOpenRecovery = allowFolderPicker || Boolean(access?.isOwner);
  const nativeWorkspaceId = allowFolderPicker && nativeConnection?.root === listing?.root ? nativeConnection?.workspaceId ?? null : null;
  const canReadFeeds = Boolean(webWorkspaceId ? access?.fullAccess : nativeWorkspaceId);
  const canSubscribeFeed = canCreate && canReadFeeds && (allowFolderPicker || access?.canEditContent === true);
  const sharingWorkspaceId = webWorkspaceId ?? nativeWorkspaceId;
  const canShare = Boolean(webWorkspaceId ? access?.canManageShares : nativeWorkspaceId);
  const selectedItemId = useMemo(() => {
    if (!selected) return null;
    try { return packIdentity(selected.markdown); }
    catch { return null; }
  }, [selected]);
  const selectedFeed = useMemo(() => {
    if (!selected) return { subscription: null, error: "" };
    try { return { subscription: readFeedSubscription(selected), error: "" }; }
    catch (reason) { return { subscription: null, error: reason instanceof Error ? reason.message : "This feed subscription could not be opened." }; }
  }, [selected]);
  const feedFolder = destinationFolder.trim();
  const canKeepFeed = canReadFeeds && (allowFolderPicker || Boolean(access?.canEditContent && canCreateInVaultFolder(access, feedFolder)));
  useEffect(() => {
    if (!selected || (!selectedFeed.subscription && !selectedFeed.error)) return;
    currentFileRef.current = () => selected;
    flushRef.current = async () => true;
    publishFlushRef.current = async () => {
      const itemId = packIdentity(selected.markdown);
      const saved = await vaultRequest<{ revision: string }>("publicationRead", { itemId });
      return saved.revision === selected.hash ? saved.revision : false;
    };
  }, [selected, selectedFeed]);
  const canPublish = Boolean(webWorkspaceId ? access?.canManageShares : nativeWorkspaceId && selectedItemId &&
    nativePublishAccess?.workspaceId === nativeWorkspaceId && nativePublishAccess.itemId === selectedItemId && nativePublishAccess.canPublish);
  const canOpenComments = Boolean(selected && selectedItemId && sharingWorkspaceId && (allowFolderPicker || access));
  const commentCapabilities = allowFolderPicker
    ? { canComment: Boolean(nativeWorkspaceId), canResolve: Boolean(nativeWorkspaceId) }
    : vaultCommentCapabilities(access, selectedItemId ?? "", selected?.path ?? "");
  const refresh = useCallback(() => { void vaultRequest<VaultListing>("list").then(setListing).catch((error: Error) => setError(error.message)); }, []);
  useEffect(() => { refresh(); window.addEventListener("texttext:vault-changed", refresh); return () => window.removeEventListener("texttext:vault-changed", refresh); }, [refresh]);
  useEffect(() => {
    if (!webWorkspaceId) return;
    const controller = new AbortController();
    void fetch(`/api/vault/${encodeURIComponent(webWorkspaceId)}/access`, { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Workspace permissions could not be loaded.");
        return parseVaultAccess(await response.json());
      })
      .then(value => { if (!controller.signal.aborted) setWebAccess({ workspaceId: webWorkspaceId, value }); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Workspace permissions could not be loaded."); });
    return () => controller.abort();
  }, [webWorkspaceId]);
  useEffect(() => {
    if (!allowFolderPicker || !listing?.root) return;
    const root = listing.root;
    let active = true;
    const accept = (value: { connected?: unknown; workspaceId?: unknown } | null | undefined) => {
      const workspaceId = value?.workspaceId;
      if (!active) return;
      setNativeConnection(value?.connected === true && typeof workspaceId === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(workspaceId)
        ? { root, workspaceId } : null);
    };
    const status = () => { void vaultRequest<{ connected?: boolean; workspaceId?: string }>("connection").then(accept).catch(() => accept(null)); };
    window.addEventListener("texttext:vault-sync-status", status);
    status();
    return () => { active = false; window.removeEventListener("texttext:vault-sync-status", status); };
  }, [allowFolderPicker, listing?.root]);
  useEffect(() => {
    if (!allowFolderPicker || !nativeWorkspaceId || !selectedItemId) return;
    const controller = new AbortController();
    void vaultRequest<{ canPublish?: boolean }>("publicationRead", { itemId: selectedItemId }, controller.signal)
      .then(value => { if (!controller.signal.aborted) setNativePublishAccess({ workspaceId: nativeWorkspaceId, itemId: selectedItemId, canPublish: value.canPublish === true }); })
      .catch(() => { if (!controller.signal.aborted) setNativePublishAccess({ workspaceId: nativeWorkspaceId, itemId: selectedItemId, canPublish: false }); });
    return () => controller.abort();
  }, [allowFolderPicker, nativeWorkspaceId, selectedItemId, nativePublishRefresh]);
  const [hashRevision, setHashRevision] = useState(0);
  useEffect(() => {
    const changed = () => setHashRevision(value => value + 1);
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  const openedLink = useRef("");
  useEffect(() => {
    if (!webWorkspaceId || !listing) return;
    const target = sharedVaultHashTarget(window.location.hash, listing.items.map(item => item.path), folders);
    if (!target) { openedLink.current = ""; return; }
    const key = `${target.type}:${target.path}`;
    if (openedLink.current === key) return;
    openedLink.current = key;
    if (target.type === "file") {
      void readForOpen(target.path, true)
        .then(value => { if (openedLink.current === key) { setSelected(value); setDestinationFolder(folderForItem(target.path)); } })
        .catch(reason => { if (openedLink.current === key) setError(reason instanceof Error ? reason.message : "The shared file could not be opened."); });
    } else {
      void Promise.resolve().then(() => { if (openedLink.current === key) { setSelected(null); setCommentsOpen(false); setDestinationFolder(target.path); } });
    }
  }, [webWorkspaceId, listing, folders, hashRevision, setSelected]);
  const closeRemoved = useCallback((removedPath?: string) => {
    if (removedPath && selectedRef.current?.path !== removedPath) return;
    setSelected(null); setFileAction(null); setCommentsOpen(false); setPublishing(null); currentFileRef.current = null;
    flushRef.current = async () => true; publishFlushRef.current = async () => false;
  }, [setSelected]);
  const operate = async (action: () => Promise<void>, navigation = false) => {
    if (busy) return;
    setBusy(true); setError("");
    try { if (await flushRef.current(navigation)) { await action(); setFileAction(null); } }
    catch (error) { setError(error instanceof Error ? error.message : "The file operation failed."); }
    finally { setBusy(false); }
  };
  const createNote = (origin: HTMLElement | null) => operate(async () => {
    const created = await vaultRequest<VaultFile>("create", { title: "Untitled", folder: destinationFolder.trim() });
    setNewNoteFocus({ file: created, root: listing?.root ?? "", itemId: packIdentity(created.markdown), origin,
      focusPending: true, awaitSharedMode: allowFolderPicker });
    setSelected(created);
    refresh();
  });
  const importImages = async (files: File[]) => {
    if (!files.length || importing.current || busy || !listing?.root || !canCreate) return;
    if (files.length > 20) { setError("Choose up to 20 images at a time."); return; }
    importing.current = true;
    try {
      await operate(async () => {
        let completed = 0;
        try {
          for (const file of files) {
            setImportStatus(`Importing image ${completed + 1} of ${files.length}…`);
            if (file.size > MAX_IMAGE_BYTES) throw new Error(`${file.name}: choose an image no larger than 20 MiB.`);
            const pack = await prepareImagePack(new Uint8Array(await file.arrayBuffer()), file.name);
            await vaultRequest<VaultFile>("importPack", { title: pack.title, data: encodeBase64(pack.bytes), folder: destinationFolder.trim() });
            completed++;
          }
          closeRemoved();
          setImportStatus(`Imported ${completed} ${completed === 1 ? "image" : "images"}.`);
        } catch (error) {
          setImportStatus(completed ? `Imported ${completed} of ${files.length} images. Earlier imports are saved.` : "");
          throw error;
        } finally { refresh(); }
      });
    } finally { importing.current = false; }
  };
  const openSearch = useCallback(() => {
    if (searchOpen || document.querySelector('[role="dialog"][aria-modal="true"], dialog[open]')) return;
    searchReturnFocus.current = focusedControl();
    setSearchOpen(true);
  }, [searchOpen]);
  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    restoreDialogFocus(searchReturnFocus.current, searchButton.current);
    searchReturnFocus.current = null;
  }, []);
  const closeFeedSubscribe = useCallback(() => {
    setFeedSubscribeOpen(false);
    restoreDialogFocus(feedSubscribeReturnFocus.current, feedSubscribeButton.current, searchButton.current);
    feedSubscribeReturnFocus.current = null;
  }, []);
  const beginCustomize = useCallback((path: string) => {
    assistantReturnFocus.current = focusedControl();
    if (window.matchMedia("(max-width: 700px)").matches) setSidebarVisible(false);
    setAssistantRequest({ type: "customize", requestId: ++assistantRequestId.current, taskId: crypto.randomUUID(), path });
    setAssistantOpen(true);
  }, [setSidebarVisible]);
  const closeAssistant = useCallback(() => {
    setAssistantOpen(false);
    restoreDialogFocus(assistantReturnFocus.current, searchButton.current);
    assistantReturnFocus.current = null;
  }, []);
  const activeWorkspaceRoot = listing?.root ?? "";
  const activeItemPath = selected?.path ?? "";
  const beginAddAgent = useCallback(() => {
    if (!activeWorkspaceRoot || !activeItemPath) return;
    assistantReturnFocus.current = focusedControl();
    if (window.matchMedia("(max-width: 700px)").matches) setSidebarVisible(false);
    setAssistantRequest({ type: "agent", requestId: ++assistantRequestId.current, root: activeWorkspaceRoot, target: activeItemPath });
    setAssistantOpen(true);
  }, [activeItemPath, activeWorkspaceRoot, setSidebarVisible]);
  useEffect(() => {
    window.addEventListener(REQUEST_ADD_ITEM_AGENT_EVENT, beginAddAgent);
    return () => window.removeEventListener(REQUEST_ADD_ITEM_AGENT_EVENT, beginAddAgent);
  }, [beginAddAgent]);
  const customizeCurrent = useCallback(async () => {
    let path = selected?.path;
    if (!path) {
      const folder = destinationFolder.trim();
      const definitions = await vaultRequest<{ files: FolderViewMetadata[] }>("folderViews", { folder });
      const view = resolveFolderView(definitions.files, folder);
      if (!view) throw new Error("Choose a folder design first, then customize this folder.");
      path = view.path;
    }
    beginCustomize(path);
  }, [beginCustomize, destinationFolder, selected?.path]);
  useEffect(() => {
    const openFile = (event: Event) => { const path = (event as CustomEvent<{ path: string }>).detail?.path; if (path) void operate(async () => { setSelected(await readForOpen(path, !allowFolderPicker)); setDestinationFolder(folderForItem(path)); }, true); };
    const newFile = () => { if (canCreate) createNote(focusedControl()); };
    window.addEventListener("texttext:vault-open", openFile);
    window.addEventListener("texttext:vault-new", newFile);
    return () => { window.removeEventListener("texttext:vault-open", openFile); window.removeEventListener("texttext:vault-new", newFile); };
  });
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        if (document.querySelector('[role="dialog"][aria-modal="true"], dialog[open]')) return;
        event.preventDefault(); openSearch();
      }
    };
    window.addEventListener("keydown", key);
    window.addEventListener("texttext:vault-search", openSearch);
    return () => { window.removeEventListener("keydown", key); window.removeEventListener("texttext:vault-search", openSearch); };
  }, [openSearch]);
  const commandActions: VaultSearchAction[] = [];
  const commandFolder = destinationFolder.trim();
  const commandLocation = commandFolder || "the workspace root";
  if (canCreate) commandActions.push(
    { id: "new-note", label: "New note", description: `Create a note in ${commandLocation}.` },
    { id: "capture", label: "Capture", description: `Save a link or note in ${commandLocation}.`, keywords: ["save", "link", "note", "bookmark"] },
  );
  if (allowFolderPicker && listing?.root) commandActions.push({
    id: "customize",
    label: selected ? "Customize this item" : "Customize this folder",
    description: selected ? "Change how the open item looks." : `Change how ${commandLocation} looks.`,
    keywords: ["design", "look", "template"],
  });
  if (allowFolderPicker && selected?.path) commandActions.push({
    id: "add-agent",
    label: "Add agent to this item",
    description: "Give Codex a task for the open item.",
    keywords: ["assistant", "collaborate", "edit"],
  });
  return <div className={`vault-app${assistantOpen ? " has-assistant" : ""}${commentsOpen && canOpenComments ? " has-comments" : ""}${sidebarOpen ? "" : " sidebar-collapsed"}${sidebarReady ? " sidebar-ready" : ""}`}
    onDragOver={(event) => { if (!selected && event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
    onDrop={(event) => { if (!selected && event.dataTransfer.files.length) { event.preventDefault(); if (canCreate) void importImages(Array.from(event.dataTransfer.files)); } }}
    onPaste={(event) => {
      const target = event.target as HTMLElement;
      if (selected || target.closest("input,textarea,[contenteditable=true]")) return;
      const files = Array.from(event.clipboardData.files);
      if (files.length) { event.preventDefault(); if (canCreate) void importImages(files); }
    }}>
    <DocumentEngineStyles />
    <aside id="vault-sidebar" className="vault-sidebar" aria-hidden={!sidebarOpen}
      onClickCapture={(event) => {
        if (window.matchMedia("(max-width: 700px)").matches &&
            (event.target as HTMLElement).closest("button,a")) setSidebarVisible(false);
      }}>
      <div className="vault-sidebar-header"><h1>TextText</h1>
        <button type="button" aria-label="Hide folders" aria-controls="vault-sidebar" aria-expanded={sidebarOpen}
          onClick={() => setSidebarVisible(false, true)}>Hide</button></div>
      {!allowFolderPicker && <nav className="vault-other-workspaces" aria-label="Shared workspaces"><a href="/shared">Shared with me</a></nav>}
      {allowFolderPicker && <button disabled={busy} onClick={() => void operate(async () => {
        const opened = await vaultRequest<VaultListing>("open");
        restoredLocationRoot.current = ""; setLocationReadyRoot("");
        setListing(opened); setSelected(null); setCommentsOpen(false); setDestinationFolder(""); flushRef.current = async () => true;
      })}>Open folder</button>}
      {listing?.root && <>
        <button disabled={busy} onClick={() => void operate(async () => { closeRemoved(); setDestinationFolder(""); }, true)}>{access && !access.fullAccess ? "Shared files" : "All files"}</button>
        <p className="vault-root" title={listing.root}>{listing.name || listing.root.split("/").filter(Boolean).at(-1)}</p>
        {canCreate && <label className="vault-folder-destination">Folder for new items
          <input list="vault-folders" aria-label="Folder for new items" value={destinationFolder} placeholder="Workspace root"
            onChange={(event) => setDestinationFolder(event.target.value)} />
          <datalist id="vault-folders">{folders.map((folder) => <option key={folder} value={folder} />)}</datalist>
        </label>}
        {canCreate && <><button disabled={busy} onClick={() => createNote(focusedControl())}>New note</button>
        <button disabled={busy} onClick={() => void operate(async () => setTemplatePicker(true))}>New from template</button>
        <button disabled={busy} onClick={() => void operate(async () => setCaptureOpen(true))}>Save a link or note</button>
        {canSubscribeFeed && <button ref={feedSubscribeButton} disabled={busy} onClick={() => {
          feedSubscribeReturnFocus.current = focusedControl();
          void operate(async () => setFeedSubscribeOpen(true));
        }}>Subscribe to a feed</button>}
        <input ref={imageInput} type="file" accept={IMAGE_ACCEPT} multiple hidden aria-label="Choose images" onChange={(event) => {
          const files = Array.from(event.target.files ?? []); event.target.value = ""; void importImages(files);
        }} />
        <button disabled={busy} onClick={() => imageInput.current?.click()}>Import images…</button></>}
        {allowFolderPicker && <>
          <button disabled={busy} onClick={() => void operate(async () => {
            const result = await vaultRequest<{ file?: VaultFile }>("import", { folder: destinationFolder.trim() });
            if (result.file) { setSelected(result.file); refresh(); }
          })}>Import file…</button>
        </>}
        <button ref={searchButton} disabled={busy} onClick={openSearch}>Search and actions ⌘K</button>
        {canOpenRecovery && <button disabled={busy} onClick={() => void operate(async () => setRecovery({}))}>Trash and recovery</button>}
        <nav aria-label="Workspace files"><FolderNavigation tree={tree} selectedPath={selected?.path} busy={busy}
          onFolder={(path) => void operate(async () => { closeRemoved(); setDestinationFolder(path); }, true)} onOpen={(item) => void operate(async () => {
            setSelected(await readForOpen(item.path, !allowFolderPicker)); setDestinationFolder(folderForItem(item.path));
          }, true)} /></nav>
        {allowFolderPicker && <NativeConnection key={listing.root} root={listing.root} />}
      </>}
    </aside>
    {sidebarOpen && <button type="button" className="vault-sidebar-backdrop" aria-label="Close folders"
      onClick={() => setSidebarVisible(false, true)} />}
    <main>
      {!sidebarOpen && <button ref={sidebarReopenButton} type="button" className="vault-sidebar-open"
        aria-controls="vault-sidebar" aria-expanded={false} onClick={() => setSidebarVisible(true)}>Show folders</button>}
      {importStatus && <p role="status">{importStatus}</p>}
      {selected && <div className="vault-file-actions">
        {canOpenComments && <button ref={commentsButton} type="button" aria-expanded={commentsOpen} aria-controls="vault-comments-panel"
          disabled={busy} onClick={() => setCommentsOpen(value => !value)}>Comments</button>}
        {canShare && sharingWorkspaceId && <button disabled={busy} onClick={() => setSharing({ workspaceId: sharingWorkspaceId, scopeType: "item", scopeKey: packIdentity(selected.markdown), label: selected.path.split("/").at(-1)?.replace(/\.textpack$/i, "") || "file" })}>Share</button>}
        {canPublish && sharingWorkspaceId && selectedItemId && <button disabled={busy} onClick={() => setPublishing({ workspaceId: sharingWorkspaceId, itemId: selectedItemId, label: selected.path.split("/").at(-1)?.replace(/\.textpack$/i, "") || "file" })}>Publish</button>}
        {canManageFiles && <button disabled={busy} onClick={() => { setNewPath(selected.path); setFileAction("rename"); }}>Rename or move</button>}
        {canManageFiles && <button disabled={busy} onClick={() => setFileAction("delete")}>Delete</button>}
        {allowFolderPicker && <button disabled={busy} onClick={() => beginCustomize(selected.path)}>Customize</button>}
        {canOpenRecovery && <button disabled={busy} onClick={() => void operate(async () => setRecovery({ path: selected.path }))}>Version history</button>}
        {canManageFiles && fileAction === "rename" && <form onSubmit={(event) => { event.preventDefault(); void operate(async () => {
          const observed = currentFileRef.current?.();
          if (!observed || observed.path !== selected.path) throw new Error("Wait for this file to finish opening.");
          const renamed = await vaultRequest<VaultFile>("rename", { path: observed.path, hash: observed.hash, newPath: newPath.trim() });
          setSelected(renamed); setFileAction(null); refresh();
        }); }}>
          <label>File path<input aria-label="New file path" value={newPath} onChange={(event) => setNewPath(event.target.value)} /></label>
          <button disabled={busy || !newPath.trim()} type="submit">Save path</button>
          <button type="button" onClick={() => setFileAction(null)}>Cancel</button>
        </form>}
        {canManageFiles && fileAction === "delete" && <div role="group" aria-label="Confirm file deletion">
          <p>Delete <strong>{selected.path}</strong>?</p>
          <button disabled={busy} onClick={() => void operate(async () => {
            const observed = currentFileRef.current?.();
            if (!observed || observed.path !== selected.path) throw new Error("Wait for this file to finish opening.");
            await vaultRequest("delete", { path: observed.path, hash: observed.hash });
            setSelected(null); setFileAction(null); setCommentsOpen(false); currentFileRef.current = null; flushRef.current = async () => true; refresh();
          })}>Delete file</button>
          <button onClick={() => setFileAction(null)}>Cancel</button>
        </div>}
      </div>}
      {commentsOpen && canOpenComments && selected && selectedItemId && <div id="vault-comments-panel"><VaultComments
        key={`${sharingWorkspaceId}:${selectedItemId}`} itemId={selectedItemId} path={selected.path}
        canComment={commentCapabilities.canComment} canResolve={commentCapabilities.canResolve}
        onClose={() => { setCommentsOpen(false); commentsButton.current?.focus(); }} /></div>}
      {recovery && <RecoveryDialog key={`recovery:${listing?.root}:${recovery.path ?? "trash"}`} path={recovery.path} onClose={() => setRecovery(null)} onRestore={async (file, folder) => {
        if (!await flushRef.current()) throw new Error("Save or resolve the current document before restoring a copy.");
        if (readFolderView(file)) {
          const definitions = await vaultRequest<{ files: VaultFile[] }>("folderViews", { folder });
          if (definitions.files.length) throw new Error("That folder already has a design. Choose another folder for this recovered design copy.");
        }
        const title = `${readDocument(file).content.title || "Untitled"} (recovered)`;
        const restored = await vaultRequest<VaultFile>("importPack", { title, data: file.data, folder });
        closeRemoved(); setSelected(restored); setDestinationFolder(folderForItem(restored.path)); refresh();
      }} />}
      {sharing && canShare && <VaultShareDialog key={`${sharing.workspaceId}:${sharing.scopeType}:${sharing.scopeKey}`} scope={sharing} onClose={() => setSharing(null)} />}
      {publishing && canPublish && selectedItemId === publishing.itemId && <VaultPublishDialog
        key={`${publishing.workspaceId}:${publishing.itemId}`} {...publishing}
        beforeChange={() => publishFlushRef.current()} onClose={() => setPublishing(null)} />}
      {captureOpen && <CaptureDialog onClose={() => setCaptureOpen(false)} onSave={async (input) => {
        if (!await flushRef.current()) throw new Error("Save or resolve the current document before capturing another item.");
        const created = await vaultRequest<VaultFile>("create", { ...input, folder: destinationFolder.trim() });
        setSelected(created); refresh();
      }} />}
      {feedSubscribeOpen && <FeedSubscribeDialog folder={destinationFolder.trim()} folders={folders} onClose={closeFeedSubscribe} onSaved={file => {
        closeRemoved(); setSelected(file); setDestinationFolder(folderForItem(file.path)); refresh();
      }} />}
      {searchOpen && <VaultSearch actions={commandActions} namesOnly={!allowFolderPicker} onClose={closeSearch} onAction={(action) => {
        if (action.id === "new-note") return createNote(null);
        if (action.id === "capture") { setCaptureOpen(true); return; }
        if (action.id === "customize") return customizeCurrent();
        if (action.id === "add-agent") { beginAddAgent(); return; }
      }} onOpen={async (path) => {
        if (!await flushRef.current(true)) throw new Error("Save or resolve the current document before opening another file.");
        setSelected(await readForOpen(path, !allowFolderPicker)); setDestinationFolder(folderForItem(path));
      }} />}
      {templatePicker && <LocalTemplateLibrary onClose={() => setTemplatePicker(false)} onApply={() => {}} onCreateFromFile={(path) => void operate(async () => {
        const source = await vaultRequest<VaultFile>("read", { path });
        const title = readDocument(source).content.title || path.split("/").at(-1)!.replace(/\.textpack$/i, "");
        const created = await vaultRequest<VaultFile>("create", { title, folder: destinationFolder.trim(), sourcePath: path, sourceHash: source.hash });
        setSelected(created); setTemplatePicker(false); refresh();
      })} />}
      {error && <div className="vault-notice" role="alert">{error}</div>}
      {selected && listing ? <DocumentBoundary key={`${listing.root}:${selected.path}`}>
        {selectedFeed.error ? <div className="vault-notice" role="alert">{selectedFeed.error}</div> : selectedFeed.subscription
          ? <FeedSubscriptionReader key={`${listing.root}:${selected.path}:${selected.hash}:${canReadFeeds}`} subscription={selectedFeed.subscription}
              folder={feedFolder} canRead={canReadFeeds} canKeep={canKeepFeed} onKept={() => refresh()} />
          : <div inert={busy}><OpenVaultEditor initial={selected} root={listing.root} registerFlush={registerFlush} onChanged={refresh} onRemoved={() => closeRemoved(selected.path)}
              focusNewNote={!busy && newNoteFocus?.file === selected && newNoteFocus.focusPending}
              focusNewNoteOrigin={newNoteFocus?.file === selected ? newNoteFocus.origin : undefined}
              onNewNoteFocusHandled={() => setNewNoteFocus(current => {
                if (current?.file !== selected) return current;
                return current.awaitSharedMode ? { ...current, focusPending: false } : null;
              })}
              awaitSharedMode={Boolean(allowFolderPicker && newNoteFocus?.awaitSharedMode && newNoteFocus.root === listing.root && newNoteFocus.itemId === selectedItemId)}
              onSharedMode={() => {
                setNewNoteFocus(current => {
                  if (!current || current.root !== listing.root || current.itemId !== selectedItemId) return current;
                  return current.focusPending ? { ...current, awaitSharedMode: false } : null;
                });
                setNativePublishRefresh(value => value + 1);
              }} /></div>}
      </DocumentBoundary> : visibleListing?.root && !allowFolderPicker && !access ? <div className="vault-empty" role="status">Loading workspace permissions…</div>
      : visibleListing?.root ? <div aria-hidden={templatePicker || captureOpen || searchOpen || undefined}><WorkspaceOverview listing={visibleListing} folder={destinationFolder} busy={busy} canCreate={canCreate} sharedView={Boolean(access && !access.fullAccess)}
        onShare={canShare && sharingWorkspaceId ? (folder) => setSharing({ workspaceId: sharingWorkspaceId, scopeType: "folder", scopeKey: folder, label: folder.split("/").at(-1) || folder }) : undefined}
        onCustomize={allowFolderPicker ? beginCustomize : undefined}
        onFolder={(path) => setDestinationFolder(path)}
        onOpen={(path) => void operate(async () => { setSelected(await readForOpen(path, !allowFolderPicker)); setDestinationFolder(folderForItem(path)); }, true)}
        onCreate={(path, folder) => void operate(async () => {
          const source = await vaultRequest<VaultFile>("read", { path });
          const title = readDocument(source).content.title || "Untitled";
          setSelected(await vaultRequest<VaultFile>("create", { title, folder, sourcePath: path, sourceHash: source.hash })); refresh();
        })} /></div> : <div className="vault-empty">
        <h2>{listing?.root ? "Your workspace" : "Open a workspace folder"}</h2>
        <p>{listing?.root ? "Choose a TextPack or create a note." : "Choose a folder on your Mac. Your documents and templates live there as TextPack files."}</p>
      </div>}
    </main>
    {allowFolderPicker && <NativeAssistant key={listing?.root || "no-workspace"} open={assistantOpen} root={listing?.root ?? ""} path={selected?.path} request={assistantRequest} onClose={closeAssistant} beforeSend={() => flushRef.current()} />}
  </div>;
}
