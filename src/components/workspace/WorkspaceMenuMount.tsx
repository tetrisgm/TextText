"use client";

// Mounts the Notion-style workspace menu at the sidebar's top-left. The
// sidebar is a pure client tree used by many pages, so instead of threading
// the account email through every page's props, this wrapper asks the
// session endpoint once on mount. Signed out (or still resolving) renders
// the classic home link fallback, so guests see exactly the old chrome.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { updateBlogNameAction } from "@/app/editor/actions";
import { updateWorkspaceBlog } from "@/lib/pool/store";
import { ShareDialog } from "./ShareDialog";
import { WorkspaceMenu } from "./WorkspaceMenu";

type SessionUser = { email?: string | null } | null;

export function WorkspaceMenuMount({
  blogName,
  canManageSharing = false,
  handle,
  onHome,
}: {
  blogName: string;
  canManageSharing?: boolean;
  handle: string;
  onHome?: () => void;
}) {
  const [user, setUser] = useState<SessionUser>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [name, setName] = useState(blogName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const inNativeApp = useSyncExternalStore(
    () => () => {},
    () =>
      document.cookie.split(";").some((part) => part.trim() === "wr_app=1") ||
      "__TAURI_INTERNALS__" in window,
    () => false,
  );
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/session")
      .then((response) => (response.ok ? response.json() : null))
      .then((session) => {
        if (!cancelled) setUser(session?.user ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const openSettings = () => setSettingsOpen(true);
    window.addEventListener("write:open-workspace-settings", openSettings);
    return () =>
      window.removeEventListener("write:open-workspace-settings", openSettings);
  }, []);

  useEffect(() => {
    if (!settingsOpen) return;
    window.requestAnimationFrame(() => {
      nameRef.current?.focus({ preventScroll: true });
      nameRef.current?.select();
    });
  }, [settingsOpen]);

  const saveSettings = () => {
    const clean = name.trim().replace(/\s+/g, " ");
    if (!clean || saving) return;
    setSaving(true);
    setError(null);
    void updateBlogNameAction(handle, clean)
      .then((result) => {
        if (!result.ok) throw new Error(result.error);
        updateWorkspaceBlog({ name: result.name });
        setName(result.name);
        setSettingsOpen(false);
      })
      .catch((saveError) => {
        setError(saveError instanceof Error ? saveError.message : "Could not save");
      })
      .finally(() => setSaving(false));
  };

  return (
    <>
      <WorkspaceMenu
        blogName={name}
        email={user?.email ?? null}
        inNativeApp={inNativeApp}
        onHome={onHome}
        onInvite={user && canManageSharing ? () => setMembersOpen(true) : undefined}
        onSettings={() => setSettingsOpen(true)}
        signedIn={Boolean(user)}
      />
      {user && (
        <ShareDialog
          handle={handle}
          scopeType="workspace"
          scopeId="workspace"
          title="Members"
          subtitle={blogName}
          open={membersOpen}
          onClose={() => setMembersOpen(false)}
        />
      )}
      {settingsOpen && (
        <div
          className="workspace-settings-backdrop applecms"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSettingsOpen(false);
          }}
        >
          <form
            className="workspace-settings-dialog ac-chrome"
            role="dialog"
            aria-modal="true"
            aria-labelledby="workspace-settings-title"
            onSubmit={(event) => {
              event.preventDefault();
              saveSettings();
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setSettingsOpen(false);
              }
            }}
          >
            <header>
              <h2 id="workspace-settings-title">Workspace settings</h2>
              <button
                type="button"
                className="ac-icon-btn"
                aria-label="Close settings"
                onClick={() => setSettingsOpen(false)}
              >
                ×
              </button>
            </header>
            <label className="workspace-settings-field">
              <span>Name</span>
              <input
                ref={nameRef}
                value={name}
                maxLength={80}
                onChange={(event) => setName(event.currentTarget.value)}
              />
            </label>
            {error && <p className="post-folder-error" role="alert">{error}</p>}
            <footer>
              <button
                type="button"
                className="ac-btn ac-btn-gray"
                onClick={() => setSettingsOpen(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="ac-btn ac-btn-filled"
                disabled={!name.trim() || saving}
              >
                {saving ? "Saving" : "Save"}
              </button>
            </footer>
          </form>
        </div>
      )}
    </>
  );
}
