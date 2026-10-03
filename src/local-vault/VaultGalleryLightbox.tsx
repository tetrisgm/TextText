import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePopoverFocus } from "@/components/accessibility/useDialogFocus";
import type { DocumentFieldValue } from "@/lib/documents/model";
import type { TemplateDefinition } from "@/lib/presentation/schema";
import { useEscapeLayer } from "./LocalKeyboard";
import { vaultRequest, type VaultFile } from "./bridge";
import { readDocument, readTemplate, writePayload } from "./model";

type Image = { id: string; url: string; alt: string; caption?: string; width?: number; height?: number };

type GalleryEntry = { path: string; index: number };
const EMPTY_IMAGES = new Map<string, string>();

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
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [editingSource, setEditingSource] = useState(false);
  const [sourceDraft, setSourceDraft] = useState("");
  const [editingTags, setEditingTags] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const [editingField, setEditingField] = useState("");
  const [fieldDraft, setFieldDraft] = useState("");
  const [updating, setUpdating] = useState(false);
  const [details, setDetails] = useState<{ colors: string[]; width: number; height: number }>({ colors: [], width: 0, height: 0 });
  const [localImages, setLocalImages] = useState<{ path: string; file: VaultFile; urls: Map<string, string> } | null>(null);
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
  useEffect(() => {
    if (!file || file.path !== path) return;
    const images = new Map<string, string>();
    for (const asset of file.assets || []) {
      if (!asset.contentType.startsWith("image/") || asset.data.length > 32 * 1024 * 1024) continue;
      try {
        const bytes = Uint8Array.from(atob(asset.data), character => character.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: asset.contentType }));
        images.set(`assets/${asset.filename}`, url);
        if (asset.remoteURL) images.set(asset.remoteURL, url);
      } catch { /* A malformed asset cannot prevent the rest of the gallery from opening. */ }
    }
    let active = true;
    void Promise.resolve().then(() => { if (active) setLocalImages({ path, file, urls: images }); });
    return () => { active = false; for (const url of new Set(images.values())) URL.revokeObjectURL(url); };
  }, [file, path]);
  const local = localImages?.path === path && localImages.file === file ? localImages.urls : EMPTY_IMAGES;
  let title = path.split("/").at(-1)?.replace(/\.textpack$/i, "") || "Image";
  let legacyCaption = "";
  let source = "";
  let tags: string[] = [];
  let extraFields: TemplateDefinition["fields"] = [];
  let fieldValues: Record<string, DocumentFieldValue> = {};
  let images: Image[] = [];
  let imageAssetCount = 0;
  let size = 0;
  try {
    if (file?.path === path) {
      const document = readDocument(file);
      title = document.content.title || title;
      legacyCaption = document.content.body;
      source = typeof document.content.fields.sourceUrl === "string" ? document.content.fields.sourceUrl : "";
      tags = document.content.tags;
      fieldValues = document.content.fields;
      try { extraFields = readTemplate(file, document).fields.filter(field => field.visibility !== "hidden" && !["cover", "sourceUrl", "sourceLabel", "links"].includes(field.id)); }
      catch { extraFields = []; }
      imageAssetCount = document.content.assets.filter(asset => asset.kind === "image").length;
      images = document.content.assets.filter(asset => asset.kind === "image" && local.has(asset.src)).map(asset => ({ id: asset.id, url: local.get(asset.src)!, alt: asset.alt || title, caption: asset.caption, width: asset.width, height: asset.height }));
    }
  } catch { /* Show a readable error below while preserving the original file. */ }
  const image = images[Math.min(index, Math.max(0, images.length - 1))];
  const caption = image?.caption ?? (imageAssetCount === 1 ? legacyCaption : "");
  const sourceHref = sourceLink(source);
  useEffect(() => { setEditingCaption(false); setEditingTitle(false); setEditingSource(false); setEditingTags(false); setEditingField(""); setTagDraft(""); }, [path, index]);
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
    if (!tag || tags.some(value => value.toLocaleLowerCase() === tag.toLocaleLowerCase())) return false;
    if (await updateContent(content => ({ ...content, tags: [...content.tags, tag] }))) { setTagDraft(""); return true; }
    return false;
  };
  const saveField = async (field: TemplateDefinition["fields"][number]) => {
    let value: DocumentFieldValue = fieldDraft.trim();
    if (field.type === "number") {
      if (fieldDraft.trim() && !Number.isFinite(Number(fieldDraft))) { setError("Enter a valid number."); return; }
      value = fieldDraft.trim() ? Number(fieldDraft) : null;
    } else if (field.type === "url" && fieldDraft.trim() && !sourceLink(fieldDraft.trim())) {
      setError("Enter a web address beginning with http or https."); return;
    } else if (!fieldDraft.trim()) value = null;
    if (await updateContent(content => ({ ...content, fields: { ...content.fields, [field.id]: value } }))) setEditingField("");
  };
  const displayField = (value: DocumentFieldValue | undefined): string => {
    if (value == null || value === "") return "Not set";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (Array.isArray(value)) return value.every(item => typeof item === "string") ? value.join(", ") : `${value.length} entries`;
    return String(value);
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
      <header><button onClick={onClose} aria-label="Close image">‹ <span>Gallery</span></button><div className="vault-gallery-title">{editingTitle ? <form onSubmit={event => { event.preventDefault(); const next = titleDraft.trim(); if (!next) return; void updateContent(content => ({ ...content, title: next })).then(saved => { if (saved) setEditingTitle(false); }); }}><input autoFocus aria-label="Image title" value={titleDraft} onChange={event => setTitleDraft(event.target.value)} maxLength={240} disabled={updating} /><button type="button" onClick={() => setEditingTitle(false)} disabled={updating}>Cancel</button><button type="submit" disabled={updating || !titleDraft.trim()}>Save title</button></form> : <button className="vault-gallery-title-button" aria-label="Edit image title" title="Edit image title" disabled={updating || !file} onClick={() => { setTitleDraft(title); setEditingTitle(true); }}>{title}</button>}</div><button aria-label="Edit item" onClick={() => onEdit(path)} disabled={!file}>Edit</button></header>
      {error && <p role="alert">{error}</p>}
      {file?.path !== path && !error && <p role="status">Opening image…</p>}
      {file?.path === path && !images.length && <p role="status">This item has no embedded image to display. Open the item to inspect its contents.</p>}
      {image && <div className="vault-gallery-detail"><div className="vault-gallery-stage">
        {entries.length > 1 && <button aria-label="Previous image" disabled={selection === 0} onClick={previous}>‹</button>}
        {/* eslint-disable-next-line @next/next/no-img-element */}<img src={image.url} alt={image.alt} style={{ transform: `scale(${zoom})` }} />
        {entries.length > 1 && <button aria-label="Next image" disabled={selection >= entries.length - 1} onClick={next}>›</button>}
        <div className="vault-gallery-zoom" role="group" aria-label="Image zoom"><button aria-label="Zoom out" disabled={zoom <= 1} onClick={() => setZoom(value => Math.max(1, Math.round((value - .25) * 100) / 100))}>−</button><span>{Math.round(zoom * 100)}%</span><button aria-label="Zoom in" disabled={zoom >= 3} onClick={() => setZoom(value => Math.min(3, Math.round((value + .25) * 100) / 100))}>+</button><button aria-label="Fit image" disabled={zoom === 1} onClick={() => setZoom(1)}>Fit</button></div>
      </div><aside><dl>{(image.width || details.width) && (image.height || details.height) && <><dt>Dimensions</dt><dd>{image.width || details.width} × {image.height || details.height}</dd></>}{size > 0 && <><dt>Size</dt><dd>{size < 1024 ? `${size} B` : `${Math.round(size / 1024)} KB`}</dd></>}{entries.length > 1 && <><dt>Library image</dt><dd>{selection + 1} of {entries.length}</dd></>}</dl>
        <div className="vault-gallery-inspector-section vault-gallery-source-section"><div className="vault-gallery-inspector-heading"><h2>Source</h2>{sourceHref && !editingSource && <a className="vault-gallery-source" href={sourceHref} target="_blank" rel="noopener noreferrer" title={source}>{new URL(sourceHref).hostname.replace(/^www\./, "")}</a>}{!editingSource && <button aria-label="Edit image source" disabled={updating} onClick={() => { setSourceDraft(source); setEditingSource(true); }}>{source ? "Edit" : "Add source URL"}</button>}</div>{editingSource ? <form onSubmit={event => { event.preventDefault(); const next = sourceDraft.trim(); if (next && !sourceLink(next)) { setError("Enter a web address beginning with http or https, without a username or password."); return; } void updateContent(content => ({ ...content, fields: { ...content.fields, sourceUrl: next || null, sourceLabel: next || null, links: next ? [{ href: next, label: next }] : [] } })).then(saved => { if (saved) setEditingSource(false); }); }}><input autoFocus aria-label="Image source" type="url" value={sourceDraft} onChange={event => setSourceDraft(event.target.value)} placeholder="https://example.com" maxLength={4096} disabled={updating} /><div><button type="button" onClick={() => setEditingSource(false)} disabled={updating}>Cancel</button><button type="submit" disabled={updating}>Save source</button></div></form> : !sourceHref && source ? <p>{source}</p> : null}</div>
        <div className="vault-gallery-inspector-section"><div className="vault-gallery-inspector-heading"><h2>Caption</h2>{!editingCaption && <button aria-label="Edit caption" disabled={updating} onClick={() => { setCaptionDraft(caption); setEditingCaption(true); }}>{caption ? "Edit" : "Add caption"}</button>}</div>{editingCaption ? <form onSubmit={event => { event.preventDefault(); void updateContent(content => ({ ...content, assets: content.assets.map(asset => asset.id === image.id ? { ...asset, caption: captionDraft.trim() } : asset) })).then(saved => { if (saved) setEditingCaption(false); }); }}><textarea autoFocus aria-label="Image caption" value={captionDraft} onChange={event => setCaptionDraft(event.target.value)} maxLength={4000} disabled={updating} /><div><button type="button" onClick={() => setEditingCaption(false)} disabled={updating}>Cancel</button><button type="submit" disabled={updating}>Save caption</button></div></form> : caption ? <p>{caption}</p> : null}</div>
        <div className="vault-gallery-inspector-section"><div className="vault-gallery-inspector-heading"><h2>Tags</h2>{!editingTags && <button aria-label="Add image tag" disabled={updating} onClick={() => setEditingTags(true)}>+ Add</button>}</div><div className="vault-gallery-tags">{tags.map(tag => <button key={tag} aria-label={`Remove ${tag} tag`} disabled={updating} onClick={() => void updateContent(content => ({ ...content, tags: content.tags.filter(value => value !== tag) }))}>#{tag} ×</button>)}</div>{editingTags && <form className="vault-gallery-tag-form" onSubmit={event => { event.preventDefault(); void addTag().then(saved => { if (saved) setEditingTags(false); }); }}><input autoFocus aria-label="New image tag" value={tagDraft} onChange={event => setTagDraft(event.target.value)} placeholder="Add a tag" maxLength={41} disabled={updating} /><button type="button" onClick={() => setEditingTags(false)} disabled={updating}>Cancel</button><button type="submit" disabled={updating || !tagDraft.trim()}>Add</button></form>}</div>
        {extraFields.length > 0 && <div className="vault-gallery-inspector-section vault-gallery-extra-fields"><h2>Details</h2>{extraFields.map(field => {
          const value = fieldValues[field.id];
          const editable = ["text", "richtext", "url", "date", "number", "boolean"].includes(field.type) || field.type === "enum" && !field.multiple;
          return <div className="vault-gallery-extra-field" key={field.id}><div className="vault-gallery-inspector-heading"><h3>{field.label}</h3>{editable && editingField !== field.id && <button aria-label={`Edit ${field.label}`} disabled={updating} onClick={() => { setEditingField(field.id); setFieldDraft(value == null ? "" : String(value)); }}>Edit</button>}</div>{editingField === field.id ? field.type === "boolean" ? <div className="vault-gallery-field-actions"><button disabled={updating} onClick={() => void updateContent(content => ({ ...content, fields: { ...content.fields, [field.id]: !Boolean(value) } })).then(saved => { if (saved) setEditingField(""); })}>{value ? "Set to No" : "Set to Yes"}</button><button onClick={() => setEditingField("")}>Cancel</button></div> : <form onSubmit={event => { event.preventDefault(); void saveField(field); }}>{field.type === "enum" ? <select aria-label={field.label} value={fieldDraft} onChange={event => setFieldDraft(event.target.value)} disabled={updating}><option value="">Not set</option>{field.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : field.type === "richtext" ? <textarea aria-label={field.label} value={fieldDraft} onChange={event => setFieldDraft(event.target.value)} disabled={updating} /> : <input aria-label={field.label} type={field.type === "date" ? "date" : field.type === "number" ? "number" : field.type === "url" ? "url" : "text"} value={fieldDraft} onChange={event => setFieldDraft(event.target.value)} disabled={updating} />}<div className="vault-gallery-field-actions"><button type="button" onClick={() => setEditingField("")}>Cancel</button><button type="submit" disabled={updating}>Save</button></div></form> : <p>{displayField(value)}</p>}</div>;
        })}</div>}
        {details.colors.length > 0 && <div className="vault-gallery-colors vault-gallery-inspector-section" aria-label="Image colors"><h2>Colors</h2><div>{details.colors.map(color => <span key={color} title={color} aria-label={color} style={{ backgroundColor: color }} />)}</div></div>}</aside></div>}
    </div>
  </section>, shell);
}
