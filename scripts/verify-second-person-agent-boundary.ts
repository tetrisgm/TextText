/** Live local proof: a shared-item editor cannot use its owner's AI connection. */
import { getOwnedBlog, getPostById, getUserIdBySub } from "../src/lib/store";
import { closeDatabaseConnections } from "../src/lib/db/client";
import { blogPostEditPath } from "../src/lib/public-paths";
import { TextTextClient } from "./texttext-live-client";

const origin = process.env.TEXTTEXT_BASE_URL ?? "http://localhost:3000";
const ownerHandle = "visual-demo";
const secondEmail = "second-editor@texttext.local";
const sharedItemId = "cb144257-2dc4-4fca-a507-06619dbe15b3";

async function main() {
  const local = new Set(["localhost", "127.0.0.1", "::1"]);
  if (!local.has(new URL(origin).hostname) || !local.has(new URL(process.env.DATABASE_URL ?? "").hostname)) {
    throw new Error("This proof requires the local server and local database");
  }
  const secondSub = `dev:${secondEmail}`;
  if (!(await getUserIdBySub(secondSub))) throw new Error("Existing second collaborator account is missing");
  const secondWorkspace = await getOwnedBlog(secondSub);
  if (secondWorkspace?.handle !== "second-editor") throw new Error("Second collaborator owns an unexpected workspace");
  const ownerWorkspace = await getOwnedBlog("dev:visual-demo@texttext.local");
  const before = await getPostById(ownerHandle, sharedItemId);
  if (!ownerWorkspace || !before || before.type !== "note") throw new Error("Shared test note is missing");

  const second = new TextTextClient(origin);
  await second.signIn(secondEmail, "Second Editor");
  const sharedPath = blogPostEditPath(ownerWorkspace, before);
  const shared = await second.http(sharedPath);
  if (shared.status !== 200) throw new Error(`Collaborator cannot open shared note: ${shared.status}`);
  await shared.arrayBuffer();

  const config = await second.http(`/api/ai?workspaceHandle=${ownerHandle}`);
  const configBody = await config.json() as { enabled?: boolean };
  if (config.status !== 200 || configBody.enabled !== false) throw new Error("Owner's AI connection was shown to collaborator");

  const turn = await second.http("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ workspaceHandle: ownerHandle, messages: [{ role: "user", content: "Read the shared note" }], context: { postId: sharedItemId } }),
  });
  const turnBody = await turn.json() as { error?: string };
  if (turn.status !== 403 || turnBody.error !== "This AI connection is not available for this workspace.") {
    throw new Error(`Foreign assistant turn was not denied at the owner boundary: ${turn.status}`);
  }

  const command = await second.http("/api/ai/tools", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ handle: ownerHandle, name: "append_to_item", args: { id: sharedItemId, markdown: "Agent boundary test must never be appended." } }),
  });
  const commandBody = await command.json() as { error?: string };
  if (command.status !== 403 || commandBody.error !== "Only the workspace owner can run assistant commands.") {
    throw new Error(`Foreign assistant command was not denied at the owner boundary: ${command.status}`);
  }

  const after = await getPostById(ownerHandle, sharedItemId);
  if (!after || after.revision !== before.revision || after.body !== before.body) {
    throw new Error("Shared note changed during denied assistant requests");
  }
  console.log("PASS: existing collaborator opens shared note; owner's AI connection hidden; turn and write command denied without changing the note");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Second-person agent boundary proof failed");
  process.exitCode = 1;
}).finally(async () => { await closeDatabaseConnections(); });
