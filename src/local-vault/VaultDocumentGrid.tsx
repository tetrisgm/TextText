import { previewLabels, rememberPreviewLabel } from "./preview-labels";
import { VaultNoteTemplatePicker } from "./VaultNoteTemplatePicker";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { DocumentCollectionRenderer } from "@/components/document/DocumentRenderer";
import type { TemplateDefinition } from "@/lib/presentation/schema";
import { selectCollectionView } from "@/lib/presentation/collection-views";
import { BUILTIN_TEMPLATES, getBuiltinTemplate } from "@/lib/presentation/templates";
import { NOTE_COLORS, noteColor, type NoteColor } from "@/lib/note-colors";
import { validateTemplateDefinition } from "@/lib/presentation/schema";
import { vaultRequest, type VaultListing } from "./bridge";
import { folderForItem } from "./folders";
import { collectionDocument, collectionMembers, noteCardDocument, queryFolderMembers, type FolderPreview } from "./folder-collection";
import { VaultFeedHeadlines } from "./VaultFeedHeadlines";
import { VaultBookmarkLibrary } from "./VaultBookmarkLibrary";
import { VaultGalleryLightbox, type GalleryCommentsAccess } from "./VaultGalleryLightbox";
import { IMAGE_ACCEPT, MAX_IMAGE_BYTES } from "./image-import";
import { VaultCardLinkPicker, type CardLinkTarget } from "./VaultCardLinkPicker";
import { noteCardHref } from "@/lib/note-card-links";
import { NoteIcon, NoteIconControl } from "@/components/document/NoteIconControl";
import { noteIcon } from "@/lib/note-icons";
import { NoteEmojiPicker } from "@/components/document/NoteEmojiPicker";
import { FieldInput } from "@/components/document/FieldInput";
import { createVaultDocumentReferences } from "./reference-choices";

const PAGE_SIZE = 24;
type DraftImage = { id: string; file: File; url: string };
function storyExcerpt(markdown: string): string {
  return markdown.replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(?:^|\n)\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+)/g, " ")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ").trim().slice(0, 300);
}
const noteTemplate = BUILTIN_TEMPLATES.find(template => template.id === "texttext.note");
function noteCardTemplate(preview?: FolderPreview): TemplateDefinition | undefined {
  const reference = preview?.document?.presentation.template;
  if (!reference) return noteTemplate;
  if (preview?.templateJSON) {
    try {
      const template = validateTemplateDefinition(JSON.parse(preview.templateJSON));
      if (template.id === reference.id && template.version === reference.version) return template;
    } catch { /* A damaged saved look falls back to the standard card. */ }
  }
  return getBuiltinTemplate(reference.id, reference.version) ?? noteTemplate;
}
let queue: Promise<unknown> = Promise.resolve();
function requestPreview(path: string, active: () => boolean, metadataOnly = false): Promise<FolderPreview | null> {
  const request = queue.then(() => active() ? vaultRequest<FolderPreview>("preview", { path, metadataOnly }) : null);
  queue = request.catch(() => null);
  return request;
}
function PreviewImage({ preview, children }: { preview?: FolderPreview; children: (url?: string) => React.ReactNode }) {
  const [source, setSource] = useState<{ data: string; contentType: string; url: string }>();
  const image = preview?.image;
  const data = image?.data;
  const contentType = image?.contentType;
  useEffect(() => {
    if (!data || !contentType || !["image/png", "image/jpeg"].includes(contentType) || data.length > 700_000) return;
    let url: string;
    try {
      const bytes = Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
      url = URL.createObjectURL(new Blob([bytes], { type: contentType }));
    } catch { return; }
    const handle = { data, contentType, url };
    void Promise.resolve().then(() => setSource(handle));
    return () => URL.revokeObjectURL(url);
  }, [data, contentType]);
  return children(source?.data === data && source?.contentType === contentType ? source?.url : undefined);
}
function GalleryTile({ source, title, disabled, onOpen, onMeasured, width, height }: { source?: string; title: string; disabled: boolean; onOpen: () => void; onMeasured: (ratio: number) => void; width: number; height: number }) {
  return <button disabled={disabled} onClick={onOpen} aria-label={`Open ${title}`} style={{ width, height }}>
    {source ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={source} alt="" loading="lazy" decoding="async" onLoad={event => {
      const image = event.currentTarget;
      if (image.naturalWidth && image.naturalHeight) onMeasured(Math.max(0.4, Math.min(4, image.naturalWidth / image.naturalHeight)));
    }} /> : <span>{title}</span>}
  </button>;
}
export function VaultDocumentGrid({ listing, folder, busy, onOpen, onEditNote, onRevealBookmark, onCreateNote, onCreateCard, onQuickSaveBookmark, onAskBookmarkAgent, onAskGalleryAgent, folderTemplate, excludedPath, previewOnly = false, canUsePersonalBookmarks = true, emptyMessage, preferredBookmarkPath, galleryCommentsAccess }: {
  listing: VaultListing; folder: string; busy: boolean; onOpen: (path: string) => void;
  onEditNote?: (path: string) => void;
  onRevealBookmark?: (path: string) => void;
  onCreateNote?: (pastedText?: string) => void; canUsePersonalBookmarks?: boolean;
  onCreateCard?: (title: string, body: string, tags: string[], images: File[], color: NoteColor, onCreated: () => void, icon?: string, parents?: string[]) => void;
  onQuickSaveBookmark?: (address: string) => Promise<void>;
  onAskBookmarkAgent?: (path: string, question: string) => void;
  onAskGalleryAgent?: (path: string, task: string, imageAssetId?: string) => void;
  folderTemplate?: TemplateDefinition; excludedPath?: string; previewOnly?: boolean; emptyMessage?: string; preferredBookmarkPath?: string; galleryCommentsAccess?: GalleryCommentsAccess;
}) {
  const [page, setPage] = useState(0);
  const [view, setView] = useState("");
  const [galleryState, setGalleryState] = useState<{ entries: { path: string; index: number }[]; selection: number } | null>(null);
  const galleryGrid = useRef<HTMLDivElement>(null);
  const [galleryWidth, setGalleryWidth] = useState(0);
  const [galleryRatios, setGalleryRatios] = useState<Record<string, number>>({});
  useEffect(() => {
    if (folder !== "Gallery" || !galleryGrid.current) return;
    const observer = new ResizeObserver(entries => setGalleryWidth(entries[0]?.contentRect.width ?? 0));
    observer.observe(galleryGrid.current);
    return () => observer.disconnect();
  }, [folder]);
  const [gallerySearchOpen, setGallerySearchOpen] = useState(false);
  const [previewState, setPreviewState] = useState(() => ({ listing, values: previewLabels(listing) }));
  const previews = previewState.listing === listing ? previewState.values : previewLabels(listing);
  const [query, setQuery] = useState<{ key: string; listing?: VaultListing; previews: Record<string, FolderPreview>; done: boolean; error?: string }>({ key: "", previews: {}, done: false });
  const template = useMemo(() => folderTemplate ? { ...folderTemplate, collection: selectCollectionView(folderTemplate.collection, view || folderTemplate.collection.defaultView || "") } : undefined, [folderTemplate, view]);
  const members = useMemo(() => collectionMembers(listing.items, folder, Boolean(template), excludedPath), [listing, folder, template, excludedPath]);
  const unsupportedDates = Boolean(template?.collection.sort.some((entry) => ["createdAt", "updatedAt", "publishedAt"].includes(entry.field)));
  const needsQuery = Boolean(template && !unsupportedDates && (template.collection.sort.length || template.collection.filters.length));
  const queryKey = JSON.stringify([listing.root, folder, members.map((item) => item.path), template?.collection.sort, template?.collection.filters]);
  useEffect(() => {
    // Opening a file takes priority over collection previews. A queued preview
    // can otherwise read and decode a whole TextPack while the editor opens.
    if (busy || !needsQuery || members.length > 2048) return;
    let active = true;
    void Promise.resolve().then(async () => {
      const metadata: Record<string, FolderPreview> = {};
      let totalBytes = 0;
      for (const item of members) {
        if (!active) return;
        try {
          const preview = await requestPreview(item.path, () => active, true);
          if (preview) {
            totalBytes += new TextEncoder().encode(JSON.stringify(preview)).byteLength;
            if (totalBytes > 8 * 1024 * 1024) {
              if (active) setQuery({ key: queryKey, listing, previews: {}, done: true, error: "This folder exceeds the query limits. Showing all files without the requested sort or filters." });
              return;
            }
            const fields = Object.fromEntries(Object.entries(preview.document?.content.fields || {}).filter(([id]) =>
              template?.collection.sort.some((entry) => entry.field === `content.fields.${id}`) || template?.collection.filters.some((entry) => entry.field === `content.fields.${id}`)));
            metadata[item.path] = { title: preview.title, excerpt: "", metadataTruncated: preview.metadataTruncated, incompleteFields: preview.incompleteFields, document: preview.document ? { ...preview.document,
              content: { ...preview.document.content, body: "", tags: [], assets: [], fields } } : undefined };
          }
        } catch { /* Query validation exposes incomplete details instead of silently excluding files. */ }
      }
      if (active) setQuery({ key: queryKey, listing, previews: metadata, done: true });
    });
    return () => { active = false; };
  }, [busy, needsQuery, queryKey, members, template, listing]);
  let queryMessage = unsupportedDates ? "Date sorting is not available for this folder yet. Showing all files in their existing order." : "";
  let items = members;
  if (needsQuery && template) {
    if (members.length > 2048) queryMessage = "Folder sorting and filtering supports up to 2,048 files here. Showing all files in their existing order.";
    else if (query.key !== queryKey || query.listing !== listing || !query.done) queryMessage = "Reading folder details before applying its sort and filters…";
    else if (query.error) queryMessage = query.error;
    else try { items = queryFolderMembers(members, query.previews, template.collection); }
    catch (error) { queryMessage = error instanceof Error ? error.message : "Folder details are unavailable."; }
  }
  const fallbackTitle = (item: VaultListing["items"][number]) => item.title || item.path.split("/").at(-1)?.replace(/\.textpack$/i, "") || "Untitled";
  const galleryFolder = folder === "Gallery";
  const [gallerySearch, setGallerySearch] = useState("");
  const [galleryTag, setGalleryTag] = useState("");
  const collectionSearchKey = (galleryFolder || folder === "Blog") ? JSON.stringify([listing.root, items.map(item => item.path)]) : "";
  const [collectionSearchIndex, setCollectionSearchIndex] = useState<{ key: string; listing?: VaultListing; previews: Record<string, FolderPreview>; error: string }>({ key: "", previews: {}, error: "" });
  useEffect(() => {
    if (!collectionSearchKey || busy || collectionSearchIndex.key === collectionSearchKey && collectionSearchIndex.listing === listing) return;
    let active = true;
    void Promise.resolve().then(async () => {
      if (items.length > 2048) { if (active) setCollectionSearchIndex({ key: collectionSearchKey, listing, previews: {}, error: "Search supports up to 2,048 items in one folder." }); return; }
      const found: Record<string, FolderPreview> = {};
      let totalBytes = 0;
      for (const item of items) {
        if (!active) return;
        try {
          const preview = await requestPreview(item.path, () => active, true);
          if (!preview?.document || preview.incompleteFields?.some(field => ["*", "title", "subtitle", "tags", "content.fields.sourceUrl"].includes(field))) {
            if (active) setCollectionSearchIndex({ key: collectionSearchKey, listing, previews: {}, error: "Search is unavailable because some item details could not be read." });
            return;
          }
          const storyFields = folder === "Blog" ? Object.fromEntries(["texttextPreviewTitle", "texttextPreviewSubtitle"]
            .filter(field => typeof preview.document?.content.fields[field] === "string")
            .map(field => [field, preview.document!.content.fields[field]])) : {};
          const compact: FolderPreview = { title: preview.title, excerpt: preview.excerpt, sourceURL: preview.sourceURL, publishedAt: preview.publishedAt, document: { ...preview.document,
            content: { ...preview.document.content, body: "", fields: storyFields, assets: galleryFolder ? preview.document.content.assets.filter(asset => asset.kind === "image") : [] } } };
          totalBytes += new TextEncoder().encode(JSON.stringify(compact)).byteLength;
          if (totalBytes > 8 * 1024 * 1024) { if (active) setCollectionSearchIndex({ key: collectionSearchKey, listing, previews: {}, error: "Item details exceed the 8 MiB search limit." }); return; }
          found[item.path] = compact;
        } catch { if (active) setCollectionSearchIndex({ key: collectionSearchKey, listing, previews: {}, error: "Search is unavailable while an item cannot be read." }); return; }
      }
      if (active) setCollectionSearchIndex({ key: collectionSearchKey, listing, previews: found, error: "" });
    });
    return () => { active = false; };
    // The key captures the folder listing without restarting the metadata scan on render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, collectionSearchKey, listing]);
  const collectionSearchReady = (galleryFolder || folder === "Blog") && collectionSearchIndex.key === collectionSearchKey && collectionSearchIndex.listing === listing && !collectionSearchIndex.error;
  const galleryQuery = gallerySearch.trim().toLocaleLowerCase();
  const galleryTags = galleryFolder && collectionSearchReady ? [...new Set(items.flatMap(item => {
    const content = collectionSearchIndex.previews[item.path]?.document?.content;
    const images = content?.assets.filter(asset => asset.kind === "image") ?? [];
    return images.length ? images.flatMap(asset => asset.tags ?? content?.tags ?? []) : content?.tags ?? [];
  }))].sort((left, right) => left.localeCompare(right)) : [];
  const [storySearch, setStorySearch] = useState("");
  const [storyStatus, setStoryStatus] = useState<"all" | "drafts" | "published">("all");
  const storyQuery = storySearch.trim().toLocaleLowerCase();
  const notesFolder = folder === "Notes";
  const [cardDraft, setCardDraft] = useState<{ title: string; body: string; tags: string[]; color: NoteColor } | null>(null);
  const cardDraftRef = useRef<{ title: string; body: string; tags: string[]; color: NoteColor } | null>(null);
  const [draftIcon, setDraftIcon] = useState("");
  const [draftParents, setDraftParents] = useState<string[]>([]);
  const draftParentsRef = useRef<string[]>([]);
  const [draftParentOpen, setDraftParentOpen] = useState(false);
  const draftParentRef = useRef<HTMLDivElement>(null);
  const draftFormRef = useRef<HTMLFormElement>(null);
  const draftReferences = useMemo(() => createVaultDocumentReferences(), [listing.root]);
  // Deferred focus runs a frame later. On a slow or busy machine that frame can land after the
  // user already moved into another draft field, and pulling focus then sends their typing to the
  // wrong field. Only move focus when the user has not moved into a different text field since
  // the focus was requested.
  const draftFocusAllowed = (target: HTMLElement, activeWhenRequested: Element | null) => {
    const active = document.activeElement;
    return !(active instanceof HTMLElement && active !== target && active !== activeWhenRequested && draftFormRef.current?.contains(active) && active.matches("input, textarea"));
  };
  const focusDraftLater = (target: () => HTMLElement | null | undefined, after?: (element: HTMLElement) => void) => {
    const activeWhenRequested = document.activeElement;
    return requestAnimationFrame(() => {
      const element = target();
      if (!element || !draftFocusAllowed(element, activeWhenRequested)) return;
      element.focus();
      after?.(element);
    });
  };
  useEffect(() => {
    if (!draftParentOpen) return;
    const frame = focusDraftLater(() => {
      const picker = draftParentRef.current?.querySelector<HTMLDetailsElement>("details");
      if (picker) picker.open = true;
      return draftParentRef.current?.querySelector<HTMLInputElement>('input[type="search"]');
    });
    return () => cancelAnimationFrame(frame);
  }, [draftParentOpen]);
  // A new draft focuses its title in the same commit that mounts it, so no later frame can steal
  // focus from a field the user has already chosen.
  const draftTitleFocusPending = useRef(false);
  useLayoutEffect(() => {
    if (!cardDraft || !draftTitleFocusPending.current) return;
    draftTitleFocusPending.current = false;
    const title = draftTitleRef.current;
    if (title && draftFocusAllowed(title, null)) title.focus();
  }, [cardDraft]);
  const draftIconRef = useRef("");
  const [draftColorOpen, setDraftColorOpen] = useState(false);
  const [draftTemplate, setDraftTemplate] = useState<{body: string; at: number} | null>(null);
  const [draftEmojiOpen, setDraftEmojiOpen] = useState(false);
  const [draftTagOpen, setDraftTagOpen] = useState(false);
  const [draftInsertOpen, setDraftInsertOpen] = useState(false);
  const [draftLinkOpen, setDraftLinkOpen] = useState(false);
  const [draftCardLinkOpen, setDraftCardLinkOpen] = useState(false);
  const [draftImages, setDraftImages] = useState<DraftImage[]>([]);
  const draftImagesRef = useRef<DraftImage[]>([]);
  const [draftImageError, setDraftImageError] = useState("");
  const draftImageInputRef = useRef<HTMLInputElement>(null);
  const draftTagRef = useRef<HTMLInputElement>(null);
  const draftLinkTextRef = useRef<HTMLInputElement>(null);
  const draftLinkURLRef = useRef<HTMLInputElement>(null);
  const draftTitleRef = useRef<HTMLTextAreaElement>(null);
  const draftBodyRef = useRef<HTMLTextAreaElement>(null);
  const draftCaretRef = useRef<number | null>(null);
  const draftLinkSelectionRef = useRef<{ from: number; to: number } | null>(null);
  const draftCardLinkLabelRef = useRef("");
  const insertDraftBody = (text: string, replace?: { from: number; to: number } | null) => {
    const body = draftBodyRef.current;
    if (!body) return;
    const at = draftCaretRef.current ?? body.selectionStart;
    body.setRangeText(text, replace?.from ?? at, replace?.to ?? at, "end");
    cardDraftRef.current = { ...(cardDraftRef.current ?? { title: "", body: "", tags: [], color: "default" }), body: body.value };
    draftCaretRef.current = null;
    body.focus();
  };
  const insertDraftChecklist = () => {
    const body = draftBodyRef.current;
    if (!body) return;
    const at = draftCaretRef.current ?? body.selectionStart;
    const before = body.value.slice(0, at);
    insertDraftBody(`${before && !before.endsWith("\n") ? "\n" : ""}- [ ] `);
    setDraftInsertOpen(false);
  };
  const insertDraftEmoji = (emoji: string) => {
    insertDraftBody(emoji, draftLinkSelectionRef.current);
    draftLinkSelectionRef.current = null;
    setDraftEmojiOpen(false);
  };
  const addDraftLink = () => {
    const rawURL = draftLinkURLRef.current?.value.trim() ?? "";
    let url: URL;
    try { url = new URL(rawURL); } catch { setDraftImageError("Enter a complete web address for the link."); return; }
    if (url.protocol !== "https:" && url.protocol !== "http:") { setDraftImageError("Use an http or https link."); return; }
    const label = (draftLinkTextRef.current?.value.trim() || url.hostname).replaceAll("[", "\\[").replaceAll("]", "\\]");
    insertDraftBody(`[${label}](${url.href})`, draftLinkSelectionRef.current);
    draftLinkSelectionRef.current = null;
    setDraftImageError("");
    setDraftLinkOpen(false);
  };
  const addDraftCardLink = (target: CardLinkTarget) => {
    const label = (draftCardLinkLabelRef.current.trim() || target.title).replaceAll("[", "\\[").replaceAll("]", "\\]");
    insertDraftBody(`[${label}](<${noteCardHref(target.id)}>)`, draftLinkSelectionRef.current);
    draftLinkSelectionRef.current = null;
    setDraftCardLinkOpen(false);
  };
  const openDraftLink = (card: boolean) => {
    const body = draftBodyRef.current;
    const selection = draftLinkSelectionRef.current;
    const from = selection?.from ?? body?.selectionStart ?? draftCaretRef.current ?? 0;
    const to = selection?.to ?? body?.selectionEnd ?? from;
    draftLinkSelectionRef.current = { from, to };
    draftCardLinkLabelRef.current = body?.value.slice(from, to) ?? "";
    setDraftInsertOpen(false);
    setDraftCardLinkOpen(card);
    setDraftLinkOpen(!card);
    if (!card) focusDraftLater(() => draftLinkURLRef.current);
  };
  const showCardDraft = (initial = "") => {
    if (cardDraftRef.current && !initial) { draftTitleRef.current?.focus(); return; }
    setDraftIcon(""); draftIconRef.current = "";
    setDraftParents([]); draftParentsRef.current = []; setDraftParentOpen(false);
    const next = { title: initial, body: "", tags: [] as string[], color: "default" as NoteColor };
    cardDraftRef.current = next;
    setCardDraft(next);
    setDraftTagOpen(false);
    setDraftInsertOpen(false);
    setDraftColorOpen(false);
    setDraftEmojiOpen(false);
    setDraftLinkOpen(false);
    setDraftCardLinkOpen(false);
    setDraftImageError("");
    window.dispatchEvent(new Event("texttext:note-draft-started"));
    draftTitleFocusPending.current = true;
  };
  const addDraftTag = () => {
    const current = cardDraftRef.current;
    const tag = draftTagRef.current?.value.trim().replace(/^#/, "").slice(0, 40) ?? "";
    if (!current || !tag || current.tags.length >= 500) return;
    if (current.tags.some(value => value.toLocaleLowerCase() === tag.toLocaleLowerCase())) { if (draftTagRef.current) draftTagRef.current.value = ""; return; }
    const next = { ...current, tags: [...current.tags, tag] };
    cardDraftRef.current = next;
    setCardDraft(next);
    if (draftTagRef.current) draftTagRef.current.value = "";
    draftTagRef.current?.focus();
  };
  const addDraftImages = (files: File[]) => {
    if (!files.length) return;
    const previous = draftImagesRef.current;
    const combined = [...previous.map(image => image.file), ...files];
    if (combined.length > 16 || combined.some(file => !file.size || file.size > MAX_IMAGE_BYTES) || combined.reduce((total, file) => total + file.size, 0) > 40 * 1024 * 1024) {
      setDraftImageError("Choose up to 16 images, no larger than 20 MiB each or 40 MiB together.");
      return;
    }
    const added = files.map(file => ({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) }));
    draftImagesRef.current = [...previous, ...added];
    setDraftImages(draftImagesRef.current);
    setDraftImageError("");
    setDraftInsertOpen(false);
    setDraftColorOpen(false);
  };
  const clearDraftImages = () => {
    for (const image of draftImagesRef.current) URL.revokeObjectURL(image.url);
    draftImagesRef.current = [];
    setDraftImages([]);
    setDraftImageError("");
  };
  useEffect(() => () => { for (const image of draftImagesRef.current) URL.revokeObjectURL(image.url); }, []);
  const resetCardDraft = () => {
    cardDraftRef.current = null;
    setCardDraft(null);
    setDraftParents([]); draftParentsRef.current = []; setDraftParentOpen(false);
    clearDraftImages();
    setDraftInsertOpen(false);
    setDraftColorOpen(false);
    setDraftTagOpen(false);
    setDraftLinkOpen(false);
    draftCaretRef.current = null;
    draftLinkSelectionRef.current = null;
    window.dispatchEvent(new Event("texttext:note-draft-ended"));
  };
  const finishCardDraft = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!onCreateCard) return;
    const title = draftTitleRef.current?.value ?? cardDraftRef.current?.title ?? "";
    const body = draftBodyRef.current?.value ?? cardDraftRef.current?.body ?? "";
    if (!title.trim() && !body.trim() && !draftImagesRef.current.length) { draftTitleRef.current?.focus(); return; }
    const savedTags = cardDraftRef.current?.tags ?? [];
    const pendingTag = draftTagRef.current?.value.trim().replace(/^#/, "").slice(0, 40) ?? "";
    const tags = pendingTag && savedTags.length < 500 && !savedTags.some(tag => tag.toLocaleLowerCase() === pendingTag.toLocaleLowerCase()) ? [...savedTags, pendingTag] : savedTags;
    onCreateCard(title.trim(), body, tags, draftImagesRef.current.map(image => image.file), cardDraftRef.current?.color ?? "default", resetCardDraft, draftIconRef.current, draftParentsRef.current);
  };
  useEffect(() => {
    if (!notesFolder || !onCreateCard || previewOnly) return;
    const type = (event: Event) => {
      const key = (event as CustomEvent<string>).detail;
      if (typeof key !== "string" || key.length !== 1) return;
      const current = cardDraftRef.current;
      if (!current) { showCardDraft(key); return; }
      const next = { ...current, title: key === "\b" ? [...current.title].slice(0, -1).join("") : current.title + key };
      cardDraftRef.current = next;
      setCardDraft(next);
      if (draftTitleRef.current) draftTitleRef.current.value = next.title;
    };
    window.addEventListener("texttext:note-type", type);
    return () => window.removeEventListener("texttext:note-type", type);
    // The listener reads the draft ref; reattaching during rapid typing can drop keys.
  }, [notesFolder, onCreateCard, previewOnly]);
  const [noteSearch, setNoteSearch] = useState("");
  const [noteContentSearch, setNoteContentSearch] = useState<{ query: string; listing?: VaultListing; paths: Set<string>; truncated: boolean; error: string }>({ query: "", paths: new Set(), truncated: false, error: "" });
  const [noteTag, setNoteTag] = useState("");
  const [noteColorFilter, setNoteColorFilter] = useState<NoteColor | "all">("all");
  const [noteSort, setNoteSort] = useState<"folder" | "title">("folder");
  const noteIndexKey = notesFolder ? JSON.stringify([listing.root, items.map(item => item.path)]) : "";
  const [noteIndex, setNoteIndex] = useState<{ key: string; listing?: VaultListing; previews: Record<string, FolderPreview>; error: string }>({ key: "", previews: {}, error: "" });
  useEffect(() => {
    if (!noteIndexKey || busy || noteIndex.key === noteIndexKey && noteIndex.listing === listing) return;
    let active = true;
    void Promise.resolve().then(async () => {
      if (items.length > 2048) { if (active) setNoteIndex({ key: noteIndexKey, listing, previews: {}, error: "Search supports up to 2,048 cards in one folder." }); return; }
      const found: Record<string, FolderPreview> = {};
      let totalBytes = 0;
      for (const item of items) {
        if (!active) return;
        try {
          const preview = await requestPreview(item.path, () => active, true);
          if (!preview?.document || preview.incompleteFields?.some(field => ["*", "title", "tags"].includes(field))) {
            if (active) setNoteIndex({ key: noteIndexKey, listing, previews: {}, error: "Card search is unavailable because some card details could not be read." });
            return;
          }
          const compact: FolderPreview = { title: preview.title, excerpt: preview.excerpt, document: { ...preview.document,
            content: { ...preview.document.content, body: preview.excerpt, fields: { texttextNoteColor: noteColor(preview.document.content.fields.texttextNoteColor), texttextNoteIcon: noteIcon(preview.document.content.fields.texttextNoteIcon) }, assets: [] } } };
          totalBytes += new TextEncoder().encode(JSON.stringify(compact)).byteLength;
          if (totalBytes > 8 * 1024 * 1024) { if (active) setNoteIndex({ key: noteIndexKey, listing, previews: {}, error: "Card details exceed the 8 MiB search limit." }); return; }
          found[item.path] = compact;
        } catch { if (active) setNoteIndex({ key: noteIndexKey, listing, previews: {}, error: "Card search is unavailable while a card cannot be read." }); return; }
      }
      if (active) setNoteIndex({ key: noteIndexKey, listing, previews: found, error: "" });
    });
    return () => { active = false; };
    // The key captures the folder listing and order without restarting an in-flight scan on render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, noteIndexKey, listing]);
  const noteIndexReady = notesFolder && noteIndex.key === noteIndexKey && noteIndex.listing === listing && !noteIndex.error;
  const noteTags = noteIndexReady ? [...new Set(items.flatMap(item => noteIndex.previews[item.path]?.document?.content.tags ?? []))].sort((left, right) => left.localeCompare(right)) : [];
  const availableNoteColors = noteIndexReady ? NOTE_COLORS.filter(color => items.some(item => noteColor(noteIndex.previews[item.path]?.document?.content.fields.texttextNoteColor) === color)) : [];
  const noteQuery = noteSearch.trim().toLocaleLowerCase();
  useEffect(() => {
    if (!notesFolder || !noteQuery || !noteIndexReady) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void vaultRequest<{ items: { path: string }[]; truncated?: boolean; skippedCount?: number }>("search", { query: noteQuery, folder: "Notes" }, controller.signal)
        .then(result => { if (!controller.signal.aborted) setNoteContentSearch({ query: noteQuery, listing, paths: new Set(result.items.map(item => item.path)), truncated: Boolean(result.truncated || result.skippedCount), error: "" }); })
        .catch(reason => { if (!controller.signal.aborted) setNoteContentSearch({ query: noteQuery, listing, paths: new Set(), truncated: false, error: reason instanceof Error ? reason.message : "Card search could not finish." }); });
    }, 400);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [notesFolder, noteQuery, noteIndexReady, listing]);
  const indexedNoteTitle = (item: VaultListing["items"][number]) => noteIndex.previews[item.path]?.title?.trim() || fallbackTitle(item);
  const searchMatchedItems = noteIndexReady && notesFolder ? items.filter(item => {
    const preview = noteIndex.previews[item.path];
    const tags = preview?.document?.content.tags ?? [];
    return (!noteTag || tags.includes(noteTag)) && (noteColorFilter === "all" || noteColor(preview?.document?.content.fields.texttextNoteColor) === noteColorFilter) && (!noteQuery || `${indexedNoteTitle(item)} ${preview?.excerpt ?? ""} ${tags.join(" ")}`.toLocaleLowerCase().includes(noteQuery) || noteContentSearch.query === noteQuery && noteContentSearch.listing === listing && noteContentSearch.paths.has(item.path));
  }).sort((left, right) => noteSort === "title" ? indexedNoteTitle(left).localeCompare(indexedNoteTitle(right)) : 0) : collectionSearchReady && (galleryFolder ? galleryQuery || galleryTag : storyQuery) ? items.filter(item => {
    const preview = collectionSearchIndex.previews[item.path];
    const imageAssets = galleryFolder ? preview?.document?.content.assets.filter(asset => asset.kind === "image") ?? [] : [];
    const content = preview?.document?.content;
    const matchedTags = imageAssets.length ? imageAssets.some(asset => (asset.tags ?? content?.tags ?? []).includes(galleryTag)) : content?.tags.includes(galleryTag);
    return (!galleryFolder || !galleryTag || matchedTags) && `${preview?.title || fallbackTitle(item)} ${imageAssets.map(asset => [asset.title, asset.alt, asset.caption, asset.summary, asset.sourceUrl, ...(asset.tags ?? content?.tags ?? [])].filter(Boolean).join(" ")).join(" ")} ${content?.subtitle || ""} ${content?.fields.texttextPreviewTitle || ""} ${content?.fields.texttextPreviewSubtitle || ""} ${preview?.excerpt || ""} ${preview?.sourceURL || ""} ${galleryFolder ? "" : (content?.tags || []).join(" ")}`.toLocaleLowerCase().includes(galleryFolder ? galleryQuery : storyQuery);
  }) : items;
  const displayedItems = folder === "Blog" && collectionSearchReady && storyStatus !== "all"
    ? searchMatchedItems.filter(item => storyStatus === "published" ? Boolean(collectionSearchIndex.previews[item.path]?.publishedAt) : !collectionSearchIndex.previews[item.path]?.publishedAt)
    : searchMatchedItems;
  const feedIndexKey = folder === "Feeds" ? JSON.stringify([listing.root, items.map(item => item.path)]) : "";
  const [feedIndex, setFeedIndex] = useState<{ key: string; previews: Record<string, FolderPreview>; done: boolean; error: string }>({ key: "", previews: {}, done: false, error: "" });
  useEffect(() => {
    if (!feedIndexKey || busy) return;
    let active = true;
    void Promise.resolve().then(async () => {
      const metadata: Record<string, FolderPreview> = {};
      let totalBytes = 0;
      if (items.length > 2048) { setFeedIndex({ key: feedIndexKey, previews: {}, done: true, error: "Feeds supports up to 2,048 subscriptions in one folder." }); return; }
      for (const item of items) {
        if (!active) return;
        try {
          const preview = await requestPreview(item.path, () => active, true);
          if (!preview?.document) continue;
          const compact: FolderPreview = { title: preview.title, excerpt: "", document: { ...preview.document,
            content: { ...preview.document.content, body: "", assets: [] } } };
          totalBytes += new TextEncoder().encode(JSON.stringify(compact)).byteLength;
          if (totalBytes > 8 * 1024 * 1024) { setFeedIndex({ key: feedIndexKey, previews: {}, done: true, error: "Feed subscription details exceed the 8 MiB folder limit." }); return; }
          metadata[item.path] = compact;
        } catch { /* A damaged subscription stays visible in Sources without blocking the others. */ }
      }
      if (active) setFeedIndex({ key: feedIndexKey, previews: metadata, done: true, error: "" });
    });
    return () => { active = false; };
  }, [busy, feedIndexKey, items]);
  const lastPage = Math.max(0, Math.ceil(displayedItems.length / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  const visible = displayedItems.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const visibleKey = JSON.stringify([listing, visible.map((item) => item.path)]);
  useEffect(() => {
    if (busy || folder === "Feeds") return;
    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      setPreviewState({ listing, values: previewLabels(listing) });
      const batchSize = folder === "Gallery" ? 4 : 1;
      for (let start = 0; start < visible.length && active; start += batchSize) {
        await Promise.all(visible.slice(start, start + batchSize).map(async item => {
          if (!active) return;
          try {
            let preview = await requestPreview(item.path, () => active);
            const reference = preview?.document?.presentation.template;
            if (active && preview && folder === "Notes" && reference && !getBuiltinTemplate(reference.id, reference.version)) {
              try {
                const source = await vaultRequest<{ templateJSON?: string }>("template", { path: item.path });
                if (source.templateJSON?.length && source.templateJSON.length <= 256 * 1024) {
                  const candidate = validateTemplateDefinition(JSON.parse(source.templateJSON));
                  if (candidate.id === reference.id && candidate.version === reference.version) preview = { ...preview, templateJSON: source.templateJSON };
                }
              } catch { /* Keep the card readable with the standard look. */ }
            }
            if (active && preview) {
              rememberPreviewLabel(listing, item.path, preview);
              setPreviewState(previous => ({ listing, values: { ...(previous.listing === listing ? previous.values : previewLabels(listing)), [item.path]: preview } }));
            }
          } catch {
            if (active) setPreviewState(previous => ({ listing, values: {
              ...(previous.listing === listing ? previous.values : previewLabels(listing)),
              [item.path]: { title: previewLabels(listing)[item.path]?.title || fallbackTitle(item), excerpt: "Preview unavailable. Open this file to read it." },
            } }));
          }
        }));
      }
    });
    return () => { active = false; };
    // Listing identity changes on file/permission notifications even when paths
    // are unchanged. The visible key also tracks pagination/query results.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, listing, visibleKey, folder]);
  const requestedLayout = template?.collection.layout || "cards";
  const supported = ["cards", "list", "index"].includes(requestedLayout);
  const layout = supported ? requestedLayout : "list";
  const photoFolder = folder === "Gallery";
  const bookmarkFolder = folder === "Bookmarks";
  const blogFolder = folder === "Blog";
  const feedsFolder = folder === "Feeds";
  const referenceFolder = photoFolder || bookmarkFolder || notesFolder || blogFolder || feedsFolder;
  const layoutPreferenceKey = `texttext:document-layout:v1:${listing.root}`;
  const readLayoutPreference = (): "list" | "cards" => {
    try { return localStorage.getItem(layoutPreferenceKey) === "list" ? "list" : "cards"; }
    catch { return "cards"; }
  };
  const [personalLayout, setPersonalLayout] = useState(() => ({ key: layoutPreferenceKey, value: readLayoutPreference() }));
  const genericLayout = personalLayout.key === layoutPreferenceKey ? personalLayout.value : readLayoutPreference();
  const chooseLayout = (value: "list" | "cards") => {
    setPersonalLayout({ key: layoutPreferenceKey, value });
    try { localStorage.setItem(layoutPreferenceKey, value); } catch { /* The current view still works when preferences cannot be stored. */ }
  };

  const galleryPhotoMatches = (item: typeof visible[number], index: number) => {
    if (!galleryTag && !galleryQuery) return true;
    const preview = collectionSearchIndex.previews[item.path];
    const content = preview?.document?.content;
    const asset = content?.assets.filter(entry => entry.kind === "image")[index];
    if (galleryTag && !(asset?.tags ?? content?.tags ?? []).includes(galleryTag)) return false;
    if (!galleryQuery) return true;
    const collectionText = [preview?.title, content?.subtitle, preview?.excerpt, preview?.sourceURL].filter(Boolean).join(" ").toLocaleLowerCase();
    const photoText = [asset?.title, asset?.alt, asset?.caption, asset?.summary, asset?.sourceUrl, ...(asset?.tags ?? content?.tags ?? [])].filter(Boolean).join(" ").toLocaleLowerCase();
    return collectionText.includes(galleryQuery) || photoText.includes(galleryQuery);
  };
  const galleryEntries = photoFolder ? visible.flatMap(item => {
    const count = previews[item.path]?.images?.length || 1;
    return Array.from({ length: count }, (_, index) => ({ path: item.path, index })).filter(entry => galleryPhotoMatches(item, entry.index));
  }) : [];
  const galleryTiles = photoFolder ? visible.flatMap(item => {
    const preview = previews[item.path];
    const images = preview?.images?.length ? preview.images : [preview?.image];
    const imageAssets = preview?.document?.content.assets.filter(asset => asset.kind === "image") || [];
    return images.map((image, index) => {
      const asset = imageAssets[index];
      const ratio = asset?.width && asset.height ? Math.max(0.4, Math.min(4, asset.width / asset.height)) : 1;
      return { item, preview, image, index, ratio, key: `${item.path}:${index}`, title: asset?.title || `${preview?.title || fallbackTitle(item)}${images.length > 1 ? ` image ${index + 1}` : ""}` };
    }).filter(tile => galleryPhotoMatches(item, tile.index));
  }) : [];
  const galleryRows: { tiles: typeof galleryTiles; height: number; widths: number[] }[] = [];
  const rowGap = 12;
  let pending: typeof galleryTiles = [];
  let ratioSum = 0;
  const finishRow = (last: boolean) => {
    if (!pending.length) return;
    const available = Math.max(0, galleryWidth - rowGap * (pending.length - 1));
    const height = !galleryWidth ? 180 : last ? Math.min(180, available / ratioSum) : available / ratioSum;
    galleryRows.push({ tiles: pending, height, widths: pending.map(tile => height * (galleryRatios[tile.key] ?? tile.ratio)) });
    pending = []; ratioSum = 0;
  };
  for (const tile of galleryTiles) {
    pending.push(tile); ratioSum += galleryRatios[tile.key] ?? tile.ratio;
    if (galleryWidth && ratioSum * 180 + rowGap * (pending.length - 1) >= galleryWidth) finishRow(false);
  }
  finishRow(true);
  const filePages = lastPage > 0 && !bookmarkFolder ? <nav className="vault-file-pages" aria-label="File pages"><button disabled={busy || currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><span>Page {currentPage + 1} of {lastPage + 1}</span><button disabled={busy || currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>Next</button></nav> : null;
  return <section aria-label="Documents" className={referenceFolder ? `vault-${folder.toLowerCase()}-folder` : undefined} onPaste={event => {
    if (!notesFolder || !onCreateNote || busy || previewOnly) return;
    if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable], [role="textbox"]')) return;
    const text = event.clipboardData.getData("text/plain");
    if (!text.trim()) return;
    event.preventDefault();
    onCreateNote(text);
  }}>{!referenceFolder && <h3>{folder ? "Files" : "Explore your documents"}</h3>}
    {template && !referenceFolder && template.collection.views.length > 0 && <label>Folder view <select aria-label="Folder view" value={view || template.collection.defaultView || ""} onChange={(event) => { setView(event.target.value); setPage(0); }}><option value="">Default</option>{template.collection.views.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>}
    {!supported && <p role="status">The {requestedLayout} layout is not available here yet. Showing a readable list.</p>}
    {queryMessage && <p role="status">{queryMessage}</p>}
    {folder === "Feeds" && feedIndex.key === feedIndexKey && feedIndex.error && <p role="alert">{feedIndex.error}</p>}
    {!referenceFolder && !template && <div className="vault-document-view-options" role="group" aria-label="Document view">{(["list", "cards"] as const).map(view => <button key={view} type="button" aria-pressed={genericLayout === view} onClick={() => chooseLayout(view)}>{view === "list" ? "List" : "Cards"}</button>)}</div>}
    {photoFolder ? <><div className="vault-gallery-tools">{galleryTags.length > 0 && <select aria-label="Filter image tags" value={galleryTag} onChange={event => { setGalleryTag(event.target.value); setPage(0); }}><option value="">All images</option>{galleryTags.map(tag => <option key={tag} value={tag}>#{tag}</option>)}</select>}{gallerySearchOpen ? <label className="vault-gallery-search"><span className="ac-sr-only">Find images</span><input autoFocus type="search" aria-label="Find images" value={gallerySearch} onChange={event => { setGallerySearch(event.target.value); setPage(0); }} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setGallerySearch(""); setGallerySearchOpen(false); setPage(0); } }} disabled={!collectionSearchReady} placeholder={collectionSearchReady ? "Find images" : "Reading image details…"} /></label> : <button type="button" className="vault-gallery-search-button" aria-label="Search images" title="Search images" onClick={() => setGallerySearchOpen(true)}><svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m12.5 12.5 4.5 4.5"/></svg></button>}{gallerySearchOpen && <button type="button" className="vault-gallery-search-close" aria-label="Close image search" onClick={() => { setGallerySearch(""); setGallerySearchOpen(false); setPage(0); }}>Done</button>}</div>{collectionSearchIndex.key === collectionSearchKey && collectionSearchIndex.error && <p role="status">{collectionSearchIndex.error}</p>}{collectionSearchReady && (galleryQuery || galleryTag) && !displayedItems.length && <p role="status">No images match.</p>}<div className="vault-photo-grid" ref={galleryGrid}>{galleryRows.map((row, rowIndex) => <div className="vault-photo-row" key={`${rowIndex}:${row.tiles[0].key}`}>{row.tiles.map((tile, index) => <PreviewImage key={tile.key} preview={tile.preview ? { ...tile.preview, image: tile.image } : undefined}>{source => <GalleryTile source={source} title={tile.title} disabled={busy || previewOnly} width={row.widths[index]} height={row.height} onMeasured={ratio => setGalleryRatios(current => (current[tile.key] ?? tile.ratio) === ratio ? current : { ...current, [tile.key]: ratio })} onOpen={() => setGalleryState({ entries: galleryEntries, selection: galleryEntries.findIndex(entry => entry.path === tile.item.path && entry.index === tile.index) })} />}</PreviewImage>)}</div>)}</div></> : bookmarkFolder ? <VaultBookmarkLibrary items={items} previews={previews} busy={busy} previewOnly={previewOnly} onOpen={onOpen} onQuickSave={onQuickSaveBookmark} onAskAgent={onAskBookmarkAgent} preferredPath={preferredBookmarkPath} /> : notesFolder ? <>
      {onCreateCard && !previewOnly && <button className="vault-note-start" aria-label="Start typing to create a new card" disabled={busy} onClick={() => showCardDraft()}>Start typing or paste anything to create a new card…</button>}
      <div className="vault-note-tools"><label><span className="ac-sr-only">Find cards</span><input type="search" aria-label="Find cards" value={noteSearch} onChange={event => { setNoteSearch(event.target.value); setPage(0); }} disabled={!noteIndexReady} placeholder={noteIndexReady ? "Find cards" : "Reading cards…"} /></label><label><span className="ac-sr-only">Sort cards</span><select aria-label="Sort cards" value={noteSort} onChange={event => { setNoteSort(event.target.value as "folder" | "title"); setPage(0); }} disabled={!noteIndexReady}><option value="folder">Folder order</option><option value="title">Title A–Z</option></select></label>{availableNoteColors.some(color => color !== "default") && <label><span className="ac-sr-only">Filter cards by color</span><select aria-label="Filter cards by color" value={noteColorFilter} onChange={event => { setNoteColorFilter(event.target.value as NoteColor | "all"); setPage(0); }}><option value="all">All colors</option>{availableNoteColors.map(color => <option key={color} value={color}>{color === "default" ? "Default" : color[0].toUpperCase() + color.slice(1)}</option>)}</select></label>}</div>
      {noteIndex.key === noteIndexKey && noteIndex.listing === listing && noteIndex.error && <p role="status" className="vault-note-index-status">{noteIndex.error}</p>}
      {noteQuery && noteContentSearch.query === noteQuery && noteContentSearch.listing === listing && (noteContentSearch.error || noteContentSearch.truncated) && <p role="status" className="vault-note-index-status">{noteContentSearch.error || "Some long cards were not searched. Results may be incomplete."}</p>}
      {noteTags.length > 0 && <div className="vault-note-tag-filters" role="group" aria-label="Filter card tags"><button aria-pressed={!noteTag} onClick={() => { setNoteTag(""); setPage(0); }}>All</button>{noteTags.slice(0, 50).map(tag => <button key={tag} aria-pressed={noteTag === tag} onClick={() => { setNoteTag(tag); setPage(0); }}>#{tag}</button>)}{noteTags.length > 50 && <span>Find more tags with search</span>}</div>}
      {noteIndexReady && displayedItems.length === 0 && <p className="vault-note-index-status">No cards match.</p>}
      <div className="vault-note-cards">{cardDraft && onCreateCard && !previewOnly && <form ref={draftFormRef} className="vault-note-draft" data-note-color={cardDraft.color} aria-label="New card draft" onSubmit={finishCardDraft} onPaste={event => { const files = [...event.clipboardData.files].filter(file => file.type.startsWith("image/")); if (files.length) { event.preventDefault(); addDraftImages(files); } }} onDragOver={event => { if ([...event.dataTransfer.items].some(item => item.kind === "file")) event.preventDefault(); }} onDrop={event => { const files = [...event.dataTransfer.files].filter(file => file.type.startsWith("image/")); if (files.length) { event.preventDefault(); event.stopPropagation(); addDraftImages(files); } }}>
        <div className="vault-note-draft-tools"><button type="button" aria-label="Add to new card" aria-expanded={draftInsertOpen} disabled={busy} onPointerDown={() => { const body = draftBodyRef.current; if (!body) return; draftCaretRef.current = body.selectionStart; draftLinkSelectionRef.current = { from: body.selectionStart, to: body.selectionEnd }; }} onClick={() => { const body = draftBodyRef.current; if (!draftLinkSelectionRef.current && body) { draftCaretRef.current = body.selectionStart; draftLinkSelectionRef.current = { from: body.selectionStart, to: body.selectionEnd }; } setDraftInsertOpen(open => !open); }}>+</button>{draftInsertOpen && <div className="vault-note-draft-insert" role="menu" aria-label="Add to new card" onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); setDraftInsertOpen(false); draftBodyRef.current?.focus(); return; } const options = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("[role='menuitem']")]; const shortcut = event.key === "#" ? "Tag" : event.key === "^" ? "Link" : event.key === "!" ? "Image" : event.key === "*" ? "Color" : event.key === "=" ? "Template" : ""; if (shortcut) { event.preventDefault(); options.find(option => option.textContent?.trim().startsWith(shortcut) && !option.disabled)?.click(); } else if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); const index = options.indexOf(document.activeElement as HTMLButtonElement); options[(index + (event.key === "ArrowDown" ? 1 : options.length - 1)) % options.length]?.focus(); } }}><button type="button" role="menuitem" disabled={cardDraft.tags.length >= 500} onClick={() => { setDraftInsertOpen(false); setDraftTagOpen(true); focusDraftLater(() => draftTagRef.current); }}>Tag <kbd>#</kbd></button><button type="button" role="menuitem" onClick={() => { setDraftInsertOpen(false); setDraftParentOpen(true); }}>Parent</button><button type="button" role="menuitem" onClick={() => openDraftLink(true)}>Link <kbd>^</kbd></button><button type="button" role="menuitem" onClick={() => openDraftLink(false)}>Web link</button><button type="button" role="menuitem" onClick={() => { setDraftInsertOpen(false); draftImageInputRef.current?.click(); }}>Image <kbd>!</kbd></button><button type="button" role="menuitem" onClick={() => { setDraftInsertOpen(false); setDraftTemplate({body: cardDraftRef.current?.body ?? "", at: draftBodyRef.current?.selectionStart ?? 0}); }}>Template</button><button type="button" role="menuitem" onClick={insertDraftChecklist}>Checklist</button><button type="button" role="menuitem" onClick={() => { setDraftInsertOpen(false); setDraftEmojiOpen(true); }}>Emoji</button><button type="button" role="menuitem" onClick={() => { setDraftInsertOpen(false); setDraftColorOpen(true); focusDraftLater(() => document.querySelector<HTMLButtonElement>('.vault-note-draft-colors button')); }}>Color <kbd>*</kbd></button></div>}<input ref={draftImageInputRef} type="file" accept={IMAGE_ACCEPT} multiple aria-label="Choose new card images" hidden onChange={event => { addDraftImages(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = ""; }} /></div>
        {draftTemplate && <VaultNoteTemplatePicker body={draftTemplate.body} onCancel={() => { setDraftTemplate(null); draftBodyRef.current?.focus(); }} onPick={text => {
          const current = cardDraftRef.current;
          if (!current || current.body !== draftTemplate.body) throw new Error("The card changed. Reopen templates at the insertion point.");
          const at = Math.max(0, Math.min(draftTemplate.at, current.body.length));
          const body = current.body.slice(0, at) + text + current.body.slice(at); cardDraftRef.current = {...current, body}; setCardDraft({...current, body});
          if (draftBodyRef.current) draftBodyRef.current.value = body; setDraftTemplate(null); focusDraftLater(() => draftBodyRef.current, () => draftBodyRef.current?.setSelectionRange(at + text.length, at + text.length));
        }} />}
        {draftEmojiOpen && <NoteEmojiPicker onPick={insertDraftEmoji} onCancel={() => { setDraftEmojiOpen(false); draftBodyRef.current?.focus(); }} />}
        {draftColorOpen && <div className="vault-note-draft-colors" role="group" aria-label="New card color" onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); setDraftColorOpen(false); draftBodyRef.current?.focus(); } }}><span>Card color</span>{NOTE_COLORS.map(color => <button key={color} type="button" data-color={color} aria-label={color === "default" ? "Default card color" : `${color} card color`} aria-pressed={cardDraft.color === color} onClick={() => { const next = { ...(cardDraftRef.current ?? cardDraft), color }; cardDraftRef.current = next; setCardDraft(next); setDraftColorOpen(false); draftBodyRef.current?.focus(); }}>{color}</button>)}</div>}
        <NoteIconControl value={draftIcon} onChange={icon => { draftIconRef.current = icon; setDraftIcon(icon); }} />
        {(draftParentOpen || draftParents.length > 0) && <div ref={draftParentRef} className="vault-note-draft-parents" role="group" aria-label="New card parents"><FieldInput field={{id: "parents", label: "Parents", type: "reference", target: "document", multiple: true, required: false, visibility: "public"}} value={draftParents} documentReferences={draftReferences} disabled={busy} onChange={value => { const parents = Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []; draftParentsRef.current = parents; setDraftParents(parents); }} />{draftParentOpen && <button type="button" onClick={() => { const picker = draftParentRef.current?.querySelector<HTMLDetailsElement>("details"); if (picker) picker.open = false; setDraftParentOpen(false); draftBodyRef.current?.focus(); }}>Done choosing parents</button>}</div>}
        <textarea ref={draftTitleRef} aria-label="New card title" rows={1} placeholder="Title" defaultValue={cardDraft.title} onInput={event => { cardDraftRef.current = { ...(cardDraftRef.current ?? cardDraft), title: event.currentTarget.value }; }} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); draftBodyRef.current?.focus(); } }} />
        <textarea ref={draftBodyRef} aria-label="New card body" rows={4} placeholder="Write a card…" defaultValue={cardDraft.body} onInput={event => { cardDraftRef.current = { ...(cardDraftRef.current ?? cardDraft), body: event.currentTarget.value }; }} onSelect={event => { if (!draftInsertOpen && !draftLinkOpen && !draftCardLinkOpen && document.activeElement === event.currentTarget) draftLinkSelectionRef.current = { from: event.currentTarget.selectionStart, to: event.currentTarget.selectionEnd }; }} onKeyDown={event => { if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey && (event.currentTarget.selectionStart === 0 || /\s/.test(event.currentTarget.value[event.currentTarget.selectionStart - 1] ?? ""))) { event.preventDefault(); draftCaretRef.current = event.currentTarget.selectionStart; setDraftInsertOpen(true); focusDraftLater(() => document.querySelector<HTMLButtonElement>('.vault-note-draft-insert [role="menuitem"]')); } else if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
        {draftImages.length > 0 && <div className="vault-note-draft-images">{draftImages.map(image => <div key={image.id} className="vault-note-draft-image">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={image.url} alt={image.file.name} /><button type="button" aria-label={`Remove ${image.file.name} from new card`} onClick={() => { URL.revokeObjectURL(image.url); draftImagesRef.current = draftImagesRef.current.filter(item => item.id !== image.id); setDraftImages(draftImagesRef.current); }}>×</button></div>)}</div>}
        {draftImageError && <p role="alert" className="vault-note-draft-error">{draftImageError}</p>}
        {cardDraft.tags.length > 0 && <div className="vault-note-draft-tags">{cardDraft.tags.map(tag => <span key={tag}>#{tag}<button type="button" aria-label={`Remove ${tag} from new card`} onClick={() => { const current = cardDraftRef.current; if (!current) return; const next = { ...current, tags: current.tags.filter(value => value !== tag) }; cardDraftRef.current = next; setCardDraft(next); }}>×</button></span>)}</div>}
        {draftCardLinkOpen && <VaultCardLinkPicker onPick={addDraftCardLink} onCancel={() => { setDraftCardLinkOpen(false); draftBodyRef.current?.focus(); }} />}{draftLinkOpen && <div className="vault-note-draft-link-entry"><input ref={draftLinkURLRef} aria-label="New card link address" type="url" placeholder="https://example.com" onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addDraftLink(); } else if (event.key === "Escape") { event.preventDefault(); setDraftLinkOpen(false); draftBodyRef.current?.focus(); } }} /><input ref={draftLinkTextRef} aria-label="New card link text" defaultValue={draftCardLinkLabelRef.current} placeholder="Link text (optional)" onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addDraftLink(); } }} /><button type="button" onClick={addDraftLink}>Insert link</button><button type="button" onClick={() => { setDraftLinkOpen(false); draftBodyRef.current?.focus(); }}>Cancel link</button></div>}{draftTagOpen && <div className="vault-note-draft-tag-entry"><input ref={draftTagRef} aria-label="New card tag" maxLength={41} placeholder="Add a tag" onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addDraftTag(); } else if (event.key === "Escape") { event.preventDefault(); setDraftTagOpen(false); draftBodyRef.current?.focus(); } }} /><button type="button" onClick={addDraftTag}>Add</button></div>}
        <div className="vault-note-draft-actions"><button type="button" disabled={busy} onClick={resetCardDraft}>Cancel</button><button type="submit" disabled={busy}>Finish</button></div>
      </form>}{visible.map(item => { const preview = previews[item.path]; const title = preview?.title || fallbackTitle(item); const look = noteCardTemplate(preview); return <div className="vault-note-card" data-note-color={noteColor(preview?.document?.content.fields.texttextNoteColor)} key={item.path} role="article" aria-label={`${title} card`} tabIndex={busy || previewOnly ? -1 : 0} onKeyDown={event => {
        if (event.target !== event.currentTarget || busy || previewOnly) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault(); event.stopPropagation();
          const cards = [...event.currentTarget.parentElement!.querySelectorAll<HTMLElement>(".vault-note-card")];
          cards[Math.max(0, Math.min(cards.length - 1, cards.indexOf(event.currentTarget) + (event.key === "ArrowDown" ? 1 : -1)))]?.focus();
        } else if (event.key === " " || event.key === "Enter") {
          event.preventDefault(); event.stopPropagation();
          if (event.key === "Enter" && onEditNote && (item.canEditContent ?? listing.fullAccess === undefined)) onEditNote(item.path); else onOpen(item.path);
        }
      }} onClick={event => {
        if (busy || previewOnly || event.target instanceof Element && event.target.closest("a, button, input, textarea, select") || window.getSelection()?.toString().trim()) return;
        onOpen(item.path);
      }}><NoteIcon value={preview?.document?.content.fields.texttextNoteIcon}/>{look ? <DocumentCollectionRenderer document={noteCardDocument(preview, title)} template={look} documentId={`note-${item.path}`} /> : <strong>{title}</strong>}{preview?.image && <PreviewImage preview={preview}>{source => source ? /* eslint-disable-next-line @next/next/no-img-element */ <img className="vault-note-card-image" src={source} alt="" loading="lazy" decoding="async" /> : null}</PreviewImage>}{preview?.document?.content.tags.length ? <div className="vault-note-card-tags">{preview.document.content.tags.slice(0, 5).map(tag => <button key={tag} type="button" disabled={busy || previewOnly} onClick={() => { setNoteTag(tag); setPage(0); }} aria-label={`Filter cards by ${tag}`}>#{tag}</button>)}{preview.document.content.tags.length > 5 && <span>+{preview.document.content.tags.length - 5}</span>}</div> : null}<button className="vault-note-open" disabled={busy || previewOnly} onClick={() => onOpen(item.path)} aria-label={`Open ${title}`} title="Open card"><span aria-hidden="true">↗</span></button>{onEditNote && (item.canEditContent ?? listing.fullAccess === undefined) && !previewOnly && <button className="vault-note-card-edit" disabled={busy} onClick={() => onEditNote(item.path)} aria-label={`Edit ${title}`} title="Edit card"><svg aria-hidden="true" viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m4 13 8.9-8.9a2 2 0 0 1 2.8 2.8L6.8 15.8 3 17z"/><path d="m11.4 5.6 3 3"/></svg></button>}</div>; })}</div>
    </> : blogFolder ? <><div className="vault-story-tools"><div className="vault-story-status" role="group" aria-label="Story status">{(["all", "drafts", "published"] as const).map(status => <button key={status} type="button" aria-pressed={storyStatus === status} disabled={!collectionSearchReady} onClick={() => { setStoryStatus(status); setPage(0); }}>{status === "all" ? "All stories" : status === "drafts" ? "Drafts" : "Published"}</button>)}</div><label className="vault-story-search"><span className="ac-sr-only">Find stories</span><input type="search" aria-label="Find stories" value={storySearch} onChange={event => { setStorySearch(event.target.value); setPage(0); }} disabled={!collectionSearchReady} placeholder={collectionSearchReady ? "Find stories" : "Reading story details…"} /></label></div>{collectionSearchIndex.key === collectionSearchKey && collectionSearchIndex.error && <p role="status">{collectionSearchIndex.error}</p>}{collectionSearchReady && (storyQuery || storyStatus !== "all") && !displayedItems.length && <p role="status">No {storyStatus === "all" ? "stories" : storyStatus === "drafts" ? "drafts" : "published stories"} match.</p>}<div className="vault-story-list">{visible.map(item => {
      const preview = previews[item.path] || collectionSearchIndex.previews[item.path];
      const customTitle = preview?.document?.content.fields.texttextPreviewTitle;
      const title = preview?.document && !preview.document.content.title.trim() ? "New story" : typeof customTitle === "string" && customTitle.trim() ? customTitle.trim() : preview?.title || fallbackTitle(item);
      const authorValue = preview?.document?.content.fields.author;
      const author = typeof authorValue === "string" ? authorValue.trim() : "";
      const customSubtitle = preview?.document?.content.fields.texttextPreviewSubtitle;
      const subtitle = typeof customSubtitle === "string" ? customSubtitle.trim() : preview?.document?.content.subtitle?.trim() || "";
      const excerpt = preview?.excerpt ? storyExcerpt(preview.excerpt) : "";
      return <PreviewImage key={item.path} preview={preview}>{source => <button disabled={busy || previewOnly} onClick={() => onOpen(item.path)} aria-label={"Open " + title}>
        <span className="vault-story-copy">
          <small className="vault-story-list-byline">{author && <span className="vault-story-list-avatar" aria-hidden="true">{author.slice(0, 1).toUpperCase()}</span>}{author || "Story"}{preview && <span className="vault-story-list-status">· {preview.publishedAt ? "Published" : "Draft"}</span>}</small>
          <strong>{title}</strong>
          {subtitle && <span className="vault-story-list-subtitle">{subtitle}</span>}
          {excerpt && excerpt !== subtitle && <span className="vault-story-list-excerpt">{excerpt}</span>}
        </span>
        {source && /* eslint-disable-next-line @next/next/no-img-element */ <img src={source} alt="" loading="lazy" />}
      </button>}</PreviewImage>;
    })}</div></> : feedsFolder ? <VaultFeedHeadlines sources={items.flatMap(item => { const preview = feedIndex.previews[item.path]; return preview ? [{ ...preview, path: item.path }] : []; })} ready={feedIndex.key === feedIndexKey && feedIndex.done && !feedIndex.error} canAdd={!busy && !previewOnly && canUsePersonalBookmarks} canReadLater={canUsePersonalBookmarks && !previewOnly} canOpenBookmark={!busy && !previewOnly && canUsePersonalBookmarks} onOpenBookmark={onRevealBookmark ?? onOpen} onOpenHistory={onOpen} sourceList={<><div className="vault-feed-sources">{visible.map(item => { const preview = feedIndex.previews[item.path]; return <button key={item.path} disabled={busy || previewOnly} onClick={() => onOpen(item.path)} aria-label={`Open ${preview?.title || fallbackTitle(item)}`}><span className="vault-feed-source-icon" aria-hidden="true">◉</span><span><strong>{preview?.title || fallbackTitle(item)}</strong><small>{preview?.document?.content.fields.texttextFeedMuted === true ? "Hidden from feed · " : ""}{typeof preview?.document?.content.fields.feedUrl === "string" ? preview.document.content.fields.feedUrl : "Open latest stories"}</small></span><span aria-hidden="true">›</span></button>; })}</div>{filePages}</>} /> : template && layout === "index" ? <div className="vault-folder-table-wrapper"><table className="vault-folder-table"><thead><tr><th>Title</th><th>Source</th><th>Tags</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{visible.map((item) => {
      const preview = previews[item.path];
      return <tr key={item.path}><td>{preview?.title || fallbackTitle(item)}</td><td>{preview?.sourceURL || ""}</td><td>{preview?.document?.content.tags.join(", ") || ""}</td><td><button disabled={busy || previewOnly} onClick={() => onOpen(item.path)} aria-label={`Open ${preview?.title || fallbackTitle(item)}`}>Open</button></td></tr>;
    })}</tbody></table></div> : <div className={template ? "vault-folder-collection" : genericLayout === "list" ? "vault-document-list" : "vault-document-grid"} data-layout={template ? layout : genericLayout} style={template ? { "--vault-folder-columns": template.collection.columns, "--vault-folder-gap": template.collection.gap === "none" ? "0" : ({ xs: "0.25rem", sm: "0.5rem", md: "1rem", lg: "1.5rem", xl: "2rem" } as Record<string, string>)[template.collection.gap] || "1rem" } as CSSProperties : undefined}>{visible.map((item) => {
      const preview = previews[item.path];
      const fallback = fallbackTitle(item);
      const savedTitle = preview ? preview.title.trim() || "Untitled" : item.title?.trim();
      return <PreviewImage key={item.path} preview={preview}>{(source) => template ? <div className="vault-folder-item">
        <DocumentCollectionRenderer document={collectionDocument(preview, fallback, source)} template={template} documentId={`folder-${item.path}`} />
        <button disabled={busy || previewOnly} onClick={() => onOpen(item.path)} aria-label={`Open ${preview?.title || fallback}`}>Open</button>
      </div> : <button disabled={busy || previewOnly} aria-label={savedTitle ? `${savedTitle} ${folderForItem(item.path) || "Workspace"} Open →` : `Open file ${item.path}`} aria-busy={!savedTitle} onClick={() => onOpen(item.path)}>
        {!source && <span className="vault-file-type-icon" aria-hidden="true">▤</span>}
        {source ? /* eslint-disable-next-line @next/next/no-img-element */
          <img className="vault-file-preview" src={source} alt="" loading="lazy" decoding="async" />
          : null}
        {(!source || genericLayout === "list") && <p className="vault-file-excerpt">{preview ? preview.excerpt || "Open this file to start reading or editing." : <span className="vault-preview-placeholder vault-excerpt-placeholder" aria-hidden="true" />}</p>}
        <strong>{savedTitle ?? <span className="vault-preview-placeholder" aria-label="Loading title" />}</strong><small>{folderForItem(item.path) || "Workspace"}</small>
        {preview?.sourceURL && <small className="vault-file-source">{preview.sourceURL}</small>}<span>Open →</span>
      </button>}</PreviewImage>;
    })}</div>}
    {!items.length && !feedsFolder && <p>{members.length ? "No files match this view." : emptyMessage ?? "No files here yet. Choose a template to get started."}</p>}
    {galleryState && <VaultGalleryLightbox entries={galleryState.entries} initialSelection={galleryState.selection} onClose={() => setGalleryState(null)} onEdit={path => { setGalleryState(null); onOpen(path); }} commentsAccess={galleryCommentsAccess} onAskAgent={onAskGalleryAgent} />}
    {!feedsFolder && filePages}
  </section>;
}
