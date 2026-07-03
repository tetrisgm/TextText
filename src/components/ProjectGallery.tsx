"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import useEmblaCarousel from "embla-carousel-react";
import type { GalleryItem, Post } from "@/lib/content";
import { isVideoFile, isYouTube, youtubeEmbedUrl } from "@/lib/content";

type LightboxImage = {
  src: string;
  alt: string;
};

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
  onOpenImage: (image: LightboxImage) => void;
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
        onOpenImage({ src: item.src, alt: caption || title });
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

export function ProjectGallery({ post }: { post: Post }) {
  const slides = post.gallery ?? [];
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
  const [lightboxImage, setLightboxImage] = useState<LightboxImage | null>(null);
  const [navPeek, setNavPeek] = useState(true);
  const autoplayStoppedRef = useRef(false);
  const autoplayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const isAutoplayStopped = useCallback(() => autoplayStoppedRef.current, []);

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
    updateSelected();
    emblaApi.on("select", updateSelected);
    emblaApi.on("reInit", updateSelected);
    emblaApi.on("pointerDown", stopAutoplay);
    return () => {
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
      emblaApi.scrollNext();
    };

    const scheduleForSlide = () => {
      clearAutoplayTimer();
      if (autoplayStoppedRef.current) return;

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

    emblaApi.on("select", scheduleForSlide);
    emblaApi.on("reInit", scheduleForSlide);
    scheduleForSlide();

    return () => {
      emblaApi.off("select", scheduleForSlide);
      emblaApi.off("reInit", scheduleForSlide);
      clearAutoplayTimer();
    };
  }, [clearAutoplayTimer, emblaApi, slideCount, slides]);

  useEffect(() => {
    if (!lightboxImage) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLightboxImage(null);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [lightboxImage]);

  const advanceFromVideo = useCallback(() => {
    if (autoplayStoppedRef.current) return;
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

  if (slideCount === 0) return null;

  return (
    <div
      className={"proj-carousel with-thumbs" + (navPeek ? " nav-peek" : "")}
      aria-roledescription="carousel"
      aria-label={`${post.title} media`}
    >
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
                          onOpenImage={setLightboxImage}
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
                      {item.caption && (
                        <p className="proj-carousel-caption">{item.caption}</p>
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
            onClick={() => setLightboxImage(null)}
          >
            <button
              type="button"
              className="media-lightbox-close"
              onClick={() => setLightboxImage(null)}
              aria-label="Close"
            >
              <CloseIcon />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="media-lightbox-img"
              src={lightboxImage.src}
              alt={lightboxImage.alt}
              onClick={(event) => event.stopPropagation()}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}
