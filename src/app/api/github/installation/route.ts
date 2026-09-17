import { forgetInstallationToken, getInstallation, githubAppConfig, manageInstallationUrl } from "@/lib/github/app.server";
import { getCurrentUser } from "@/lib/session";
import { getBlogEditAccess } from "@/lib/blog-edit-auth";
import { forgetGithubInstallation, getGithubInstallation, type GithubInstallationRecord } from "@/lib/store";
import { json, jsonError } from "../_shared";

export const dynamic = "force-dynamic";

export type GithubInstallationStatus = {
  configured: boolean;
  installation:
    | (Pick<GithubInstallationRecord, "installationId" | "accountLogin" | "accountType" | "repositorySelection" | "connectedByLogin" | "backupRepository" | "backupBranch" | "backupSchedule" | "backupLastStatus" | "backupLastDetail" | "backupLastCommit"> & {
        backupLastRunAt: string | null;
        manageUrl: string;
        /** null until checked; false when GitHub no longer has it */
        reachable: boolean | null;
      })
    | null;
};

async function owner(handle: string) {
  const user = await getCurrentUser();
  if (!user) return { response: jsonError("Sign in first", 401) };
  const access = await getBlogEditAccess(handle);
  if (!access.canEdit || !access.isOwner || !access.ownerId || !access.blogId) return { response: jsonError("Only the workspace owner can manage GitHub", 403) };
  return { userId: access.ownerId, blogId: access.blogId };
}

/** GET ?handle= -> the workspace's GitHub connection. ?check=1 also asks GitHub whether it still exists. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const handle = url.searchParams.get("handle")?.trim() ?? "";
  if (!handle) return jsonError("Missing workspace handle", 400);
  const who = await owner(handle);
  if ("response" in who) return who.response;
  const config = githubAppConfig();
  const record = await getGithubInstallation(who.blogId);
  if (!record) return json({ configured: Boolean(config), installation: null } satisfies GithubInstallationStatus);
  let reachable: boolean | null = null;
  if (config && url.searchParams.get("check") === "1") {
    try {
      const live = await getInstallation(config, record.installationId);
      reachable = Boolean(live && !live.suspended);
    } catch {
      reachable = null;
    }
  }
  const { id: _id, blogId: _blogId, updatedAt: _updatedAt, backupLastRunAt, ...rest } = record;
  void _id;
  void _blogId;
  void _updatedAt;
  return json({
    configured: Boolean(config),
    installation: { ...rest, backupLastRunAt: backupLastRunAt ? backupLastRunAt.toISOString() : null, manageUrl: manageInstallationUrl(record.installationId, record.accountType, record.accountLogin), reachable },
  } satisfies GithubInstallationStatus);
}

/** DELETE { handle } forgets the connection here. Removing the installation itself happens on GitHub. */
export async function DELETE(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { handle?: unknown };
  const handle = typeof body.handle === "string" ? body.handle.trim() : "";
  if (!handle) return jsonError("Missing workspace handle", 400);
  const who = await owner(handle);
  if ("response" in who) return who.response;
  const record = await getGithubInstallation(who.blogId);
  if (record) forgetInstallationToken(record.installationId);
  const removed = await forgetGithubInstallation(who.blogId, { userId: who.userId, actorType: "human" });
  return json({ removed });
}
