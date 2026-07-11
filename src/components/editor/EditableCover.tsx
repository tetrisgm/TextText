"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useEscapeLayer } from "@/components/keyboard/CommandLayer";
import { isVideoFile } from "@/lib/content";

export const COVER_HEIGHT_MIN = 220;
export const COVER_HEIGHT_MAX = 760;
const COVER_HEIGHT_STEP = 24;

function clampCoverHeight(value: number): number {
  return Math.min(COVER_HEIGHT_MAX, Math.max(COVER_HEIGHT_MIN, Math.round(value)));
}

export function randomCover(
  covers: readonly string[],
  currentCover: string,
): string {
  const available = covers.filter((cover) => cover !== currentCover);
  const pile = available.length > 0 ? available : covers;
  return pile[Math.floor(Math.random() * pile.length)] ?? covers[0] ?? "";
}

export function EditableCover({
  title,
  cover,
  covers,
  coverHeight,
  mediaEnabled,
  uploading,
  error,
  onSelectCover,
  onCoverHeightChange,
  onUploadFile,
  onRemoveCover,
}: {
  title: string;
  cover: string;
  covers: readonly string[];
  coverHeight: number | null;
  mediaEnabled: boolean;
  uploading: boolean;
  error: string | null;
  onSelectCover: (cover: string) => void;
  onCoverHeightChange: (height: number) => void;
  onUploadFile: (file: File) => void;
  onRemoveCover: () => void;
}) {
  const figureRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pickerGridRef = useRef<HTMLDivElement>(null);
  const pickerSheetRef = useRef<HTMLElement>(null);
  const pickerTriggerRef = useRef<HTMLButtonElement>(null);
  const pickerWasOpenRef = useRef(false);
  const [draggingCover, setDraggingCover] = useState(false);
  const [resizingCover, setResizingCover] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  useEscapeLayer(pickerOpen, "Header image picker", () => setPickerOpen(false));

  useEffect(() => {
    if (!pickerOpen) return;
    const frame = window.requestAnimationFrame(() => {
      const selected = pickerGridRef.current?.querySelector<HTMLButtonElement>(
        ".cover-picker-card.is-selected",
      );
      const first = pickerGridRef.current?.querySelector<HTMLButtonElement>(
        ".cover-picker-card",
      );
      (selected ?? first)?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pickerOpen]);

  useEffect(() => {
    if (pickerOpen) {
      pickerWasOpenRef.current = true;
      return;
    }
    if (!pickerWasOpenRef.current) return;
    pickerWasOpenRef.current = false;
    const frame = window.requestAnimationFrame(() => {
      pickerTriggerRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pickerOpen]);

  const chooseFile = (files: FileList | null) => {
    if (!mediaEnabled) return;
    const file = files
      ? Array.from(files).find((item) => item.type.startsWith("image/"))
      : undefined;
    if (!file) return;
    setPickerOpen(false);
    onUploadFile(file);
  };
  const shuffle = () => {
    const next = randomCover(covers, cover);
    if (next) onSelectCover(next);
  };
  const hasCoverDrop = (event: DragEvent<HTMLElement>) =>
    Array.from(event.dataTransfer.types).includes("Files");
  const onCoverDrag = (event: DragEvent<HTMLElement>) => {
    if (!mediaEnabled || !hasCoverDrop(event)) return;
    event.preventDefault();
    if (uploading) return;
    event.dataTransfer.dropEffect = "copy";
    setDraggingCover(true);
  };
  const onCoverDragLeave = (event: DragEvent<HTMLElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setDraggingCover(false);
  };
  const onCoverDrop = (event: DragEvent<HTMLElement>) => {
    if (!mediaEnabled || !hasCoverDrop(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setDraggingCover(false);
    if (!uploading) chooseFile(event.dataTransfer.files);
  };
  const onResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const media = figureRef.current?.querySelector<HTMLElement>(".edit-cover-media");
    if (!media) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const startHeight = media.getBoundingClientRect().height;
    setResizingCover(true);
    const onPointerMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      onCoverHeightChange(clampCoverHeight(startHeight + moveEvent.clientY - startY));
    };
    const onPointerUp = () => {
      setResizingCover(false);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
    window.addEventListener("pointercancel", onPointerUp, { once: true });
  };
  const onResizeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const currentHeight =
      coverHeight ??
      figureRef.current
        ?.querySelector<HTMLElement>(".edit-cover-media")
        ?.getBoundingClientRect().height ??
      420;
    const step = event.shiftKey ? COVER_HEIGHT_STEP * 2 : COVER_HEIGHT_STEP;
    if (event.key === "ArrowUp") {
      event.preventDefault();
      onCoverHeightChange(clampCoverHeight(currentHeight - step));
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      onCoverHeightChange(clampCoverHeight(currentHeight + step));
    } else if (event.key === "Home") {
      event.preventDefault();
      onCoverHeightChange(COVER_HEIGHT_MIN);
    } else if (event.key === "End") {
      event.preventDefault();
      onCoverHeightChange(COVER_HEIGHT_MAX);
    }
  };
  const coverStyle = coverHeight
    ? ({ "--reader-cover-height": `${coverHeight}px` } as CSSProperties)
    : undefined;

  return (
    <>
      <figure
        ref={figureRef}
        className={`reader-cover edit-cover applecms${
          draggingCover ? " is-dragging-cover" : ""
        }${uploading ? " is-uploading-cover" : ""}${
          resizingCover ? " is-resizing-cover" : ""
        }`}
        style={coverStyle}
        onDragEnter={onCoverDrag}
        onDragOver={onCoverDrag}
        onDragLeave={onCoverDragLeave}
        onDrop={onCoverDrop}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            chooseFile(event.currentTarget.files);
            event.currentTarget.value = "";
          }}
        />
        <div className="edit-cover-media">
          {isVideoFile(cover) ? (
            <video src={cover} controls playsInline preload="metadata" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cover} alt={title} />
          )}
          <div className="edit-cover-drop-hint" aria-hidden="true">
            {mediaEnabled ? "Drop to replace image" : "Choose a local image"}
          </div>
          <div className="edit-cover-toolbar">
            <button
              ref={pickerTriggerRef}
              type="button"
              className="edit-cover-action"
              disabled={uploading}
              onClick={() => setPickerOpen(true)}
            >
              Choose image
            </button>
            <button
              type="button"
              className="edit-cover-action"
              disabled={uploading}
              onClick={shuffle}
            >
              Shuffle
            </button>
            <button
              type="button"
              className="edit-cover-action"
              disabled={uploading || !mediaEnabled}
              onClick={() => inputRef.current?.click()}
            >
              {uploading ? "Uploading" : "Upload"}
            </button>
            <button
              type="button"
              className="edit-cover-action"
              disabled={uploading}
              onClick={onRemoveCover}
            >
              Remove
            </button>
          </div>
          <div
            role="separator"
            tabIndex={0}
            className="edit-cover-resize-handle"
            aria-label="Resize header image"
            aria-orientation="horizontal"
            aria-valuemin={COVER_HEIGHT_MIN}
            aria-valuemax={COVER_HEIGHT_MAX}
            aria-valuenow={Math.round(coverHeight ?? 420)}
            onPointerDown={onResizePointerDown}
            onKeyDown={onResizeKeyDown}
          >
            <span aria-hidden="true" />
          </div>
        </div>
        {error && (
          <span className="edit-cover-error" role="alert">
            {error}
          </span>
        )}
      </figure>
      {pickerOpen && (
        <div
          className="cover-picker-backdrop applecms"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPickerOpen(false);
          }}
        >
          <section
            ref={pickerSheetRef}
            className="cover-picker-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cover-picker-title"
            onKeyDown={(event) => {
              if (event.key !== "Tab") return;
              const focusable = Array.from(
                pickerSheetRef.current?.querySelectorAll<HTMLButtonElement>(
                  "button:not(:disabled)",
                ) ?? [],
              );
              const first = focusable[0];
              const last = focusable.at(-1);
              if (!first || !last) return;
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
              }
            }}
          >
            <header className="cover-picker-header">
              <h2 id="cover-picker-title">Choose a header image</h2>
              <div className="cover-picker-actions">
                <button
                  type="button"
                  className="cover-picker-secondary"
                  onClick={shuffle}
                >
                  Shuffle
                </button>
                <button
                  type="button"
                  className="cover-picker-secondary"
                  disabled={!mediaEnabled || uploading}
                  onClick={() => inputRef.current?.click()}
                >
                  Upload
                </button>
                <button
                  type="button"
                  className="cover-picker-secondary"
                  onClick={() => setPickerOpen(false)}
                >
                  Close
                </button>
              </div>
            </header>
            <div ref={pickerGridRef} className="cover-picker-grid">
              {covers.map((candidate, index) => (
                <button
                  key={candidate}
                  type="button"
                  className={`cover-picker-card${
                    candidate === cover ? " is-selected" : ""
                  }`}
                  aria-label={`Use header image ${index + 1}`}
                  aria-pressed={candidate === cover}
                  onClick={() => {
                    onSelectCover(candidate);
                    setPickerOpen(false);
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={candidate} alt="" loading="lazy" decoding="async" />
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
