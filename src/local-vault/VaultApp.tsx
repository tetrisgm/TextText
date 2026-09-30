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
import { NativeConnection } from "./NativeConnection";
import { NativeAssistant } from "./NativeAssistant";
import { FolderNavigation } from "./FolderNavigation";
import { folderTree, folderPaths, folderForItem } from "./folders";
import { CaptureDialog } from "./CaptureDialog";
import { VaultSearch } from "./VaultSearch";
import "./style.css";

const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
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

function VaultEditor({ initial, root, onChanged, onRemoved, registerFlush }: { onRemoved: () => void; initial: VaultFile; root: string; onChanged: () => void; registerFlush: (flush: () => Promise<boolean>, currentFile: () => VaultFile) => void }) {
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
  useEffect(() => { registerFlush(flush, () => file.current); }, [flush, registerFlush]);
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
  return <section className="vault-document"><header className="vault-document-path">{initial.path}</header>{notice && <div className="vault-notice" role="status">{notice}{hasConflict ? <button disabled={copying} onClick={() => void saveCopy()}>{copying ? "Saving copy…" : "Save my edits as a copy"}</button> : <button onClick={() => void flush()}>Retry save</button>}</div>}<UnifiedDocumentEditor transport="local" externalDocument={display} blog={localBlog} post={post} template={templates.find((template) => template.id === external.presentation.template.id && template.version === external.presentation.template.version) ?? initialTemplate} availableTemplates={templates} onSaveAsLook={saveLook} renderTemplateLibrary={(props) => <LocalTemplateLibrary currentTemplate={pendingLook.current?.template ?? readTemplate(file.current, current.current)} onClose={props.onClose} onApply={(template, sourceJSON) => {
    pendingLook.current = { template, sourceJSON };
    setTemplates((values) => [template, ...values.filter((value) => value.id !== template.id || value.version !== template.version)]);
    props.onApply(template); remember();
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, 350);
  }} />} collab={{ postId: initial.path, userName: "You", color: "#3970c5", canEdit: true }} onDocumentChange={change} onDone={async () => { await flush(); }} /></section>;
}

class DocumentBoundary extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: "" };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() { return this.state.error ? <div className="vault-notice" role="alert">This TextPack could not be opened: {this.state.error}</div> : this.props.children; }
}

export function VaultApp({ allowFolderPicker = true }: { allowFolderPicker?: boolean }) {
  const [listing, setListing] = useState<VaultListing | null>(null);
  const [selected, setSelected] = useState<VaultFile | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [destinationFolder, setDestinationFolder] = useState("");
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [templatePicker, setTemplatePicker] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [fileAction, setFileAction] = useState<"rename" | "delete" | null>(null);
  const [newPath, setNewPath] = useState("");
  const currentFileRef = useRef<(() => VaultFile) | null>(null);
  const tree = useMemo(() => folderTree(listing?.items ?? []), [listing]);
  const folders = useMemo(() => folderPaths(tree), [tree]);
  const flushRef = useRef<() => Promise<boolean>>(async () => true);
  const registerFlush = useCallback((flush: () => Promise<boolean>, currentFile: () => VaultFile) => { flushRef.current = flush; currentFileRef.current = currentFile; }, []);
  const refresh = useCallback(() => { void vaultRequest<VaultListing>("list").then(setListing).catch((error: Error) => setError(error.message)); }, []);
  useEffect(() => { refresh(); window.addEventListener("texttext:vault-changed", refresh); return () => window.removeEventListener("texttext:vault-changed", refresh); }, [refresh]);
  const closeRemoved = useCallback(() => {
    setSelected(null); setFileAction(null); currentFileRef.current = null;
    flushRef.current = async () => true;
  }, []);
  const operate = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError("");
    try { if (await flushRef.current()) { await action(); setFileAction(null); } }
    catch (error) { setError(error instanceof Error ? error.message : "The file operation failed."); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    const openFile = (event: Event) => { const path = (event as CustomEvent<{ path: string }>).detail?.path; if (path) void operate(async () => { setSelected(await vaultRequest<VaultFile>("read", { path })); setDestinationFolder(folderForItem(path)); }); };
    const newFile = () => { void operate(async () => { setSelected(await vaultRequest<VaultFile>("create", { title: "Untitled", folder: destinationFolder.trim() })); refresh(); }); };
    window.addEventListener("texttext:vault-open", openFile);
    window.addEventListener("texttext:vault-new", newFile);
    return () => { window.removeEventListener("texttext:vault-open", openFile); window.removeEventListener("texttext:vault-new", newFile); };
  });
  useEffect(() => {
    const search = () => setSearchOpen(true);
    const key = (event: KeyboardEvent) => {
      if (allowFolderPicker && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault(); search();
      }
    };
    window.addEventListener("keydown", key);
    window.addEventListener("texttext:vault-search", search);
    return () => { window.removeEventListener("keydown", key); window.removeEventListener("texttext:vault-search", search); };
  }, [allowFolderPicker]);
  return <div className={`vault-app${assistantOpen ? " has-assistant" : ""}`}>
    <DocumentEngineStyles />
    <aside className="vault-sidebar">
      <h1>TextText</h1>
      {allowFolderPicker && <button disabled={busy} onClick={() => void operate(async () => {
        const opened = await vaultRequest<VaultListing>("open");
        setListing(opened); setSelected(null); setDestinationFolder(""); flushRef.current = async () => true;
      })}>Open folder</button>}
      {listing?.root && <>
        <p className="vault-root" title={listing.root}>{listing.name || listing.root.split("/").filter(Boolean).at(-1)}</p>
        <label className="vault-folder-destination">Folder for new notes
          <input list="vault-folders" aria-label="Folder for new notes" value={destinationFolder} placeholder="Workspace root"
            onChange={(event) => setDestinationFolder(event.target.value)} />
          <datalist id="vault-folders">{folders.map((folder) => <option key={folder} value={folder} />)}</datalist>
        </label>
        <button disabled={busy} onClick={() => void operate(async () => {
          const created = await vaultRequest<VaultFile>("create", { title: "Untitled", folder: destinationFolder.trim() });
          setSelected(created); refresh();
        })}>New note</button>
        <button disabled={busy} onClick={() => void operate(async () => setTemplatePicker(true))}>New from template</button>
        <button disabled={busy} onClick={() => void operate(async () => setCaptureOpen(true))}>Save a link or note</button>
        {allowFolderPicker && <>
          <button disabled={busy} onClick={() => void operate(async () => {
            const result = await vaultRequest<{ file?: VaultFile }>("import", { folder: destinationFolder.trim() });
            if (result.file) { setSelected(result.file); refresh(); }
          })}>Import file…</button>
          <button disabled={busy} onClick={() => setSearchOpen(true)}>Search files ⌘K</button>
        </>}
        <nav aria-label="Workspace files"><FolderNavigation tree={tree} selectedPath={selected?.path} busy={busy}
          onFolder={setDestinationFolder} onOpen={(item) => void operate(async () => {
            setSelected(await vaultRequest<VaultFile>("read", { path: item.path })); setDestinationFolder(folderForItem(item.path));
          })} /></nav>
        {allowFolderPicker && <button onClick={() => setAssistantOpen((value) => !value)}>Assistant</button>}
        {allowFolderPicker && <NativeConnection key={listing.root} root={listing.root} />}
      </>}
    </aside>
    <main>
      {selected && <div className="vault-file-actions">
        <button disabled={busy} onClick={() => { setNewPath(selected.path); setFileAction("rename"); }}>Rename or move</button>
        <button disabled={busy} onClick={() => setFileAction("delete")}>Delete</button>
        {fileAction === "rename" && <form onSubmit={(event) => { event.preventDefault(); void operate(async () => {
          const observed = currentFileRef.current?.();
          if (!observed || observed.path !== selected.path) throw new Error("Wait for this file to finish opening.");
          const renamed = await vaultRequest<VaultFile>("rename", { path: observed.path, hash: observed.hash, newPath: newPath.trim() });
          setSelected(renamed); setFileAction(null); refresh();
        }); }}>
          <label>File path<input aria-label="New file path" value={newPath} onChange={(event) => setNewPath(event.target.value)} /></label>
          <button disabled={busy || !newPath.trim()} type="submit">Save path</button>
          <button type="button" onClick={() => setFileAction(null)}>Cancel</button>
        </form>}
        {fileAction === "delete" && <div role="group" aria-label="Confirm file deletion">
          <p>Delete <strong>{selected.path}</strong>?</p>
          <button disabled={busy} onClick={() => void operate(async () => {
            const observed = currentFileRef.current?.();
            if (!observed || observed.path !== selected.path) throw new Error("Wait for this file to finish opening.");
            await vaultRequest("delete", { path: observed.path, hash: observed.hash });
            setSelected(null); setFileAction(null); currentFileRef.current = null; flushRef.current = async () => true; refresh();
          })}>Delete file</button>
          <button onClick={() => setFileAction(null)}>Cancel</button>
        </div>}
      </div>}
      {captureOpen && <CaptureDialog onClose={() => setCaptureOpen(false)} onSave={async (input) => {
        if (!await flushRef.current()) throw new Error("Save or resolve the current document before capturing another item.");
        const created = await vaultRequest<VaultFile>("create", { ...input, folder: destinationFolder.trim() });
        setSelected(created); refresh();
      }} />}
      {searchOpen && <VaultSearch onClose={() => setSearchOpen(false)} onOpen={async (path) => {
        if (!await flushRef.current()) throw new Error("Save or resolve the current document before opening another file.");
        setSelected(await vaultRequest<VaultFile>("read", { path })); setDestinationFolder(folderForItem(path));
      }} />}
      {templatePicker && <LocalTemplateLibrary onClose={() => setTemplatePicker(false)} onApply={() => {}} onCreateFromFile={(path) => void operate(async () => {
        const source = await vaultRequest<VaultFile>("read", { path });
        const title = readDocument(source).content.title || path.split("/").at(-1)!.replace(/\.textpack$/i, "");
        const created = await vaultRequest<VaultFile>("create", { title, folder: destinationFolder.trim(), sourcePath: path, sourceHash: source.hash });
        setSelected(created); setTemplatePicker(false); refresh();
      })} />}
      {error && <div className="vault-notice" role="alert">{error}</div>}
      {selected && listing ? <DocumentBoundary key={`${listing.root}:${selected.path}`}>
        <div inert={busy}><VaultEditor initial={selected} root={listing.root} registerFlush={registerFlush} onChanged={refresh} onRemoved={closeRemoved} /></div>
      </DocumentBoundary> : <div className="vault-empty">
        <h2>{listing?.root ? "Your workspace" : "Open a workspace folder"}</h2>
        <p>{listing?.root ? "Choose a TextPack or create a note." : "Choose a folder on your Mac. Your documents and templates live there as TextPack files."}</p>
      </div>}
    </main>
    {allowFolderPicker && <NativeAssistant key={listing?.root || "no-workspace"} open={assistantOpen} path={selected?.path} onClose={() => setAssistantOpen(false)} beforeSend={() => flushRef.current()} />}
  </div>;
}
