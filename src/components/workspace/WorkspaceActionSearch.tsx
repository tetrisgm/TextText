"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { OPEN_COMMAND_PALETTE_EVENT } from "@/components/keyboard/CommandPalette";
import {
  SearchIcon,
  WorkspaceSearchButton,
} from "@/components/workspace/WorkspaceSearchButton";

const INLINE_SEARCH_MIN_WIDTH = 720;

function openSearchModal() {
  window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE_EVENT));
}

export function WorkspaceActionSearch({
  ariaLabel = "Search",
  focusRequestKey = 0,
  inputRef,
  onChange,
  onKeyDown,
  placeholder = "Search",
  value,
}: {
  ariaLabel?: string;
  focusRequestKey?: number;
  inputRef?: RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
  value: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const localInputRef = useRef<HTMLInputElement>(null);
  const [compact, setCompact] = useState(false);
  const [expanded, setExpanded] = useState(() => value.trim().length > 0);
  const searchVisible = expanded || value.trim().length > 0;

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const surface =
      host.closest<HTMLElement>(".post-editor-content") ??
      host.closest<HTMLElement>(".local-workspace-surface") ??
      document.documentElement;
    // The observer already carries the size; measuring inside its callback
    // forces layout and risks a resize loop.
    const apply = (width: number) => {
      setCompact(width < INLINE_SEARCH_MIN_WIDTH);
    };
    apply(surface.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (typeof width === "number") apply(width);
    });
    observer.observe(surface);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (focusRequestKey <= 0) return;
    const host = hostRef.current;
    if (!host || host.closest("[hidden]")) return;
    if (compact) {
      openSearchModal();
      return;
    }
    const revealFrame = window.requestAnimationFrame(() => {
      setExpanded(true);
      window.requestAnimationFrame(() => localInputRef.current?.focus());
    });
    return () => window.cancelAnimationFrame(revealFrame);
  }, [compact, focusRequestKey]);

  const setInput = (node: HTMLInputElement | null) => {
    localInputRef.current = node;
    if (inputRef) inputRef.current = node;
  };

  const revealInput = () => {
    setExpanded(true);
    window.requestAnimationFrame(() => localInputRef.current?.focus());
  };

  return (
    <div
      ref={hostRef}
      className={`workspace-action-search${compact ? " is-compact" : ""}${
        !compact && searchVisible ? " is-expanded" : ""
      }`}
    >
      {compact ? (
        <WorkspaceSearchButton onSearch={openSearchModal} />
      ) : !searchVisible ? (
        <div className="workspace-search-launcher">
          <kbd aria-hidden="true">/</kbd>
          <WorkspaceSearchButton onSearch={revealInput} />
        </div>
      ) : (
        <label className="workspace-search-field">
          <SearchIcon />
          <input
            ref={setInput}
            type="search"
            value={value}
            aria-label={ariaLabel}
            aria-keyshortcuts="/"
            placeholder={placeholder}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              onChange(event.currentTarget.value)
            }
            onBlur={() => {
              if (!value.trim()) setExpanded(false);
            }}
            onKeyDown={(event) => {
              onKeyDown?.(event);
              if (event.key === "Escape") setExpanded(false);
            }}
          />
          <kbd>/</kbd>
        </label>
      )}
    </div>
  );
}
