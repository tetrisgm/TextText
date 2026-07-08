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

export type SlashCommandItem = {
  id: string;
  action:
    | "paragraph"
    | "heading1"
    | "heading2"
    | "heading3"
    | "bulletList"
    | "orderedList"
    | "taskList"
    | "blockquote"
    | "codeBlock"
    | "horizontalRule"
    | "image";
  label: string;
  hint: string;
  icon: string;
  aliases: string[];
};

export type SlashMenuProps = SuggestionProps<SlashCommandItem> & {
  onClose: () => void;
};

export type SlashMenuHandle = {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
};

type MenuPosition = {
  left: number;
  top: number;
};

const MENU_WIDTH = 288;
const MENU_GAP = 8;
const VIEWPORT_PADDING = 8;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function positionedFromRect(
  rect: DOMRect | null,
  menu: HTMLElement | null,
): MenuPosition {
  if (!rect) {
    return { left: VIEWPORT_PADDING, top: VIEWPORT_PADDING };
  }

  const width = menu?.offsetWidth || MENU_WIDTH;
  const height = menu?.offsetHeight || 0;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const left = clamp(
    rect.left,
    VIEWPORT_PADDING,
    Math.max(VIEWPORT_PADDING, viewportWidth - width - VIEWPORT_PADDING),
  );
  const roomBelow = viewportHeight - rect.bottom - VIEWPORT_PADDING;
  const shouldFlip = height > 0 && roomBelow < height + MENU_GAP;
  const top = shouldFlip
    ? clamp(
        rect.top - height - MENU_GAP,
        VIEWPORT_PADDING,
        Math.max(VIEWPORT_PADDING, viewportHeight - height - VIEWPORT_PADDING),
      )
    : clamp(
        rect.bottom + MENU_GAP,
        VIEWPORT_PADDING,
        Math.max(VIEWPORT_PADDING, viewportHeight - VIEWPORT_PADDING),
      );

  return { left, top };
}

export const SlashMenu = forwardRef<SlashMenuHandle, SlashMenuProps>(
  function SlashMenu({ items, command, clientRect, onClose }, ref) {
    const menuRef = useRef<HTMLDivElement>(null);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [position, setPosition] = useState<MenuPosition>({
      left: VIEWPORT_PADDING,
      top: VIEWPORT_PADDING,
    });
    const itemKey = useMemo(
      () => items.map((item) => item.id).join("|"),
      [items],
    );

    const updatePosition = () => {
      setPosition((prev) => {
        const next = positionedFromRect(clientRect(), menuRef.current);
        // Bail when unchanged: positionedFromRect returns a fresh object each
        // call, so without this equality check the no-dep layout effect below
        // re-renders forever (React error #185).
        return prev.left === next.left && prev.top === next.top ? prev : next;
      });
    };

    useLayoutEffect(() => {
      updatePosition();
      const frame = window.requestAnimationFrame(updatePosition);

      return () => window.cancelAnimationFrame(frame);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [itemKey]);

    useEffect(() => {
      setSelectedIndex(0);
    }, [itemKey]);

    useEffect(() => {
      setSelectedIndex((index) =>
        items.length === 0 ? 0 : Math.min(index, items.length - 1),
      );
    }, [items.length]);

    useEffect(() => {
      window.addEventListener("resize", updatePosition);
      window.addEventListener("scroll", updatePosition, true);

      return () => {
        window.removeEventListener("resize", updatePosition);
        window.removeEventListener("scroll", updatePosition, true);
      };
    });

    const runSelected = () => {
      const item = items[selectedIndex];
      if (item) command(item);
    };

    useImperativeHandle(
      ref,
      () => ({
        onKeyDown: ({ event }) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            event.stopPropagation();
            if (items.length > 0) {
              setSelectedIndex((index) => (index + 1) % items.length);
            }
            return true;
          }

          if (event.key === "ArrowUp") {
            event.preventDefault();
            event.stopPropagation();
            if (items.length > 0) {
              setSelectedIndex(
                (index) => (index - 1 + items.length) % items.length,
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
        className="slash-command-menu"
        data-post-edit-menu-open="true"
        style={{
          left: position.left,
          top: position.top,
        }}
        role="listbox"
        aria-label="Block commands"
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
              {item.icon}
            </span>
            <span className="slash-command-copy">
              <span className="slash-command-label">{item.label}</span>
              <span className="slash-command-hint">{item.hint}</span>
            </span>
          </button>
        ))}
      </div>
    );
  },
);
