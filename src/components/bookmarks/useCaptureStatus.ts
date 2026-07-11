"use client";

import { useEffect, useRef, useState } from "react";
import type { BookmarkCapture, CaptureStatus } from "@/lib/content";

const FIRST_POLL_MS = 3_000;
const MAX_POLL_MS = 12_000;
const MAX_POLL_DURATION_MS = 3 * 60 * 1_000;

type TerminalCaptureStatus = Exclude<CaptureStatus, "pending">;

export type CaptureStatusResponse = {
  captureStatus?: CaptureStatus | null;
  capture?: BookmarkCapture | null;
  cover?: string | null;
  updatedAt?: string | null;
  wordCount?: number | null;
};

function cleanCaptureStatus(value: unknown): CaptureStatus | undefined {
  if (value === "pending" || value === "captured" || value === "failed") {
    return value;
  }
  return undefined;
}

function nextDelay(attempt: number): number {
  return Math.min(FIRST_POLL_MS + attempt * 1_000, MAX_POLL_MS);
}

export function useCaptureStatus(
  itemId: string | undefined,
  initialStatus: CaptureStatus | undefined,
  options?: {
    onResolved?: (
      status: TerminalCaptureStatus,
      response: CaptureStatusResponse,
    ) => void;
  },
): CaptureStatus | undefined {
  const [resolvedStatus, setResolvedStatus] = useState<{
    initialStatus: CaptureStatus | undefined;
    itemId: string | undefined;
    status: CaptureStatus;
  } | null>(null);
  const captureStatus =
    resolvedStatus &&
    resolvedStatus.itemId === itemId &&
    resolvedStatus.initialStatus === initialStatus
      ? resolvedStatus.status
      : initialStatus;
  const onResolvedRef = useRef(options?.onResolved);

  useEffect(() => {
    onResolvedRef.current = options?.onResolved;
  }, [options?.onResolved]);

  useEffect(() => {
    if (!itemId || initialStatus !== "pending") return;

    let cancelled = false;
    let timeoutId: number | undefined;
    let attempt = 0;
    const startedAt = Date.now();

    const poll = async () => {
      if (cancelled) return;

      try {
        const response = await fetch(
          `/api/items/${encodeURIComponent(itemId)}/capture-status`,
          {
            cache: "no-store",
            credentials: "same-origin",
          },
        );

        if (response.ok) {
          const data = (await response.json()) as CaptureStatusResponse;
          const nextStatus = cleanCaptureStatus(data.captureStatus);
          if (nextStatus) {
            setResolvedStatus({ itemId, initialStatus, status: nextStatus });
            if (nextStatus !== "pending") {
              onResolvedRef.current?.(nextStatus, data);
              return;
            }
          }
        } else if (response.status === 403 || response.status === 404) {
          return;
        }
      } catch {
        // Transient network failures get another gentle poll until the cap.
      }

      if (Date.now() - startedAt >= MAX_POLL_DURATION_MS) return;
      attempt += 1;
      timeoutId = window.setTimeout(poll, nextDelay(attempt));
    };

    timeoutId = window.setTimeout(poll, FIRST_POLL_MS);

    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [initialStatus, itemId]);

  return captureStatus;
}
