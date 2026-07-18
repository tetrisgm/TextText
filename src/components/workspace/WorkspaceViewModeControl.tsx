"use client";

import { useCallback, useSyncExternalStore } from "react";
import { ShortcutTooltip } from "@/components/keyboard/ShortcutTooltip";

export type WorkspaceViewMode = "list" | "column" | "grid";

const VIEW_MODE_EVENT = "write:workspace-view-mode-changed";

export const WORKSPACE_VIEW_MODE_LABELS: Record<WorkspaceViewMode, string> = {
  list: "List",
  column: "One column",
  grid: "Grid",
};

function validWorkspaceViewMode(
  value: string | null,
): value is WorkspaceViewMode {
  return value === "list" || value === "column" || value === "grid";
}

export function useWorkspaceViewMode(
  id: string,
  defaultMode: WorkspaceViewMode,
): [WorkspaceViewMode, (mode: WorkspaceViewMode) => void] {
  const key = id.startsWith("folder:")
    ? `write:folder-view:${id.slice("folder:".length)}`
    : `write:workspace-view:${id}`;
  const subscribe = useCallback((notify: () => void) => {
    window.addEventListener("storage", notify);
    window.addEventListener(VIEW_MODE_EVENT, notify);
    return () => {
      window.removeEventListener("storage", notify);
      window.removeEventListener(VIEW_MODE_EVENT, notify);
    };
  }, []);
  const getSnapshot = useCallback(() => {
    const saved = window.localStorage.getItem(key);
    return validWorkspaceViewMode(saved) ? saved : defaultMode;
  }, [defaultMode, key]);
  const viewMode = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => defaultMode,
  );
  const changeView = useCallback(
    (mode: WorkspaceViewMode) => {
      window.localStorage.setItem(key, mode);
      window.dispatchEvent(new Event(VIEW_MODE_EVENT));
    },
    [key],
  );
  return [viewMode, changeView];
}

function ViewModeIcon({ mode }: { mode: WorkspaceViewMode }) {
  if (mode === "list") {
    return (
      <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <path d="M3 5h12M3 9h12M3 13h12" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
      </svg>
    );
  }
  if (mode === "column") {
    return (
      <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <rect x="4" y="3" width="10" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
        <path d="M6.5 6h5M6.5 9h5M6.5 12h3.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.2" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="10" y="3" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="3" y="10" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="10" y="10" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

export function WorkspaceViewModeControl({
  mode,
  onChange,
}: {
  mode: WorkspaceViewMode;
  onChange: (mode: WorkspaceViewMode) => void;
}) {
  return (
    <div className="workspace-view-segmented" role="group" aria-label="View mode">
      {(Object.keys(WORKSPACE_VIEW_MODE_LABELS) as WorkspaceViewMode[]).map(
        (candidate) => (
          <ShortcutTooltip
            key={candidate}
            label={WORKSPACE_VIEW_MODE_LABELS[candidate]}
            placement="bottom"
          >
            <button
              type="button"
              className="workspace-view-segmented-button"
              aria-label={WORKSPACE_VIEW_MODE_LABELS[candidate]}
              aria-pressed={mode === candidate}
              onClick={() => onChange(candidate)}
            >
              <ViewModeIcon mode={candidate} />
            </button>
          </ShortcutTooltip>
        ),
      )}
    </div>
  );
}
