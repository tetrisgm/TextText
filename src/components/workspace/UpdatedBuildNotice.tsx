"use client";

// A stale page reloads ITSELF - the person is never asked.
//
// A Mac window keeps the bundle it loaded, so a deploy never reaches an app
// that is already open. This used to show a "reload?" notice; the owner ruled
// that unacceptable (2026-09-02): the app must simply be current, the way a
// website is. So when a newer build is detected the page reloads at the first
// moment that cannot cost anyone anything:
//
//   - immediately, if the window is hidden (the reload is invisible, and the
//     next summon opens the new build), or
//   - once the person has been hands-off for a short idle window.
//
// Unsaved work is why this is safe rather than reckless: editors flush
// pending saves on pagehide (keepalive), and collaborative documents push
// their state continuously, so a reload at an idle moment loses nothing. The
// idle gate exists so the ground never shifts mid-thought - a reload happens
// between interactions, never during one.

import { useCallback, useEffect, useRef } from "react";
import {
  RUNNING_BUILD_ID,
  compareBuild,
  comparableBuild,
  markBuildStale,
} from "@/lib/deployed-build";

/** A tiny JSON fetch; frequent enough that a deploy reaches an app in
 * constant use within a minute, not within a coffee break. */
const CHECK_EVERY_MS = 60 * 1000;
/** Hands-off this long counts as between-thoughts. */
const IDLE_BEFORE_RELOAD_MS = 15 * 1000;

export function UpdatedBuildNotice() {
  const staleRef = useRef(false);
  const lastInputRef = useRef(0);
  const idleTimerRef = useRef<number | null>(null);

  const reloadNow = useCallback(() => {
    // pagehide flushes editor saves; nothing else to do here.
    window.location.reload();
  }, []);

  const scheduleIdleReload = useCallback(() => {
    if (idleTimerRef.current !== null) return;
    const tick = () => {
      idleTimerRef.current = null;
      if (!staleRef.current) return;
      if (document.visibilityState === "hidden") {
        reloadNow();
        return;
      }
      const idleFor = Date.now() - lastInputRef.current;
      if (idleFor >= IDLE_BEFORE_RELOAD_MS) {
        reloadNow();
        return;
      }
      idleTimerRef.current = window.setTimeout(
        tick,
        IDLE_BEFORE_RELOAD_MS - idleFor + 250,
      );
    };
    idleTimerRef.current = window.setTimeout(tick, 250);
  }, [reloadNow]);

  const check = useCallback(async () => {
    if (staleRef.current || !comparableBuild(RUNNING_BUILD_ID)) return;
    try {
      const response = await fetch("/api/app/build", { cache: "no-store" });
      if (!response.ok) return;
      const answer = await response.json();
      if (compareBuild(RUNNING_BUILD_ID, answer).state === "stale") {
        staleRef.current = true;
        // The shell turns the next navigation into a full-page load of the
        // new build; the idle/hidden reload below is the fallback for a
        // window nobody navigates in.
        markBuildStale();
        if (document.visibilityState === "hidden") reloadNow();
        else scheduleIdleReload();
      }
    } catch {
      // Offline, or the origin is between deployments. Say nothing.
    }
  }, [reloadNow, scheduleIdleReload]);

  useEffect(() => {
    if (!comparableBuild(RUNNING_BUILD_ID)) return;
    lastInputRef.current = Date.now();
    const noteInput = () => {
      lastInputRef.current = Date.now();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        // The invisible moment: reload a stale window while nobody watches.
        if (staleRef.current) reloadNow();
        return;
      }
      void check();
    };
    // No check on mount: a page that has just loaded came from the origin it
    // would be asking about, so it cannot be behind. The interesting moment is
    // returning to a window that has been sitting open.
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);
    window.addEventListener("keydown", noteInput, { capture: true, passive: true });
    window.addEventListener("pointerdown", noteInput, { capture: true, passive: true });
    window.addEventListener("wheel", noteInput, { capture: true, passive: true });
    const timer = window.setInterval(() => void check(), CHECK_EVERY_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
      window.removeEventListener("keydown", noteInput, { capture: true });
      window.removeEventListener("pointerdown", noteInput, { capture: true });
      window.removeEventListener("wheel", noteInput, { capture: true });
      window.clearInterval(timer);
      if (idleTimerRef.current !== null) {
        window.clearTimeout(idleTimerRef.current);
      }
    };
  }, [check, reloadNow]);

  return null;
}
