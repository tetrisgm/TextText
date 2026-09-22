"use client";

import { Activity, useState, type ReactNode } from "react";

/** Visit once, then retain UI state while hidden effects and subscriptions stop. */
export function RetainedWorkspacePane({ active, children }: { active: boolean; children: ReactNode }) {
  const [visited, setVisited] = useState(active);
  if (active && !visited) setVisited(true);
  if (!active && !visited) return null;
  return <Activity mode={active ? "visible" : "hidden"}>{children}</Activity>;
}
