"use client";

import { useLayoutEffect, type ReactNode } from "react";
import {
  seedWorkspacePool,
} from "@/lib/pool/store";
import type {
  WorkspaceInitialDocument,
  WorkspacePoolPayload,
} from "@/lib/pool/types";

export function WorkspaceProvider({
  children,
  initialDocument,
  initialPool,
}: {
  children: ReactNode;
  initialDocument?: WorkspaceInitialDocument | null;
  initialPool: WorkspacePoolPayload;
}) {
  useLayoutEffect(() => {
    seedWorkspacePool(initialPool, initialDocument);
  }, [initialDocument, initialPool]);

  return <>{children}</>;
}
