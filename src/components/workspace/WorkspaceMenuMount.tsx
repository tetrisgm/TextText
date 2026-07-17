"use client";

// Mounts the workspace menu at the sidebar's top-left. The
// sidebar is a pure client tree used by many pages, so instead of threading
// the account email through every page's props, this wrapper asks the
// session endpoint once on mount.

import { useEffect, useState, useSyncExternalStore } from "react";
import { ShareDialog } from "./ShareDialog";
import { WorkspaceMenu } from "./WorkspaceMenu";

type SessionUser = { email?: string | null } | null;

export function WorkspaceMenuMount({
  blogName,
  canManageSharing = false,
  handle,
  onSettings,
}: {
  blogName: string;
  canManageSharing?: boolean;
  handle: string;
  onSettings?: () => void;
}) {
  const [user, setUser] = useState<SessionUser>(null);
  const [membersOpen, setMembersOpen] = useState(false);
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

  return (
    <>
      <WorkspaceMenu
        blogName={blogName}
        email={user?.email ?? null}
        inNativeApp={inNativeApp}
        onInvite={user && canManageSharing ? () => setMembersOpen(true) : undefined}
        onSettings={onSettings}
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
    </>
  );
}
