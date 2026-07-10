"use client";

import type { ReactNode } from "react";

// A small hover/focus tooltip that shows an action's label and its keyboard
// shortcut. Keys come from the command registry (shortcutLabelForCommand) so the
// hint stays in sync with what actually fires. Styled in apple.css (.kbd-tip*),
// neutral tokens so it renders in both the reader and the editor chrome.
export function ShortcutTooltip({
  label,
  keys,
  placement = "top",
  className,
  children,
}: {
  label: string;
  keys?: string | null;
  placement?: "top" | "bottom";
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`kbd-tip-wrap${className ? ` ${className}` : ""}`}
      data-tip-placement={placement}
    >
      {children}
      <span className="kbd-tip" role="tooltip" aria-hidden="true">
        <span className="kbd-tip-label">{label}</span>
        {keys ? <kbd className="kbd-tip-key">{keys}</kbd> : null}
      </span>
    </span>
  );
}
