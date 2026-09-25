#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { isEntrypoint } from "./entrypoint.mjs";
import pg from "pg";
import { localDatabase, protectedEnvironment } from "./start.mjs";

export function smokeOrigin(value = "http://127.0.0.1:3400") {
  let url;
  try { url = new URL(value); } catch { throw new Error("Smoke origin must be loopback HTTP on port 3400."); }
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.port !== "3400" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Smoke origin must be loopback HTTP on port 3400.");
  }
  return url.origin;
}

// Only this invocation's random IDs are eligible for cleanup. No account or
// document from the owner's workspace is read, updated, or deleted.
async function removeScratch(client, { userId, blogId, folderId, handle }) {
  await client.query("BEGIN");
  try {
    const { rows } = await client.query("SELECT id FROM posts WHERE blog_id = $1", [blogId]);
    const postIds = rows.map(row => row.id);
    for (const table of ["collab_presence", "collab_updates", "collab_state"]) {
      await client.query(`DELETE FROM ${table} WHERE post_id = ANY($1::uuid[])`, [postIds]);
    }
    await client.query("DELETE FROM idempotency_keys WHERE blog_id = $1", [blogId]);
    await client.query("DELETE FROM posts WHERE blog_id = $1", [blogId]);
    await client.query("DELETE FROM folders WHERE blog_id = $1", [blogId]);
    await client.query("DELETE FROM blogs WHERE id = $1 AND owner_id = $2", [blogId, userId]);
    await client.query("DELETE FROM api_tokens WHERE user_id = $1", [userId]);
    await client.query("DELETE FROM action_audit WHERE actor_user_id = $1 OR target_id = ANY($2::text[])",
      [userId, [blogId, folderId, handle, ...postIds]]);
    await client.query("DELETE FROM users WHERE id = $1 AND username = $2", [userId, handle]);
    const residue = await client.query(`SELECT
      (SELECT count(*) FROM users WHERE id = $1) +
      (SELECT count(*) FROM blogs WHERE id = $2) +
      (SELECT count(*) FROM posts WHERE blog_id = $2) +
      (SELECT count(*) FROM api_tokens WHERE user_id = $1) +
      (SELECT count(*) FROM action_audit WHERE actor_user_id = $1) AS count`, [userId, blogId]);
    assert.equal(Number(residue.rows[0].count), 0, "Scratch cleanup left records behind.");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function smoke({ scratch = false, environment = process.env, origin, fetchImpl = fetch } = {}) {
  if (!scratch) throw new Error("Pass --scratch to authorize the temporary workspace and its cleanup.");
  const base = smokeOrigin(origin);
  localDatabase(environment.DATABASE_URL);
  const client = new pg.Client({ connectionString: environment.DATABASE_URL, connectionTimeoutMillis: 10_000,
    statement_timeout: 20_000, application_name: "texttext-oracle-smoke" });
  // pg accepts connection-string query parameters; check its resolved host too.
  if (!["localhost", "127.0.0.1", "::1"].includes(client.connectionParameters.host)) {
    throw new Error("Smoke database must resolve to a loopback PostgreSQL host.");
  }
  const fixture = { userId: randomUUID(), blogId: randomUUID(), folderId: randomUUID(),
    handle: `scratch-oracle-smoke-${randomBytes(8).toString("hex")}` };
  const token = `wsk_${randomBytes(32).toString("base64url")}`;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const checks = [];
  let connected = false;
  let failure;
  const request = async (path, options = {}) => {
    try {
      return await fetchImpl(`${base}${path}`, { ...options, headers: { ...headers, ...options.headers },
        redirect: "manual", signal: AbortSignal.timeout(20_000) });
    } catch {
      throw new Error(`Loopback request failed: ${path}.`);
    }
  };
  const command = async (name, args) => {
    const response = await request("/api/app/commands", { method: "POST", body: JSON.stringify({ name, args }) });
    assert.equal(response.status, 200, `Native ${name} returned HTTP ${response.status}.`);
    const data = await response.json();
    assert.ok(data.result && !data.error, `Native ${name} returned no result.`);
    return data.result;
  };
  try {
    await client.connect();
    connected = true;
    await client.query("BEGIN");
    try {
      await client.query("INSERT INTO users (id, apple_sub, username, name) VALUES ($1, $2, $2, $3)",
        [fixture.userId, fixture.handle, "Deployment smoke"]);
      await client.query("INSERT INTO blogs (id, handle, name, owner_id) VALUES ($1, $2, $3, $4)",
        [fixture.blogId, fixture.handle, "Deployment smoke", fixture.userId]);
      await client.query(`INSERT INTO folders (id, blog_id, name, path, mode, default_template_id)
        VALUES ($1, $2, 'Notes', 'notes', 'notes', 'texttext.note')`, [fixture.folderId, fixture.blogId]);
      await client.query(`INSERT INTO api_tokens (user_id, name, kind, token_hash, scopes, expires_at)
        VALUES ($1, 'Deployment smoke', 'app', $2, 'sync', $3::timestamp)`,
      // Match Drizzle's UTC timestamp serialization even on a Mac database
      // whose session time zone differs from the production server's UTC.
      [fixture.userId, createHash("sha256").update(token).digest("hex"), new Date(Date.now() + 600_000).toISOString()]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }

    const session = await request("/api/app/session", { method: "POST", headers: { "x-texttext-app": "1" } });
    assert.equal(session.status, 303, `Native session returned HTTP ${session.status}.`);
    assert.match(session.headers.get("set-cookie") ?? "", /(?:^|,\s*)(?:__Secure-)?authjs\.session-token=/,
      "Native session did not issue an authenticated cookie.");
    checks.push("authenticated app session");

    const workspace = await request("/api/sync/v1/workspace");
    assert.equal(workspace.status, 200, `Workspace read returned HTTP ${workspace.status}.`);
    const workspaceData = await workspace.json();
    assert.equal(workspaceData.blog?.handle, fixture.handle, "Token resolved to the wrong workspace.");
    assert.ok(workspaceData.folders?.some(folder => folder.id === fixture.folderId), "Notes folder is missing.");
    checks.push("authenticated workspace read");

    const body = "A deployment check must persist this note.";
    const appended = "The edited paragraph must persist too.";
    const created = await command("create_item", { folder_path: "notes", kind: "note", title: "Deployment smoke", body });
    assert.match(created.item?.id ?? "", /^[0-9a-f-]{36}$/i, "Create returned no item ID.");
    const itemId = created.item.id;
    const firstRead = await command("read_item", { id: itemId });
    assert.ok(firstRead.markdown?.includes(body), "Created note could not be read through the app.");
    assert.ok(firstRead.item?.hash, "Created note has no concurrency hash.");
    checks.push("note creation and read");

    await command("append_to_item", { id: itemId, markdown: appended, if_match_hash: firstRead.item.hash });
    const secondRead = await command("read_item", { id: itemId });
    assert.ok(secondRead.markdown?.includes(`${body}\n\n${appended}`), "Edited note could not be read through the app.");
    assert.notEqual(secondRead.item?.hash, firstRead.item.hash, "Edit did not change the content hash.");
    checks.push("note edit and read");

    const stored = await client.query("SELECT document, body, visibility, revision FROM posts WHERE id = $1 AND blog_id = $2",
      [itemId, fixture.blogId]);
    assert.equal(stored.rowCount, 1, "App did not write to the expected PostgreSQL database.");
    assert.equal(stored.rows[0].document?.content?.body, `${body}\n\n${appended}`, "Canonical document was not persisted.");
    assert.equal(stored.rows[0].body, `${body}\n\n${appended}`, "Body projection is inconsistent.");
    assert.equal(stored.rows[0].visibility, "private", "Scratch note is not private.");
    assert.ok(Number(stored.rows[0].revision) > 0, "Note revision was not assigned.");
    const audit = await client.query("SELECT action_name, actor_type FROM action_audit WHERE actor_user_id = $1 AND target_id = $2",
      [fixture.userId, itemId]);
    for (const action of ["mcp.create_item", "mcp.append_to_item"]) {
      assert.ok(audit.rows.some(row => row.action_name === action && row.actor_type === "human"), `Missing ${action} audit record.`);
    }
    checks.push("canonical storage and mutation audit");
  } catch (error) {
    // Do not expose driver errors, response bodies, credentials, or user data.
    failure = error instanceof assert.AssertionError || (error instanceof Error && error.message.startsWith("Loopback request failed:"))
      // Assertion diagnostics can include an unexpected cookie or body value.
      // Keep only our explicit first-line description, never their value diff.
      ? new Error(error.message.split("\n", 1)[0])
      : new Error("Authenticated deployment smoke failed while accessing local storage or the app.");
  } finally {
    if (connected) {
      try {
        await removeScratch(client, fixture);
        checks.push("scratch workspace removed");
      } catch {
        failure = new Error(`Scratch cleanup failed for ${fixture.handle}. Resolve this workspace before retrying.`);
      }
      await client.end().catch(() => {});
    }
  }
  if (failure) throw failure;
  return { ok: true, checks };
}

if (isEntrypoint(import.meta.url)) {
  try {
    const options = {};
    const args = process.argv.slice(2);
    while (args.length) {
      const arg = args.shift();
      if (arg === "--scratch") options.scratch = true;
      else if (["--env-file", "--origin"].includes(arg) && args[0] && !args[0].startsWith("--")) {
        const value = args.shift();
        if (arg === "--env-file") options.environment = { ...process.env, ...protectedEnvironment(value) };
        else options.origin = value;
      } else throw new Error("Usage: smoke.mjs --scratch [--env-file <private file>] [--origin http://127.0.0.1:3400]");
    }
    const result = await smoke(options);
    for (const check of result.checks) console.log(`PASS ${check}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Authenticated deployment smoke failed.");
    process.exitCode = 1;
  }
}
