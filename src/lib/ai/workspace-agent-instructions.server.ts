// Server-only persistence for owner-authored assistant instructions.

import { and, eq, isNull } from "drizzle-orm";
import { auditInsertQuery } from "@/lib/audit";
import { db, executeAtomicBatch } from "@/lib/db/client";
import { blogs, workspaceAgentConfigs } from "@/lib/db/schema";
import { getUserIdBySub } from "@/lib/store";
import {
  buildWorkspaceAgentPrompt,
  cleanWorkspaceAgentSettings,
  EMPTY_WORKSPACE_AGENT_SETTINGS,
  safeWorkspaceAgentSettings,
  type WorkspaceAgentSettings,
} from "@/lib/ai/agent-instructions";

export async function getWorkspaceAgentSettings(
  blogId: string,
): Promise<WorkspaceAgentSettings> {
  if (!db) return EMPTY_WORKSPACE_AGENT_SETTINGS;
  const [row] = await db
    .select({
      instructions: workspaceAgentConfigs.instructions,
      skills: workspaceAgentConfigs.skills,
    })
    .from(workspaceAgentConfigs)
    .where(eq(workspaceAgentConfigs.blogId, blogId))
    .limit(1);
  return row ? safeWorkspaceAgentSettings(row) : EMPTY_WORKSPACE_AGENT_SETTINGS;
}

export async function saveWorkspaceAgentSettings(
  blogId: string,
  input: unknown,
  actorUserId: string,
): Promise<WorkspaceAgentSettings> {
  if (!db) throw new Error("Agent instructions need a configured database.");
  const settings = cleanWorkspaceAgentSettings(input);
  await executeAtomicBatch((database) => [
    database
      .insert(workspaceAgentConfigs)
      .values({ blogId, ...settings })
      .onConflictDoUpdate({
        target: workspaceAgentConfigs.blogId,
        set: { ...settings, updatedAt: new Date() },
      }),
    auditInsertQuery(
      {
        actorUserId,
        actorType: "human",
        actionName: "configure_agent_instructions",
        targetType: "workspace",
        targetId: blogId,
        inputSummary: `${settings.instructions.length} instruction characters, ${settings.skills.length} skills`,
      },
      database,
    ),
  ] as const);
  return settings;
}

export async function removeWorkspaceAgentSettings(
  blogId: string,
  actorUserId: string,
): Promise<void> {
  if (!db) throw new Error("Agent instructions need a configured database.");
  await executeAtomicBatch((database) => [
    database
      .delete(workspaceAgentConfigs)
      .where(eq(workspaceAgentConfigs.blogId, blogId)),
    auditInsertQuery(
      {
        actorUserId,
        actorType: "human",
        actionName: "remove_agent_instructions",
        targetType: "workspace",
        targetId: blogId,
      },
      database,
    ),
  ] as const);
}

function currentUserRequest(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || typeof message !== "object" || Array.isArray(message))
      continue;
    const record = message as Record<string, unknown>;
    if (record.role === "user" && typeof record.content === "string") {
      return record.content;
    }
  }
  return "";
}

/**
 * Owner-scoped prompt integration for /api/ai. A caller supplies the signed-in
 * subject, not a blog id, so a route cannot accidentally load instructions
 * from a workspace the caller merely collaborates on.
 */
export async function workspaceAgentPromptForOwner(
  sub: string,
  messages: unknown,
): Promise<string> {
  if (!db || !sub) return "";
  const userId = await getUserIdBySub(sub);
  if (!userId) return "";
  const [row] = await db
    .select({
      instructions: workspaceAgentConfigs.instructions,
      skills: workspaceAgentConfigs.skills,
    })
    .from(workspaceAgentConfigs)
    .innerJoin(blogs, eq(workspaceAgentConfigs.blogId, blogs.id))
    .where(and(eq(blogs.ownerId, userId), isNull(blogs.deletedAt)))
    .limit(1);
  return row
    ? buildWorkspaceAgentPrompt(row, currentUserRequest(messages))
    : "";
}
