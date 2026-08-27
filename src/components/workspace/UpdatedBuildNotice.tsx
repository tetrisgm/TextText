"use client";

// "This page is out of date" — said once, quietly, by the page itself.
//
// A Mac window keeps the bundle it loaded, so a deploy never reaches an app
// that is already open. On 2026-08-27 a fix shipped at 12:33, the deployed
// artifact demonstrably contained it, and a window open since before that was
// still showing the old behaviour at 14:15. The person reported a fixed bug as
// broken, which was entirely fair: nothing on screen could have told them.
//
// Deliberately quiet. It checks when the window is brought back to the front,
// which is when a person returns to an app they left open, and otherwise on a
// slow timer. It never reloads on its own: a reload during writing would throw
// away whatever is not yet saved, and this is not urgent enough to take that
// risk on someone's behalf.

import { useCallback, useEffect, useState } from "react";
import {
  RUNNING_BUILD_ID,
  compareBuild,
  comparableBuild,
} from "@/lib/deployed-build";

/** Slow: this is a courtesy, not a heartbeat. */
const CHECK_EVERY_MS = 10 * 60 * 1000;

export function UpdatedBuildNotice() {
  const [stale, setStale] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const check = useCallback(async () => {
    if (!comparableBuild(RUNNING_BUILD_ID)) return;
    try {
      const response = await fetch("/api/app/build", { cache: "no-store" });
      if (!response.ok) return;
      const answer = await response.json();
      if (compareBuild(RUNNING_BUILD_ID, answer).state === "stale") {
        setStale(true);
      }
    } catch {
      // Offline, or the origin is between deployments. Say nothing.
    }
  }, []);

  useEffect(() => {
    if (!comparableBuild(RUNNING_BUILD_ID)) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    void check();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    const timer = window.setInterval(() => void check(), CHECK_EVERY_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.clearInterval(timer);
    };
  }, [check]);

  if (!stale || dismissed) return null;

  return (
    <div className="workspace-build-notice" role="status">
      <span>TextText updated since you opened this.</span>
      <button type="button" onClick={() => window.location.reload()}>
        Reload
      </button>
      <button
        type="button"
        className="workspace-build-notice-dismiss"
        aria-label="Dismiss update notice"
        onClick={() => setDismissed(true)}
      >
        Not now
      </button>
    </div>
  );
}
