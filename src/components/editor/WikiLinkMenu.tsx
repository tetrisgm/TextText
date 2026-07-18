"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  SuggestionKeyDownProps,
  SuggestionProps,
} from "@tiptap/suggestion";

export type WikiLinkCommandItem = {
  id: string;
  kind: "post" | "create";
  slug?: string;
  title: string;
  query: string;
};

export type WikiLinkMenuProps = SuggestionProps<WikiLinkCommandItem> & {
  onClose: () => void;
};

export type WikiLinkMenuHandle = {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
};

const MENU_WIDTH = 288;
const MENU_GAP = 8;
const VIEWPORT_PADDING = 8;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export const WikiLinkMenu = forwardRef<WikiLinkMenuHandle, WikiLinkMenuProps>(
  function WikiLinkMenu({ items, command, clientRect, onClose }, ref) {
    const menuRef = useRef<HTMLDivElement>(null);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [position, setPosition] = useState({
      left: VIEWPORT_PADDING,
      top: VIEWPORT_PADDING,
    });
    const itemKey = useMemo(
      () => items.map((item) => item.id).join("|"),
      [items],
    );

    const updatePosition = () => {
      const rect = clientRect();
      if (!rect) return;
      const width = menuRef.current?.offsetWidth || MENU_WIDTH;
      const height = menuRef.current?.offsetHeight || 0;
      const left = clamp(
        rect.left,
        VIEWPORT_PADDING,
        Math.max(VIEWPORT_PADDING, window.innerWidth - width - VIEWPORT_PADDING),
      );
      const roomBelow = window.innerHeight - rect.bottom - VIEWPORT_PADDING;
      const top =
        height > 0 && roomBelow < height + MENU_GAP
          ? clamp(rect.top - height - MENU_GAP, VIEWPORT_PADDING, window.innerHeight)
          : clamp(rect.bottom + MENU_GAP, VIEWPORT_PADDING, window.innerHeight);
      setPosition((current) =>
        current.left === left && current.top === top ? current : { left, top },
      );
    };

    useLayoutEffect(() => {
      updatePosition();
      const frame = window.requestAnimationFrame(updatePosition);
      return () => window.cancelAnimationFrame(frame);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [itemKey]);

    useEffect(() => setSelectedIndex(0), [itemKey]);
    useEffect(() => {
      setSelectedIndex((index) =>
        items.length === 0 ? 0 : Math.min(index, items.length - 1),
      );
    }, [items.length]);

    const runSelected = () => {
      const item = items[selectedIndex];
      if (item) command(item);
    };

    useImperativeHandle(
      ref,
      () => ({
        onKeyDown: ({ event }) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            event.stopPropagation();
            if (items.length > 0) {
              const delta = event.key === "ArrowDown" ? 1 : -1;
              setSelectedIndex(
                (index) => (index + delta + items.length) % items.length,
              );
            }
            return true;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            runSelected();
            return true;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
            return true;
          }
          return false;
        },
      }),
      [items, onClose, selectedIndex],
    );

    return (
      <div
        ref={menuRef}
        className="slash-command-menu wiki-link-menu"
        data-post-edit-menu-open="true"
        style={position}
        role="listbox"
        aria-label="Note links"
        aria-activedescendant={items[selectedIndex]?.id}
      >
        {items.map((item, index) => (
          <button
            key={item.id}
            id={item.id}
            type="button"
            className={`slash-command-item${
              index === selectedIndex ? " is-selected" : ""
            }`}
            role="option"
            aria-selected={index === selectedIndex}
            onMouseEnter={() => setSelectedIndex(index)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => command(item)}
          >
            <span className="slash-command-icon" aria-hidden="true">
              {item.kind === "create" ? "+" : "[["}
            </span>
            <span className="slash-command-copy">
              <span className="slash-command-label">
                {item.kind === "create" ? `Create ${item.title}` : item.title}
              </span>
              <span className="slash-command-hint">
                {item.kind === "create" ? "Create note" : item.slug}
              </span>
            </span>
          </button>
        ))}
      </div>
    );
  },
);
