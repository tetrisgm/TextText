import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePopoverFocus } from "@/components/accessibility/useDialogFocus";
import { useEscapeLayer } from "./LocalKeyboard";
import { vaultRequest, type VaultFile } from "./bridge";
import { readDocument, writePayload } from "./model";

type Image = { id: string; url: string; alt: string; width?: number; height?: number };

type GalleryEntry = { path: string; index: number };

function sourceLink(value: string): string | null {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function imageDetails(source: string): Promise<{ colors: string[]; width: number; height: number }> {
  return new Promise(resolve => {
    const sample = new Image();
    sample.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 48; canvas.height = 48;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) { resolve({ colors: [], width: sample.naturalWidth, height: sample.naturalHeight }); return; }
        context.drawImage(sample, 0, 0, 48, 48);
        const pixels = context.getImageData(0, 0, 48, 48).data;
        const counts = new Map<string, number>();
        for (let offset = 0; offset < pixels.length; offset += 4) {
          if (pixels[offset + 3] < 128) continue;
          const color = [0, 1, 2].map(channel => Math.min(255, Math.round(pixels[offset + channel] / 32) * 32));
          const hex = `#${color.map(value => value.toString(16).padStart(2, "0")).join("")}`;
          counts.set(hex, (counts.get(hex) || 0) + 1);
        }
        resolve({ colors: [...counts].sort((left, right) => right[1] - left[1]).slice(0, 5).map(([color]) => color), width: sample.naturalWidth, height: sample.naturalHeight });
      } catch { resolve({ colors: [], width: sample.naturalWidth, height: sample.naturalHeight }); }
    };
    sample.onerror = () => resolve({ colors: [], width: 0, height: 0 });
    sample.src = source;
  });
}

export function VaultGalleryLightbox({ entries, initialSelection, onClose, onEdit }: { entries: GalleryEntry[]; initialSelection: number; onClose: () => void; onEdit: (path: string) => void }) {
  const viewer = useRef<HTMLDivElement>(null);
  const [file, setFile] = useState<VaultFile | null>(null);
  const [error, setError] = useState("");
  const [selection, setSelection] = useState(initialSelection);
  const [zoom, setZoom] = useState(1);
  const [editingCaption, setEditingCaption] = useState(false);
  const [captionDraft, setCaptionDraft] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [updating, setUpdating] = useState(false);
  const [details, setDetails] = useState<{ colors: string[]; width: number; height: number }>({ colors: [], width: 0, height: 0 });
  const chosen = entries[Math.min(selection, entries.length - 1)];
  const path = chosen?.path || "";
  const index = chosen?.index || 0;
  useEscapeLayer(true, "gallery-image", onClose);
  usePopoverFocus(viewer, true);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    setError("");
    void vaultRequest<VaultFile>("read", { path }, controller.signal)
      .then(setFile).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "The image could not be opened."); });
    return () => controller.abort();
  }, [path]);
  const local = useMemo(() => {
    const images = new Map<string, string>();
    for (const asset of (file?.path === path ? file.assets : null) || []) {
      if (!asset.contentType.startsWith("image/") || asset.data.length > 32 * 1024 * 1024) continue;
      try {
        const bytes = Uint8Array.from(atob(asset.data), character => character.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: asset.contentType }));
        images.set(`assets/${asset.filename}`, url);
        if (asset.remoteURL) images.set(asset.remoteURL, url);
      } catch { /* A malformed asset cannot prevent the rest of the gallery from opening. */ }
    }
    return images;
  }, [file, path]);
  useEffect(() => () => { for (const url of new Set(local.values())) URL.revokeObjectURL(url); }, [local]);
  let title = path.split("/").at(-1)?.replace(/\.textpack$/i, "") || "Image";
  let caption = "";
  let source = "";
  let tags: string[] = [];
  let images: Image[] = [];
  let size = 0;
  try {
    if (file?.path === path) {
      const document = readDocument(file);
      title = document.content.title || title;
      caption = document.content.body;
      source = typeof document.content.fields.sourceUrl === "string" ? document.content.fields.sourceUrl : "";
      tags = document.content.tags;
      images = document.content.assets.filter(asset => asset.kind === "image" && local.has(asset.src)).map(asset => ({ id: asset.id, url: local.get(asset.src)!, alt: asset.alt || title, width: asset.width, height: asset.height }));
    }
  } catch { /* Show a readable error below while preserving the original file. */ }
  const image = images[Math.min(index, Math.max(0, images.length - 1))];
  const sourceHref = sourceLink(source);
  useEffect(() => { setEditingCaption(false); setTagDraft(""); }, [path]);
  const updateContent = async (change: (content: ReturnType<typeof readDocument>["content"]) => ReturnType<typeof readDocument>["content"]) => {
    if (!file || file.path !== path || updating) return false;
    setUpdating(true); setError("");
    try {
      const document = readDocument(file);
      const updated = await vaultRequest<VaultFile>("write", writePayload(file, { ...document, content: change(document.content) }));
      setFile(current => current?.path === updated.path ? updated : current);
      window.dispatchEvent(new Event("texttext:vault-changed"));
      return true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The image details could not be saved."); return false; }
    finally { setUpdating(false); }
  };
  const addTag = async () => {
    const tag = tagDraft.trim().replace(/^#/, "").slice(0, 40);
    if (!tag || tags.some(value => value.toLocaleLowerCase() === tag.toLocaleLowerCase())) return;
    if (await updateContent(content => ({ ...content, tags: [...content.tags, tag] }))) setTagDraft("");
  };
  useEffect(() => setZoom(1), [image?.url]);
  const asset = image && file?.assets?.find(entry => local.get(`assets/${entry.filename}`) === image.url || (entry.remoteURL && local.get(entry.remoteURL) === image.url));
  if (asset) size = Math.floor(asset.data.length * 3 / 4) - (asset.data.endsWith("==") ? 2 : asset.data.endsWith("=") ? 1 : 0);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => setDetails({ colors: [], width: 0, height: 0 }));
    if (image?.url) void imageDetails(image.url).then(value => { if (active) setDetails(value); });
    return () => { active = false; };
  }, [image?.url]);
  const previous = () => setSelection(value => Math.max(0, value - 1));
  const next = () => setSelection(value => Math.min(entries.length - 1, value + 1));
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest("input,textarea,[contenteditable=true]")) return;
      if (event.key === "ArrowLeft" && selection > 0) { event.preventDefault(); previous(); }
      if (event.key === "ArrowRight" && selection < entries.length - 1) { event.preventDefault(); next(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection, entries.length]);
  const shell = document.querySelector(".vault-app");
  if (!shell) return null;
  return createPortal(<section className="vault-gallery-view">
    <div ref={viewer} className="vault-gallery-lightbox" role="region" aria-label={title}>
      <header><button onClick={onClose} aria-label="Close image">‹ <span>Gallery</span></button><span>{title}</span><button aria-label="Edit item" onClick={() => onEdit(path)} disabled={!file}>Edit</button></header>
      {error && <p role="alert">{error}</p>}
      {file?.path !== path && !error && <p role="status">Opening image…</p>}
      {file?.path === path && !images.length && <p role="status">This item has no embedded image to display. Open the item to inspect its contents.</p>}
      {image && <div className="vault-gallery-detail"><div className="vault-gallery-stage">
        {entries.length > 1 && <button aria-label="Previous image" disabled={selection === 0} onClick={previous}>‹</button>}
        {/* eslint-disable-next-line @next/next/no-img-element */}<img src={image.url} alt={image.alt} style={{ transform: `scale(${zoom})` }} />
        {entries.length > 1 && <button aria-label="Next image" disabled={selection >= entries.length - 1} onClick={next}>›</button>}
        <div className="vault-gallery-zoom" role="group" aria-label="Image zoom"><button aria-label="Zoom out" disabled={zoom <= 1} onClick={() => setZoom(value => Math.max(1, Math.round((value - .25) * 100) / 100))}>−</button><span>{Math.round(zoom * 100)}%</span><button aria-label="Zoom in" disabled={zoom >= 3} onClick={() => setZoom(value => Math.min(3, Math.round((value + .25) * 100) / 100))}>+</button><button aria-label="Fit image" disabled={zoom === 1} onClick={() => setZoom(1)}>Fit</button></div>
      </div><aside><dl>{(image.width || details.width) && (image.height || details.height) && <><dt>Dimensions</dt><dd>{image.width || details.width} × {image.height || details.height}</dd></>}{size > 0 && <><dt>Size</dt><dd>{size < 1024 ? `${size} B` : `${Math.round(size / 1024)} KB`}</dd></>}{source && <><dt>Source</dt><dd className="vault-gallery-source">{sourceHref ? <a href={sourceHref} target="_blank" rel="noopener noreferrer">{source}</a> : source}</dd></>}{entries.length > 1 && <><dt>Library image</dt><dd>{selection + 1} of {entries.length}</dd></>}</dl>
        <div className="vault-gallery-inspector-section"><div className="vault-gallery-inspector-heading"><h2>Caption</h2>{!editingCaption && <button aria-label="Edit caption" disabled={updating} onClick={() => { setCaptionDraft(caption); setEditingCaption(true); }}>Edit</button>}</div>{editingCaption ? <form onSubmit={event => { event.preventDefault(); void updateContent(content => ({ ...content, body: captionDraft.trim() })).then(saved => { if (saved) setEditingCaption(false); }); }}><textarea aria-label="Image caption" value={captionDraft} onChange={event => setCaptionDraft(event.target.value)} maxLength={4000} disabled={updating} /><div><button type="button" onClick={() => setEditingCaption(false)} disabled={updating}>Cancel</button><button type="submit" disabled={updating}>Save caption</button></div></form> : <p>{caption || "No caption yet"}</p>}</div>
        <div className="vault-gallery-inspector-section"><h2>Tags</h2><div className="vault-gallery-tags">{tags.map(tag => <button key={tag} aria-label={`Remove ${tag} tag`} disabled={updating} onClick={() => void updateContent(content => ({ ...content, tags: content.tags.filter(value => value !== tag) }))}>#{tag} ×</button>)}</div><form className="vault-gallery-tag-form" onSubmit={event => { event.preventDefault(); void addTag(); }}><input aria-label="Add image tag" value={tagDraft} onChange={event => setTagDraft(event.target.value)} placeholder="Add a tag" maxLength={41} disabled={updating} /><button type="submit" disabled={updating || !tagDraft.trim()}>Add</button></form></div>
        {details.colors.length > 0 && <div className="vault-gallery-colors vault-gallery-inspector-section" aria-label="Image colors"><h2>Colors</h2><div>{details.colors.map(color => <span key={color} title={color} aria-label={color} style={{ backgroundColor: color }} />)}</div></div>}</aside></div>}
    </div>
  </section>, shell);
}
