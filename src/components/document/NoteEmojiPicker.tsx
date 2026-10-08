"use client";

import { useRef, useState } from "react";
import { noteIcon } from "@/lib/note-icons";

const SUGGESTIONS = ["💡", "📌", "✍️", "📚", "🔗", "✨", "✅", "😀"];

export function NoteEmojiPicker({ onPick, onCancel }: { onPick: (emoji: string) => void; onCancel: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const insert = () => {
    const value = input.current?.value.trim() ?? "";
    if (!noteIcon(value)) {
      setError("Choose one emoji.");
      return;
    }
    onPick(value);
  };
  return <div className="tt-note-emoji-picker" role="group" aria-label="Choose emoji" onKeyDown={event => {
    if (event.key === "Escape") { event.preventDefault(); onCancel(); }
  }}>
    <div className="tt-note-emoji-choices">{SUGGESTIONS.map(emoji => <button type="button" key={emoji} aria-label={`Insert ${emoji}`} onClick={() => onPick(emoji)}>{emoji}</button>)}</div>
    <div className="tt-note-emoji-custom"><input ref={input} aria-label="Custom emoji" maxLength={16} placeholder="Another emoji" onChange={() => setError("")} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); insert(); } }} /><button type="button" onClick={insert}>Insert</button></div>
    {error && <span role="alert">{error}</span>}
  </div>;
}
