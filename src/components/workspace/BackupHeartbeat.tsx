"use client";

import { useEffect } from "react";

/**
 * The app is its own scheduler. Opening the workspace asks the server to run
 * the GitHub backup if its schedule says one is owed; the server decides, and
 * a workspace with no schedule answers "not due" in one cheap query.
 */
export function BackupHeartbeat({ handle, enabled }: { handle: string; enabled: boolean }) {
  useEffect(() => {
    if (!enabled) return;
    const key = `texttext-backup-tick:${handle}`;
    try {
      const last = Number(sessionStorage.getItem(key) ?? 0);
      if (Date.now() - last < 10 * 60 * 1000) return;
      sessionStorage.setItem(key, String(Date.now()));
    } catch {
      // Private mode: tick anyway.
    }
    void fetch("/api/github/backup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ handle, action: "tick" }) }).catch(() => undefined);
  }, [enabled, handle]);
  return null;
}
