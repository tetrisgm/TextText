import { githubAppConfig, installationToken, listInstallationRepositories } from "@/lib/github/app.server";
import { restoreBackup, runBackup, runBackupIfDue, setBackupSettings, type BackupSchedule } from "@/lib/github/backup.server";
import { getCurrentUser } from "@/lib/session";
import { getBlogEditAccess } from "@/lib/blog-edit-auth";
import { getGithubInstallation } from "@/lib/store";
import { json, jsonError } from "../_shared";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function owner(handle: string) {
  const user = await getCurrentUser();
  if (!user) return { response: jsonError("Sign in first", 401) };
  const access = await getBlogEditAccess(handle);
  if (!access.canEdit || !access.isOwner || !access.ownerId || !access.blogId) return { response: jsonError("Only the workspace owner can manage backups", 403) };
  return { userId: access.ownerId, blogId: access.blogId };
}

/** GET ?handle= -> the repositories the installation can push to. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const handle = url.searchParams.get("handle")?.trim() ?? "";
  if (!handle) return jsonError("Missing workspace handle", 400);
  const who = await owner(handle);
  if ("response" in who) return who.response;
  const config = githubAppConfig();
  const record = await getGithubInstallation(who.blogId);
  if (!config || !record) return jsonError("Connect GitHub first", 404);
  try {
    const token = await installationToken(config, record.installationId);
    const repositories = (await listInstallationRepositories(token)).filter((repository) => repository.permissions.push);
    return json({ repositories });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not list repositories", 502);
  }
}

/**
 * POST { handle, action }:
 *   "settings" { repository, branch, schedule }  choose where and how often
 *   "run"                                        back up now
 *   "tick"                                       back up only if due (the app's heartbeat)
 *   "restore"                                    import what the repository holds and the workspace lacks
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const handle = typeof body.handle === "string" ? body.handle.trim() : "";
  if (!handle) return jsonError("Missing workspace handle", 400);
  const who = await owner(handle);
  if ("response" in who) return who.response;
  const actor = { userId: who.userId, actorType: "human" as const };
  try {
    switch (body.action) {
      case "settings": {
        const schedule = (["off", "hourly", "daily", "weekly"] as const).find((value) => value === body.schedule) ?? "off";
        const record = await setBackupSettings({
          blogId: who.blogId,
          repository: typeof body.repository === "string" ? body.repository : null,
          branch: typeof body.branch === "string" ? body.branch : null,
          schedule: schedule as BackupSchedule,
          actor,
        });
        return json({ repository: record.backupRepository, branch: record.backupBranch, schedule: record.backupSchedule });
      }
      case "run":
        return json(await runBackup({ handle, blogId: who.blogId, actor }));
      case "tick":
        return json(await runBackupIfDue({ handle, blogId: who.blogId }));
      case "restore":
        return json(await restoreBackup({ handle, blogId: who.blogId, actor }));
      default:
        return jsonError("Unknown action", 400);
    }
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Something went wrong", 500);
  }
}
