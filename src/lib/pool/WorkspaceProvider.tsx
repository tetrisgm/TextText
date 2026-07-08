"use client";

import { useEffect, useRef, type ReactNode } from "react";
import {
  hydrateWorkspacePoolFromStorage,
  refreshWorkspacePool,
  seedWorkspacePool,
} from "@/lib/pool/store";
import type {
  WorkspaceInitialBody,
  WorkspacePoolPayload,
} from "@/lib/pool/types";

export function WorkspaceProvider({
  children,
  initialBody,
  initialPool,
}: {
  children: ReactNode;
  initialBody?: WorkspaceInitialBody | null;
  initialPool: WorkspacePoolPayload;
}) {
  const seededRef = useRef(false);
  if (!seededRef.current && typeof window !== "undefined") {
    seededRef.current = true;
    seedWorkspacePool(initialPool, initialBody);
  }

  useEffect(() => {
    let cancelled = false;
    void hydrateWorkspacePoolFromStorage(initialPool.blogId).then(() => {
      if (!cancelled) {
        void refreshWorkspacePool(initialPool.blog.handle, initialPool.blogId);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [initialPool.blog.handle, initialPool.blogId]);

  return <>{children}</>;
}
