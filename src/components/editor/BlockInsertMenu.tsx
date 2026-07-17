"use client";

import type { Editor, Range } from "@tiptap/core";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  commandItems,
  runCommand,
} from "@/components/editor/SlashCommand";

export type BlockInsertPosition = {
  left: number;
  top: number;
};

export function BlockInsertMenu({
  editor,
  mediaEnabled,
  onChooseImage,
  onClose,
  position,
}: {
  editor: Editor;
  mediaEnabled: boolean;
  onChooseImage: () => void;
  onClose: () => void;
  position: BlockInsertPosition;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const items = useMemo(() => commandItems(mediaEnabled), [mediaEnabled]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !menuRef.current?.contains(event.target)
      ) {
        onClose();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        editor.commands.focus();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((index) => (index + 1) % items.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((index) => (index - 1 + items.length) % items.length);
        return;
      }
      if (event.key === "Enter") {
        const item = items[selectedIndex];
        if (!item) return;
        event.preventDefault();
        choose(item);
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  });

  const choose = (item: (typeof items)[number]) => {
    const range: Range = {
      from: editor.state.selection.from,
      to: editor.state.selection.to,
    };
    runCommand({ editor, range, item, onChooseImage });
    onClose();
  };

  return (
    <div
      ref={menuRef}
      className="block-insert-menu slash-command-menu applecms"
      data-post-edit-menu-open="true"
      style={{ left: position.left, position: "absolute", top: position.top }}
      role="listbox"
      aria-label="Insert block"
      aria-activedescendant={items[selectedIndex]?.id.replace("slash", "insert")}
    >
      {items.map((item, index) => (
        <button
          key={item.id}
          id={item.id.replace("slash", "insert")}
          type="button"
          className={`slash-command-item${
            selectedIndex === index ? " is-selected" : ""
          }`}
          role="option"
          aria-selected={selectedIndex === index}
          onMouseEnter={() => setSelectedIndex(index)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => choose(item)}
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
}
