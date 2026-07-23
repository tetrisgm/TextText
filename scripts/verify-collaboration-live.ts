// Destructive local-database collaboration evaluation.
//
// Four independent Yjs clients edit one scratch document. Three publish while
// the fourth is offline, the fourth reconnects later, all clients consume the
// actual relay log, and the merged document is materialized through the same
// store and audit boundaries as the product. Every scratch row is removed in a
// finally block. Output is content-blind numeric diagnostics.
//
//   node --env-file=.env.local --import tsx scripts/verify-collaboration-live.ts

import { isDeepStrictEqual } from "node:util";
import { and, eq } from "drizzle-orm";
import * as Y from "yjs";
import {
  Awareness,
  encodeAwarenessUpdate,
} from "y-protocols/awareness";
import {
  activePresence,
  appendCollabUpdate,
  collabUpdatesSince,
  markCollabMaterialized,
  materializeCollabDocument,
  prepareCollabBaseline,
  upsertPresence,
} from "@/lib/collab";
import {
  documentAssets,
  documentFields,
  documentPresentation,
  documentSnapshotFromYDoc,
  documentTags,
  documentText,
  documentTheme,
} from "@/lib/collab/document";
import { COLLABORATION_EVALUATION_BASELINE } from "@/lib/collab/evaluation";
import { closeDatabaseConnections, db } from "@/lib/db/client";
import {
  actionAudit,
  blogs,
  collabPresence,
  collabState,
  collabUpdates,
  folders,
  posts,
  users,
} from "@/lib/db/schema";
import {
  ensureWorkspaceFolders,
  getPostStoreContext,
  savePost,
} from "@/lib/store";

const CLIENTS = [
  { id: "browser", clientId: 1_001, color: "#3c7de0" },
  { id: "native", clientId: 2_002, color: "#2ca39a" },
  { id: "agent", clientId: 3_003, color: "#b05ae0" },
  { id: "offline", clientId: 4_004, color: "#e08a3c" },
] as const;

type ScenarioClient = {
  id: (typeof CLIENTS)[number]["id"];
  doc: Y.Doc;
  awareness: Awareness;
  baselineVector: Uint8Array;
  update: Uint8Array;
};

type EvaluationMetrics = {
  status: "pass";
  clients: number;
  updates: number;
  updateBytes: number;
  presenceStates: number;
  assets: number;
  tags: number;
  themeTokens: number;
  revisionAdvanced: number;
  auditRows: number;
  relayWriteMilliseconds: number;
  relayReadMilliseconds: number;
  materializeMilliseconds: number;
  persistMilliseconds: number;
  totalMilliseconds: number;
};

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function updateFromBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}

function updateToBase64(value: Uint8Array): string {
  return Buffer.from(value).toString("base64");
}

function addUnique(target: Y.Array<unknown>, value: unknown): void {
  if (!target.toArray().some((entry) => isDeepStrictEqual(entry, value))) {
    target.push([value]);
  }
}

function applyClientEdit(client: ScenarioClient): void {
  const body = documentText(client.doc, "body");
  switch (client.id) {
    case "browser":
      documentText(client.doc, "title").insert(
        COLLABORATION_EVALUATION_BASELINE.content.title.length,
        " from the browser",
      );
      documentFields(client.doc).set("browserState", "ready");
      documentTheme(client.doc).set("accent", "#FF375F");
      break;
    case "native":
      body.insert(0, "Mac edit. ");
      addUnique(documentAssets(client.doc), {
        id: "native-cover",
        kind: "image",
        src: "assets/native-cover.jpg",
      });
      documentTheme(client.doc).set("density", "compact");
      break;
    case "agent":
      body.insert(0, "Agent edit. ");
      addUnique(documentTags(client.doc), "agent-authored");
      documentPresentation(client.doc).set("templateId", "texttext.gallery");
      break;
    case "offline":
      documentText(client.doc, "subtitle").insert(
        COLLABORATION_EVALUATION_BASELINE.content.subtitle?.length ?? 0,
        " after reconnect",
      );
      documentFields(client.doc).set("offlineState", "replayed");
      documentTheme(client.doc).set("measure", "wide");
      addUnique(documentAssets(client.doc), {
        id: "offline-photo",
        kind: "image",
        src: "assets/offline-photo.jpg",
      });
      break;
  }
}

function createClients(baseline: string): ScenarioClient[] {
  return CLIENTS.map((definition) => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, updateFromBase64(baseline), "server-baseline");
    doc.clientID = definition.clientId;
    const awareness = new Awareness(doc);
    awareness.setLocalState({
      user: { id: definition.id, color: definition.color },
      selection: { field: "body", anchor: 0, head: 0 },
    });
    const client: ScenarioClient = {
      id: definition.id,
      doc,
      awareness,
      baselineVector: Y.encodeStateVector(doc),
      update: new Uint8Array(),
    };
    applyClientEdit(client);
    client.update = Y.encodeStateAsUpdate(doc, client.baselineVector);
    return client;
  });
}

function applyRows(
  clients: ScenarioClient[],
  rows: Array<{ update: string }>,
): void {
  for (const [index, client] of clients.entries()) {
    const ordered = index % 2 === 0 ? rows : [...rows].reverse();
    for (const row of ordered) {
      Y.applyUpdate(client.doc, updateFromBase64(row.update), "relay-read");
    }
  }
}

async function evaluate(): Promise<EvaluationMetrics> {
  if (!db) throw new Error("DATABASE_URL must point to the local database");
  const startedAt = performance.now();
  const stamp = `${Date.now().toString(36)}-${process.pid.toString(36)}`;
  const handle = `scratch-collab-${stamp}`;
  let userId = "";
  let blogId = "";
  let postId = "";
  const clients: ScenarioClient[] = [];

  try {
    const [user] = await db
      .insert(users)
      .values({
        appleSub: handle,
        username: handle,
        name: "Collaboration evaluation",
      })
      .returning({ id: users.id });
    userId = user.id;
    const [blog] = await db
      .insert(blogs)
      .values({
        handle,
        name: "Collaboration evaluation",
        ownerId: userId,
      })
      .returning({ id: blogs.id });
    blogId = blog.id;
    const workspaceFolders = await ensureWorkspaceFolders(blogId);
    const blogFolder = workspaceFolders.find((folder) => folder.mode === "blog");
    invariant(blogFolder, "scratch blog folder was not provisioned");
    const [post] = await db
      .insert(posts)
      .values({
        blogId,
        folderId: blogFolder.id,
        type: "article",
        title: COLLABORATION_EVALUATION_BASELINE.content.title,
        excerpt: COLLABORATION_EVALUATION_BASELINE.content.subtitle,
        slug: `shared-document-${stamp}`,
        body: COLLABORATION_EVALUATION_BASELINE.content.body,
        tags: COLLABORATION_EVALUATION_BASELINE.content.tags,
        document: COLLABORATION_EVALUATION_BASELINE,
        templateId:
          COLLABORATION_EVALUATION_BASELINE.presentation.template.id,
        templateVersion:
          COLLABORATION_EVALUATION_BASELINE.presentation.template.version,
        visibility: "private",
        status: "draft",
      })
      .returning({ id: posts.id });
    postId = post.id;

    const baseline = await prepareCollabBaseline(postId);
    invariant(baseline, "server baseline was not prepared");
    clients.push(...createClients(baseline.update));

    for (const client of clients) {
      const awareness = encodeAwarenessUpdate(client.awareness, [
        client.awareness.clientID,
      ]);
      await upsertPresence(postId, {
        clientId: client.id,
        userName: client.id,
        color:
          CLIENTS.find((definition) => definition.id === client.id)?.color ??
          "#3c7de0",
        awareness: updateToBase64(awareness),
      });
    }

    const writeStartedAt = performance.now();
    for (const client of clients.filter((entry) => entry.id !== "offline")) {
      const appended = await appendCollabUpdate(
        postId,
        updateToBase64(client.update),
        baseline.epoch,
      );
      invariant("seq" in appended, "online relay update was fenced unexpectedly");
    }
    const onlineRows = await collabUpdatesSince(postId, 0, baseline.epoch);
    invariant(onlineRows.length === 3, "online relay update count was incorrect");
    const onlineLastSeq = Math.max(...onlineRows.map((row) => row.seq));
    const offline = clients.find((entry) => entry.id === "offline");
    invariant(offline, "offline client was not created");
    const appendedOffline = await appendCollabUpdate(
      postId,
      updateToBase64(offline.update),
      baseline.epoch,
    );
    invariant(
      "seq" in appendedOffline,
      "offline replay was fenced unexpectedly",
    );
    const relayWriteMilliseconds = performance.now() - writeStartedAt;

    const readStartedAt = performance.now();
    const delayedRows = await collabUpdatesSince(
      postId,
      onlineLastSeq,
      baseline.epoch,
    );
    invariant(delayedRows.length === 1, "offline relay replay count was incorrect");
    const allRows = [...onlineRows, ...delayedRows];
    applyRows(clients, allRows);
    const relayReadMilliseconds = performance.now() - readStartedAt;

    const snapshots = clients.map((client) =>
      documentSnapshotFromYDoc(client.doc),
    );
    invariant(
      snapshots.every((snapshot) => isDeepStrictEqual(snapshot, snapshots[0])),
      "relay clients did not converge",
    );
    const stateVectors = clients.map((client) =>
      Buffer.from(Y.encodeStateVector(client.doc)).toString("base64"),
    );
    invariant(
      stateVectors.every((value) => value === stateVectors[0]),
      "relay clients have different state vectors",
    );
    const presence = await activePresence(postId);
    invariant(
      presence.length === CLIENTS.length,
      "presence did not include every client",
    );

    const materializeStartedAt = performance.now();
    const materialized = await materializeCollabDocument(postId);
    const materializeMilliseconds = performance.now() - materializeStartedAt;
    invariant(materialized, "relay document could not be materialized");
    invariant(
      isDeepStrictEqual(materialized, snapshots[0]),
      "server materialization diverged from the clients",
    );

    const beforeSave = await getPostStoreContext(postId);
    invariant(beforeSave, "scratch document disappeared before persistence");
    const beforeRevision = beforeSave.post.revision;
    invariant(
      typeof beforeRevision === "number",
      "scratch document did not have a revision",
    );
    const persistStartedAt = performance.now();
    const saved = await savePost(
      handle,
      { ...beforeSave.post, document: materialized },
      {
        preservePublishedAt: true,
        expectedRevision: beforeRevision,
        audit: {
          actorUserId: userId,
          actorType: "human",
          actionName: "collab.materialize",
          targetType: "item",
          targetId: postId,
          inputSummary: "four-client-evaluation",
        },
      },
    );
    invariant(
      typeof saved.revision === "number" &&
        saved.revision > beforeRevision,
      "canonical revision did not advance",
    );
    await markCollabMaterialized(postId, saved.revision);
    const persisted = await getPostStoreContext(postId);
    invariant(persisted, "persisted document could not be read through the store");
    invariant(
      isDeepStrictEqual(persisted.post.document, materialized),
      "canonical store did not retain the materialized document",
    );
    const persistMilliseconds = performance.now() - persistStartedAt;
    const audits = await db
      .select({ id: actionAudit.id })
      .from(actionAudit)
      .where(
        and(
          eq(actionAudit.targetId, postId),
          eq(actionAudit.actionName, "collab.materialize"),
        ),
      );
    invariant(audits.length === 1, "collaboration save was not audited once");

    return {
      status: "pass",
      clients: clients.length,
      updates: allRows.length,
      updateBytes: clients.reduce(
        (total, client) => total + client.update.byteLength,
        0,
      ),
      presenceStates: presence.length,
      assets: materialized.content.assets.length,
      tags: materialized.content.tags.length,
      themeTokens: Object.keys(materialized.presentation.theme).length,
      revisionAdvanced: 1,
      auditRows: audits.length,
      relayWriteMilliseconds: Math.round(relayWriteMilliseconds),
      relayReadMilliseconds: Math.round(relayReadMilliseconds),
      materializeMilliseconds: Math.round(materializeMilliseconds),
      persistMilliseconds: Math.round(persistMilliseconds),
      totalMilliseconds: Math.round(performance.now() - startedAt),
    };
  } finally {
    for (const client of clients) {
      client.awareness.destroy();
      client.doc.destroy();
    }
    if (postId) {
      await db
        .delete(collabPresence)
        .where(eq(collabPresence.postId, postId))
        .catch(() => {});
      await db
        .delete(collabUpdates)
        .where(eq(collabUpdates.postId, postId))
        .catch(() => {});
      await db
        .delete(collabState)
        .where(eq(collabState.postId, postId))
        .catch(() => {});
      await db
        .delete(actionAudit)
        .where(eq(actionAudit.targetId, postId))
        .catch(() => {});
      await db.delete(posts).where(eq(posts.id, postId)).catch(() => {});
    }
    if (blogId) {
      await db.delete(folders).where(eq(folders.blogId, blogId)).catch(() => {});
      await db.delete(blogs).where(eq(blogs.id, blogId)).catch(() => {});
    }
    if (userId) {
      await db.delete(users).where(eq(users.id, userId)).catch(() => {});
    }
  }
}

evaluate()
  .then(async (metrics) => {
    console.log(JSON.stringify(metrics));
    await closeDatabaseConnections();
  })
  .catch(async (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    await closeDatabaseConnections();
    process.exitCode = 1;
  });
