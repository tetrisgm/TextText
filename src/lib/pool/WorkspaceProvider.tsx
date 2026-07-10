"use client";

import { useLayoutEffect, type ReactNode } from "react";
import {
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
  useLayoutEffect(() => {
    seedWorkspacePool(initialPool, initialBody);
  }, [initialBody, initialPool]);

  return <>{children}</>;
}
