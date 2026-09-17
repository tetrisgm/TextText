import { recordAction, type AuditActorType } from "@/lib/audit";
import type { Post } from "@/lib/content";
import { validateDocumentSnapshot } from "@/lib/documents/model";
import { legacyProjectionFromDocument } from "@/lib/documents/legacy";
import { mergeMarkdownIntoDocument } from "@/lib/documents/sync";
import { parsePostMarkdownFile, slugForNewFile } from "@/lib/markdown-files";
import { renderSyncFile, templateForPost, templatesForPosts } from "@/app/api/sync/v1/sync";
import {
  claimGithubBackupRun,
  createDraftInFolder,
  createSubfolder,
  getBlog,
  getFolders,
  getGithubInstallation,
  getPostById,
  getWorkspacePostsWithDocuments,
  recordGithubBackupRun,
  savePost,
  setGithubBackupSettings,
  type GithubInstallationRecord,
} from "@/lib/store";
import { dispatchNotification } from "@/lib/notifications/dispatch.server";
import { GithubApiError, forgetInstallationToken, githubAppConfig, installationToken, type GithubFetch } from "./app.server";
import { buildTextpack, gitBlobSha, parseTextpack, sha256Hex, textpackFileName } from "./textpack";

/**
 * The workspace backup: every item the person authored, as a textpack, plus
 * a manifest, committed to a repository they own under
 * `workspaces/<handle>/`. Postgres stays the source of truth; the repository
 * is a copy the person can read without TextText. Every document is
 * validated against the schema before it is packed, and one bad document
 * aborts the whole run: a broken snapshot never lands.
 *
 * Commits go through the Git Data API with an installation token. Unchanged
 * files are named by the blob sha the previous manifest recorded, so a run
 * uploads only what changed and a run with no changes commits nothing.
 */

export const BACKUP_MANIFEST_SCHEMA = "texttext.backup.v1" as const;
export type BackupSchedule = GithubInstallationRecord["backupSchedule"];

export type BackupManifest = {
  schema: typeof BACKUP_MANIFEST_SCHEMA;
  handle: string;
  workspace: { name: string };
  exportedAt: string;
  folders: Array<{ path: string; name: string; mode: string }>;
  documents: BackupManifestDocument[];
};

export type BackupManifestDocument = {
  id: string;
  path: string;
  folderPath: string;
  slug: string;
  type: string;
  title: string;
  status: string;
  updatedAt: string | null;
  sha256: string;
  gitSha: string;
};

export type BackupSnapshot = { manifest: BackupManifest; files: Map<string, Uint8Array> };

const API = "https://api.github.com";
const MAX_DOCUMENTS = 5000;

export function backupPrefix(handle: string): string {
  return `workspaces/${handle}`;
}

const FOLDER_PATH_RE = /^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/;
const LEAF_RE = /^[A-Za-z0-9._-]+\.textpack$/;

/**
 * Only entries that live where this workspace's backup lives, with a leaf
 * the packer could have written. The previous manifest is read back from
 * the repository, which anyone with push can edit; it decides which files
 * are deleted and which are fetched on restore, so it is not trusted
 * beyond that shape.
 */
export function sanitizeManifest(manifest: BackupManifest, handle: string): BackupManifest {
  const prefix = `${backupPrefix(handle)}/`;
  const documents = manifest.documents.filter((entry) => {
    if (typeof entry?.path !== "string" || !entry.path.startsWith(prefix) || entry.path.includes("..")) return false;
    const rest = entry.path.slice(prefix.length);
    const slash = rest.lastIndexOf("/");
    if (slash <= 0) return false;
    const folderPath = rest.slice(0, slash);
    const leaf = rest.slice(slash + 1);
    return FOLDER_PATH_RE.test(folderPath) && LEAF_RE.test(leaf) && entry.folderPath === folderPath && typeof entry.id === "string" && /^[A-Za-z0-9-]{1,64}$/.test(entry.id);
  });
  return { ...manifest, handle, documents };
}

function contentsUrl(repository: string, path: string, branch: string): string {
  return `/repos/${repository}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(branch)}`;
}

export function scheduleIntervalMs(schedule: BackupSchedule): number | null {
  switch (schedule) {
    case "hourly":
      return 60 * 60 * 1000;
    case "daily":
      return 24 * 60 * 60 * 1000;
    case "weekly":
      return 7 * 24 * 60 * 60 * 1000;
    default:
      return null;
  }
}

/** Whether a scheduled run is owed. Manual runs never wait on this. */
export function backupDue(record: Pick<GithubInstallationRecord, "backupSchedule" | "backupRepository" | "backupLastRunAt">, now = new Date()): boolean {
  const interval = scheduleIntervalMs(record.backupSchedule);
  if (interval === null || !record.backupRepository) return false;
  if (!record.backupLastRunAt) return true;
  return now.getTime() - record.backupLastRunAt.getTime() >= interval;
}

/**
 * Every item the person authored, packed and validated. Throws on the first
 * document that fails the schema, naming it, so the caller records the
 * failure instead of committing around it.
 */
export async function buildBackupSnapshot(handle: string, now = new Date()): Promise<BackupSnapshot> {
  const blog = await getBlog(handle);
  if (!blog) throw new Error("Workspace not found");
  const folders = await getFolders(handle);
  const folderById = new Map(folders.map((folder) => [folder.id, folder]));
  const posts = (await getWorkspacePostsWithDocuments(handle, MAX_DOCUMENTS)).filter((post): post is Post & { id: string } => Boolean(post.id));
  const templates = await templatesForPosts(handle, posts);
  const files = new Map<string, Uint8Array>();
  const documents: BackupManifestDocument[] = [];
  const prefix = backupPrefix(handle);
  const seen = new Set<string>();
  for (const post of posts) {
    let document;
    try {
      document = validateDocumentSnapshot(post.document);
    } catch (error) {
      throw new Error(`Item ${post.id} (${post.title || post.slug}) does not pass the document schema: ${error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 300) : "invalid"}`);
    }
    const folder = post.folderId ? folderById.get(post.folderId) : undefined;
    const folderPath = folder?.path ?? "blog";
    const markdown = renderSyncFile(blog, post, folderPath).text;
    const template = templateForPost(post, templates) ?? undefined;
    let name = textpackFileName(post.slug);
    let path = `${prefix}/${folderPath}/${name}`;
    if (seen.has(path)) {
      name = textpackFileName(`${post.slug}-${post.id.slice(0, 8)}`);
      path = `${prefix}/${folderPath}/${name}`;
    }
    seen.add(path);
    const sourceUrl = (document as { content?: { fields?: { sourceUrl?: unknown } } }).content?.fields?.sourceUrl;
    const bytes = buildTextpack(name.replace(/\.textpack$/, ""), { markdown, document, template, sourceUrl: typeof sourceUrl === "string" ? sourceUrl : null });
    files.set(path, bytes);
    documents.push({
      id: post.id,
      path,
      folderPath,
      slug: post.slug,
      type: post.type,
      title: post.title,
      status: post.status,
      updatedAt: post.updatedAt ?? null,
      sha256: sha256Hex(bytes),
      gitSha: gitBlobSha(bytes),
    });
  }
  documents.sort((a, b) => a.path.localeCompare(b.path));
  const manifest: BackupManifest = {
    schema: BACKUP_MANIFEST_SCHEMA,
    handle,
    workspace: { name: blog.name },
    exportedAt: now.toISOString(),
    folders: folders.map((folder) => ({ path: folder.path, name: folder.name, mode: folder.mode })).sort((a, b) => a.path.localeCompare(b.path)),
    documents,
  };
  return { manifest, files };
}

export function parseBackupManifest(raw: string): BackupManifest {
  const value = JSON.parse(raw) as BackupManifest;
  if (value?.schema !== BACKUP_MANIFEST_SCHEMA || !Array.isArray(value.documents)) throw new Error("Not a TextText backup manifest");
  return value;
}

// ---------------------------------------------------------------------------
// The repository side

type RepoContext = { token: string; repository: string; branch: string; fetcher: GithubFetch };

async function api<T>(ctx: RepoContext, path: string, init: RequestInit = {}): Promise<T> {
  const response = await ctx.fetcher(`${API}${path}`, {
    ...init,
    headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "TextText", Authorization: `Bearer ${ctx.token}`, ...(init.headers ?? {}) },
  });
  if (!response.ok) {
    let detail = "";
    try {
      detail = ((await response.json()) as { message?: string }).message ?? "";
    } catch {
      // Status is the message.
    }
    throw new GithubApiError(detail || `GitHub answered ${response.status}`, response.status);
  }
  return (await response.json()) as T;
}

async function headOf(ctx: RepoContext): Promise<{ commit: string; tree: string } | null> {
  try {
    const ref = await api<{ object: { sha: string } }>(ctx, `/repos/${ctx.repository}/git/ref/heads/${encodeURIComponent(ctx.branch)}`);
    const commit = await api<{ tree: { sha: string } }>(ctx, `/repos/${ctx.repository}/git/commits/${ref.object.sha}`);
    return { commit: ref.object.sha, tree: commit.tree.sha };
  } catch (error) {
    if (error instanceof GithubApiError && (error.status === 404 || error.status === 409)) return null;
    throw error;
  }
}

async function previousManifest(ctx: RepoContext, handle: string): Promise<BackupManifest | null> {
  try {
    const file = await api<{ content: string; encoding: string }>(ctx, contentsUrl(ctx.repository, `${backupPrefix(handle)}/manifest.json`, ctx.branch));
    return sanitizeManifest(parseBackupManifest(Buffer.from(file.content, "base64").toString("utf8")), handle);
  } catch (error) {
    if (error instanceof GithubApiError && error.status === 404) return null;
    return null;
  }
}

/**
 * Commits the snapshot. Returns the new commit sha, or null when the tree is
 * identical to what the branch already holds.
 */
export async function commitSnapshot(ctx: RepoContext, snapshot: BackupSnapshot, message: string): Promise<{ commit: string | null; uploaded: number; removed: number }> {
  const { manifest, files } = snapshot;
  const prefix = backupPrefix(manifest.handle);
  let head = await headOf(ctx);
  if (!head) {
    // An empty repository has no branch to build on. The Contents API can
    // create the first commit; everything after that uses the Git Data API.
    await api(ctx, `/repos/${ctx.repository}/contents/${prefix}/README.md`, {
      method: "PUT",
      body: JSON.stringify({ message: "Start the TextText backup", branch: ctx.branch, content: Buffer.from(`# ${manifest.workspace.name}\n\nA TextText backup of the ${manifest.handle} workspace. Each item is a textpack; manifest.json lists them.\n`).toString("base64") }),
    });
    head = await headOf(ctx);
    if (!head) throw new Error("Could not create the branch");
  }
  const previous = await previousManifest(ctx, manifest.handle);
  const previousSha = new Map((previous?.documents ?? []).map((document) => [document.path, document.gitSha]));
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const tree: Array<{ path: string; mode: "100644"; type: "blob"; sha: string | null }> = [];
  let uploaded = 0;
  let changed = false;
  for (const document of manifest.documents) {
    if (previousSha.get(document.path) === document.gitSha) {
      tree.push({ path: document.path, mode: "100644", type: "blob", sha: document.gitSha });
      continue;
    }
    const bytes = files.get(document.path);
    if (!bytes) throw new Error(`Snapshot is missing ${document.path}`);
    const blob = await api<{ sha: string }>(ctx, `/repos/${ctx.repository}/git/blobs`, { method: "POST", body: JSON.stringify({ content: Buffer.from(bytes).toString("base64"), encoding: "base64" }) });
    if (blob.sha !== document.gitSha) throw new Error(`GitHub stored ${document.path} with a different sha`);
    tree.push({ path: document.path, mode: "100644", type: "blob", sha: blob.sha });
    uploaded += 1;
    changed = true;
  }
  const current = new Set(manifest.documents.map((document) => document.path));
  let removed = 0;
  for (const path of previousSha.keys()) {
    if (!current.has(path)) {
      tree.push({ path, mode: "100644", type: "blob", sha: null });
      removed += 1;
      changed = true;
    }
  }
  if (!changed && previous) {
    // Same files, same folders: nothing to record. The manifest's exportedAt
    // alone is not a reason to commit.
    const same = JSON.stringify({ ...previous, exportedAt: null }) === JSON.stringify({ ...manifest, exportedAt: null });
    if (same) return { commit: null, uploaded: 0, removed: 0 };
  }
  const manifestBlob = await api<{ sha: string }>(ctx, `/repos/${ctx.repository}/git/blobs`, { method: "POST", body: JSON.stringify({ content: manifestBytes.toString("base64"), encoding: "base64" }) });
  tree.push({ path: `${prefix}/manifest.json`, mode: "100644", type: "blob", sha: manifestBlob.sha });
  const newTree = await api<{ sha: string }>(ctx, `/repos/${ctx.repository}/git/trees`, { method: "POST", body: JSON.stringify({ base_tree: head.tree, tree }) });
  const commit = await api<{ sha: string }>(ctx, `/repos/${ctx.repository}/git/commits`, { method: "POST", body: JSON.stringify({ message, tree: newTree.sha, parents: [head.commit] }) });
  await api(ctx, `/repos/${ctx.repository}/git/refs/heads/${encodeURIComponent(ctx.branch)}`, { method: "PATCH", body: JSON.stringify({ sha: commit.sha, force: false }) });
  return { commit: commit.sha, uploaded, removed };
}

// ---------------------------------------------------------------------------
// Settings and runs

export async function setBackupSettings(input: {
  blogId: string;
  repository: string | null;
  branch: string | null;
  schedule: BackupSchedule;
  /** A public repository publishes every note and bookmark; the owner must say so. */
  allowPublic?: boolean;
  actor: { userId: string | null; actorType: AuditActorType };
  fetcher?: GithubFetch;
}): Promise<GithubInstallationRecord> {
  const record = await getGithubInstallation(input.blogId);
  if (!record) throw new Error("Connect GitHub first");
  const repository = input.repository?.trim() || null;
  if (repository && !/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error("Repository must look like owner/name");
  const branch = input.branch?.trim() || null;
  if (branch && !/^[\w./-]+$/.test(branch)) throw new Error("Branch name is not valid");
  if (repository && !input.allowPublic) {
    const config = githubAppConfig();
    if (config) {
      const token = await installationToken(config, record.installationId, input.fetcher ?? fetch);
      const repo = await api<{ private: boolean }>({ token, repository, branch: "", fetcher: input.fetcher ?? fetch }, `/repos/${repository}`);
      if (!repo.private) throw new Error("That repository is public, so every note and bookmark in this workspace would be readable by anyone. Choose a private repository, or confirm you want a public backup.");
    }
  }
  const saved = await setGithubBackupSettings({ blogId: input.blogId, repository, branch, schedule: input.schedule, actor: input.actor });
  if (!saved) throw new Error("Connect GitHub first");
  return saved;
}

export type BackupRunReport = { ran: boolean; reason?: string; commit?: string | null; documents?: number; uploaded?: number; removed?: number };

async function repositoryContext(record: GithubInstallationRecord, fetcher: GithubFetch): Promise<RepoContext> {
  const config = githubAppConfig();
  if (!config) throw new Error("GitHub is not set up on this deployment");
  if (!record.backupRepository) throw new Error("Choose a repository first");
  const token = await installationToken(config, record.installationId, fetcher);
  let branch = record.backupBranch;
  if (!branch) {
    const repo = await api<{ default_branch: string }>({ token, repository: record.backupRepository, branch: "", fetcher }, `/repos/${record.backupRepository}`);
    branch = repo.default_branch;
  }
  return { token, repository: record.backupRepository, branch, fetcher };
}

/** One backup run. Records how it went on the installation row and in the audit log. */
export async function runBackup(input: { handle: string; blogId: string; actor: { userId: string | null; actorType: AuditActorType }; fetcher?: GithubFetch; now?: Date }): Promise<BackupRunReport> {
  const record = await getGithubInstallation(input.blogId);
  if (!record || !record.backupRepository) return { ran: false, reason: "Choose a repository first" };
  const fetcher = input.fetcher ?? fetch;
  const now = input.now ?? new Date();
  const finish = async (status: "ok" | "unchanged" | "failed", detail: string | null, commit: string | null) => {
    await recordGithubBackupRun({ blogId: input.blogId, status, detail, commit, at: now, actor: input.actor, repository: record.backupRepository });
    if (status !== "unchanged") {
      const blog = await getBlog(input.handle);
      await dispatchNotification({
        blogId: input.blogId,
        message: {
          event: "github.backup",
          title: status === "ok" ? `Backup of ${input.handle} landed` : `Backup of ${input.handle} failed`,
          body: detail ?? "",
          url: commit && record.backupRepository ? `https://github.com/${record.backupRepository}/commit/${commit}` : null,
          workspace: { handle: input.handle, name: blog?.name ?? input.handle },
        },
      }).catch(() => undefined);
    }
  };
  try {
    const snapshot = await buildBackupSnapshot(input.handle, now);
    const ctx = await repositoryContext(record, fetcher);
    const result = await commitSnapshot(ctx, snapshot, `TextText backup of ${input.handle}, ${snapshot.manifest.documents.length} items`);
    const documents = snapshot.manifest.documents.length;
    if (!result.commit) {
      await finish("unchanged", `${documents} items, nothing changed`, null);
      return { ran: true, commit: null, documents, uploaded: 0, removed: 0 };
    }
    await finish("ok", `${documents} items, ${result.uploaded} uploaded, ${result.removed} removed`, result.commit);
    return { ran: true, commit: result.commit, documents, uploaded: result.uploaded, removed: result.removed };
  } catch (error) {
    if (error instanceof GithubApiError && error.status === 401) forgetInstallationToken(record.installationId);
    if (error instanceof GithubApiError && error.status === 422) {
      // The branch moved under us: another run landed first. Nothing is
      // lost; the next run builds on it.
      await finish("unchanged", "another backup landed first", null);
      return { ran: true, commit: null, documents: 0, uploaded: 0, removed: 0 };
    }
    const message = error instanceof Error ? error.message : "Backup failed";
    await finish("failed", message.slice(0, 500), null);
    return { ran: false, reason: message };
  }
}

/** Runs the backup only when the schedule says so. The app's own heartbeat calls this. */
export async function runBackupIfDue(input: { handle: string; blogId: string; actor: { userId: string | null; actorType: AuditActorType }; fetcher?: GithubFetch; now?: Date }): Promise<BackupRunReport> {
  const record = await getGithubInstallation(input.blogId);
  const now = input.now ?? new Date();
  if (!record || !backupDue(record, now)) return { ran: false, reason: "not due" };
  const interval = scheduleIntervalMs(record.backupSchedule);
  if (interval === null || !(await claimGithubBackupRun(input.blogId, now, interval))) return { ran: false, reason: "not due" };
  return runBackup({ ...input, now });
}

// ---------------------------------------------------------------------------
// Restore: import what the repository holds and the workspace does not

export type RestoreReport = { considered: number; restored: number; skipped: number; failed: number; folders: number };

export async function restoreBackup(input: { handle: string; blogId: string; actor: { userId: string | null; actorType: AuditActorType }; fetcher?: GithubFetch }): Promise<RestoreReport> {
  const record = await getGithubInstallation(input.blogId);
  if (!record || !record.backupRepository) throw new Error("Choose a repository first");
  const ctx = await repositoryContext(record, input.fetcher ?? fetch);
  const manifest = await previousManifest(ctx, input.handle);
  if (!manifest) throw new Error("The repository has no backup of this workspace yet");
  const report: RestoreReport = { considered: manifest.documents.length, restored: 0, skipped: 0, failed: 0, folders: 0 };
  const folders = await getFolders(input.handle);
  const folderIdByPath = new Map(folders.map((folder) => [folder.path, folder.id]));
  const audit = { actorUserId: input.actor.userId, actorType: input.actor.actorType, targetType: "item" as const };
  const folderFor = async (path: string): Promise<string | null> => {
    if (!FOLDER_PATH_RE.test(path)) return null;
    const known = folderIdByPath.get(path);
    if (known) return known;
    const parts = path.split("/");
    if (parts.length < 2) return null;
    const parentPath = parts.slice(0, -1).join("/");
    const parentId = await folderFor(parentPath);
    if (!parentId) return null;
    const name = manifest.folders.find((folder) => folder.path === path)?.name ?? parts[parts.length - 1];
    const created = await createSubfolder(input.handle, parentPath, name, { audit: { ...audit, targetType: "folder", actionName: "github.restore_folder", inputSummary: path } });
    folderIdByPath.set(created.path, created.id);
    report.folders += 1;
    return created.id;
  };
  for (const entry of manifest.documents) {
    try {
      if (await getPostById(input.handle, entry.id)) {
        report.skipped += 1;
        continue;
      }
      const folderId = await folderFor(entry.folderPath);
      if (!folderId) throw new Error(`No folder for ${entry.folderPath}`);
      const file = await api<{ content: string }>(ctx, contentsUrl(ctx.repository, entry.path, ctx.branch));
      const parts = parseTextpack(Buffer.from(file.content, "base64"));
      const parsed = parsePostMarkdownFile(parts.markdown);
      const created = await createDraftInFolder(input.handle, folderId, { audit: { ...audit, actionName: "github.restore_item", inputSummary: entry.path.slice(0, 200) } });
      const document = mergeMarkdownIntoDocument(validateDocumentSnapshot(parts.document), parsed);
      const projection = legacyProjectionFromDocument(document);
      await savePost(input.handle, {
        ...created,
        ...projection,
        ...parsed.fields,
        accent: projection.accent ?? undefined,
        cover: projection.cover ?? undefined,
        coverCaption: projection.coverCaption ?? undefined,
        coverHeight: projection.coverHeight ?? undefined,
        links: projection.links ?? undefined,
        videoUrl: projection.videoUrl ?? undefined,
        venue: projection.venue ?? undefined,
        duration: projection.duration ?? undefined,
        type: created.type,
        date: parsed.fields.date,
        slug: slugForNewFile(parsed.fields, created.slug),
        // Restored as a draft, whatever the file said: the repository is a
        // copy, not a place to publish from.
        status: "draft",
        visibility: "private",
        document,
      });
      report.restored += 1;
    } catch {
      report.failed += 1;
    }
  }
  await recordAction({ actorUserId: input.actor.userId, actorType: input.actor.actorType, actionName: "github.restore_backup", targetType: "workspace", targetId: input.blogId, inputSummary: record.backupRepository, outputSummary: `${report.restored} restored, ${report.skipped} present, ${report.failed} failed` });
  return report;
}
