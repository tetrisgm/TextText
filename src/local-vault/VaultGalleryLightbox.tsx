import { useEffect, useMemo, useRef, useState } from "react";
import { useDialogFocus } from "@/components/accessibility/useDialogFocus";
import { useEscapeLayer } from "./LocalKeyboard";
import { vaultRequest, type VaultFile } from "./bridge";
import { readDocument } from "./model";

type Image = { id: string; url: string; alt: string; width?: number; height?: number };

type GalleryEntry = { path: string; index: number };

function imageColors(source: string): Promise<string[]> {
  return new Promise(resolve => {
    const sample = new Image();
    sample.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 48; canvas.height = 48;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) { resolve([]); return; }
        context.drawImage(sample, 0, 0, 48, 48);
        const pixels = context.getImageData(0, 0, 48, 48).data;
        const counts = new Map<string, number>();
        for (let offset = 0; offset < pixels.length; offset += 4) {
          if (pixels[offset + 3] < 128) continue;
          const color = [0, 1, 2].map(channel => Math.min(255, Math.round(pixels[offset + channel] / 32) * 32));
          const hex = `#${color.map(value => value.toString(16).padStart(2, "0")).join("")}`;
          counts.set(hex, (counts.get(hex) || 0) + 1);
        }
        resolve([...counts].sort((left, right) => right[1] - left[1]).slice(0, 5).map(([color]) => color));
      } catch { resolve([]); }
    };
    sample.onerror = () => resolve([]);
    sample.src = source;
  });
}

export function VaultGalleryLightbox({ entries, initialSelection, onClose, onEdit }: { entries: GalleryEntry[]; initialSelection: number; onClose: () => void; onEdit: (path: string) => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  const [file, setFile] = useState<VaultFile | null>(null);
  const [error, setError] = useState("");
  const [selection, setSelection] = useState(initialSelection);
  const [colors, setColors] = useState<string[]>([]);
  const chosen = entries[Math.min(selection, entries.length - 1)];
  const path = chosen?.path || "";
  const index = chosen?.index || 0;
  useEscapeLayer(true, "gallery-image", onClose);
  useDialogFocus(dialog, true);
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
  let images: Image[] = [];
  try {
    if (file?.path === path) {
      const document = readDocument(file);
      title = document.content.title || title;
      caption = document.content.body;
      images = document.content.assets.filter(asset => asset.kind === "image" && local.has(asset.src)).map(asset => ({ id: asset.id, url: local.get(asset.src)!, alt: asset.alt || title, width: asset.width, height: asset.height }));
    }
  } catch { /* Show a readable error below while preserving the original file. */ }
  const image = images[Math.min(index, Math.max(0, images.length - 1))];
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => setColors([]));
    if (image?.url) void imageColors(image.url).then(value => { if (active) setColors(value); });
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
  return <div className="vault-gallery-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialog} className="vault-gallery-lightbox" role="dialog" aria-modal="true" aria-label={title}>
      <header><button onClick={onClose} aria-label="Close image">✕</button><span>{title}</span><button onClick={() => onEdit(path)} disabled={!file}>Edit item</button></header>
      {error && <p role="alert">{error}</p>}
      {file?.path !== path && !error && <p role="status">Opening image…</p>}
      {file?.path === path && !images.length && <p role="status">This item has no embedded image to display. Open the item to inspect its contents.</p>}
      {image && <div className="vault-gallery-detail"><div className="vault-gallery-stage">
        {entries.length > 1 && <button aria-label="Previous image" disabled={selection === 0} onClick={previous}>‹</button>}
        {/* eslint-disable-next-line @next/next/no-img-element */}<img src={image.url} alt={image.alt} />
        {entries.length > 1 && <button aria-label="Next image" disabled={selection >= entries.length - 1} onClick={next}>›</button>}
      </div><aside><h2>{title}</h2>{caption && <p>{caption}</p>}{colors.length > 0 && <div className="vault-gallery-colors" aria-label="Image colors"><h3>Colors</h3><div>{colors.map(color => <span key={color} title={color} aria-label={color} style={{ backgroundColor: color }} />)}</div></div>}<dl>{entries.length > 1 && <><dt>Library image</dt><dd>{selection + 1} of {entries.length}</dd></>}{image.width && image.height && <><dt>Dimensions</dt><dd>{image.width} × {image.height}</dd></>}</dl></aside></div>}
    </div>
  </div>;
}
