"use client";
import { useRef, useState } from "react";
import { noteIcon } from "@/lib/note-icons";
import { NoteEmojiPicker } from "./NoteEmojiPicker";
import "./note-icon.css";
export function NoteIconControl({ value, onChange }: { value: unknown; onChange: (icon: string) => void }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const icon = noteIcon(value);
  const close = () => { setOpen(false); button.current?.focus(); };
  return <div className="tt-note-icon-control">
    <button ref={button} type="button" aria-label={icon ? "Change card icon" : "Add card icon"} aria-expanded={open} onClick={() => setOpen(!open)}>{icon || "Add icon"}</button>
    {open && <div role="group" aria-label="Card icon" onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } }}><NoteEmojiPicker onPick={emoji => { const next = noteIcon(emoji); if (next) { onChange(next); close(); } }} onCancel={close}/>{icon && <button type="button" onClick={() => { onChange(""); close(); }}>Remove icon</button>}</div>}
  </div>;
}
export function NoteIcon({ value }: { value: unknown }) { const icon = noteIcon(value); return icon ? <span className="tt-note-icon" role="img" aria-label={`Card icon ${icon}`}>{icon}</span> : null; }
