"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import type { Blog } from "@/lib/content";
import { blogTagPath } from "@/lib/public-paths";
import { MAX_TAGS, normalizeTag, normalizeTags } from "@/lib/tags";
import styles from "./TagChips.module.css";

export function TagChips({
  tags,
  blog,
  hrefForTag,
  onOpenTag,
  className,
}: {
  tags?: string[];
  blog?: Pick<Blog, "handle" | "username">;
  hrefForTag?: (tag: string) => string;
  onOpenTag?: (tag: string) => void;
  className?: string;
}) {
  const normalized = normalizeTags(tags);
  if (normalized.length === 0) return null;
  return (
    <nav
      className={[styles.chips, className].filter(Boolean).join(" ")}
      aria-label="Tags"
    >
      {normalized.map((tag) =>
        onOpenTag ? (
          <button key={tag} type="button" onClick={() => onOpenTag(tag)}>
            #{tag}
          </button>
        ) : hrefForTag || blog ? (
          <Link
            key={tag}
            href={hrefForTag ? hrefForTag(tag) : blogTagPath(blog!, tag)}
            prefetch
          >
            #{tag}
          </Link>
        ) : (
          <span key={tag}>#{tag}</span>
        ),
      )}
    </nav>
  );
}

export function TagEditor({
  tags,
  suggestions,
  onChange,
  onOpenTag,
}: {
  tags?: string[];
  suggestions: string[];
  onChange: (tags: string[]) => void;
  onOpenTag?: (tag: string) => void;
}) {
  const current = normalizeTags(tags);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const candidate = normalizeTag(query);
  const existing = useMemo(
    () => new Set(current),
    [current],
  );
  const matches = useMemo(() => {
    const needle = candidate ?? "";
    return suggestions
      .flatMap((tag) => normalizeTags([tag]))
      .filter((tag, index, all) => all.indexOf(tag) === index)
      .filter((tag) => !existing.has(tag))
      .filter((tag) => !needle || tag.includes(needle))
      .slice(0, 8);
  }, [candidate, existing, suggestions]);
  const canCreate = Boolean(candidate && !existing.has(candidate));
  const options = [
    ...matches.map((tag) => ({ kind: "existing" as const, tag })),
    ...(canCreate && !matches.includes(candidate!)
      ? [{ kind: "create" as const, tag: candidate! }]
      : []),
  ];

  function add(tag: string) {
    if (current.length >= MAX_TAGS) return;
    onChange(normalizeTags([...current, tag]));
    setQuery("");
    setOpen(false);
    setActiveIndex(0);
  }

  function remove(tag: string) {
    onChange(current.filter((candidateTag) => candidateTag !== tag));
  }

  return (
    <div className={styles.editor}>
      <div className={styles.editorRow}>
        {current.map((tag) => (
          <span key={tag} className={styles.editChip}>
            <button type="button" onClick={() => onOpenTag?.(tag)}>
              #{tag}
            </button>
            <button
              type="button"
              className={styles.remove}
              aria-label={`Remove #${tag}`}
              onClick={() => remove(tag)}
            >
              ×
            </button>
          </span>
        ))}
        {current.length < MAX_TAGS && (
          <div className={styles.inputWrap}>
            <input
              value={query}
              placeholder="# Add tag"
              aria-label="Add tag"
              aria-autocomplete="list"
              aria-expanded={open && options.length > 0}
              onFocus={() => {
                if (blurTimer.current) clearTimeout(blurTimer.current);
                setOpen(true);
              }}
              onBlur={() => {
                blurTimer.current = setTimeout(() => setOpen(false), 100);
              }}
              onChange={(event) => {
                setQuery(event.target.value);
                setOpen(true);
                setActiveIndex(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" && options.length > 0) {
                  event.preventDefault();
                  setOpen(true);
                  setActiveIndex((index) => (index + 1) % options.length);
                } else if (event.key === "ArrowUp" && options.length > 0) {
                  event.preventDefault();
                  setOpen(true);
                  setActiveIndex(
                    (index) => (index - 1 + options.length) % options.length,
                  );
                } else if (event.key === "Enter" && candidate) {
                  event.preventDefault();
                  add(options[activeIndex]?.tag ?? candidate);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setOpen(false);
                  setQuery("");
                } else if (
                  event.key === "Backspace" &&
                  !query &&
                  current.length > 0
                ) {
                  remove(current.at(-1)!);
                }
              }}
            />
            {open && options.length > 0 && (
              <div className={styles.menu} role="listbox" aria-label="Tag options">
                {options.map((option, index) => (
                  <button
                    key={`${option.kind}:${option.tag}`}
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => add(option.tag)}
                  >
                    {option.kind === "create"
                      ? `Create #${option.tag}`
                      : `#${option.tag}`}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
