#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { isEntrypoint } from "./entrypoint.mjs";
import pg from "pg";
import * as fs from "node:fs/promises";
import path from "node:path";
import { unzipSync, strFromU8 } from "fflate";
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

export async function removeScratchFiles(root, workspaceId) {
  if (!path.isAbsolute(root ?? "") || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(workspaceId)) throw new Error("Invalid scratch file location.");
  let actualRoot;
  try { actualRoot = await fs.realpath(root); } catch (error) { if (error.code === "ENOENT") return; throw error; }
  const target = path.join(actualRoot, workspaceId);
  let stat;
  try { stat = await fs.lstat(target); } catch (error) { if (error.code === "ENOENT") return; throw error; }
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Scratch workspace is not an ordinary directory.");
  await fs.rm(target, { recursive: true });
  await assert.rejects(fs.lstat(target), { code: "ENOENT" });
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
  if (!path.isAbsolute(environment.TEXTTEXT_VAULT_ROOT ?? "")) throw new Error("Smoke requires an absolute file storage root.");
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

    // Exercise cookie authentication through the public HTTPS proxy shape.
    // Bearer-only checks cannot catch rejecting a browser's public Origin
    // against Next's private loopback request.url.
    const cookie = session.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ");
    const publicOrigin = new URL(environment.AUTH_URL || environment.TEXTTEXT_PRODUCT_ORIGIN || "https://texttext.app").origin;
    const browserProbe = async origin => fetchImpl(`${base}/api/vault/${fixture.blogId}/items/${randomUUID()}`, {
      method: "PUT", redirect: "manual", signal: AbortSignal.timeout(20_000),
      headers: { Cookie: cookie, Origin: origin, Host: new URL(publicOrigin).host,
        "X-Forwarded-Proto": "https", "If-None-Match": "*",
        "X-TextText-Path": "Notes/Origin-probe.textpack", "X-TextText-Operation-Id": randomUUID() },
    });
    // No body: successful authorization reaches validation, creates no file.
    const browserWrite = await browserProbe(publicOrigin);
    assert.ok([400, 422].includes(browserWrite.status), `Browser cookie mutation returned HTTP ${browserWrite.status} before body validation.`);
    const bodyError = (await browserWrite.json()).error;
    assert.ok(["TextPack body is required", "Invalid TextPack or file metadata"].includes(bodyError), "Browser write failed before body validation.");
    assert.equal((await browserProbe("https://attacker.invalid")).status, 403, "Cross-origin cookie mutation was accepted.");
    checks.push("browser cookie mutation origin enforcement");

    const workspace = await request(`/api/vault/${fixture.blogId}/items`);
    assert.equal(workspace.status, 200, `File workspace read returned HTTP ${workspace.status}.`);
    const workspaceData = await workspace.json();
    assert.deepEqual(workspaceData.items, [], "Scratch file workspace is not empty.");
    checks.push("authenticated file workspace read");

    const body = "A deployment check must persist this note.";
    const appended = "The edited paragraph must persist too.";
    const created = await command("create_item", { folder_path: "Notes", kind: "note", title: "Deployment smoke", body });
    assert.match(created.item?.id ?? "", /^[0-9a-f-]{36}$/i, "Create returned no item ID.");
    const itemId = created.item.id;
    const firstRead = await command("read_item", { id: itemId });
    assert.ok(firstRead.markdown?.includes(body), "Created note could not be read through the app.");
    assert.ok(firstRead.item?.hash, "Created note has no concurrency hash.");
    checks.push("note creation and read");

    const appendArgs = { id: itemId, markdown: appended, if_match_hash: firstRead.item.hash, idempotency_key: `smoke-${randomUUID()}` };
    await command("append_to_item", appendArgs);
    await command("append_to_item", appendArgs); // lost acknowledgement retry keeps the original hash/key

    const secondRead = await command("read_item", { id: itemId });
    assert.ok(secondRead.markdown?.includes(`${body}\n\n${appended}`), "Edited note could not be read through the app.");
    assert.notEqual(secondRead.item?.hash, firstRead.item.hash, "Edit did not change the content hash.");
    checks.push("note edit, durable retry and read");

    const manifestResponse = await request(`/api/vault/${fixture.blogId}/items`);
    assert.equal(manifestResponse.status, 200, "File manifest read failed.");
    const manifest = await manifestResponse.json();
    assert.equal(manifest.items.length, 1, "Retry created a duplicate file.");
    assert.equal(manifest.items[0].itemId, itemId, "Manifest item identity differs.");
    assert.equal(manifest.items[0].revision, secondRead.item.hash, "Manifest revision differs from command read.");
    const archive = await request(`/api/vault/${fixture.blogId}/items/${itemId}`);
    assert.equal(archive.status, 200, "Canonical TextPack read failed.");
    const bytes = new Uint8Array(await archive.arrayBuffer());
    assert.equal(createHash("sha256").update(bytes).digest("hex"), secondRead.item.hash, "Canonical archive hash differs.");
    const entries = unzipSync(bytes);
    const documents = Object.keys(entries).filter(name => /(?:^|\/)document\.json$/.test(name));
    const markdown = Object.keys(entries).filter(name => /(?:^|\/)text\.md$/.test(name));
    assert.equal(documents.length, 1, "TextPack must contain one canonical document.");
    assert.equal(markdown.length, 1, "TextPack must contain one Markdown projection.");
    assert.equal(JSON.parse(strFromU8(entries[documents[0]])).content.body, `${body}\n\n${appended}`, "Canonical file did not persist exactly one append.");
    assert.ok(strFromU8(entries[markdown[0]]).includes(`${body}\n\n${appended}`), "File Markdown projection differs.");
    assert.ok(!Object.keys(entries).some(name => /(?:^|\/)publication\.json$/.test(name)), "Scratch note was published.");
    const stored = await client.query("SELECT count(*) AS count FROM posts WHERE blog_id = $1", [fixture.blogId]);
    assert.equal(Number(stored.rows[0].count), 0, "Canonical file commands created independent SQL content.");
    const sqlFolders = await client.query("SELECT count(*) AS count FROM folders WHERE blog_id = $1", [fixture.blogId]);
    assert.equal(Number(sqlFolders.rows[0].count), 0, "Canonical file commands created independent SQL folders.");
    const audit = await client.query("SELECT action_name, actor_type FROM action_audit WHERE actor_user_id = $1 AND target_id = $2", [fixture.userId, itemId]);
    assert.equal(audit.rows.filter(row => row.action_name === "vault.write" && row.actor_type === "human").length, 2, "Expected exactly two human file mutation audit receipts.");
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
        await removeScratchFiles(environment.TEXTTEXT_VAULT_ROOT, fixture.blogId);
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
