"use client";

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { DocumentAsset } from "@/lib/documents/model";
import { isSafeLinkHref } from "@/lib/content";

function safeMediaSource(value: string | undefined): string {
  const source = value?.trim() ?? "";
  if (source.startsWith("/") || source.startsWith("blob:")) return source;
  return isSafeLinkHref(source) && !source.toLowerCase().startsWith("mailto:") ? source : "";
}

function assetLabel(asset: DocumentAsset, index: number): string {
  return asset.alt?.trim() || asset.caption?.trim() || `Image ${index + 1}`;
}

/** The preview is inert so a folder card remains a single link and never starts media. */
export function DocumentGallery({
  assets,
  columns,
  nodeId,
  preview = false,
}: {
  assets: DocumentAsset[];
  columns: number;
  nodeId?: string;
  preview?: boolean;
}) {
  const visible = assets.flatMap((asset) => {
    const source = safeMediaSource(asset.src);
    if (!source || (asset.kind !== "image" && asset.kind !== "video")) return [];
    return [{ ...asset, source, still: safeMediaSource(asset.poster) || source }];
  });
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const [naturalSize, setNaturalSize] = useState<{ id: string; width: number; height: number } | null>(null);
  const viewerOpen = selectedIndex !== null;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const selected = selectedIndex === null ? null : visible[selectedIndex] ?? null;
  const width = selected?.width ?? (naturalSize && naturalSize.id === selected?.id ? naturalSize.width : undefined);
  const height = selected?.height ?? (naturalSize && naturalSize.id === selected?.id ? naturalSize.height : undefined);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !viewerOpen) return;
    dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [viewerOpen]);

  if (visible.length === 0) return null;

  const move = (step: number) => {
    if (selectedIndex === null) return;
    setZoomed(false);
    setNaturalSize(null);
    setSelectedIndex((selectedIndex + step + visible.length) % visible.length);
  };
  const onViewerKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      move(event.key === "ArrowLeft" ? -1 : 1);
    }
  };

  return (
    <div data-tt-node={nodeId} className="tt-gallery" style={{ "--tt-gallery-columns": columns } as CSSProperties}>
      {visible.map((asset, index) => (
        <figure key={asset.id}>
          {asset.kind === "video" && !preview ? (
            <video src={asset.source} poster={safeMediaSource(asset.poster) || undefined} controls playsInline preload="none" />
          ) : asset.kind === "video" && !safeMediaSource(asset.poster) ? (
            <span className="tt-media-still" aria-label={asset.caption || "Video"} />
          ) : preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={asset.still} alt={asset.alt ?? asset.caption ?? ""} loading="lazy" decoding="async" width={asset.width} height={asset.height} />
          ) : (
            <button type="button" className="tt-gallery-open" aria-label={`View ${assetLabel(asset, index)}`} onClick={(event) => {
              openerRef.current = event.currentTarget;
              setZoomed(false);
              setNaturalSize(null);
              setSelectedIndex(index);
            }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={asset.still} alt={asset.alt ?? asset.caption ?? ""} loading="lazy" decoding="async" width={asset.width} height={asset.height} />
            </button>
          )}
          {asset.caption && <figcaption>{asset.caption}</figcaption>}
        </figure>
      ))}
      {!preview && (
        <dialog ref={dialogRef} className="tt-gallery-viewer" aria-label="Image viewer" onKeyDown={onViewerKeyDown} onClose={() => {
          setSelectedIndex(null);
          setZoomed(false);
          requestAnimationFrame(() => openerRef.current?.isConnected && openerRef.current.focus());
        }} onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }}>
          {selected && (
            <div className="tt-gallery-viewer-content">
              <div className="tt-gallery-viewer-toolbar">
                <span>{selectedIndex! + 1} of {visible.length}</span>
                <div>
                  {selected.kind === "image" && <button type="button" onClick={() => setZoomed(!zoomed)}>{zoomed ? "Fit" : "Zoom"}</button>}
                  <button type="button" onClick={() => dialogRef.current?.close()} aria-label="Close image viewer">Close</button>
                </div>
              </div>
              <div className={`tt-gallery-viewer-stage${zoomed ? " is-zoomed" : ""}`}>
                {selected.kind === "video" ? (
                  <video key={selected.id} src={selected.source} poster={safeMediaSource(selected.poster) || undefined} controls playsInline preload="metadata" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={selected.id} src={selected.source} alt={selected.alt ?? selected.caption ?? ""} onLoad={(event) => setNaturalSize({
                    id: selected.id,
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight,
                  })} />
                )}
              </div>
              <div className="tt-gallery-viewer-footer">
                <div>
                  {selected.caption && <p>{selected.caption}</p>}
                  {width && height && <span>{width} × {height} px</span>}
                  <a href={selected.source} target="_blank" rel="noopener noreferrer">Open original</a>
                </div>
                {visible.length > 1 && <div className="tt-gallery-viewer-navigation">
                  <button type="button" onClick={() => move(-1)} aria-label="Previous image">←</button>
                  <button type="button" onClick={() => move(1)} aria-label="Next image">→</button>
                </div>}
              </div>
            </div>
          )}
        </dialog>
      )}
    </div>
  );
}
