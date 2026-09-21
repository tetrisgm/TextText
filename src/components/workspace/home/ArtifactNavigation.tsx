"use client";

import type { ReactNode } from "react";

export type ArtifactPane = "home" | "news" | "bookmarks" | "headlines" | "notes" | "profile";

export function artifactPaneFromSearch(search: string): ArtifactPane {
  const pane = new URLSearchParams(search).get("pane");
  return pane === "news" || pane === "bookmarks" || pane === "headlines" || pane === "profile" || pane === "notes" ? pane : "home";
}

export function ArtifactIcon({ name }: { name: "home" | "headlines" | "notes" | "profile" | "search" | "bell" | "bookmark" | "history" | "settings" | "folder" }) {
  const shapes: Record<typeof name, ReactNode> = {
    home: <><path d="m3 10 9-7 9 7v11h-6v-7H9v7H3Z" /></>,
    headlines: <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" /></>,
    profile: <><circle cx="12" cy="7" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2Z" /></>,
    notes: <><path d="M5 3h10l4 4v14H5Z" /><path d="M14 3v5h5M8 12h8M8 16h6" /></>,
    search: <><circle cx="10" cy="10" r="6" /><path d="m15 15 6 6" /></>,
    bell: <><path d="M5 10a7 7 0 0 1 14 0c0 7 3 7 3 7H2s3 0 3-7Z" /><path d="M9 21h6" /></>,
    bookmark: <path d="M6 3h12v19l-6-4-6 4Z" />,
    history: <><path d="M4 7v5h5M4 12a8 8 0 1 1 2 6" /><path d="M12 7v5l3 2" /></>,
    settings: <><circle cx="12" cy="12" r="4" /><path d="m9 2-1 3-3 1-3 3 2 3-1 4 3 3 4-1 3 2 3-2 1-4 3-2-1-4-3-2-4 1Z" /></>,
    folder: <path d="M3 5h7l2 3h9v12H3Z" />,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{shapes[name]}</svg>;
}

export function ArtifactNavigation({ pane, onSelect }: { pane: ArtifactPane; onSelect: (pane: ArtifactPane) => void }) {
  return <nav className="artifact-navigation" aria-label="Main navigation">
    {(["home", "news", "bookmarks", "notes", "profile"] as const).map((target) => <button
      key={target}
      type="button"
      aria-label={target === "home" ? "Home" : target === "news" ? "News" : target === "bookmarks" ? "Bookmarks" : target === "notes" ? "Writing" : "Profile"}
      aria-current={pane === target ? "page" : undefined}
      onClick={() => onSelect(target)}
    ><ArtifactIcon name={target === "news" ? "headlines" : target === "bookmarks" ? "bookmark" : target} /></button>)}
  </nav>;
}
