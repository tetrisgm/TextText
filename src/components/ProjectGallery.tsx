"use client";

import {
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import useEmblaCarousel from "embla-carousel-react";
import { isTypingTarget } from "@/components/PostShortcuts";
import type { GalleryItem, Post } from "@/lib/content";
import { isVideoFile, isYouTube, youtubeEmbedUrl } from "@/lib/content";

type ProjectGalleryEdit = {
  uploading: boolean;
  uploadError: string | null;
  disabled?: boolean;
  disabledReason?: string;
  onAddMedia: (files: File[]) => void;
  onChange: (gallery: GalleryItem[]) => void;
};

const MEDIA_ACCEPT = "image/*,video/*";

function hasDraggedFiles(event: DragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer.types).includes("Files");
}

function tabIsVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

function Chevron({ direction }: { direction: "left" | "right" }) {
  const d = direction === "left" ? "M11 3L5 9L11 15" : "M5 3L11 9L5 15";

  return (
    <svg viewBox="0 0 16 18" fill="none" aria-hidden="true">
      <path
        d={d}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function isImageItem(item: GalleryItem): boolean {
  return !isVideoFile(item.src) && !isYouTube(item.src);
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 3L13 13M13 3L3 13"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M10 4.5v11M4.5 10h11"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function SlideMedia({
  item,
  title,
  isAutoplayStopped,
  onEnded,
  onOpenImage,
  onStopAutoplay,
  onLoaded,
}: {
  item: GalleryItem;
  title: string;
  isAutoplayStopped: () => boolean;
  onEnded: () => void;
  onOpenImage: () => void;
  onStopAutoplay: () => void;
  onLoaded: () => void;
}) {
  const caption = item.caption ?? "";

  if (isYouTube(item.src)) {
    const embedSrc = youtubeEmbedUrl(item.src);
    return (
      <iframe
        className="proj-carousel-iframe"
        src={embedSrc}
        title={caption || title}
        allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        onLoad={onLoaded}
      />
    );
  }

  if (isVideoFile(item.src)) {
    return (
      <video
        src={item.src}
        poster={item.poster}
        autoPlay
        controls
        muted
        playsInline
        preload="auto"
        onLoadedData={onLoaded}
        onEnded={() => {
          if (!isAutoplayStopped()) onEnded();
        }}
        onPointerDown={onStopAutoplay}
      />
    );
  }

  return (
    <button
      type="button"
      className="proj-carousel-image-button"
      onClick={() => {
        onStopAutoplay();
        onOpenImage();
      }}
      aria-label="Open image"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={item.src}
        alt={caption || title}
        loading="lazy"
        draggable={false}
        onLoad={onLoaded}
      />
    </button>
  );
}

export function ProjectGallery({
  post,
  edit,
}: {
  post: Post;
  edit?: ProjectGalleryEdit;
}) {
  const slides = useMemo(() => post.gallery ?? [], [post.gallery]);
  const slideCount = slides.length;
  const [emblaRef, emblaApi] = useEmblaCarousel({
    align: "center",
    loop: slideCount > 1,
    skipSnaps: false,
  });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);
  const [loadedSlides, setLoadedSlides] = useState<Set<number>>(() => new Set());
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [navPeek, setNavPeek] = useState(true);
  const [isDraggingMedia, setIsDraggingMedia] = useState(false);
  const addInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const autoplayStoppedRef = useRef(false);
  const autoplayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const imageSlideIndexes = useMemo(
    () =>
      slides.reduce<number[]>((indexes, item, index) => {
        if (isImageItem(item)) indexes.push(index);
        return indexes;
      }, []),
    [slides],
  );
  const activeLightboxIndex =
    lightboxIndex !== null &&
    slides[lightboxIndex] &&
    isImageItem(slides[lightboxIndex])
      ? lightboxIndex
      : null;
  const lightboxPosition =
    activeLightboxIndex === null
      ? -1
      : imageSlideIndexes.indexOf(activeLightboxIndex);
  const canLightboxPrev = lightboxPosition > 0;
  const canLightboxNext =
    lightboxPosition >= 0 && lightboxPosition < imageSlideIndexes.length - 1;
  const lightboxItem =
    activeLightboxIndex === null ? undefined : slides[activeLightboxIndex];
  const lightboxImage =
    lightboxItem && isImageItem(lightboxItem)
      ? {
          src: lightboxItem.src,
          alt: lightboxItem.caption || post.title,
        }
      : null;
  const uploadDisabled = Boolean(edit?.disabled);

  const clearAutoplayTimer = useCallback(() => {
    if (autoplayTimerRef.current !== null) {
      clearTimeout(autoplayTimerRef.current);
      autoplayTimerRef.current = null;
    }
  }, []);

  const stopAutoplay = useCallback(() => {
    autoplayStoppedRef.current = true;
    clearAutoplayTimer();
  }, [clearAutoplayTimer]);

  const isAutoplayStopped = useCallback(
    () => autoplayStoppedRef.current || !tabIsVisible(),
    [],
  );

  const markLoaded = useCallback((index: number) => {
    setLoadedSlides((previous) => {
      if (previous.has(index)) return previous;
      const next = new Set(previous);
      next.add(index);
      return next;
    });
  }, []);

  const updateSelected = useCallback(() => {
    if (!emblaApi) return;
    setSelectedIndex(emblaApi.selectedScrollSnap());
    setCanPrev(slideCount > 1 && emblaApi.canScrollPrev());
    setCanNext(slideCount > 1 && emblaApi.canScrollNext());
  }, [emblaApi, slideCount]);

  useEffect(() => {
    if (!emblaApi) return;
    const frame = window.requestAnimationFrame(updateSelected);
    emblaApi.on("select", updateSelected);
    emblaApi.on("reInit", updateSelected);
    emblaApi.on("pointerDown", stopAutoplay);
    return () => {
      window.cancelAnimationFrame(frame);
      emblaApi.off("select", updateSelected);
      emblaApi.off("reInit", updateSelected);
      emblaApi.off("pointerDown", stopAutoplay);
    };
  }, [emblaApi, stopAutoplay, updateSelected]);

  useEffect(() => {
    const timeout = setTimeout(() => setNavPeek(false), 1800);
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!emblaApi || slideCount < 2) return;

    const advance = () => {
      if (autoplayStoppedRef.current) return;
      if (!tabIsVisible()) return;
      emblaApi.scrollNext();
    };

    const scheduleForSlide = () => {
      clearAutoplayTimer();
      if (autoplayStoppedRef.current) return;
      if (!tabIsVisible()) return;

      const index = emblaApi.selectedScrollSnap();
      const slide = slides[index];
      if (!slide) return;

      if (isVideoFile(slide.src)) {
        const video = emblaApi.slideNodes()[index]?.querySelector("video");
        if (video) {
          try {
            video.currentTime = 0;
            void video.play();
          } catch {
            // Autoplay is best effort; the ended handler still owns advancement.
          }
        }
        return;
      }

      autoplayTimerRef.current = setTimeout(advance, 3000);
    };

    const onVisibilityChange = () => {
      if (!tabIsVisible()) {
        clearAutoplayTimer();
        for (const slide of emblaApi.slideNodes()) {
          slide.querySelector("video")?.pause();
        }
        return;
      }

      scheduleForSlide();
    };

    emblaApi.on("select", scheduleForSlide);
    emblaApi.on("reInit", scheduleForSlide);
    document.addEventListener("visibilitychange", onVisibilityChange);
    scheduleForSlide();

    return () => {
      emblaApi.off("select", scheduleForSlide);
      emblaApi.off("reInit", scheduleForSlide);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearAutoplayTimer();
    };
  }, [clearAutoplayTimer, emblaApi, slideCount, slides]);

  const advanceFromVideo = useCallback(() => {
    if (autoplayStoppedRef.current) return;
    if (!tabIsVisible()) return;
    emblaApi?.scrollNext();
  }, [emblaApi]);

  const scrollPrev = useCallback(() => {
    stopAutoplay();
    emblaApi?.scrollPrev();
  }, [emblaApi, stopAutoplay]);

  const scrollNext = useCallback(() => {
    stopAutoplay();
    emblaApi?.scrollNext();
  }, [emblaApi, stopAutoplay]);

  const scrollTo = useCallback(
    (index: number) => {
      stopAutoplay();
      emblaApi?.scrollTo(index);
    },
    [emblaApi, stopAutoplay],
  );

  const openLightbox = useCallback(
    (index: number) => {
      stopAutoplay();
      setLightboxIndex(index);
    },
    [stopAutoplay],
  );

  const moveLightbox = useCallback(
    (direction: -1 | 1) => {
      if (activeLightboxIndex === null) return;
      const currentPosition = imageSlideIndexes.indexOf(activeLightboxIndex);
      const targetIndex = imageSlideIndexes[currentPosition + direction];
      if (targetIndex === undefined) return;
      stopAutoplay();
      setLightboxIndex(targetIndex);
      emblaApi?.scrollTo(targetIndex);
    },
    [activeLightboxIndex, emblaApi, imageSlideIndexes, stopAutoplay],
  );

  useEffect(() => {
    if (!emblaApi || slideCount < 2 || activeLightboxIndex !== null) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

      event.preventDefault();
      if (event.key === "ArrowLeft") {
        scrollPrev();
      } else {
        scrollNext();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeLightboxIndex, emblaApi, scrollNext, scrollPrev, slideCount]);

  useEffect(() => {
    if (activeLightboxIndex === null) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setLightboxIndex(null);
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        moveLightbox(-1);
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        moveLightbox(1);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeLightboxIndex, moveLightbox]);

  const addMedia = useCallback(
    (files: FileList | null) => {
      if (uploadDisabled) return;
      const next = Array.from(files ?? []);
      if (next.length > 0) edit?.onAddMedia(next);
    },
    [edit, uploadDisabled],
  );

  const openFilePicker = useCallback(() => {
    if (edit?.uploading || uploadDisabled) return;
    addInputRef.current?.click();
  }, [edit?.uploading, uploadDisabled]);

  const clearMediaDrag = useCallback(() => {
    dragDepthRef.current = 0;
    setIsDraggingMedia(false);
  }, []);

  const handleMediaDragEnter = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (!edit || uploadDisabled || !hasDraggedFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      dragDepthRef.current += 1;
      setIsDraggingMedia(true);
    },
    [edit, uploadDisabled],
  );

  const handleMediaDragOver = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (!edit || uploadDisabled || !hasDraggedFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = edit.uploading ? "none" : "copy";
      setIsDraggingMedia(true);
    },
    [edit, uploadDisabled],
  );

  const handleMediaDragLeave = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (!edit || uploadDisabled || !hasDraggedFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setIsDraggingMedia(false);
    },
    [edit, uploadDisabled],
  );

  const handleMediaDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (!edit || uploadDisabled || !hasDraggedFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      const files = event.dataTransfer.files;
      clearMediaDrag();
      if (!edit.uploading) addMedia(files);
    },
    [addMedia, clearMediaDrag, edit, uploadDisabled],
  );

  const handleEmptyKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openFilePicker();
    },
    [openFilePicker],
  );

  const updateSlide = useCallback(
    (index: number, patch: Partial<GalleryItem>) => {
      if (!edit) return;
      edit.onChange(
        slides.map((item, itemIndex) =>
          itemIndex === index ? { ...item, ...patch } : item,
        ),
      );
    },
    [edit, slides],
  );

  const moveSlide = useCallback(
    (index: number, direction: -1 | 1) => {
      if (!edit) return;
      const target = index + direction;
      if (target < 0 || target >= slides.length) return;
      const next = [...slides];
      const [item] = next.splice(index, 1);
      if (!item) return;
      next.splice(target, 0, item);
      edit.onChange(next);
      window.requestAnimationFrame(() => emblaApi?.scrollTo(target));
    },
    [edit, emblaApi, slides],
  );

  const removeSlide = useCallback(
    (index: number) => {
      if (!edit) return;
      edit.onChange(slides.filter((_, itemIndex) => itemIndex !== index));
    },
    [edit, slides],
  );

  if (slideCount === 0) {
    if (!edit) return null;

    return (
      <div
        className={
          "proj-gallery-empty applecms" +
          (isDraggingMedia ? " is-dragging-media" : "") +
          (edit.uploading ? " is-uploading" : "") +
          (uploadDisabled ? " is-disabled" : "")
        }
        role="button"
        tabIndex={edit.uploading || uploadDisabled ? -1 : 0}
        aria-label={uploadDisabled ? "Claim to add media" : "Add photos or video"}
        aria-disabled={edit.uploading || uploadDisabled}
        onClick={openFilePicker}
        onKeyDown={handleEmptyKeyDown}
        onDragEnter={handleMediaDragEnter}
        onDragOver={handleMediaDragOver}
        onDragLeave={handleMediaDragLeave}
        onDrop={handleMediaDrop}
        onDragEnd={clearMediaDrag}
      >
        <input
          ref={addInputRef}
          type="file"
          accept={MEDIA_ACCEPT}
          multiple
          hidden
          onChange={(event) => {
            addMedia(event.currentTarget.files);
            event.currentTarget.value = "";
          }}
        />
        <span className="proj-gallery-empty-copy">
          <span className="proj-gallery-empty-icon">
            <PlusIcon />
          </span>
          <span className="proj-gallery-empty-title">
            {edit.uploading
              ? "Uploading"
              : uploadDisabled
                ? "Claim to add media"
                : "Add photos or video"}
          </span>
          <span className="proj-gallery-empty-subtitle">
            {edit.uploading
              ? "Adding media"
              : uploadDisabled
                ? (edit.disabledReason ?? "Sign in to keep uploads recoverable.")
                : "Drop files here or click to choose"}
          </span>
        </span>
        {edit.uploadError && (
          <span className="proj-gallery-error" role="alert">
            {edit.uploadError}
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      className={
        "proj-carousel with-thumbs" +
        (navPeek ? " nav-peek" : "") +
        (edit ? " is-editing" : "") +
        (isDraggingMedia ? " is-dragging-media" : "")
      }
      aria-roledescription="carousel"
      aria-label={`${post.title} media`}
      onDragEnter={handleMediaDragEnter}
      onDragOver={handleMediaDragOver}
      onDragLeave={handleMediaDragLeave}
      onDrop={handleMediaDrop}
      onDragEnd={clearMediaDrag}
    >
      {edit && (
        <div className="proj-gallery-edit-bar applecms">
          <input
            ref={addInputRef}
            type="file"
            accept={MEDIA_ACCEPT}
            multiple
            hidden
            onChange={(event) => {
              addMedia(event.currentTarget.files);
              event.currentTarget.value = "";
            }}
          />
          <button
            type="button"
            className="proj-gallery-add ac-btn ac-btn-gray"
            disabled={edit.uploading || uploadDisabled}
            onClick={openFilePicker}
          >
            {edit.uploading
              ? "Uploading"
              : uploadDisabled
                ? "Claim to add media"
                : "Add media"}
          </button>
          {uploadDisabled && edit.disabledReason && (
            <span className="proj-gallery-limit-note">
              {edit.disabledReason}
            </span>
          )}
          {edit.uploadError && (
            <span className="proj-gallery-error" role="alert">
              {edit.uploadError}
            </span>
          )}
        </div>
      )}
      {edit && isDraggingMedia && (
        <div className="proj-gallery-drop-overlay" aria-hidden="true">
          <span>Drop to add</span>
        </div>
      )}
      <div className="proj-carousel-stage">
        {canPrev && (
          <button
            type="button"
            className="proj-carousel-nav prev"
            aria-label="Previous slide"
            onClick={scrollPrev}
          >
            <span className="proj-carousel-nav-icon">
              <Chevron direction="left" />
            </span>
          </button>
        )}
        {canNext && (
          <button
            type="button"
            className="proj-carousel-nav next"
            aria-label="Next slide"
            onClick={scrollNext}
          >
            <span className="proj-carousel-nav-icon">
              <Chevron direction="right" />
            </span>
          </button>
        )}

        <div className="proj-carousel-viewport" ref={emblaRef}>
          <div className="proj-carousel-track">
            {slides.map((item, index) => {
              const isLoaded = loadedSlides.has(index);
              return (
                <div
                  key={`${item.src}:${index}`}
                  className="proj-carousel-slide"
                  aria-roledescription="slide"
                  aria-label={`${index + 1} of ${slideCount}`}
                >
                  <div className="proj-carousel-card">
                    <div className="proj-carousel-stack">
                      <div
                        className={
                          "proj-carousel-media" + (isLoaded ? " is-loaded" : "")
                        }
                      >
                        <SlideMedia
                          item={item}
                          title={post.title}
                          isAutoplayStopped={isAutoplayStopped}
                          onEnded={advanceFromVideo}
                          onOpenImage={() => openLightbox(index)}
                          onStopAutoplay={stopAutoplay}
                          onLoaded={() => markLoaded(index)}
                        />
                        {!isLoaded && (
                          <div
                            className="proj-carousel-skeleton"
                            aria-hidden="true"
                          />
                        )}
                      </div>
                      {edit ? (
                        <div className="proj-gallery-item-editor applecms">
                          <div className="proj-gallery-item-actions">
                            <button
                              type="button"
                              className="ac-btn ac-btn-gray"
                              disabled={index === 0}
                              onClick={() => moveSlide(index, -1)}
                            >
                              Prev
                            </button>
                            <button
                              type="button"
                              className="ac-btn ac-btn-gray"
                              disabled={index === slideCount - 1}
                              onClick={() => moveSlide(index, 1)}
                            >
                              Next
                            </button>
                            <button
                              type="button"
                              className="ac-btn ac-btn-plain ac-danger"
                              onClick={() => removeSlide(index)}
                            >
                              Remove
                            </button>
                          </div>
                          <input
                            className="proj-gallery-caption-input"
                            value={item.caption ?? ""}
                            placeholder="Add caption"
                            aria-label={`Caption for image ${index + 1}`}
                            onChange={(event) =>
                              updateSlide(index, {
                                caption: event.currentTarget.value || undefined,
                              })
                            }
                          />
                        </div>
                      ) : (
                        item.caption && (
                          <p className="proj-carousel-caption">
                            {item.caption}
                          </p>
                        )
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {slideCount > 1 && (
          <div className="proj-carousel-status">
            <div
              className="proj-carousel-dots"
              role="tablist"
              aria-label="Slides"
            >
              {slides.map((_, index) => (
                <button
                  key={index}
                  type="button"
                  className={
                    "proj-carousel-dot" +
                    (index === selectedIndex ? " active" : "")
                  }
                  aria-label={`Go to slide ${index + 1}`}
                  aria-selected={index === selectedIndex}
                  role="tab"
                  onClick={() => scrollTo(index)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {lightboxImage &&
        createPortal(
          <div
            className="media-lightbox"
            role="dialog"
            aria-modal="true"
            aria-label="Expanded image"
            onClick={() => setLightboxIndex(null)}
          >
            <button
              type="button"
              className="media-lightbox-close"
              onClick={() => setLightboxIndex(null)}
              aria-label="Close"
            >
              <CloseIcon />
            </button>
            <button
              type="button"
              className="media-lightbox-nav prev"
              aria-label="Previous image"
              disabled={!canLightboxPrev}
              onClick={(event) => {
                event.stopPropagation();
                moveLightbox(-1);
              }}
            >
              <Chevron direction="left" />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="media-lightbox-img"
              src={lightboxImage.src}
              alt={lightboxImage.alt}
              onClick={(event) => event.stopPropagation()}
            />
            <button
              type="button"
              className="media-lightbox-nav next"
              aria-label="Next image"
              disabled={!canLightboxNext}
              onClick={(event) => {
                event.stopPropagation();
                moveLightbox(1);
              }}
            >
              <Chevron direction="right" />
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}
