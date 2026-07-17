"use client";

import { ShortcutTooltip } from "@/components/keyboard/ShortcutTooltip";

function SearchIcon() {
  return (
    <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="4.75" stroke="currentColor" strokeWidth="1.55" />
      <path
        d="m11.6 11.6 3.1 3.1"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.55"
      />
    </svg>
  );
}

export function WorkspaceSearchButton({
  onSearch,
}: {
  onSearch: () => void;
}) {
  return (
    <ShortcutTooltip label="Search" keys="/" placement="bottom">
      <button
        type="button"
        className="workspace-search-action ac-icon-btn"
        aria-label="Search"
        aria-keyshortcuts="/"
        onClick={onSearch}
      >
        <SearchIcon />
      </button>
    </ShortcutTooltip>
  );
}
