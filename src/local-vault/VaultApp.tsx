"use client";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { applyDocumentSnapshot } from "@/lib/collab/document";
import { HostedVaultEditor, VaultEditorSurfaceHost, VaultEditorSurfaceController, VaultEditorSurface } from "./editor-surface-host";
import { isLocalHandoffCapability } from "./local-handoff-capability";
import { handoffLocalToShared } from "./local-shared-handoff";
import { prepareHandoffUpdate } from "./handoff-update";
import { acquireVaultDocument, type VaultDocumentHandle } from "./document-session";
import type { NativeHandoffScope, NativeHandoffDraftOwner } from "./native-handoff-draft";
import { NativeHandoffDraftOwner as HandoffDraftOwner, parseNativeHandoffDraft, decodeHandoffUpdate } from "./native-handoff-draft";
import { createVaultDocumentReferences, vaultReferenceChoices } from "./reference-choices";
import { FolderMoveDialog } from "./FolderMoveDialog";
import { reconcileFolderLocation } from "./folder-location";
import { newItemPack } from "./new-item-pack";
import { loadFolderItemDefault, folderStarter } from "./folder-item-default";
import { useShortcutLabel } from "@/components/accessibility/useShortcutLabel";
import { listingCapabilities, type CreatedVaultItem } from "./listing-capabilities";
import { workspaceIdFromWebRoot } from "./web-workspace-root";
import { DocumentRenderer } from "@/components/document/DocumentRenderer";
import { retryBootstrap, isTransientBootstrapError } from "./bootstrap-retry";
import { templateStarterDocument } from "./template-starter";
import { VaultNoteTemplatePicker } from "./VaultNoteTemplatePicker";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DocumentBoundary } from "./DocumentBoundary";
import type { EditorImagePasteRequest, EditorImagePasteResult } from "@/components/document/UnifiedDocumentEditor";
import { DocumentEngineStyles } from "@/components/document/DocumentEngineStyles";
import { validateTemplateDefinition, type TemplateDefinition } from "@/lib/presentation/schema";
import { noteIcon } from "@/lib/note-icons";
import { BUILTIN_TEMPLATES, templateExperience } from "@/lib/presentation/templates";
import { emptyDocumentSnapshot, type DocumentSnapshot } from "@/lib/documents/model";
import { reconcileDocumentSnapshots } from "@/lib/vault/reconcile";
import { VaultError, vaultRequest, type VaultFile, type VaultItem, type VaultListing } from "./bridge";
import { asPost, localBlog, readDocument, readTemplate, writePayload, VaultRepresentationConflict, type VaultTemplateSelection } from "./model";
import { WorkspaceTypeLibrary as LocalTemplateLibrary } from "./LocalTemplateLibrary";
import { WorkspaceOverview } from "./WorkspaceOverview";
import { VaultGalleryLightbox } from "./VaultGalleryLightbox";
import { NativeConnection } from "./NativeConnection";
import { NativeAssistant, type NativeAssistantRequest } from "./NativeAssistant";
import { ParticipantsRow as LocalParticipantsRow } from "./LocalParticipants";
import { FolderNavigation } from "./FolderNavigation";
import { folderTree, folderPaths, folderForItem } from "./folders";
import { ArticleReader } from "./ArticleReader";
import { toggleNoteTask, VaultNoteDisplay } from "./VaultNoteDisplay";
import { VaultCardLinkPicker } from "./VaultCardLinkPicker";
import { VaultStoryDisplay } from "./VaultStoryDisplay";
import { articleSource } from "@/lib/vault/article-capture";
import { readFeedSubscription } from "@/lib/vault/rss";
import { activeBodySelection } from "@/lib/document-history-events";
import { ArticleCapture } from "./ArticleCapture";
import { ArticleEnrichmentWorker } from "./ArticleEnrichmentWorker";
import { queueArticleEnrichment } from "./article-enrichment";
import { CaptureDialog, captureInput } from "./CaptureDialog";
import { FeedSubscribeDialog, FeedSubscriptionReader } from "./VaultFeeds";
import { RecoveryDialog } from "./RecoveryDialog";
import { CollaborativeVaultEditor, type VaultCollaborationConfig, type VaultEditorProps } from "./CollaborativeVaultEditor";
import { flushDocumentSessions } from "./document-session";
import { fileCollaborationJournalKey, hasPendingFileCollaborationJournal } from "@/sync/engine/client";
import { applyStoryDetails, type StoryDetails } from "./story-details";
import { packIdentity } from "./pack";
import { locateVaultItemOrResolve } from "./item-location";
import { prepareSharedNote } from "./new-note-promotion";
import { readFolderView, resolveFolderView, type FolderViewMetadata } from "./folder-view";
import { VaultSearch, type VaultSearchAction } from "./VaultSearch";
import { VaultShareDialog, type VaultShareScope } from "./VaultShareDialog";
import { VaultPublishDialog } from "./VaultPublishDialog";
import { VaultComments } from "./VaultComments";
import { vaultCommentCapabilities } from "./vault-comments";
import { watchWorkspaceAccess } from "./workspace-access";
import { sharedVaultLinkTarget, type VaultAccess } from "./shared-vaults";
import { prepareImagePack, encodeBase64, MAX_IMAGE_BYTES, IMAGE_ACCEPT } from "./image-import";
import { prepareEditorImagePaste } from "./editor-image-paste";
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

type LocalEditorHandoff = {
  capture(): { generation: number; document: DocumentSnapshot };
  recoveryDocument(): DocumentSnapshot;
  pauseAndDrain(): Promise<{ file: VaultFile; base: DocumentSnapshot }>;
  begin(scope: NativeHandoffScope, proof: import("./local-handoff-capability").LocalHandoffCapability): NativeHandoffDraftOwner;
  assertCurrent(): void;
};
function VaultEditor({ documentReferences, onOpenReference, referenceChoices, readOnly = false, initial, root, onChanged, onRemoved, onTitleChange, registerFlush, startEditing, focusNewNote, focusNewNoteTitle, focusNewNoteOrigin, focusNewNoteSelection, onNewNoteFocusHandled, registerHandoff }: VaultEditorProps & { registerHandoff?: (owner: LocalEditorHandoff | null) => void }) {
  const recoveryKey = `texttext:vault-item-draft:${JSON.stringify([root, packIdentity(initial.markdown)])}`;
  const legacyRecoveryKey = useRef(`texttext:vault-draft:${root}:${initial.path}`).current;
  const initialDocument = useMemo(() => readDocument(initial), [initial]);
  const initialTemplate = useMemo(() => readTemplate(initial, initialDocument), [initial, initialDocument]);
  const [templates, setTemplates] = useState(() => [initialTemplate, ...BUILTIN_TEMPLATES.filter((template) => template.id !== initialTemplate.id || template.version !== initialTemplate.version)]);
  const pendingLook = useRef<VaultTemplateSelection | null>(null);
  const file = useRef(initial);
  useEffect(() => {
    if (packIdentity(initial.markdown) === packIdentity(file.current.markdown)) file.current = { ...file.current, path: initial.path };
  }, [initial.path, initial.markdown]);
  const baseline = useRef(initialDocument);
  const current = useRef(initialDocument);
  const localGeneration = useRef(0), fileWriterPaused = useRef(false);
  const handoffDraft = useRef<NativeHandoffDraftOwner | null>(null);
  const handoffStorageFailed = useRef(false);
  const alive = useRef(true);
  const [localDocument] = useState(() => { const doc = new Y.Doc(); applyDocumentSnapshot(doc, initialDocument); return doc; });
  const [localAwareness] = useState(() => new Awareness(localDocument));
  useEffect(() => () => { alive.current = false; localAwareness.destroy(); localDocument.destroy(); }, [localAwareness, localDocument]);

  const running = useRef<Promise<boolean> | null>(null);
  const fileOperations = useRef(new Set<Promise<void>>());
  const captureFinish = useRef<(() => void) | null>(null);
  const capturePending = useCallback((pending: boolean) => {
    if (pending) {
      if (captureFinish.current) return;
      let finish!: () => void;
      const operation = new Promise<void>(resolve => { finish = resolve; });
      fileOperations.current.add(operation);
      captureFinish.current = () => { fileOperations.current.delete(operation); finish(); captureFinish.current = null; };
    } else captureFinish.current?.();
  }, []);

  const refreshing = useRef(false);
  const conflict = useRef(false);
  const missing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [external, setExternal] = useState(initialDocument);
  const [reading, setReading] = useState(() => !startEditing && Boolean(articleSource(initialDocument) ||
    templateExperience(initialTemplate) === "note" && !focusNewNote && !focusNewNoteTitle &&
    (initialDocument.content.title.trim() || initialDocument.content.body.trim()) ||
    templateExperience(initialTemplate) === "article" && !focusNewNoteTitle &&
    (initialDocument.content.title.trim() || initialDocument.content.body.trim())));
  useEffect(() => {
    const editItem = () => {
      if (readOnly) return;
      setReading(false);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        document.querySelector<HTMLElement>('[aria-label="Document body"], .tt-text-title[contenteditable="true"]')?.focus();
      }));
    };
    window.addEventListener("texttext:vault-edit-item", editItem);
    return () => window.removeEventListener("texttext:vault-edit-item", editItem);
  }, [readOnly]);
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
      if (handoffDraft.current) {
        const captured = handoffDraft.current.capture();
        if (localGeneration.current > captured.generation) handoffDraft.current.remember(current.current, localGeneration.current);
        else handoffDraft.current.assertCurrent();
        return true;
      }
      if (equal(current.current, baseline.current) && !pendingLook.current) localStorage.removeItem(recoveryKey);
      else localStorage.setItem(recoveryKey, JSON.stringify({ base: baseline.current, document: current.current, look: pendingLook.current }));
      return true;
    } catch { handoffStorageFailed.current = true; setNotice("The recovery copy could not be saved. Keep this document open until its file saves."); return false; }
  }, [recoveryKey]);
  const acceptRemote = useCallback((remote: VaultFile): boolean => {
    if (remote.hash === file.current.hash) { file.current = { ...file.current, path: remote.path }; return true; }
    let remoteDocument: DocumentSnapshot;
    try { remoteDocument = readDocument(remote, file.current, baseline.current); }
    catch (error) {
      if (!(error instanceof VaultRepresentationConflict)) throw error;
      conflict.current = true; setHasConflict(true); setNotice(error.message);
      return false;
    }
    const result = reconcileDocumentSnapshots(baseline.current, current.current, remoteDocument, { concurrentInsertions: "remote-first" });
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
    if (fileWriterPaused.current) return Promise.resolve(false);
    if (running.current) return running.current.then(saved => saved && !fileWriterPaused.current);
    if (conflict.current) return Promise.resolve(false);
    const save = async () => {
      let retries = 0;
      while (!equal(current.current, baseline.current) || pendingLook.current) {
        if (conflict.current) return false;
        if (fileWriterPaused.current) return true;
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
    return running.current.then(saved => saved && !fileWriterPaused.current);
  }, [acceptRemote, onChanged, remember]);
  const retrySave = async () => {
    if (!await flush()) return;
    try {
      // A bridge timeout may occur after the file operation finishes. Verify
      // the pack before dismissing its warning, even if no edits remain.
      const latest = await vaultRequest<VaultFile>("read", { path: file.current.path });
      if (acceptRemote(latest) && await flush()) setNotice("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The file could not be checked. Your edits are kept here.");
    }
  };
  const change = useCallback((next: DocumentSnapshot) => {
    if (equal(next, current.current)) return;
    current.current = next; localGeneration.current++; remember();
    onTitleChange?.(file.current.path, next.content.title);
    if (timer.current) clearTimeout(timer.current);
    if (!fileWriterPaused.current) timer.current = setTimeout(() => { void flush(); }, 350);
  }, [flush, onTitleChange, remember]);
  useEffect(() => {
    if (!registerHandoff) return;
    const assertCurrent = () => {
      if (!alive.current || conflict.current || handoffStorageFailed.current || pendingLook.current) throw Error("This editor has retained work that needs recovery before connecting.");
      handoffDraft.current?.assertCurrent();
    };
    registerHandoff({
      capture: () => { assertCurrent(); return { generation: localGeneration.current, document: structuredClone(current.current) }; },
      recoveryDocument: () => structuredClone(current.current),
      pauseAndDrain: async () => {
        assertCurrent(); fileWriterPaused.current = true;
        if (timer.current) { clearTimeout(timer.current); timer.current = null; }
        const pending = running.current;
        if (pending && !await pending) throw Error("The pending file write could not be verified.");
        await Promise.all([...fileOperations.current]);
        assertCurrent();
        return { file: { ...file.current }, base: structuredClone(baseline.current) };
      },
      begin: (scope, proof) => {
        assertCurrent();
        if (!fileWriterPaused.current) throw Error("The file writer is still active.");
        if (!handoffDraft.current) handoffDraft.current = new HandoffDraftOwner(localStorage, recoveryKey,
          { generation: localGeneration.current, base: baseline.current, document: current.current }, scope, proof);
        return handoffDraft.current;
      }, assertCurrent,
    });
    return () => registerHandoff(null);
  }, [registerHandoff, recoveryKey]);
  useEffect(() => { applyDocumentSnapshot(localDocument, external, "external-file"); }, [localDocument, external]);
  const pasteImages = useCallback(async (request: EditorImagePasteRequest): Promise<EditorImagePasteResult> => {
    let finish!: () => void;
    const operation = new Promise<void>(resolve => { finish = resolve; });
    fileOperations.current.add(operation);
    try {
      if (fileWriterPaused.current) throw Error("Finish connecting this note before pasting an image. Your clipboard is unchanged.");
      if (conflict.current) throw new Error("Resolve the file conflict before pasting an image.");
      if (!await flush()) throw new Error("Save the current text before pasting an image.");
      const sourceDocument = current.current;
      if (sourceDocument.content.body !== request.document.content.body) throw new Error("The document changed. Paste the image again.");
      const edit = await prepareEditorImagePaste({
        document: sourceDocument,
        selection: request.selection,
        files: request.files,
        occupiedFilenames: file.current.assets?.map(asset => asset.filename),
      });
      if (fileWriterPaused.current) throw Error("The editor started connecting. Paste the image again after it connects.");
      if (!equal(sourceDocument, current.current)) throw new Error("The document changed. Paste the image again.");
      const written = await vaultRequest<VaultFile>("write", {
        ...writePayload(file.current, edit.document),
        addedAssets: edit.addedAssets,
      });
      // An already issued asset write is drained before native ownership.
      // Reconcile its reply with text accepted while it was in flight.
      if (!acceptRemote(written)) throw Error("The image file saved, but newer edits need recovery. Both versions are kept.");
      localGeneration.current++; remember();
      onChanged();
      setNotice("");
      return { caret: edit.caret };
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The image could not be pasted. Your text is still here.");
      return undefined;
    } finally { fileOperations.current.delete(operation); finish(); }
  }, [acceptRemote, flush, onChanged, remember]);
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
  const saveStoryDetails = useCallback(async (details: StoryDetails) => {
    if (!await publishFlush() || fileWriterPaused.current) return false;
    updateArticle(document => applyStoryDetails(document, details));
    return publishFlush();
  }, [publishFlush, updateArticle]);
  useEffect(() => { registerFlush(flush, () => file.current, publishFlush, saveStoryDetails); }, [flush, publishFlush, registerFlush, saveStoryDetails]);
  useEffect(() => {
    try {
      let saved = localStorage.getItem(recoveryKey);
      if (!saved) {
        saved = localStorage.getItem(legacyRecoveryKey);
        if (saved) { localStorage.setItem(recoveryKey, saved); localStorage.removeItem(legacyRecoveryKey); }
      }
      if (saved) {
        const draft = JSON.parse(saved);
        if (Object.prototype.hasOwnProperty.call(draft, "version")) {
          conflict.current = true; setHasConflict(true);
          throw Error("This draft requires its verified shared recovery session before editing.");
        }
        if (draft.look) {
          const template = validateTemplateDefinition(draft.look.template);
          pendingLook.current = { template, sourceJSON: draft.look.sourceJSON };
          // Hydrate a persisted recovery record from browser storage once per opened file.
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setTemplates((values) => [template, ...values.filter((value) => value.id !== template.id || value.version !== template.version)]);
        }
        const result = reconcileDocumentSnapshots(draft.base, draft.document, baseline.current, { concurrentInsertions: "remote-first" });
        if (result.status === "merged") { current.current = result.document; setExternal(result.document); void flush(); }
        else { current.current = draft.document; setExternal(draft.document); conflict.current = true; setHasConflict(true); setNotice("A recovered draft and this file have different edits. Save a separate copy to keep both."); }
      }
    } catch (error) { handoffStorageFailed.current = true; setNotice(`Could not restore the draft: ${error instanceof Error ? error.message : "invalid recovery data"}`); }
    const changed = () => {
      if (fileWriterPaused.current || refreshing.current) return;
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
          const relocated = await locateVaultItemOrResolve(packIdentity(file.current.markdown), file.current.path, listing, itemId => vaultRequest("resolveItemId", { itemId }));
          if (relocated && relocated.path !== file.current.path) {
            if (running.current) await running.current;
            const latest = await vaultRequest<VaultFile>("read", { path: relocated.path });
            if (packIdentity(latest.markdown) !== packIdentity(file.current.markdown)) throw new Error("The file location changed again. Your draft is kept.");
            if (acceptRemote(latest)) await flush();
            return;
          }
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
  const display = useMemo(() => mapStrings(external, assets.forward), [external, assets]);
  const post = useMemo(() => asPost(display, initial.path), [display, initial.path]);
  const displayTemplate = templates.find((candidate) => candidate.id === external.presentation.template.id && candidate.version === external.presentation.template.version) ?? initialTemplate;
  const experience = templateExperience(displayTemplate);
  if (readOnly) return <section className="vault-document"><p className="vault-notice">Read only</p><DocumentRenderer document={display} template={displayTemplate} /></section>;
  return <section className="vault-document">{notice && <div className="vault-notice" role="status">{notice}{hasConflict ? <button disabled={copying} onClick={() => void saveCopy()}>{copying ? "Saving copy…" : "Save my edits as a copy"}</button> : <button onClick={() => void retrySave()}>Retry save</button>}</div>}<ArticleCapture document={external} readCurrent={readCurrent} update={updateArticle} beforeCapture={flush} onCapturePending={capturePending} onMediaPending={() => queueArticleEnrichment(root, file.current.path)} />{articleSource(external) && <div className="vault-reading-switch"><button aria-pressed={reading} onClick={() => void flush().then((saved) => { if (saved) { setExternal(current.current); setReading(true); } })}>Read</button><button aria-pressed={!reading} onClick={() => setReading(false)}>Edit</button></div>}{reading ? articleSource(external) ? <ArticleReader document={display} template={displayTemplate} update={updateArticle} /> : experience === "article" ? <VaultStoryDisplay document={display} template={displayTemplate} onEdit={() => setReading(false)} /> : <VaultNoteDisplay document={display} sourceBody={external.content.body} template={displayTemplate} itemId={packIdentity(openedFile.markdown)} onOpenCardPath={path => window.dispatchEvent(new CustomEvent("texttext:vault-open", { detail: { path } }))} onEdit={() => setReading(false)} onOpenCardId={async itemId => { const resolved = await vaultRequest<{ path: string }>("resolveItemId", { itemId }); window.dispatchEvent(new CustomEvent("texttext:vault-open", { detail: { path: resolved.path } })); }} onToggleTask={(index, body) => updateArticle(current => current.content.body !== body ? current : { ...current, content: { ...current.content, body: toggleNoteTask(body, index) ?? body } })} /> : <HostedVaultEditor localDocument={registerHandoff ? localDocument : undefined} localPresence={registerHandoff ? { awareness: localAwareness, peers: [] } : undefined} onOpenReference={onOpenReference} referenceChoices={referenceChoices} documentReferences={documentReferences} transport="local" renderNoteTemplatePicker={props => <VaultNoteTemplatePicker {...props} />} renderNoteCardLinkPicker={props => <VaultCardLinkPicker {...props} />} externalDocument={external} resolveDocumentAssets={(document) => mapStrings(document, assets.forward)} blog={localBlog} post={post} template={displayTemplate} availableTemplates={templates} onPasteImages={pasteImages} renderTemplateLibrary={(props) => <LocalTemplateLibrary currentTemplate={pendingLook.current?.template ?? readTemplate(file.current, current.current)} onClose={props.onClose} onApply={(template, sourceJSON) => {
    if (fileWriterPaused.current) { setNotice("Finish connecting this note before changing its look."); return; }
    pendingLook.current = { template, sourceJSON };
    setTemplates((values) => [template, ...values.filter((value) => value.id !== template.id || value.version !== template.version)]);
    props.onApply(template); remember();
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, 350);
  }} />} focusNewNote={focusNewNote} focusNewNoteTitle={focusNewNoteTitle} focusNewNoteOrigin={focusNewNoteOrigin} focusNewNoteSelection={focusNewNoteSelection} onNewNoteFocusHandled={onNewNoteFocusHandled} collab={{ postId: initial.path, userName: "You", color: "#3970c5", canEdit: true }} onDocumentChange={change} onDone={async () => { if (await flush() && (experience === "note" || experience === "article")) { setExternal(current.current); setReading(true); } }} />}</section>;
}

export function OpenVaultEditor(props: VaultEditorProps & { awaitSharedMode?: boolean; onSharedMode?: () => void }) {
  const { root, initial, awaitSharedMode, onSharedMode, registerFlush } = props;
  const path = initial.path;
  const markdown = initial.markdown;
  const [mode, setMode] = useState<VaultCollaborationConfig | "local" | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (mode === "local" || error) window.dispatchEvent(new Event("texttext:initial-view-terminal"));
  }, [mode, error]);
  const [retry, setRetry] = useState(0);
  const [retryable, setRetryable] = useState(false);
  const [handoffRetry, setHandoffRetry] = useState(0);
  const [canRetryHandoff, setCanRetryHandoff] = useState(false);
  const [retryingHandoff, setRetryingHandoff] = useState(false);
  const retryingHandoffRef = useRef(false);
  const handoffScope = JSON.stringify([root, path, packIdentity(markdown)]);
  const handoffScopeRef = useRef(handoffScope); handoffScopeRef.current = handoffScope;
  const [localFallbackFile, setLocalFallbackFile] = useState<{ scope: string; file: VaultFile } | null>(null);
  const fallbackToLocal = useCallback((fresh?: VaultFile) => {
    if (fresh) {
      if (fresh.path !== path || packIdentity(fresh.markdown) !== packIdentity(markdown)) throw new Error("The local file no longer matches this document.");
      setLocalFallbackFile({ scope: handoffScope, file: fresh });
    }
    setMode("local");
  }, [handoffScope, path, markdown]);
  const [promoting, setPromoting] = useState(false);
  const [sharedInitial, setSharedInitial] = useState<VaultFile | null>(null);
  const [resumeEditor, setResumeEditor] = useState<{ target: "body" | "title"; selection: { anchor: number; head: number; direction?: "forward" | "backward" | "none" } | null; focused: boolean } | null>(null);
  const localRoot = useRef<HTMLDivElement>(null);
  const localFlush = useRef<(() => Promise<boolean>) | null>(null);
  const localOwner = useRef<LocalEditorHandoff | null>(null);
  const registerLocalOwner = useCallback((owner: LocalEditorHandoff | null) => { localOwner.current = owner; }, []);
  const [surfaceHost] = useState(() => new VaultEditorSurfaceHost());
  const [nativeHandoff, setNativeHandoff] = useState<{ config: VaultCollaborationConfig; file: VaultFile; committed: boolean; sharedReady: boolean } | null>(null);
  const nativeHandoffRef = useRef(nativeHandoff); nativeHandoffRef.current = nativeHandoff;
  const retainedHandle = useRef<VaultDocumentHandle | null>(null);
  const startupHandle = useRef<VaultDocumentHandle | null>(null);
  const releaseStartupHandle = useCallback((handle: VaultDocumentHandle) => {
    const retained = startupHandle.current;
    if (retained && retained.session === handle.session) { startupHandle.current = null; void retained.release(); }
  }, []);

  const sharedFlush = useRef<Parameters<VaultEditorProps["registerFlush"]> | null>(null);
  const handoffAcknowledged = useRef(false);
  const publishSharedFlush = useCallback((value: Parameters<VaultEditorProps["registerFlush"]>) => {
    const [flush, currentFile, publish, details, durability] = value;
    registerFlush(async navigation => Boolean(await flush(navigation)) && handoffAcknowledged.current, currentFile,
      async () => handoffAcknowledged.current ? publish() : false,
      async change => handoffAcknowledged.current ? details(change) : false,
      durability ? async () => { const receipt = await durability(); return receipt && !handoffAcknowledged.current && receipt.outcome === "durable" ? { ...receipt, outcome: "pending" } : receipt; } : undefined);
  }, [registerFlush]);

  const registerBackgroundFlush = useCallback<VaultEditorProps["registerFlush"]>((...value) => {
    sharedFlush.current = value;
    if (nativeHandoffRef.current?.committed) publishSharedFlush(value);
  }, [publishSharedFlush]);

  const downloadHandoffRecovery = useCallback(() => {
    const key = `texttext:vault-item-draft:${JSON.stringify([root, packIdentity(markdown)])}`;
    const handle = retainedHandle.current ?? startupHandle.current;
    const raw = localStorage.getItem(key);
    let beforeHandoff: string | null = null;
    try {
      const hash: unknown = raw ? JSON.parse(raw).handoff?.legacyDraftSha256 : null;
      if (typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash)) beforeHandoff = localStorage.getItem(key + ":before-handoff-v2:" + hash);
    } catch { /* The original raw record is still exported for explicit recovery. */ }
    const value = { version: 1, document: localOwner.current?.recoveryDocument() ?? null,
      draft: raw, beforeHandoff,
      journal: handle?.session.hasClient ? handle.session.client.recoveryJournal : null };
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "TextText connecting editor recovery.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [root, markdown]);
  const onSharedModeRef = useRef(onSharedMode);
  useEffect(() => { onSharedModeRef.current = onSharedMode; }, [onSharedMode]);
  const registerLocalFlush = useCallback<VaultEditorProps["registerFlush"]>((flush, currentFile, publishFlush, saveStoryDetails, durabilityResult) => {
    localFlush.current = flush;
    if (!nativeHandoffRef.current?.committed) registerFlush(flush, currentFile, publishFlush, saveStoryDetails, durabilityResult, "local-file");
  }, [registerFlush]);
  const retryCertifiedHandoff = async () => {
    if (retryingHandoffRef.current) return;
    const startup = !retainedHandle.current && Boolean(startupHandle.current);
    const handle = startup ? startupHandle.current : retainedHandle.current, local = localOwner.current;
    const expected = handle?.session.identity;
    const scope = handoffScopeRef.current;
    const key = `texttext:vault-item-draft:${JSON.stringify([root, packIdentity(markdown)])}`;
    const retainedDraft = startup ? localStorage.getItem(key) : null;
    const assertCurrent = () => {
      if ((startup ? startupHandle.current !== handle || localStorage.getItem(key) !== retainedDraft : !local || localOwner.current !== local || retainedHandle.current !== handle) || handoffScopeRef.current !== scope)
        throw Error("This retained editor is no longer current. Its recovery copy is kept.");
      if (!startup) local!.assertCurrent();
    };
    if (!handle || !expected || !handle.session.canRetryUnpublishedOpen) return;
    retryingHandoffRef.current = true; setRetryingHandoff(true); setCanRetryHandoff(false);
    try {
      assertCurrent();
      const fresh = await vaultRequest<VaultCollaborationConfig | null>("collaborationConfig", { path });
      assertCurrent();
      if (!fresh || !isLocalHandoffCapability(fresh.localHandoff) || fresh.localFiles !== true ||
          fresh.namespace !== expected.namespace || fresh.accountId !== expected.accountId || fresh.workspaceId !== expected.workspaceId || fresh.itemId !== expected.itemId)
        throw Error("Return to the original account and workspace before retrying this retained note.");
      if (!handle.session.canRetryUnpublishedOpen) throw Error("The native owner could not confirm that this note never opened. Its recovery copy is kept.");
      const closed = await handle.closeExclusive(() => {
        assertCurrent();
        if (!handle.session.canRetryUnpublishedOpen) throw Error("The retained owner changed before retrying.");
      });
      assertCurrent();
      if (!closed) throw Error("The retained owner could not close safely. Keep this note open.");
      setError("");
      if (startup) { startupHandle.current = null; setRetry(value => value + 1); }
      else {
        retainedHandle.current = null; sharedFlush.current = null;
        nativeHandoffRef.current = null; setNativeHandoff(null); setHandoffRetry(value => value + 1);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The retained note could not retry safely.");
      // A failed account/config check does not consume the original no-open proof.
      // Every click must revalidate fresh authority before disposing this owner.
      try { assertCurrent(); setCanRetryHandoff(handle.session.canRetryUnpublishedOpen); }
      catch { setCanRetryHandoff(false); }
    }
    finally { retryingHandoffRef.current = false; setRetryingHandoff(false); }
  };
  useEffect(() => {
    if (nativeHandoffRef.current) return;
    let stopped = false;
    const controller = new AbortController();
    const cacheKey = `texttext:collaboration-config:${root}:${packIdentity(markdown)}`;
    const draftKey = `texttext:vault-item-draft:${JSON.stringify([root, packIdentity(markdown)])}`;
    // A new-format draft cannot enter the old snapshot-rediff/file writer.
    // Native compatibility and stable scope are verified before its bytes apply.
    const retainedDraft = localStorage.getItem(draftKey);
    let draftVersion: unknown;
    try { if (retainedDraft) draftVersion = JSON.parse(retainedDraft).version; }
    catch { draftVersion = "invalid"; }
    if (draftVersion !== undefined) {
      // No mounted file owner may acknowledge an unopened/future handoff.
      registerFlush(async () => false, () => initial, async () => false, async () => false);
      const assertStartup = () => { if (stopped || controller.signal.aborted || localStorage.getItem(draftKey) !== retainedDraft) throw Error("The retained handoff changed or is no longer current."); };
      void (async () => {
        if (draftVersion !== 2 || !retainedDraft) throw Error("This retained draft uses an unsupported recovery format.");
        const config = await retryBootstrap(signal => vaultRequest<VaultCollaborationConfig | null>("collaborationConfig", { path }, signal), controller.signal);
        assertStartup();
        if (!config?.localFiles || !config.accountId || !isLocalHandoffCapability(config.localHandoff)) throw Error("Open this retained draft with its supported native account session.");
        const handle = acquireVaultDocument({ ...config, requireLocalHandoff: true, assertHandoffCurrent: assertStartup }, initial, root);
        startupHandle.current = handle;
        await handle.ready; assertStartup();
        const native = handle.session.native, client = handle.session.client;
        if (!isLocalHandoffCapability(native?.localHandoff) || !client.epoch) throw Error("The native recovery format was not verified.");
        const scope = { origin: new URL(config.namespace).origin, accountId: config.accountId, workspaceId: config.workspaceId, itemId: config.itemId, epoch: client.epoch };
        const saved = parseNativeHandoffDraft(retainedDraft, scope);
        const draft = new HandoffDraftOwner(localStorage, draftKey, saved, scope, native.localHandoff);
        let target = client.localDurabilityTarget.generation;
        for (const intent of saved.handoff.intents) {
          assertStartup();
          const applied = client.applyLocalHandoffUpdate(decodeHandoffUpdate(intent.update), scope.epoch);
          if (applied === null) throw Error("The retained update could not be durably applied. Its original bytes are kept.");
          target = applied;
        }
        const prior = saved.handoff.intents.at(-1)?.sourceDocument ?? saved.base;
        if (!equal(prior, saved.document)) {
          const update = prepareHandoffUpdate(client.doc, prior, saved.document);
          if (!update) throw Error("The retained draft and shared document need separate recovery copies.");
          draft.record(update, saved.generation, crypto.randomUUID());
          const applied = client.applyLocalHandoffUpdate(update, scope.epoch);
          if (applied === null) throw Error("The retained update could not be durably applied.");
          target = applied;
        }
        const lifetime = client.localDurabilityTarget.lifecycle;
        const receipt = await client.flushLocalResult();
        if (stopped || controller.signal.aborted || receipt.outcome !== "durable" || receipt.generation < target || receipt.lifecycle !== lifetime || client.epoch !== scope.epoch)
          throw Error("The recovered handoff has not durably saved its original epoch.");
        draft.assertCurrent(); draft.acknowledge(saved.generation);
        if (stopped) return;
        setSharedInitial(handle.session.file); setMode(config); onSharedModeRef.current?.();
      })().catch(reason => { if (!stopped) { setRetryable(false); setCanRetryHandoff(Boolean(startupHandle.current?.session.canRetryUnpublishedOpen)); setError(reason instanceof Error ? reason.message : "The retained handoff needs recovery."); } });
      return () => { stopped = true; controller.abort(); };
    }
    // Finish an ordinary recoverable file draft through its existing owner.
    if (retainedDraft || localStorage.getItem(`texttext:vault-draft:${root}:${path}`)) {
      queueMicrotask(() => { if (!stopped) setMode("local"); });
      return () => { stopped = true; };
    }
    void retryBootstrap(signal => vaultRequest<VaultCollaborationConfig | null>("collaborationConfig", { path }, signal), controller.signal).then(async config => {
      if (stopped) return;
      setError(""); setRetryable(false);
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
        const key = fileCollaborationJournalKey({ server: previous.namespace, workspaceId: previous.workspaceId, itemId: previous.itemId, accountId: previous.accountId });
        try { if (await hasPendingFileCollaborationJournal(key)) { setMode(previous); return; } }
        catch {
          // Let the shared client expose an intact or unreadable IndexedDB
          // journal instead of silently opening another persistence path.
          setMode(previous); return;
        }
      }
      setMode("local");
    }).catch(reason => {
      if (stopped) return;
      if (awaitSharedMode) setMode("local");
      else { setRetryable(isTransientBootstrapError(reason)); setError(reason instanceof Error ? reason.message : "Could not open this document."); }
    });
    return () => { stopped = true; controller.abort(); };
  }, [root, path, markdown, retry, awaitSharedMode]);
  useEffect(() => {
    if (!retryable) return;
    const recover = () => { setRetryable(false); setError(""); setRetry(value => value + 1); };
    window.addEventListener("online", recover); window.addEventListener("focus", recover);
    return () => { window.removeEventListener("online", recover); window.removeEventListener("focus", recover); };
  }, [retryable]);
  useEffect(() => {
    // Files created outside the app also join live editing after sync acknowledges them.
    if (mode !== "local") return;
    let stopped = false, running = false, rerun = false;
    let handoffAbort: AbortController | null = null;
    const draftKey = `texttext:vault-item-draft:${JSON.stringify([root, packIdentity(markdown)])}`;
    const config = () => vaultRequest<VaultCollaborationConfig | null>("collaborationConfig", { path });
    const read = () => vaultRequest<VaultFile>("read", { path });
    const check = () => {
      if (stopped || nativeHandoffRef.current) return;
      if (running) { rerun = true; return; }
      running = true;
      void (async () => {
        do {
          rerun = false;
          const candidate = await config();
          if (!candidate || stopped || !localFlush.current) continue;
          if (candidate.localFiles === true && isLocalHandoffCapability(candidate.localHandoff) && localOwner.current) {
            if (!surfaceHost.hasLocalSurface() || localRoot.current?.closest("[inert]")) continue;
            const local = localOwner.current;
            let draft: NativeHandoffDraftOwner | null = null, acknowledgements = 0;
            const controller = new AbortController(); handoffAbort = controller;
            const assertCurrent = (handle?: VaultDocumentHandle) => {
              if (stopped || localOwner.current !== local) throw Error("The editor handoff is no longer current.");
              local.assertCurrent();
              if (handle && retainedHandle.current !== handle) throw Error("The shared owner changed.");
            };
            const result = await handoffLocalToShared({
              assertCurrent, capture: () => local.capture(), pauseAndDrain: () => local.pauseAndDrain(),
              beginOpen: saved => {
                assertCurrent();
                let handle!: VaultDocumentHandle;
                handle = acquireVaultDocument({ ...candidate, requireLocalHandoff: true, assertHandoffCurrent: () => assertCurrent(handle) }, saved.file, root);
                retainedHandle.current = handle;
                setNativeHandoff({ config: candidate, file: saved.file, committed: false, sharedReady: false });
                const ready = (async () => {
                  await handle.ready; assertCurrent(handle);
                  if (!isLocalHandoffCapability(handle.session.native?.localHandoff)) throw Error("The native recovery format was not verified.");
                  if (!handle.session.client.hasBaseline || !handle.session.client.canEdit) throw Error("The shared document is not ready for editing. The local draft is kept.");
                  setNativeHandoff(value => value ? { ...value, sharedReady: true } : value);
                  await surfaceHost.waitForSharedSurface(controller.signal); assertCurrent(handle);
                })();
                return { handle, ready };
              },
              scope: handle => handle.session.client.localDurabilityTarget,
              merge: (handle, base, localDocument) => {
                assertCurrent(handle);
                const client = handle.session.client, native = handle.session.native;
                if (!candidate.accountId || !client.epoch || !isLocalHandoffCapability(native?.localHandoff)) return null;
                draft ??= local.begin({ origin: new URL(candidate.namespace).origin, accountId: candidate.accountId,
                  workspaceId: candidate.workspaceId, itemId: candidate.itemId, epoch: client.epoch }, native.localHandoff);
                const update = prepareHandoffUpdate(client.doc, base, localDocument);
                if (!update) return null;
                const captured = local.capture();
                if (!equal(captured.document, localDocument)) return null;
                const previous = draft.retained().handoff.intents.at(-1);
                if (!previous || previous.sourceGeneration !== captured.generation || !equal(previous.sourceDocument, localDocument))
                  draft.record(update, captured.generation, crypto.randomUUID());
                return client.applyLocalHandoffUpdate(update, client.epoch);
              },
              durability: async handle => {
                const receipt = await handle.session.client.flushLocalResult();
                if (acknowledgements++ === 0) await surfaceHost.waitForComposition(controller.signal);
                return receipt;
              },
              atomicCommit: (handle, generation) => {
                assertCurrent(handle);
                if (local.capture().generation !== generation || !sharedFlush.current || !surfaceHost.commitShared()) return false;
                publishSharedFlush(sharedFlush.current);
                setNativeHandoff(value => value ? { ...value, committed: true } : value);
                onSharedModeRef.current?.(); return true;
              },
              acknowledgeDraft: async (handle, generation) => {
                assertCurrent(handle);
                if (local.capture().generation !== generation) throw Error("Newer local input remains in recovery.");
                draft?.acknowledge(generation);
                handoffAcknowledged.current = true;
                if (sharedFlush.current) publishSharedFlush(sharedFlush.current);
              },
              retain: reason => { setError(reason instanceof Error ? reason.message : "The connecting editor retained its recovery copy."); },
            });
            if (result.state === "shared") { retainedHandle.current = null; void result.handle.release(); }
            else setCanRetryHandoff(Boolean(result.handle?.session.canRetryUnpublishedOpen));
            // Unknown lease/durability outcomes keep the old view, paused file
            // owner and exact retained handle. Never fall through to legacy.
            return;
          }

          const body = localRoot.current?.querySelector<HTMLElement>('[aria-label="Document body"]');
          const editingBody = body?.isContentEditable === true;
          const title = localRoot.current?.querySelector<HTMLTextAreaElement>('textarea[aria-label="Title"]');
          const titleFocused = Boolean(title && document.activeElement === title);
          const focused = titleFocused || editingBody && document.activeElement === body;
          const selection = titleFocused && title
            ? { anchor: title.selectionStart, head: title.selectionEnd, direction: title.selectionDirection }
            : focused ? activeBodySelection() : null;
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
          if (editingBody || titleFocused) setResumeEditor({ target: titleFocused ? "title" : "body", selection, focused });
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
    let localSurfaceReady = surfaceHost.hasLocalSurface();
    const unsubscribeSurface = surfaceHost.subscribe(() => {
      const ready = surfaceHost.hasLocalSurface();
      if (ready && !localSurfaceReady) check();
      localSurfaceReady = ready;
    });
    check();
    return () => { stopped = true; unsubscribeSurface(); handoffAbort?.abort(); window.removeEventListener("texttext:vault-sync-status", sync); window.removeEventListener("texttext:vault-changed", check); };
  }, [mode, path, root, handoffRetry]);
  if (mode === "local") return <><div ref={localRoot} inert={promoting} onCompositionStartCapture={() => surfaceHost.setComposing(true)} onCompositionEndCapture={() => surfaceHost.setComposing(false)}>
    <div hidden={nativeHandoff?.committed}><VaultEditorSurfaceController host={surfaceHost} owner="local"><VaultEditor {...props} initial={localFallbackFile?.scope === handoffScope ? localFallbackFile.file : props.initial} registerFlush={registerLocalFlush} registerHandoff={registerLocalOwner} /></VaultEditorSurfaceController></div>
    {nativeHandoff?.sharedReady && <div hidden={!nativeHandoff.committed}><VaultEditorSurfaceController host={surfaceHost} owner="shared"><CollaborativeVaultEditor {...props} initial={nativeHandoff.file} config={nativeHandoff.config} inactiveHandoff={!nativeHandoff.committed} registerFlush={registerBackgroundFlush} onTitleChange={(path, title) => { if (nativeHandoffRef.current?.committed) props.onTitleChange?.(path, title); }} startEditing /></VaultEditorSurfaceController></div>}
    <section className="vault-document"><VaultEditorSurface host={surfaceHost} /></section>
    </div>{(error || promoting || nativeHandoff && !nativeHandoff.committed) && <p className="vault-notice" role="status">{error || "Connecting this note…"}{error && <>{canRetryHandoff && <button disabled={retryingHandoff} onClick={() => void retryCertifiedHandoff()}>{retryingHandoff ? "Retrying…" : "Retry connecting"}</button>}<button onClick={downloadHandoffRecovery}>Download recovery</button></>}</p>}</>;
  if (mode) return <CollaborativeVaultEditor {...props} onSessionAcquired={releaseStartupHandle} initial={sharedInitial ? { ...sharedInitial, path: props.initial.path } : props.initial} config={mode}
    startEditing={Boolean(resumeEditor) || props.startEditing}
    focusNewNote={Boolean(resumeEditor?.focused) || props.focusNewNote} focusNewNoteOrigin={resumeEditor ? null : props.focusNewNoteOrigin}
    focusNewNoteTitle={resumeEditor ? resumeEditor.target === "title" : props.focusNewNoteTitle}
    focusNewNoteSelection={resumeEditor?.selection} onNewNoteFocusHandled={() => { setResumeEditor(null); props.onNewNoteFocusHandled?.(); }}
    onLocalFallback={fallbackToLocal} />;
  return <div className="vault-notice" role="status">{error || "Opening document…"}{error && <>{startupHandle.current ? canRetryHandoff && <button disabled={retryingHandoff} onClick={() => void retryCertifiedHandoff()}>Retry connecting</button> : <button onClick={() => { setError(""); setRetry(value => value + 1); }}>Retry</button>}<button onClick={downloadHandoffRecovery}>Download recovery</button></>}</div>;
}

function selectedIdentity(file: VaultFile): string | null {
  try { return packIdentity(file.markdown); } catch { return null; }
}
export function VaultApp({ allowFolderPicker = true, accountMenu, templateIntent = null, webAssistant = false, inputDisabled = false }: { inputDisabled?: boolean; allowFolderPicker?: boolean; webAssistant?: boolean; accountMenu?: ReactNode; templateIntent?: { query: string } | null }) {
  const shortcut = useShortcutLabel();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarReady, setSidebarReady] = useState(false);
  const sidebarReopenButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const saved = localStorage.getItem("texttext:vault-sidebar-open");
        setSidebarOpen(!window.matchMedia("(max-width: 700px)").matches && saved !== "false");
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
    const narrow = window.matchMedia("(max-width: 700px)");
    const syncForWidth = (event: MediaQueryListEvent) => {
      if (event.matches) { setSidebarOpen(false); return; }
      try { setSidebarOpen(localStorage.getItem("texttext:vault-sidebar-open") !== "false"); }
      catch { setSidebarOpen(true); }
    };
    narrow.addEventListener("change", syncForWidth);
    return () => narrow.removeEventListener("change", syncForWidth);
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
  const listingRef = useRef<VaultListing | null>(null);
  listingRef.current = listing;
  const [selected, setSelectedState] = useState<VaultFile | null>(null);
  const [liveTitle, setLiveTitle] = useState<{ path: string; title: string } | null>(null);
  const updateSelectedTitle = useCallback((path: string, title: string) => {
    setLiveTitle(current => current?.path === path && current.title === title ? current : { path, title });
  }, []);
  const selectedRef = useRef<VaultFile | null>(null);
  const navigationGeneration = useRef(0);
  const setSelected = useCallback((file: VaultFile | null) => {
    navigationGeneration.current++;
    selectedRef.current = file;
    setLiveTitle(null);
    setSelectedState(file);
  }, []);
  const restoredLocationRoot = useRef("");
  const [locationReadyRoot, setLocationReadyRoot] = useState("");
  const [newNoteFocus, setNewNoteFocus] = useState<{ file: VaultFile; root: string; itemId: string; origin: HTMLElement | null; focusPending: boolean; focusTitle?: boolean; awaitSharedMode: boolean } | null>(null);
  // The store already accepted this item. Keep it editable while a busy native
  // inventory scan delays its listing row; the listing answers once it names it.
  const [createdItem, setCreatedItem] = useState<CreatedVaultItem | null>(null);
  const rememberCreated = useCallback((file: VaultFile, root: string | undefined) => {
    const itemId = selectedIdentity(file);
    setCreatedItem(root && itemId ? { root, itemId, path: file.path } : null);
  }, []);
  const noteDraftActive = useRef(false);
  const [noteEditPath, setNoteEditPath] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [listingError, setListingError] = useState("");
  const [accessError, setAccessError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingNativeOpen, setPendingNativeOpen] = useState<string | null>(null);
  const nativeOpenRequested = useRef(false);
  const [destinationFolder, setDestinationFolder] = useState("");
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantRequest, setAssistantRequest] = useState<NativeAssistantRequest | null>(null);
  const [assistantTargetPath, setAssistantTargetPath] = useState<string | null>(null);
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
  const [templateQuery, setTemplateQuery] = useState("");
  const consumedTemplateIntent = useRef<{ query: string } | null>(null);
  const [captureMode, setCaptureMode] = useState<"bookmark" | "mixed" | null>(null);
  const [pendingCreationLook, setPendingCreationLook] = useState<{ kind: "bookmark" | "gallery"; template: TemplateDefinition; sourceJSON?: string | null } | null>(null);
  const [preferredBookmarkPath, setPreferredBookmarkPath] = useState("");
  const [importedGalleryPath, setImportedGalleryPath] = useState<string | null>(null);
  const [imageCaptureOpen, setImageCaptureOpen] = useState(false);
  const [feedSubscribeOpen, setFeedSubscribeOpen] = useState(false);
  const [folderDesignOpen, setFolderDesignOpen] = useState(false);
  const [movingFolder, setMovingFolder] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [recovery, setRecovery] = useState<{ path?: string; scope: string } | null>(null);
  const [sharing, setSharing] = useState<VaultShareScope | null>(null);
  const [publishing, setPublishing] = useState<{ workspaceId: string; itemId: string; label: string } | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [fileAction, setFileAction] = useState<"rename" | "delete" | null>(null);
  const [newPath, setNewPath] = useState("");
  const imageInput = useRef<HTMLInputElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const feedSubscribeButton = useRef<HTMLButtonElement>(null);
  const moreActions = useRef<HTMLDetailsElement>(null);
  const moreActionsSummary = useRef<HTMLElement>(null);
  const searchReturnFocus = useRef<HTMLElement | null>(null);
  const feedSubscribeReturnFocus = useRef<HTMLElement | null>(null);
  const commentsButton = useRef<HTMLButtonElement>(null);
  const assistantReturnFocus = useRef<HTMLElement | null>(null);
  const importing = useRef(false);
  const [importStatus, setImportStatus] = useState("");
  useEffect(() => { queueMicrotask(() => setImportStatus("")); }, [listing?.root, selected?.path, destinationFolder]);
  const [nativeConnection, setNativeConnection] = useState<{ root: string; workspaceId: string; webURL?: string; accountId?: string } | null>(null);
  const [nativePublishAccess, setNativePublishAccess] = useState<{ workspaceId: string; itemId: string; canPublish: boolean } | null>(null);
  const [nativePublishRefresh, setNativePublishRefresh] = useState(0);
  const currentFileRef = useRef<(() => VaultFile) | null>(null);
  const webWorkspaceId = !allowFolderPicker ? workspaceIdFromWebRoot(listing?.root) : null;
  const nativeWorkspaceId = allowFolderPicker && nativeConnection?.root === listing?.root ? nativeConnection?.workspaceId ?? null : null;
  const sharingWorkspaceId = webWorkspaceId ?? nativeWorkspaceId;
  const accessScope = useMemo(() => sharingWorkspaceId && listing?.root
    ? { root: listing.root, workspaceId: sharingWorkspaceId, connection: allowFolderPicker ? nativeConnection : null } : null,
    [sharingWorkspaceId, listing?.root, allowFolderPicker, nativeConnection]);
  const recoveryScope = JSON.stringify([listing?.root ?? "", nativeConnection?.workspaceId ?? "", nativeConnection?.accountId ?? ""]);
  const recoveryScopeRef = useRef(recoveryScope);
  recoveryScopeRef.current = recoveryScope;
  const [workspaceAccess, setWorkspaceAccess] = useState<{ scope: NonNullable<typeof accessScope>; value: VaultAccess } | null>(null);
  const access = accessScope && workspaceAccess?.scope === accessScope ? workspaceAccess.value : null;
  useEffect(() => { queueMicrotask(() => setSharing(null)); }, [accessScope]);
  const visibleListing = useMemo(() => {
    if (!listing || !access || access.fullAccess) return listing;
    const folders = access.grants.filter(grant => grant.scopeType === "folder").map(grant => grant.scopeKey);
    return { ...listing, folders: [...new Set([...(listing.folders ?? []), ...folders])] };
  }, [listing, access]);
  const browseListing = useMemo(() => visibleListing && ({ ...visibleListing,
    items: visibleListing.items.filter(item => !/^(Templates|Recovered)\//i.test(item.path)),
    folders: visibleListing.folders?.filter(folder => !/^(Templates|Recovered)(\/|$)/i.test(folder)),
  }), [visibleListing]);
  const tree = useMemo(() => folderTree(browseListing?.items ?? [], browseListing?.folders), [browseListing]);
  const folders = useMemo(() => folderPaths(tree), [tree]);
  useEffect(() => {
    if (!visibleListing?.root || (!allowFolderPicker && !access) || restoredLocationRoot.current === visibleListing.root) return;
    const root = visibleListing.root;
    const restoringGeneration = navigationGeneration.current;
    restoredLocationRoot.current = root;
    void Promise.resolve().then(() => {
      if (nativeOpenRequested.current || selectedRef.current || navigationGeneration.current !== restoringGeneration) {
        setLocationReadyRoot(root);
        return;
      }
      if (webWorkspaceId && new URLSearchParams(window.location.search).has("item")) {
        if (!sharedVaultLinkTarget(window.location.search, window.location.hash, visibleListing.items, folders)) {
          setSelected(null);
          setError("This file is unavailable or you no longer have access.");
        }
        setLocationReadyRoot(root);
        return;
      }
      if (webWorkspaceId && sharedVaultLinkTarget(window.location.search, window.location.hash, visibleListing.items, folders)) {
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
        if (restoredLocationRoot.current === root && navigationGeneration.current === restoringGeneration) setSelected(file);
      }).catch(reason => {
        if (restoredLocationRoot.current === root && navigationGeneration.current === restoringGeneration) {
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
  const durabilityResultRef = useRef<() => Promise<import("@/sync/engine/client").FileCollaborationDurabilityResult | null>>(async () => null);
  const localFileModeRef = useRef(false);
  useEffect(() => {
    const nativeWindow = window as Window & {
      texttextFlushForSignOut?: () => Promise<boolean>;
      texttextFlushForNativeClose?: () => Promise<{ ok: boolean; idle: boolean; durability: import("@/sync/engine/client").FileCollaborationDurabilityResult | { outcome: "durable" | "pending" } | { outcome: "local-file-durable"; workspaceId: string; itemId: string; lifecycle: string; fileHash: string } | null }>;
    };
    const flushApplication = async () => {
      const ok = await flushRef.current(true) && await flushDocumentSessions();
      if (!ok) setError("Some edits have not finished saving. Reopen the document to retry saving or keep a recovery copy.");
      return ok;
    };
    nativeWindow.texttextFlushForSignOut = flushApplication;
    nativeWindow.texttextFlushForNativeClose = async () => {
      const ok = await flushApplication();
      const durability = await durabilityResultRef.current();
      const selectedFile = selectedRef.current;
      const currentFile = currentFileRef.current?.();
      const localFile = ok && localFileModeRef.current && durability === null && selectedFile && currentFile?.path === selectedFile.path ? currentFile : null;
      return { ok, idle: ok && selectedRef.current === null && durability === null,
        durability: !ok ? { outcome: "pending" } : durability ?? (localFile ? { outcome: "local-file-durable", workspaceId: listingRef.current?.root ?? "",
          itemId: packIdentity(localFile.markdown), lifecycle: `local-file:${localFile.path}`, fileHash: localFile.hash }
          : { outcome: ok ? "durable" : "pending" }) };
    };
    return () => { delete nativeWindow.texttextFlushForSignOut; delete nativeWindow.texttextFlushForNativeClose; };
  }, []);
  const publishFlushRef = useRef<() => Promise<string | false>>(async () => false);
  const saveStoryDetailsRef = useRef<(details: StoryDetails) => Promise<string | false>>(async () => false);
  const registerFlush = useCallback<VaultEditorProps["registerFlush"]>((flush, currentFile, publishFlush, saveStoryDetails, durabilityResult, mode) => {
    flushRef.current = flush; publishFlushRef.current = publishFlush; saveStoryDetailsRef.current = saveStoryDetails; currentFileRef.current = currentFile;
    durabilityResultRef.current = durabilityResult ?? (async () => null);
    localFileModeRef.current = mode === "local-file";
  }, []);
  const capabilities = listingCapabilities(listing, access, allowFolderPicker, createdItem);
  const canCreate = capabilities.create(destinationFolder.trim());
  const canEditSelected = Boolean(selected && capabilities.editItem(selectedIdentity(selected), selected.path));
  useEffect(() => {
    if (templateIntent === null || consumedTemplateIntent.current === templateIntent || !listing || !canCreate) return;
    consumedTemplateIntent.current = templateIntent;
    setTemplateQuery(templateIntent.query);
    setTemplatePicker(true);
  }, [templateIntent, listing, canCreate]);
  const canManageFiles = capabilities.manageFiles;
  const canOpenRecovery = canManageFiles && (allowFolderPicker || Boolean(access?.isOwner));
  const canReadFeeds = Boolean(capabilities.fullAccess && (webWorkspaceId || nativeWorkspaceId));
  const canSubscribeFeed = canCreate && canReadFeeds && capabilities.create(destinationFolder.trim());
  const canShare = Boolean(access?.canManageShares);
  const selectedItemId = useMemo(() => selected ? selectedIdentity(selected) : null, [selected]);
  const documentReferences = useMemo(() => createVaultDocumentReferences(selectedItemId ?? undefined, selected?.path), [selectedItemId, listing?.root, selected?.path]);
  const selectedFeed = useMemo(() => {
    if (!selected) return { subscription: null, error: "" };
    try { return { subscription: readFeedSubscription(selected), error: "" }; }
    catch (reason) { return { subscription: null, error: reason instanceof Error ? reason.message : "This feed subscription could not be opened." }; }
  }, [selected]);
  const feedFolder = destinationFolder.trim();
  useEffect(() => {
    if (listingError || (listing?.root && locationReadyRoot === listing.root &&
        (!selected || selectedFeed.subscription || selectedFeed.error))) {
      window.dispatchEvent(new Event("texttext:initial-view-terminal"));
    }
  }, [listingError, listing?.root, locationReadyRoot, selected, selectedFeed]);
  const canKeepFeed = canReadFeeds && capabilities.create(feedFolder);
  useEffect(() => {
    if (!selected || (!selectedFeed.subscription && !selectedFeed.error)) return;
    currentFileRef.current = () => selected;
    flushRef.current = async () => true;
    durabilityResultRef.current = async () => null;
    localFileModeRef.current = false;
    publishFlushRef.current = async () => {
      const itemId = packIdentity(selected.markdown);
      const saved = await vaultRequest<{ revision: string }>("publicationRead", { itemId });
      return saved.revision === selected.hash ? saved.revision : false;
    };
  }, [selected, selectedFeed]);
  const canPublish = Boolean(webWorkspaceId ? access?.canManageShares : nativeWorkspaceId && selectedItemId &&
    nativePublishAccess?.workspaceId === nativeWorkspaceId && nativePublishAccess.itemId === selectedItemId && nativePublishAccess.canPublish);
  const canOpenComments = Boolean(selected && selectedItemId && sharingWorkspaceId && (access || commentsOpen));
  const commentCapabilities = vaultCommentCapabilities(access, selectedItemId ?? "", selected?.path ?? "");
  const galleryCommentsAccess = sharingWorkspaceId
    ? (itemId: string, path: string) => vaultCommentCapabilities(access, itemId, path)
    : undefined;
  const listingRequest = useRef(0);
  const refresh = useCallback(() => {
    const request = ++listingRequest.current;
    return vaultRequest<VaultListing>("list")
      .then(async value => {
        if (request !== listingRequest.current) return;
        const previous = listingRef.current;
        const opened = selectedRef.current;
        let relocated: VaultItem | null = null;
        if (opened && previous?.root === value.root) {
          // Otherwise the open file sits at a path the listing no longer has,
          // flips read-only and unmounts the editor until the manifest catches up.
          relocated = await locateVaultItemOrResolve(selectedIdentity(opened), opened.path, value, itemId => vaultRequest("resolveItemId", { itemId }));
          if (request !== listingRequest.current) return;
          if (selectedRef.current !== opened) relocated = null;
        }
        setDestinationFolder(folder => reconcileFolderLocation(folder, previous, value));
        setCreatedItem(created => created && (created.root !== value.root || value.items.some(item => item.itemId === created.itemId || item.path === created.path)) ? null : created);
        if (opened && relocated && relocated.path !== opened.path) {
          const next = { ...opened, path: relocated.path };
          selectedRef.current = next; setSelectedState(next);
          setLiveTitle(title => title?.path === opened.path ? { ...title, path: next.path } : title);
        }
        setListing(value);
        setListingError("");
      })
      .catch((error: Error) => { if (request === listingRequest.current) setListingError(error.message); });
  }, []);
  useEffect(() => { refresh(); window.addEventListener("texttext:vault-changed", refresh); return () => window.removeEventListener("texttext:vault-changed", refresh); }, [refresh]);
  useEffect(() => {
    setAccessError("");
    if (!accessScope) return;
    return watchWorkspaceAccess({ events: window,
      read: signal => vaultRequest("workspaceAccess", {}, signal),
      changed: value => { setWorkspaceAccess(value ? { scope: accessScope, value } : null); if (value) setAccessError(""); },
      failed: reason => setAccessError(reason instanceof Error ? reason.message : "Workspace permissions could not be loaded."),
    });
  }, [accessScope]);
  useEffect(() => {
    if (!allowFolderPicker || !listing?.root) return;
    const root = listing.root;
    let active = true;
    const accept = (value: { connected?: unknown; workspaceId?: unknown; webURL?: unknown; accountId?: unknown } | null | undefined) => {
      const workspaceId = value?.workspaceId;
      if (!active) return;
      const next = value?.connected === true && typeof workspaceId === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(workspaceId)
        ? { root, workspaceId, webURL: typeof value?.webURL === "string" ? value.webURL : undefined,
          accountId: typeof value?.accountId === "string" ? value.accountId : undefined } : null;
      setNativeConnection(previous => previous?.root === next?.root && previous?.workspaceId === next?.workspaceId &&
        previous?.webURL === next?.webURL && previous?.accountId === next?.accountId ? previous : next);
    };
    let statusGeneration = 0;
    const status = () => {
      const generation = ++statusGeneration;
      void vaultRequest<{ connected?: boolean; workspaceId?: string; webURL?: string; accountId?: string }>("connection")
        .then(value => { if (generation === statusGeneration) accept(value); })
        .catch(() => { if (generation === statusGeneration) accept(null); });
    };
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
    const target = sharedVaultLinkTarget(window.location.search, window.location.hash, listing.items, folders);
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
    setImportedGalleryPath(null);
    setSelected(null); setFileAction(null); setCommentsOpen(false); setPublishing(null); currentFileRef.current = null; localFileModeRef.current = false;
    flushRef.current = async () => true; publishFlushRef.current = async () => false; saveStoryDetailsRef.current = async () => false;
    durabilityResultRef.current = async () => null;
  }, [setSelected]);
  const operate = async (action: () => Promise<void>, navigation = false) => {
    if (busy) return;
    setBusy(true); setError("");
    try { if (await flushRef.current(navigation)) { await action(); setFileAction(null); } }
    catch (error) { setError(error instanceof Error ? error.message : "The file operation failed."); }
    finally { setBusy(false); }
  };
  const createNote = (origin: HTMLElement | null, firstText = "") => operate(async () => {
    const folder = destinationFolder.trim() || "Notes";
    const chosen = await loadFolderItemDefault(folder, listing);
    let created: VaultFile;
    if (chosen) {
      const document = emptyDocumentSnapshot({ id: chosen.template.id, version: chosen.template.version });
      document.content = { ...document.content, ...folderStarter(chosen.template, firstText ? { title: firstText } : {}) };
      created = await vaultRequest<VaultFile>("importPack", { title: document.content.title || "Untitled", folder, data: encodeBase64(newItemPack(document, { template: chosen.template, sourceJSON: chosen.authoringSource ? JSON.stringify(chosen.authoringSource) : null })) });
    } else if (folder === "Blog") {
      const template = BUILTIN_TEMPLATES.find(item => item.id === "texttext.article")!;
      const document = emptyDocumentSnapshot({ id: template.id, version: template.version });
      document.content.title = firstText;
      created = await vaultRequest<VaultFile>("importPack", { title: firstText || "Untitled", folder, data: encodeBase64(newItemPack(document, { template })) });
    } else created = await vaultRequest<VaultFile>("create", { title: firstText, folder });
    setNewNoteFocus({ file: created, root: listing?.root ?? "", itemId: packIdentity(created.markdown), origin,
      focusPending: true, focusTitle: true, awaitSharedMode: allowFolderPicker });
    rememberCreated(created, listing?.root);
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
        let imported: VaultFile | null = null;
        const folder = destinationFolder.trim() || "Gallery";
        try {
          for (const file of files) {
            setImportStatus(`Importing image ${completed + 1} of ${files.length}…`);
            if (file.size > MAX_IMAGE_BYTES) throw new Error(`${file.name}: choose an image no larger than 20 MiB.`);
            const pack = await prepareImagePack(new Uint8Array(await file.arrayBuffer()), file.name);
            imported = await vaultRequest<VaultFile>("importPack", { title: pack.title, data: encodeBase64(pack.bytes), folder });
            completed++;
            if (pendingCreationLook?.kind === "gallery" && folder === "Gallery") {
              const document = readDocument(imported);
              imported = await vaultRequest<VaultFile>("write", writePayload(imported, { ...document, presentation: { ...document.presentation, template: { id: pendingCreationLook.template.id, version: pendingCreationLook.template.version } } }, { template: pendingCreationLook.template, sourceJSON: pendingCreationLook.sourceJSON }));
            }
          }
          closeRemoved();
          setImageCaptureOpen(false);
          if (completed === 1 && folder === "Gallery" && imported) {
            setImportedGalleryPath(imported.path);
            setDestinationFolder(folder);
            setImportStatus("");
          } else setImportStatus(`Imported ${completed} ${completed === 1 ? "image" : "images"}.`);
        } catch (error) {
          setImportStatus(completed ? `Imported ${completed} of ${files.length} images. Earlier imports are saved.` : "");
          throw error;
        } finally { setPendingCreationLook(null); refresh(); }
      });
    } finally { importing.current = false; }
  };
  const closeImageCapture = () => { setImageCaptureOpen(false); setPendingCreationLook(null); };
  const closeMoreActions = () => { moreActions.current?.removeAttribute("open"); };
  const openWorkspaceFolder = () => {
    closeMoreActions();
    void operate(async () => {
      const opened = await vaultRequest<VaultListing>("open");
      restoredLocationRoot.current = ""; setLocationReadyRoot("");
      listingRequest.current++;
      setListing(opened); setSelected(null); setCommentsOpen(false); setDestinationFolder(""); flushRef.current = async () => true; durabilityResultRef.current = async () => null; localFileModeRef.current = false;
    });
  };
  const openTemplateLibrary = () => { closeMoreActions(); void operate(async () => { setTemplateQuery(""); setTemplatePicker(true); }); };
  const createForFolder = (folder: string, templateName: string, initialTitle: string | undefined = undefined, builtinTemplate?: TemplateDefinition, initialBody: string | undefined = undefined, stayInList = false, onCreated?: () => void, initialTags: string[] = [], initialImages: File[] = [], initialColor = "default", initialIcon = "", initialParents: string[] = []) => operate(async () => {
    const chosen = builtinTemplate ? null : await loadFolderItemDefault(folder, listing);
    const sourcePath = `Templates/${templateName}.textpack`;
    const source = !builtinTemplate && !chosen && listing?.items.some(item => item.path === sourcePath) ? await vaultRequest<VaultFile>("read", { path: sourcePath }) : null;
    let imageEdit: Awaited<ReturnType<typeof prepareEditorImagePaste>> | null = null;
    if (initialImages.length) {
      const draft = emptyDocumentSnapshot({ id: "texttext.note", version: 1 });
      draft.content.body = initialBody ?? "";
      imageEdit = await prepareEditorImagePaste({ document: draft, selection: { from: (initialBody ?? "").length, to: (initialBody ?? "").length }, files: initialImages, occupiedFilenames: source?.assets?.map(asset => asset.filename) });
    }
    const example = emptyDocumentSnapshot();
    const fallback = builtinTemplate ?? chosen?.template ?? (source?.templateJSON ? validateTemplateDefinition(JSON.parse(source.templateJSON)) : BUILTIN_TEMPLATES.find(template => template.id === (folder === "Blog" ? "texttext.article" : "texttext.note")));
    const starter = folderStarter(fallback, { title: initialTitle, body: initialBody, fields: { ...(initialColor === "default" ? {} : { texttextNoteColor: initialColor }), ...(noteIcon(initialIcon) ? { texttextNoteIcon: noteIcon(initialIcon) } : {}) } });
    const blank: DocumentSnapshot = { ...example, content: { ...example.content, title: starter.title, subtitle: "", body: imageEdit?.document.content.body ?? starter.body, fields: { ...starter.fields, ...(initialParents.length ? { parents: [...new Set(initialParents)] } : {}) }, tags: initialTags, assets: imageEdit?.document.content.assets ?? [] },
      presentation: fallback ? { ...example.presentation, template: { id: fallback.id, version: fallback.version } } : example.presentation };
    if (!fallback) throw new Error("Choose an available template.");
    const created = await vaultRequest<VaultFile>("importPack", { title: blank.content.title || "Untitled", folder, data: encodeBase64(newItemPack(blank, { template: fallback, sourceJSON: chosen?.authoringSource ? JSON.stringify(chosen.authoringSource) : source?.templateAuthoringSourceJSON ?? null }, imageEdit?.addedAssets.map(asset => ({ ...asset, data: Uint8Array.from(atob(asset.data), character => character.charCodeAt(0)) })))) });
    if (stayInList) onCreated?.();
    else {
      setNewNoteFocus({ file: created, root: listing?.root ?? "", itemId: packIdentity(created.markdown), origin: focusedControl(), focusPending: true, focusTitle: folder === "Blog" || folder === "Notes" && !initialBody, awaitSharedMode: allowFolderPicker });
      rememberCreated(created, listing?.root);
      setSelected(created); setDestinationFolder(folder);
    }
    refresh();
  });
  const currentFolder = destinationFolder.trim();
  const primaryLabel = currentFolder === "Bookmarks" ? "Save bookmark" : currentFolder === "Gallery" ? "Add images" : currentFolder === "Feeds" ? "Add source" : currentFolder === "Blog" ? "Write a story" : "New note";
  const focusBookmarkSave = () => {
    const input = document.querySelector<HTMLInputElement>('.vault-bookmark-quick-save input[aria-label="Web address to save"]');
    if (input) { input.focus(); return true; }
    const addLink = document.querySelector<HTMLButtonElement>(".vault-bookmark-add-link");
    if (addLink) { addLink.click(); return true; }
    return false;
  };
  const primaryAction = () => {
    if (currentFolder === "Bookmarks") { if (!focusBookmarkSave()) openCapture(); return; }
    if (currentFolder === "Gallery") { setImageCaptureOpen(true); return; }
    if (currentFolder === "Feeds") { openFeedSubscribe(focusedControl()); return; }
    if (currentFolder === "Blog") { void createForFolder("Blog", "Blog post"); return; }
    if (currentFolder === "Notes") { void createForFolder("Notes", "Note"); return; }
    createNote(focusedControl());
  };
  const openCapture = (mode?: "bookmark" | "mixed") => { closeMoreActions(); void operate(async () => setCaptureMode(mode || (destinationFolder.trim() === "Bookmarks" ? "bookmark" : "mixed"))); };
  const quickSaveBookmark = async (address: string) => {
    if (!await flushRef.current()) throw new Error("Save or resolve the current document before capturing another item.");
    const input = captureInput(address, "");
    if (!input.sourceURL) throw new Error("Enter a web address to save it in Bookmarks.");
    const created = await vaultRequest<VaultFile>("create", { ...input, folder: "Bookmarks" });
    if (listing?.root) queueArticleEnrichment(listing.root, created.path);
    setPreferredBookmarkPath(created.path);
    setDestinationFolder("Bookmarks");
    setSelected(null);
    await refresh();
  };
  const saveDroppedBookmark = (address: string) => {
    void quickSaveBookmark(address).catch(reason => setError(reason instanceof Error ? reason.message : "Could not save this link."));
  };
  const openFeedSubscribe = (returnFocus: HTMLElement | null) => {
    feedSubscribeReturnFocus.current = returnFocus;
    closeMoreActions();
    void operate(async () => setFeedSubscribeOpen(true));
  };
  const importFile = () => {
    closeMoreActions();
    void operate(async () => {
      const result = await vaultRequest<{ file?: VaultFile }>("import", { folder: destinationFolder.trim() });
      if (result.file) { setSelected(result.file); refresh(); }
    });
  };
  const openRecovery = (path?: string) => { closeMoreActions(); setRecovery({ path, scope: recoveryScope }); };
  const openFolderDesign = () => { closeMoreActions(); setFolderDesignOpen(true); };
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
  const [folderAssistantTarget, setFolderAssistantTarget] = useState<{ path: string; folder: string; root: string; requestId: number; taskId: string } | null>(null);
  const beginCustomize = useCallback((path: string) => {
    setAssistantTargetPath(null);
    const requestId = ++assistantRequestId.current, taskId = crypto.randomUUID();
    setFolderAssistantTarget(selected ? null : { path, folder: destinationFolder, root: listing?.root ?? "", requestId, taskId });
    assistantReturnFocus.current = focusedControl();
    if (window.matchMedia("(max-width: 700px)").matches) setSidebarVisible(false);
    setAssistantRequest({ type: "customize", requestId, taskId, root: listing?.root ?? "", path });
    setAssistantOpen(true);
  }, [setSidebarVisible, selected, destinationFolder, listing?.root]);
  const folderTargetMatches = !!folderAssistantTarget && !selected && folderAssistantTarget.folder === destinationFolder && folderAssistantTarget.root === listing?.root && folderAssistantTarget.requestId === assistantRequest?.requestId && assistantRequest.type === "customize" && folderAssistantTarget.taskId === assistantRequest.taskId;
  useEffect(() => {
    if (!folderAssistantTarget || folderTargetMatches) return;
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      setFolderAssistantTarget(null);
      setAssistantRequest(current => current?.requestId === folderAssistantTarget.requestId ? null : current);
    });
    return () => { active = false; };
  }, [folderAssistantTarget, folderTargetMatches]);
  const closeAssistant = useCallback(() => {
    setAssistantOpen(false);
    setFolderAssistantTarget(null);
    setAssistantRequest(null);
    setAssistantTargetPath(null);
    restoreDialogFocus(assistantReturnFocus.current, searchButton.current);
    assistantReturnFocus.current = null;
  }, []);
  const activeWorkspaceRoot = listing?.root ?? "";
  useEffect(() => { setMovingFolder(null); }, [activeWorkspaceRoot, destinationFolder, selected?.path]);
  const activeItemPath = selected?.path ?? "";
  const beginAddAgent = useCallback(() => {
    if (!activeWorkspaceRoot || !activeItemPath) return;
    setAssistantTargetPath(null);
    assistantReturnFocus.current = focusedControl();
    if (window.matchMedia("(max-width: 700px)").matches) setSidebarVisible(false);
    setAssistantRequest({ type: "agent", requestId: ++assistantRequestId.current, root: activeWorkspaceRoot, target: activeItemPath });
    setAssistantOpen(true);
  }, [activeItemPath, activeWorkspaceRoot, setSidebarVisible]);
  const beginFolderAgent = useCallback(() => {
    const folder = destinationFolder.trim();
    if ((!allowFolderPicker && !webAssistant) || !activeWorkspaceRoot || selected || !canCreate || (folder && !folders.includes(folder))) return;
    setFolderAssistantTarget(null);
    setAssistantTargetPath(null);
    assistantReturnFocus.current = focusedControl();
    if (window.matchMedia("(max-width: 700px)").matches) setSidebarVisible(false);
    setAssistantRequest({ type: "agent", scope: "folder", requestId: ++assistantRequestId.current, root: activeWorkspaceRoot, target: folder });
    setAssistantOpen(true);
  }, [allowFolderPicker, webAssistant, activeWorkspaceRoot, selected, canCreate, folders, destinationFolder, setSidebarVisible]);
  const askItemAgent = useCallback((path: string, question: string, imageAssetId?: string) => {
    if (!activeWorkspaceRoot || !listing?.items.some(item => item.path === path)) return;
    assistantReturnFocus.current = focusedControl();
    if (window.matchMedia("(max-width: 700px)").matches) setSidebarVisible(false);
    setAssistantTargetPath(path);
    setAssistantRequest({ type: "agent", requestId: ++assistantRequestId.current, root: activeWorkspaceRoot, target: path,
      suggestedPrompt: question, ...(imageAssetId ? { imageAssetId } : {}) });
    setAssistantOpen(true);
  }, [activeWorkspaceRoot, listing?.items, setSidebarVisible]);
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
  const shareCurrent = () => {
    if (!canShare || !sharingWorkspaceId) return;
    if (selected) setSharing({ workspaceId: sharingWorkspaceId, scopeType: "item", scopeKey: packIdentity(selected.markdown), label: selected.path.split("/").at(-1)?.replace(/\.textpack$/i, "") || "file" });
    else if (destinationFolder.trim()) setSharing({ workspaceId: sharingWorkspaceId, scopeType: "folder", scopeKey: destinationFolder.trim(), label: destinationFolder.trim().split("/").at(-1) || destinationFolder.trim() });
  };
  useEffect(() => {
    const openFile = (event: Event) => {
      const path = (event as CustomEvent<{ path: string }>).detail?.path;
      if (path) {
        // A Finder request made during startup takes precedence over restoring
        // the previous location, including a restore read already in flight.
        nativeOpenRequested.current = true;
        navigationGeneration.current++;
        setPendingNativeOpen(path);
      }
    };
    const newFile = () => { if (canCreate) createNote(focusedControl()); };
    const nativeWindow = window as Window & { texttextOpenFile?: (path: string) => Promise<string> };
    nativeWindow.texttextOpenFile = async path => {
      if (busy) return "busy";
      nativeOpenRequested.current = true;
      navigationGeneration.current++;
      let opened = false;
      await operate(async () => { setSelected(await readForOpen(path, !allowFolderPicker)); setDestinationFolder(folderForItem(path)); opened = true; }, true);
      nativeOpenRequested.current = false;
      return opened ? "opened" : "blocked";
    };
    window.addEventListener("texttext:vault-open", openFile);
    window.addEventListener("texttext:vault-new", newFile);
    return () => { delete nativeWindow.texttextOpenFile; window.removeEventListener("texttext:vault-open", openFile); window.removeEventListener("texttext:vault-new", newFile); };
  });
  useEffect(() => {
    if (!pendingNativeOpen || busy) return;
    const path = pendingNativeOpen;
    setPendingNativeOpen(null);
    void operate(async () => { setSelected(await readForOpen(path, !allowFolderPicker)); setDestinationFolder(folderForItem(path)); }, true)
      .finally(() => { nativeOpenRequested.current = false; });
  // The native file request remains queued while an earlier navigation finishes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingNativeOpen, busy]);
  const commandActions: VaultSearchAction[] = [];
  const commandFolder = destinationFolder.trim();
  const commandLocation = commandFolder || "the workspace root";
  if (canCreate) {
    commandActions.push({ id: "new-note", label: "New note", description: "Write a card in Notes.", shortcut: "N" });
    commandActions.push({ id: "write-story", label: "Write a story", description: "Start a draft in Blog.", shortcut: "C", keywords: ["medium"], aliases: ["New blog post", "Write article"] });
    commandActions.push({ id: "save-bookmark", label: "Save bookmark", description: "Capture a link in Bookmarks.", shortcut: "B", keywords: ["shiori"], aliases: ["Read later", "Save link"] });
    commandActions.push({ id: "capture", label: "Capture", description: "Save a link or note.", shortcut: "L", keywords: ["save", "link"] });
    commandActions.push(
      { id: "new-from-template", label: "New from template", description: `Create from a saved template in ${commandLocation}.`, shortcut: "T", keywords: ["starter", "look"] },
      { id: "import-images", label: "Add images", description: "Collect images in Gallery.", shortcut: "I", keywords: ["visual", "gallery", "photo", "gif"] },
    );
  }
  if (canSubscribeFeed) commandActions.push({ id: "subscribe-feed", label: "Add source", description: "Follow a site in Feeds.", shortcut: "F", keywords: ["rss", "atom", "news", "feed"] });
  if (allowFolderPicker && listing?.root) commandActions.push({ id: "import-file", label: "Import file", description: `Add a file to ${commandLocation}.`, shortcut: "P", keywords: ["textpack", "document"] });
  if (!selected && canCreate) commandActions.push({ id: "folder-design", label: "Choose folder design", description: `Change how ${commandLocation} is presented.`, shortcut: "V", keywords: ["view", "layout", "gallery", "table"] });
  if ((allowFolderPicker || webAssistant) && listing?.root && (selected ? canEditSelected : canCreate)) commandActions.push({
    id: "customize",
    label: selected ? "Customize this item" : "Customize this folder",
    description: selected ? "Change how the open item looks." : `Change how ${commandLocation} looks.`,
    shortcut: "U",
    keywords: ["design", "look", "template"],
  });
  if ((allowFolderPicker || webAssistant) && selected?.path) commandActions.push({
    id: "add-agent",
    label: "Add agent to this item",
    description: webAssistant ? "Ask about this item or review a proposed change." : "Give Codex a task for the open item.",
    shortcut: "A",
    keywords: ["assistant", "collaborate", "edit"],
  });
  const contextualActions: VaultSearchAction[] = [];
  if (selected && !selectedFeed.subscription && canEditSelected) contextualActions.push({ id: "edit-current", label: "Edit this item", description: "Open the editor for this item.", shortcut: "E", keywords: ["write", "change"] });
  if (canShare && sharingWorkspaceId && (selected || commandFolder)) contextualActions.push({ id: "share-current", label: selected ? "Share this item" : "Share this folder", description: "Manage access to the current location.", keywords: ["collaborate", "invite", "permissions"] });
  if (canOpenComments) contextualActions.push({ id: "show-comments", label: "Show comments", description: "Discuss the open item.", keywords: ["discussion", "replies"] });
  if (selected && canPublish) contextualActions.push({ id: "publish-current", label: "Publish this item", description: "Review public access before publishing.", keywords: ["public", "website"] });
  if (selected && canOpenRecovery) contextualActions.push({ id: "version-history", label: "Version history", description: "Inspect saved versions of this item.", aliases: ["Restore version"], keywords: ["restore", "revisions"] });
  if (selected && canManageFiles) contextualActions.push(
    { id: "rename-current", label: "Rename or move this item", description: "Change the file path of the open item.", aliases: ["Move this item"], keywords: ["file", "folder", "path"] },
    { id: "delete-current", label: "Delete this item", description: "Move the open item to Trash after confirmation.", aliases: ["Trash this item"], keywords: ["remove", "file"] },
  );
  if (selected) commandActions.unshift(...contextualActions);
  else {
    const primaryByFolder: Record<string, string> = {
      Notes: "new-note", Blog: "write-story", Bookmarks: "save-bookmark",
      Gallery: "import-images", Feeds: "subscribe-feed",
    };
    const primaryIndex = commandActions.findIndex(action => action.id === primaryByFolder[commandFolder]);
    if (primaryIndex > 0) commandActions.unshift(...commandActions.splice(primaryIndex, 1));
    commandActions.splice(1, 0, ...contextualActions);
  }
  if (selected || commandFolder) commandActions.push({ id: "go-home", label: "Go home", description: "Show all files in this workspace.", shortcut: "H", aliases: ["All files"], keywords: ["workspace", "home"] });
  if (canOpenRecovery) commandActions.push({ id: "trash-recovery", label: "Trash and recovery", description: "Recover deleted items or inspect saved versions.", shortcut: "R", keywords: ["restore", "history", "deleted"] });
  if (allowFolderPicker && listing?.root) commandActions.push({ id: "open-folder", label: "Open another folder", description: "Choose a different workspace folder on this device.", shortcut: "O", keywords: ["workspace", "switch"] });
  for (const folder of folders) commandActions.push({
    id: `go-to-folder:${folder}`, label: `Go to ${folder}`,
    description: "Open this workspace folder.", keywords: ["navigate", "folder", folder],
  });
  const runCommandAction = (id: string) => {
    if (id === "go-home") return operate(async () => { closeRemoved(); setDestinationFolder(""); setFolderDesignOpen(false); }, true);
    if (id === "edit-current") { window.dispatchEvent(new Event("texttext:vault-edit-item")); return; }
    if (id.startsWith("go-to-folder:")) return operate(async () => {
      closeRemoved(); setDestinationFolder(id.slice("go-to-folder:".length)); setFolderDesignOpen(false);
    }, true);
    if (id === "new-note") return createForFolder("Notes", "Note");
    if (id === "write-story") return createForFolder("Blog", "Blog post");
    if (id === "save-bookmark") { if (currentFolder !== "Bookmarks" || !focusBookmarkSave()) openCapture("bookmark"); return; }
    if (id === "capture") { openCapture("mixed"); return; }
    if (id === "new-from-template") { openTemplateLibrary(); return; }
    if (id === "subscribe-feed") { setDestinationFolder("Feeds"); openFeedSubscribe(searchButton.current); return; }
    if (id === "import-images") { setDestinationFolder("Gallery"); setImageCaptureOpen(true); return; }
    if (id === "import-file") { importFile(); return; }
    if (id === "folder-design") { openFolderDesign(); return; }
    if (id === "customize") return customizeCurrent();
    if (id === "add-agent") { beginAddAgent(); return; }
    if (id === "share-current") { shareCurrent(); return; }
    if (id === "show-comments") { setCommentsOpen(true); return; }
    if (id === "publish-current") { openPublish(); return; }
    if (id === "version-history" && selected) { openRecovery(selected.path); return; }
    if (id === "rename-current" && selected) { setNewPath(selected.path); setFileAction("rename"); return; }
    if (id === "delete-current" && selected) { setFileAction("delete"); return; }
    if (id === "trash-recovery") { openRecovery(); return; }
    if (id === "open-folder") { openWorkspaceFolder(); return; }
  };
  useEffect(() => {
    if (destinationFolder.trim() !== "Notes" || selected) noteDraftActive.current = false;
  }, [destinationFolder, selected]);
  useEffect(() => {
    const startDraft = () => { noteDraftActive.current = true; };
    const endDraft = () => { noteDraftActive.current = false; };
    window.addEventListener("texttext:note-draft-started", startDraft);
    window.addEventListener("texttext:note-draft-ended", endDraft);
    return () => { window.removeEventListener("texttext:note-draft-started", startDraft); window.removeEventListener("texttext:note-draft-ended", endDraft); };
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (inputDisabled) return;
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      const dialogOpen = Boolean(document.querySelector('[role="dialog"][aria-modal="true"], dialog[open]'));
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        if (searchOpen) { event.preventDefault(); closeSearch(); return; }
        if (!dialogOpen) { event.preventDefault(); openSearch(); }
        return;
      }
      if (dialogOpen || event.metaKey || event.ctrlKey || event.altKey || busy) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable], [role="textbox"]')) return;
      if (!selected && destinationFolder.trim() === "Notes" && noteDraftActive.current && event.key === "Backspace") {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent("texttext:note-type", { detail: "\b" }));
        return;
      }
      if (!selected && destinationFolder.trim() === "Notes" && canCreate && event.key.length === 1 && (noteDraftActive.current || /\S/u.test(event.key) && event.key !== "/" && event.key.toLowerCase() !== "n")) {
        event.preventDefault();
        noteDraftActive.current = true;
        window.dispatchEvent(new CustomEvent("texttext:note-type", { detail: event.key }));
        return;
      }
      if (event.shiftKey) return;
      if (event.key === "/") {
        event.preventDefault();
        const bookmarkSearch = !selected && destinationFolder.trim() === "Bookmarks" ? document.querySelector<HTMLInputElement>('.vault-bookmark-toolbar input[type="search"]:not(:disabled)') : null;
        if (bookmarkSearch) bookmarkSearch.focus(); else openSearch();
        return;
      }
      const action = commandActions.find(item => item.shortcut?.toLowerCase() === event.key.toLowerCase());
      if (action) { event.preventDefault(); void runCommandAction(action.id); }
    };
    window.addEventListener("keydown", key);
    window.addEventListener("texttext:vault-search", openSearch);
    return () => { window.removeEventListener("keydown", key); window.removeEventListener("texttext:vault-search", openSearch); };
  });
  const selectedStory = (() => {
    if (!selected || folderForItem(selected.path) !== "Blog") return false;
    try { return templateExperience(readTemplate(selected, readDocument(selected))) === "article"; }
    catch { return false; }
  })();
  const selectedNote = (() => {
    if (!selected || folderForItem(selected.path) !== "Notes") return false;
    try { return templateExperience(readTemplate(selected, readDocument(selected))) === "note"; }
    catch { return false; }
  })();
  const contextTitle = selected
    ? (liveTitle?.path === selected.path ? liveTitle.title.trim() || (selectedStory ? "New story" : "Untitled") : (() => {
        try { return readDocument(selected).content.title.trim() || (selectedStory ? "New story" : "Untitled"); }
        catch { return selected.path.split("/").at(-1)?.replace(/\.textpack$/i, "") || "Untitled"; }
      })())
    : destinationFolder.trim() || (access && !access.fullAccess ? "Shared files" : "All files");
  const contextParent = selected
    ? folderForItem(selected.path) || "All files"
    : listing?.name || listing?.root.split("/").filter(Boolean).at(-1) || "TextText";
  function openPublish() {
    if (!selected || !sharingWorkspaceId || !selectedItemId || !canPublish) return;
    let label = selected.path.split("/").at(-1)?.replace(/\.textpack$/i, "") || "file";
    try { label = readDocument(selected).content.title || label; } catch { /* The file label remains usable. */ }
    setPublishing({ workspaceId: sharingWorkspaceId, itemId: selectedItemId, label });
  }
  return <div inert={inputDisabled} className={`vault-app${assistantOpen ? " has-assistant" : ""}${commentsOpen && canOpenComments ? " has-comments" : ""}${selectedStory ? " has-story" : ""}${sidebarOpen ? "" : " sidebar-collapsed"}${sidebarReady ? " sidebar-ready" : ""}`}
    onDragOver={(event) => { if (!selected && (event.dataTransfer.types.includes("Files") || currentFolder === "Bookmarks" && event.dataTransfer.types.includes("text/uri-list"))) event.preventDefault(); }}
    onDrop={(event) => { if (selected) return; if (event.dataTransfer.files.length) { event.preventDefault(); if (canCreate) void importImages(Array.from(event.dataTransfer.files)); } else if (currentFolder === "Bookmarks" && event.dataTransfer.types.includes("text/uri-list")) { event.preventDefault(); if (canCreate) saveDroppedBookmark(event.dataTransfer.getData("text/uri-list").split("\n").find(line => line.trim() && !line.startsWith("#")) || ""); } }}
    onPaste={(event) => {
      const target = event.target as HTMLElement;
      if (selected && !imageCaptureOpen || target.closest("input,textarea,[contenteditable=true]")) return;
      const files = Array.from(event.clipboardData.files);
      if (files.length) { event.preventDefault(); if (canCreate) void importImages(files); }
    }}>
    <DocumentEngineStyles />
    <aside id="vault-sidebar" className="vault-sidebar" aria-hidden={!sidebarOpen}
      onClickCapture={(event) => {
        if (window.matchMedia("(max-width: 700px)").matches &&
            !(event.target as HTMLElement).closest(".vault-connection") &&
            (event.target as HTMLElement).closest("button,a,summary")) setSidebarVisible(false);
      }}>
      <div className="vault-sidebar-header"><h1><button type="button" className="vault-home-button" onClick={() => void operate(async () => { closeRemoved(); setDestinationFolder(""); setFolderDesignOpen(false); }, true)}>TextText</button></h1>
        <button type="button" aria-label="Hide folders" aria-controls="vault-sidebar" aria-expanded={sidebarOpen}
          onClick={() => setSidebarVisible(false, true)}>Hide</button></div>
      {!allowFolderPicker && <nav className="vault-other-workspaces" aria-label="Shared workspaces"><a href="/shared">Shared with me</a></nav>}
      {allowFolderPicker && !listing?.root && <button disabled={busy} onClick={openWorkspaceFolder}>Open folder</button>}
      {listing?.root && <>
        <p className="vault-root" title={listing.root}>{listing.name || listing.root.split("/").filter(Boolean).at(-1)}</p>
        <button ref={searchButton} className="vault-search-trigger" disabled={busy} onClick={openSearch}><span>Search and actions</span><kbd>{shortcut("⌘K")}</kbd></button>
        <nav aria-label="Folders"><FolderNavigation tree={tree} selectedFolder={selected ? folderForItem(selected.path) : destinationFolder.trim()}
          onFolder={(path) => void operate(async () => { closeRemoved(); setDestinationFolder(path); setFolderDesignOpen(false); }, true)} /></nav>
      </>}
      {allowFolderPicker && listing?.root ? <NativeConnection key={listing.root} root={listing.root} /> : accountMenu}
    </aside>
    {sidebarOpen && <button type="button" className="vault-sidebar-backdrop" aria-label="Close folders"
      onClick={() => setSidebarVisible(false, true)} />}
    <main>
      {listing?.root && <header className="vault-context-header">
        <div className="vault-context-location">
          {selectedStory && <button type="button" className="vault-story-back" aria-label="Back to Blog" onClick={() => void operate(async () => { closeRemoved(); setDestinationFolder("Blog"); setFolderDesignOpen(false); }, true)}>← Blog</button>}
          {selectedNote && <button type="button" className="vault-note-back" aria-label="Back to Notes" onClick={() => void operate(async () => { closeRemoved(); setDestinationFolder("Notes"); setFolderDesignOpen(false); }, true)}>← Notes</button>}
          {!sidebarOpen && <button ref={sidebarReopenButton} type="button" className="vault-sidebar-open"
            aria-controls="vault-sidebar" aria-expanded={false} onClick={() => setSidebarVisible(true)}>Show folders</button>}
          <div><p>{contextParent}</p><h2 title={selected?.path || destinationFolder.trim() || contextTitle}>{contextTitle}</h2></div>
        </div>
        <div className="vault-context-actions">
          {selectedStory ? <button className="vault-primary-action" disabled={busy || !canPublish} title={canPublish ? "Review public access for this story" : "Connect your workspace to publish this story"} onClick={openPublish}>Publish</button>
            : canCreate && <button className="vault-primary-action" disabled={busy} onClick={primaryAction}>{primaryLabel}</button>}
          {selected && <div className="vault-editor-actions workspace-action-bar-host">
            <div className="workspace-action-bar-slot is-right" />
          </div>}
          {selected && (allowFolderPicker || webAssistant) && <LocalParticipantsRow postId={selected.path} />}
          {selected && !selectedStory && canOpenComments && <button ref={commentsButton} type="button" aria-expanded={commentsOpen} aria-controls="vault-comments-panel"
            disabled={busy} onClick={() => setCommentsOpen(value => !value)}>Comments</button>}
          {canShare && sharingWorkspaceId && (selected || destinationFolder.trim()) && !selectedStory && <button disabled={busy} onClick={shareCurrent}>Share</button>}
          <details ref={moreActions} className="vault-context-menu" onKeyDown={(event) => {
            if (event.key !== "Escape" || !event.currentTarget.open) return;
            event.preventDefault(); event.stopPropagation(); event.currentTarget.open = false; moreActionsSummary.current?.focus();
          }}>
            <summary ref={moreActionsSummary} aria-label="More actions">More</summary>
            <div className="vault-context-menu-items">
              {selected ? <>
                {selectedStory && canOpenComments && <button disabled={busy} onClick={() => { closeMoreActions(); setCommentsOpen(value => !value); }}>{commentsOpen ? "Hide comments" : "Comments"}</button>}
                {selectedStory && canShare && sharingWorkspaceId && <button disabled={busy} onClick={() => { closeMoreActions(); shareCurrent(); }}>Share</button>}
                {canPublish && sharingWorkspaceId && selectedItemId && !selectedStory && <button disabled={busy} onClick={() => { closeMoreActions(); openPublish(); }}>Publish</button>}
                {selectedStory && canCreate && <button disabled={busy} onClick={() => { closeMoreActions(); void createForFolder("Blog", "Blog post"); }}>Write another story</button>}
                {canManageFiles && <button disabled={busy} onClick={() => { closeMoreActions(); setNewPath(selected.path); setFileAction("rename"); }}>Rename or move</button>}
                {canManageFiles && <button disabled={busy} onClick={() => { closeMoreActions(); setFileAction("delete"); }}>Delete</button>}
                {(allowFolderPicker || webAssistant) && <button disabled={busy} onClick={() => { closeMoreActions(); beginCustomize(selected.path); }}>Customize</button>}
                {canOpenRecovery && <button disabled={busy} onClick={() => openRecovery(selected.path)}>Version history</button>}
              </> : <>
                {canCreate && <button disabled={busy} onClick={() => openCapture()}>Capture a link or note</button>}
                {canCreate && <button disabled={busy} onClick={openTemplateLibrary}>New from template</button>}
                {canSubscribeFeed && <button ref={feedSubscribeButton} disabled={busy} onClick={() => openFeedSubscribe(moreActionsSummary.current)}>Subscribe to a feed</button>}
                {canCreate && <button disabled={busy} onClick={() => { closeMoreActions(); setDestinationFolder("Gallery"); setImageCaptureOpen(true); }}>Import images…</button>}
                {allowFolderPicker && <button disabled={busy} onClick={importFile}>Import file…</button>}
                {canCreate && <label className="vault-folder-destination">Current folder
                  <input list="vault-folders" aria-label="Current folder" value={destinationFolder} placeholder="Workspace root"
                    onChange={(event) => { setDestinationFolder(event.target.value); setFolderDesignOpen(false); }} />
                </label>}
                {canManageFiles && destinationFolder.trim() && <button disabled={busy} onClick={() => { closeMoreActions(); void operate(async () => setMovingFolder(destinationFolder.trim())); }}>Rename or move folder</button>}
                {canCreate && <button disabled={busy} onClick={openFolderDesign}>Choose folder design</button>}
                {(allowFolderPicker || webAssistant) && canCreate && <button disabled={busy} onClick={() => { closeMoreActions(); void operate(customizeCurrent); }}>Customize folder</button>}
                {(allowFolderPicker || webAssistant) && canCreate && <button disabled={busy} onClick={() => { closeMoreActions(); beginFolderAgent(); }}>Add agent</button>}
                {canOpenRecovery && <button disabled={busy} onClick={() => openRecovery()}>Trash and recovery</button>}
                {allowFolderPicker && <button disabled={busy} onClick={openWorkspaceFolder}>Open another folder…</button>}
              </>}
            </div>
          </details>
        </div>
      </header>}
      {!listing?.root && !sidebarOpen && <button ref={sidebarReopenButton} type="button" className="vault-sidebar-open"
        aria-controls="vault-sidebar" aria-expanded={false} onClick={() => setSidebarVisible(true)}>Show folders</button>}
      <datalist id="vault-folders">{folders.map((folder) => <option key={folder} value={folder} />)}</datalist>
      <input ref={imageInput} type="file" accept={IMAGE_ACCEPT} multiple hidden aria-label="Choose images" onChange={(event) => {
        const files = Array.from(event.target.files ?? []); event.target.value = ""; void importImages(files);
      }} />
      {imageCaptureOpen && <div className="vault-image-capture-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) closeImageCapture(); }}>
        <div className="vault-image-capture" role="dialog" aria-modal="true" aria-label="Add images" onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); closeImageCapture(); } }}
          onDragOver={event => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
          onDrop={event => { if (!event.dataTransfer.files.length) return; event.preventDefault(); event.stopPropagation(); void importImages(Array.from(event.dataTransfer.files)); }}>
          <header><div><h2>Add images</h2><p>Collect visual references in your Gallery.</p></div><button type="button" aria-label="Close image capture" onClick={closeImageCapture}>✕</button></header>
          <div className="vault-image-capture-target"><span aria-hidden="true">＋</span><strong>Drop images here</strong><p>Paste an image with {shortcut("⌘V")}, or choose files from your device.</p><button type="button" autoFocus disabled={busy} onClick={() => imageInput.current?.click()}>Choose images</button></div>
        </div>
      </div>}
      {importStatus && <p role="status">{importStatus}</p>}
      {selected && canManageFiles && fileAction === "rename" && <div className="vault-file-operation"><form onSubmit={(event) => { event.preventDefault(); void operate(async () => {
          const observed = currentFileRef.current?.();
          if (!observed || observed.path !== selected.path) throw new Error("Wait for this file to finish opening.");
          const renamed = await vaultRequest<VaultFile>("rename", { path: observed.path, hash: observed.hash, newPath: newPath.trim() });
          setSelected(renamed); setFileAction(null); refresh();
        }); }}>
          <label>File path<input aria-label="New file path" value={newPath} onChange={(event) => setNewPath(event.target.value)} /></label>
          <button disabled={busy || !newPath.trim()} type="submit">Save path</button>
          <button type="button" onClick={() => setFileAction(null)}>Cancel</button>
        </form></div>}
      {selected && canManageFiles && fileAction === "delete" && <div className="vault-file-operation" role="group" aria-label="Confirm file deletion">
          <p>Delete <strong>{selected.path}</strong>?</p>
          <button disabled={busy} onClick={() => void operate(async () => {
            const observed = currentFileRef.current?.();
            if (!observed || observed.path !== selected.path) throw new Error("Wait for this file to finish opening.");
            await vaultRequest("delete", { path: observed.path, hash: observed.hash });
            setSelected(null); setFileAction(null); setCommentsOpen(false); currentFileRef.current = null; flushRef.current = async () => true; durabilityResultRef.current = async () => null; localFileModeRef.current = false; refresh();
          })}>Delete file</button>
          <button onClick={() => setFileAction(null)}>Cancel</button>
        </div>}
      {commentsOpen && canOpenComments && selected && selectedItemId && <div id="vault-comments-panel"><VaultComments
        key={`${sharingWorkspaceId}:${selectedItemId}`} itemId={selectedItemId} path={selected.path}
        canComment={commentCapabilities.canComment} canResolve={commentCapabilities.canResolve}
        onClose={() => { setCommentsOpen(false); commentsButton.current?.focus(); }} /></div>}
      {recovery && recovery.scope === recoveryScope && <RecoveryDialog key={`recovery:${recoveryScope}:${recovery.path ?? "trash"}`} workspaceRoot={listing?.root ?? ""} path={recovery.path} onClose={() => setRecovery(null)} onRestoreDeleted={async (request) => {
        if (!await flushRef.current()) throw new Error("Save the current document before restoring an item.");
        const assertScope = () => { if (recovery.scope !== recoveryScopeRef.current) throw new Error("The workspace changed. Reopen recovery to continue."); };
        assertScope();
        const { itemId, operationId, basePath, baseRevision, relativePath } = request;
        const restored = await vaultRequest<{ status: string; relativePath: string; revision: string }>("trashRestore", { itemId, operationId, basePath, baseRevision, relativePath });
        assertScope();
        if (restored.status !== "restored") throw new Error("The original location is occupied. Refresh Trash before trying again.");
        await vaultRequest("trashReconcile", { itemId, operationId, basePath, baseRevision, relativePath: restored.relativePath, revision: restored.revision });
        assertScope();
        const file = await vaultRequest<VaultFile>("read", { path: restored.relativePath });
        assertScope();
        if (packIdentity(file.markdown) !== itemId) throw new Error("The restored item is still arriving. Try Restore item again.");
        closeRemoved(); setSelected(file); setDestinationFolder(folderForItem(file.path)); refresh();
      }} onRestore={async (file, folder) => {
        if (!await flushRef.current()) throw new Error("Save or resolve the current document before restoring a copy.");
        const assertScope = () => { if (recovery.scope !== recoveryScopeRef.current) throw new Error("The workspace changed. Reopen recovery to continue."); };
        assertScope();
        if (readFolderView(file)) {
          const definitions = await vaultRequest<{ files: VaultFile[] }>("folderViews", { folder });
          assertScope();
          if (definitions.files.length) throw new Error("That folder already has a design. Choose another folder for this recovered design copy.");
        }
        const title = `${readDocument(file).content.title || "Untitled"} (recovered)`;
        const restored = await vaultRequest<VaultFile>("importPack", { title, data: file.data, folder });
        assertScope();
        closeRemoved(); setSelected(restored); setDestinationFolder(folderForItem(restored.path)); refresh();
      }} />}
      {sharing && canShare && sharing.workspaceId === sharingWorkspaceId && <VaultShareDialog key={`${sharing.workspaceId}:${sharing.scopeType}:${sharing.scopeKey}`} scope={sharing} workspaceURL={allowFolderPicker
        ? nativeConnection?.root === listing?.root && nativeConnection?.workspaceId === sharing.workspaceId ? nativeConnection.webURL ?? null : null
        : window.location.href} onClose={() => setSharing(null)} />}
      {publishing && canPublish && selectedItemId === publishing.itemId && <VaultPublishDialog
        key={`${publishing.workspaceId}:${publishing.itemId}`} {...publishing}
        beforeChange={() => publishFlushRef.current()}
        readStoryFile={selectedStory ? async () => {
          const revision = await publishFlushRef.current();
          const current = currentFileRef.current?.();
          if (!revision || !current || packIdentity(current.markdown) !== publishing.itemId) throw new Error("Save or resolve this story before reviewing it for publication.");
          const saved = await vaultRequest<VaultFile>("read", { path: current.path });
          if (saved.hash !== revision || packIdentity(saved.markdown) !== publishing.itemId) throw new Error("The saved story changed. Close and reopen Publish to review it.");
          return saved;
        } : undefined}
        onSaveStoryDetails={selectedStory ? details => saveStoryDetailsRef.current(details) : undefined}
        onClose={() => setPublishing(null)} />}
      {movingFolder && <FolderMoveDialog source={movingFolder} native={allowFolderPicker} onClose={() => setMovingFolder(null)} />}
      {captureMode && <CaptureDialog bookmarkOnly={captureMode === "bookmark"} onClose={() => { setCaptureMode(null); setPendingCreationLook(null); }} onSave={async (input) => {
        if (!await flushRef.current()) throw new Error("Save or resolve the current document before capturing another item.");
        let created = await vaultRequest<VaultFile>("create", { ...input, folder: input.sourceURL ? "Bookmarks" : destinationFolder.trim() || "Notes" });
        if (input.sourceURL && pendingCreationLook?.kind === "bookmark") {
          const document = readDocument(created);
          created = await vaultRequest<VaultFile>("write", writePayload(created, { ...document, presentation: { ...document.presentation, template: { id: pendingCreationLook.template.id, version: pendingCreationLook.template.version } } }, { template: pendingCreationLook.template, sourceJSON: pendingCreationLook.sourceJSON }));
        }
        if (input.sourceURL && listing?.root) queueArticleEnrichment(listing.root, created.path);
        if (input.sourceURL) {
          setPreferredBookmarkPath(created.path);
          setDestinationFolder("Bookmarks");
          setSelected(null);
        } else setSelected(created);
        refresh();
      }} />}
      {feedSubscribeOpen && <FeedSubscribeDialog folder={destinationFolder.trim()} folders={folders} onClose={closeFeedSubscribe} onSaved={file => {
        closeRemoved(); setSelected(file); setDestinationFolder(folderForItem(file.path)); refresh();
      }} />}
      {searchOpen && <VaultSearch actions={commandActions} namesOnly={!allowFolderPicker} onClose={closeSearch} onAction={(action) => runCommandAction(action.id)} onOpen={async (path) => {
        if (!await flushRef.current(true)) throw new Error("Save or resolve the current document before opening another file.");
        setSelected(await readForOpen(path, !allowFolderPicker)); setDestinationFolder(folderForItem(path));
      }} />}
      {templatePicker && <LocalTemplateLibrary initialQuery={templateQuery} onClose={() => setTemplatePicker(false)} onApply={() => {}} onCreateFeed={canSubscribeFeed ? () => {
        setTemplatePicker(false); setDestinationFolder("Feeds"); openFeedSubscribe(searchButton.current);
      } : undefined} onCreateFromBuiltIn={(template) => {
        setTemplatePicker(false);
        setPendingCreationLook(null);
        if (template.id === "texttext.bookmark") { setDestinationFolder("Bookmarks"); setCaptureMode("bookmark"); return; }
        if (template.id === "texttext.gallery") { setDestinationFolder("Gallery"); setImageCaptureOpen(true); return; }
        const destination = template.id === "texttext.article" ? ["Blog", "Blog post"] : template.id === "texttext.talk" ? ["Presentations", "Talk"] : ["Notes", "Note"];
        void createForFolder(destination[0], destination[1], undefined, template);
      }} onCreateFromFile={(path) => void operate(async () => {
        const source = await vaultRequest<VaultFile>("read", { path });
        const sourceDocument = readDocument(source);
        const selectedTemplate = source.templateJSON ? validateTemplateDefinition(JSON.parse(source.templateJSON)) : readTemplate(source, sourceDocument);
        const experience = templateExperience(selectedTemplate);
        if (experience === "bookmark") { setPendingCreationLook({ kind: "bookmark", template: selectedTemplate, sourceJSON: source.templateAuthoringSourceJSON }); setDestinationFolder("Bookmarks"); setTemplatePicker(false); setCaptureMode("bookmark"); return; }
        if (experience === "gallery") { setPendingCreationLook({ kind: "gallery", template: selectedTemplate, sourceJSON: source.templateAuthoringSourceJSON }); setDestinationFolder("Gallery"); setTemplatePicker(false); setImageCaptureOpen(true); return; }
        const folder = experience === "article" ? "Blog" : experience === "note" ? "Notes" : selectedTemplate.id === "texttext.talk" ? "Presentations" : destinationFolder.trim() || "Notes";
        const cloned = await vaultRequest<VaultFile>("create", { title: "Untitled", folder, sourcePath: path, sourceHash: source.hash });
        const example = readDocument(cloned);
        const starter = templateStarterDocument(example, selectedTemplate);
        const created = await vaultRequest<VaultFile>("write", writePayload(cloned, starter, { template: selectedTemplate, sourceJSON: source.templateAuthoringSourceJSON }));
        setNewNoteFocus({ file: created, root: listing?.root ?? "", itemId: packIdentity(created.markdown), origin: focusedControl(), focusPending: true, focusTitle: experience === "article" || experience === "note", awaitSharedMode: allowFolderPicker });
        rememberCreated(created, listing?.root);
        setSelected(created); setDestinationFolder(folder); setTemplatePicker(false); refresh();
      })} />}
      {error && <div className="vault-notice" role="alert">{error}</div>}
      {listingError && <div className="vault-notice" role="alert">{listingError}</div>}
      {accessError && <div className="vault-notice" role="alert">{accessError}</div>}
      {listing && <ArticleEnrichmentWorker listing={listing} enabled={canManageFiles} skipPath={selected?.path} onChanged={refresh} />}
      {selected && listing ? <DocumentBoundary key={`${listing.root}:${selectedItemId ?? selected.path}`} revision={selected.hash}
        reload={async signal => {
          const opened = selectedRef.current;
          if (!opened || listingRef.current?.root !== listing.root) return;
          const latest = await vaultRequest<VaultFile>("read", { path: opened.path });
          if (signal.aborted || selectedRef.current !== opened || listingRef.current?.root !== listing.root) return;
          if (latest.hash !== opened.hash) setSelected(latest);
        }}>
        {selectedFeed.error ? <div className="vault-notice" role="alert">{selectedFeed.error}</div> : selectedFeed.subscription
          ? <FeedSubscriptionReader key={`${listing.root}:${selected.path}:${selected.hash}:${canReadFeeds}`} subscription={selectedFeed.subscription}
              folder={feedFolder} canRead={canReadFeeds} canKeep={canKeepFeed} onKept={() => refresh()} />
          : <div inert={busy}><OpenVaultEditor documentReferences={documentReferences} onOpenReference={itemId => void operate(async () => {
            const resolved = await vaultRequest<{path:string}>("resolveItemId", {itemId});
            const opened = await readForOpen(resolved.path, !allowFolderPicker);
            if (packIdentity(opened.markdown) !== itemId) throw new Error("This item moved. Choose it again.");
            setNoteEditPath(null); setSelected(opened); setDestinationFolder(folderForItem(opened.path));
          }, true)} referenceChoices={vaultReferenceChoices(visibleListing?.items ?? [], selectedItemId ?? undefined)} readOnly={!canEditSelected} initial={selected} root={listing.root} registerFlush={registerFlush} onChanged={refresh} onTitleChange={updateSelectedTitle} onRemoved={() => closeRemoved(selected.path)}
              startEditing={noteEditPath === selected.path}
              focusNewNote={!busy && (newNoteFocus?.file === selected && newNoteFocus.focusPending || noteEditPath === selected.path)}
              focusNewNoteTitle={Boolean(newNoteFocus?.file === selected && newNoteFocus.focusTitle)}
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
      : browseListing?.root ? <div aria-hidden={templatePicker || Boolean(captureMode) || searchOpen || undefined}><WorkspaceOverview listing={browseListing} folder={destinationFolder} busy={busy} canCreate={canCreate} sharedView={!capabilities.fullAccess} preferredBookmarkPath={preferredBookmarkPath} galleryCommentsAccess={galleryCommentsAccess}
        onCreateCard={(title, body, tags, images, color, onCreated, icon, parents) => { void createForFolder("Notes", "Note", title, undefined, body, true, onCreated, tags, images, color, icon, parents); }}
        onEditNote={(path) => { if (!capabilities.edit(path)) return; void operate(async () => { setNoteEditPath(path); setSelected(await readForOpen(path, !allowFolderPicker)); setDestinationFolder("Notes"); }, true); }}
        onCreateNote={(pastedText) => { if (pastedText) { const [firstLine, ...rest] = pastedText.trim().split(/\r?\n/); const title = firstLine.slice(0, 120) || "New card"; void createForFolder("Notes", "Note", title, undefined, rest.join("\n").replace(/^\n+/, "")); } else void createNote(focusedControl()); }}
        onQuickSaveBookmark={canCreate ? quickSaveBookmark : undefined}
        onAskBookmarkAgent={allowFolderPicker || webAssistant ? askItemAgent : undefined}
        onAskGalleryAgent={allowFolderPicker || webAssistant ? askItemAgent : undefined}
        designOpen={folderDesignOpen}
        onCustomize={(allowFolderPicker || webAssistant) && canCreate ? beginCustomize : undefined}
        onCloseDesign={() => setFolderDesignOpen(false)}
        onRevealBookmark={(path) => void operate(async () => { setSelected(null); setPreferredBookmarkPath(path); setDestinationFolder("Bookmarks"); }, true)}
        onOpen={(path) => void operate(async () => { setNoteEditPath(null); setSelected(await readForOpen(path, !allowFolderPicker)); setDestinationFolder(folderForItem(path)); }, true)} /></div> : <div className="vault-empty">
        <h2>{listing?.root ? "Your workspace" : allowFolderPicker ? "Open a workspace folder" : "Opening workspace"}</h2>
        <p>{listing?.root ? "Choose a TextPack or create a note." : allowFolderPicker ? "Choose a folder on your computer. Your documents and templates live there as TextPack files." : "Your files will appear here."}</p>
      </div>}
    </main>
    {importedGalleryPath && destinationFolder.trim() === "Gallery" && !selected && <VaultGalleryLightbox key={importedGalleryPath} entries={[{ path: importedGalleryPath, index: 0 }]} initialSelection={0} commentsAccess={galleryCommentsAccess} onAskAgent={allowFolderPicker || webAssistant ? askItemAgent : undefined}
      onClose={() => { setImportedGalleryPath(null); refresh(); }}
      onEdit={(path) => void operate(async () => { setImportedGalleryPath(null); setSelected(await readForOpen(path, !allowFolderPicker)); setDestinationFolder("Gallery"); }, true)} />}
    {(allowFolderPicker || webAssistant) && <NativeAssistant folder={!selected ? destinationFolder.trim() : undefined} targetTitle={selected ? { path: selected.path, title: contextTitle } : undefined} webAssistant={webAssistant} key={listing?.root || "no-workspace"} open={assistantOpen} root={listing?.root ?? ""} path={assistantTargetPath ?? selected?.path ?? (folderTargetMatches ? folderAssistantTarget?.path : undefined)} request={folderAssistantTarget && !folderTargetMatches ? null : assistantRequest} onClose={closeAssistant} beforeSend={() => flushRef.current()} />}
  </div>;
}
