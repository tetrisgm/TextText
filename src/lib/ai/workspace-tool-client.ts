"use client";

import type { WorkspaceToolInput, WorkspaceToolName } from "@/lib/ai/tools";

type ToolResult = Record<string, unknown>;

export async function executeWorkspaceToolRequest<
  Name extends WorkspaceToolName,
>(
  handle: string,
  name: Name,
  args: WorkspaceToolInput<Name>,
): Promise<ToolResult> {
  const response = await fetch("/api/ai/tools", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ handle, name, args }),
  });
  const payload = (await response.json().catch(() => null)) as {
    result?: unknown;
    error?: unknown;
  } | null;
  if (!response.ok) {
    throw new Error(
      typeof payload?.error === "string"
        ? payload.error
        : "The workspace command failed. Try again.",
    );
  }
  if (!payload?.result || typeof payload.result !== "object") {
    return {};
  }
  return payload.result as ToolResult;
}
