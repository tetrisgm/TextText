import assert from "node:assert/strict";
import { test } from "node:test";
import { Readable } from "node:stream";
import { createR2BackupClient } from "./r2-backup-client.mjs";

const environment = {
  TEXTTEXT_R2_ACCOUNT_ID: "a".repeat(32),
  TEXTTEXT_BACKUP_R2_BUCKET: "texttext-backups",
  TEXTTEXT_R2_ACCESS_KEY_ID: "fixture-key-id",
  TEXTTEXT_R2_SECRET_ACCESS_KEY: "fixture-secret-with-enough-length",
};
const key = "backups/oracle/texttext/texttext-20260930T120000Z-12345678.dump.aes256gcm";
class ListObjectsV2Command { constructor(input) { this.input = input; } }
class PutObjectCommand { constructor(input) { this.input = input; } }
class GetObjectCommand { constructor(input) { this.input = input; } }
class DeleteObjectCommand { constructor(input) { this.input = input; } }
const sdk = { ListObjectsV2Command, PutObjectCommand, GetObjectCommand, DeleteObjectCommand };

test("R2 backups stay private, bounded and conditionally created", async () => {
  const commands = [];
  const client = await createR2BackupClient(environment, { sdk, client: { async send(command) {
    commands.push(command);
    if (command instanceof ListObjectsV2Command) return { Contents: [{ Key: key, Size: 64, LastModified: new Date("2026-09-30T12:00:00Z") }] };
    if (command instanceof GetObjectCommand) return { Body: Readable.from([Buffer.from("ciphertext")]), $metadata: { httpStatusCode: 200 } };
    return {};
  } } });
  const inventory = await client.list({ prefix: "backups/oracle/texttext/", limit: 100 });
  assert.equal(inventory.hasMore, false);
  assert.deepEqual(inventory.blobs, [{ pathname: key, url: `r2://texttext-backups/${key}`, size: 64, uploadedAt: "2026-09-30T12:00:00.000Z" }]);
  await client.put(key, Readable.from([Buffer.alloc(64)]), { contentLength: 64, allowOverwrite: false, addRandomSuffix: false });
  const downloaded = await client.get(inventory.blobs[0].url);
  assert.equal(downloaded.statusCode, 200);
  assert.equal(Buffer.concat(await Array.fromAsync(downloaded.stream)).toString(), "ciphertext");
  await client.del(inventory.blobs[0].url);
  assert.deepEqual(commands.map(command => command.constructor.name), ["ListObjectsV2Command", "PutObjectCommand", "GetObjectCommand", "DeleteObjectCommand"]);
  assert.equal(commands[0].input.MaxKeys, 101);
  assert.equal(commands[1].input.IfNoneMatch, "*");
  assert.equal(commands[1].input.ContentLength, 64);
  assert.equal(commands[1].input.Bucket, "texttext-backups");
  assert.equal(commands[2].input.Key, key);
});

test("R2 backup client refuses foreign paths, oversized cleanup and missing credentials", async () => {
  await assert.rejects(createR2BackupClient({ ...environment, TEXTTEXT_R2_SECRET_ACCESS_KEY: "" }, { sdk, client: {} }), /credentials/);
  const client = await createR2BackupClient(environment, { sdk, client: { async send() { return {}; } } });
  await assert.rejects(client.put("documents/private", Readable.from([]), { contentLength: 64, allowOverwrite: false, addRandomSuffix: false }), /upload/);
  await assert.rejects(client.get("https://example.invalid/backup"), /locator/);
  await assert.rejects(client.del(Array(101).fill(`r2://texttext-backups/${key}`)), /batch/);
  await assert.rejects(client.list({ prefix: "documents/", limit: 100 }), /inventory/);
});
