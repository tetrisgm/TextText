"use client";

// Mounts the Notion-style workspace menu at the sidebar's top-left. The
// sidebar is a pure client tree used by many pages, so instead of threading
// the account email through every page's props, this wrapper asks the
// session endpoint once on mount. Signed out (or still resolving) renders
// the classic home link fallback, so guests see exactly the old chrome.

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { WorkspaceMenu } from "./WorkspaceMenu";

type SessionUser = { email?: string | null } | null;

export function WorkspaceMenuMount({
  blogName,
  settingsHref,
  fallback,
}: {
  blogName: string;
  settingsHref: string;
  fallback: ReactNode;
}) {
  const [user, setUser] = useState<SessionUser>(null);
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

  if (!user) return <>{fallback}</>;
  return (
    <WorkspaceMenu
      blogName={blogName}
      email={user.email ?? null}
      settingsHref={settingsHref}
    />
  );
}
