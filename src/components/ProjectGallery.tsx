"use client";

import { useCallback, useEffect, useState } from "react";
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
  onOpenImage,
}: {
  item: GalleryItem;
  title: string;
  onOpenImage: (image: LightboxImage) => void;
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
      />
    );
  }

  if (isVideoFile(item.src)) {
    return (
      <video
        src={item.src}
        poster={item.poster}
        controls
        playsInline
        preload="metadata"
      />
    );
  }

  return (
    <button
      type="button"
      className="proj-carousel-image-button"
      onClick={() => onOpenImage({ src: item.src, alt: caption || title })}
      aria-label="Open image"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={item.src} alt={caption || title} loading="lazy" draggable={false} />
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
  const [lightboxImage, setLightboxImage] = useState<LightboxImage | null>(null);

  const updateSelected = useCallback(() => {
    if (!emblaApi) return;
    setSelectedIndex(emblaApi.selectedScrollSnap());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    emblaApi.on("select", updateSelected);
    emblaApi.on("reInit", updateSelected);
    return () => {
      emblaApi.off("select", updateSelected);
      emblaApi.off("reInit", updateSelected);
    };
  }, [emblaApi, updateSelected]);

  useEffect(() => {
    if (!lightboxImage) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLightboxImage(null);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [lightboxImage]);

  const scrollPrev = useCallback(() => {
    emblaApi?.scrollPrev();
  }, [emblaApi]);

  const scrollNext = useCallback(() => {
    emblaApi?.scrollNext();
  }, [emblaApi]);

  const scrollTo = useCallback(
    (index: number) => {
      emblaApi?.scrollTo(index);
    },
    [emblaApi],
  );

  if (slideCount === 0) return null;

  return (
    <div
      className="proj-carousel"
      aria-roledescription="carousel"
      aria-label={`${post.title} media`}
    >
      <div className="proj-carousel-stage">
        {slideCount > 1 && (
          <>
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
          </>
        )}

        <div className="proj-carousel-viewport" ref={emblaRef}>
          <div className="proj-carousel-track">
            {slides.map((item, index) => (
              <div
                key={`${item.src}:${index}`}
                className="proj-carousel-slide"
                aria-roledescription="slide"
                aria-label={`${index + 1} of ${slideCount}`}
              >
                <div className="proj-carousel-card">
                  <div className="proj-carousel-stack">
                    <div className="proj-carousel-media">
                      <SlideMedia
                        item={item}
                        title={post.title}
                        onOpenImage={setLightboxImage}
                      />
                    </div>
                    {item.caption && (
                      <p className="proj-carousel-caption">{item.caption}</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {slideCount > 1 && (
          <div className="proj-carousel-status">
            <span className="proj-carousel-counter" aria-hidden="true">
              {selectedIndex + 1} / {slideCount}
            </span>
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
