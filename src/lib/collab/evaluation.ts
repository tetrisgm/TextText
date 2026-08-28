import * as Y from "yjs";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from "y-protocols/awareness";
import {
  applyDocumentBaseline,
  documentAssets,
  documentFields,
  documentPresentation,
  documentSnapshotFromYDoc,
  documentTags,
  documentText,
  documentTheme,
} from "@/lib/collab/document";
import {
  validateDocumentSnapshot,
  type DocumentSnapshot,
} from "@/lib/documents/model";

const CLIENTS = [
  { id: "browser", clientId: 101, name: "Browser editor", color: "#3c7de0" },
  { id: "native", clientId: 202, name: "Mac editor", color: "#2ca39a" },
  { id: "agent", clientId: 303, name: "Agent", color: "#b05ae0" },
  { id: "offline", clientId: 404, name: "Offline editor", color: "#e08a3c" },
] as const;

export const COLLABORATION_EVALUATION_BASELINE = validateDocumentSnapshot({
  schemaVersion: 1,
  content: {
    title: "Shared field notes",
    subtitle: "Four editors, one portable document",
    body: "The original paragraph.",
    fields: { status: "draft" },
    tags: ["collaboration"],
    assets: [],
  },
  presentation: {
    template: { id: "texttext.article", version: 1 },
    theme: {
      accent: "#0071E3",
      density: "comfortable",
      measure: "reading",
    },
  },
});

type CollaborationEvaluationResult = {
  status: "pass";
  clients: number;
  editOperations: number;
  relayRounds: number;
  updateBytes: number;
  awarenessStates: number;
  contentFields: number;
  assets: number;
  tags: number;
  themeTokens: number;
};

type ScenarioClient = {
  id: (typeof CLIENTS)[number]["id"];
  doc: Y.Doc;
  awareness: Awareness;
  baselineVector: Uint8Array;
  update?: Uint8Array;
};

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function bytesKey(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((entry, index) => valuesEqual(entry, right[index]));
  }
  if (
    !left ||
    !right ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    return false;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] &&
        valuesEqual(leftRecord[key], rightRecord[key]),
    )
  );
}

function firstDifferencePath(left: unknown, right: unknown, path = "document"): string {
  if (valuesEqual(left, right)) return "";
  if (
    !left ||
    !right ||
    typeof left !== "object" ||
    typeof right !== "object" ||
    Array.isArray(left) !== Array.isArray(right)
  ) {
    return path;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)]);
  for (const key of keys) {
    const difference = firstDifferencePath(
      leftRecord[key],
      rightRecord[key],
      `${path}.${key}`,
    );
    if (difference) return difference;
  }
  return path;
}

function addUnique(target: Y.Array<unknown>, value: unknown): void {
  if (!target.toArray().some((entry) => JSON.stringify(entry) === JSON.stringify(value))) {
    target.push([value]);
  }
}

function makeClients(): ScenarioClient[] {
  return CLIENTS.map((definition) => {
    const doc = new Y.Doc();
    applyDocumentBaseline(doc, COLLABORATION_EVALUATION_BASELINE, "collaboration-eval");
    doc.clientID = definition.clientId;
    const awareness = new Awareness(doc);
    awareness.setLocalState({
      user: {
        id: definition.id,
        name: definition.name,
        color: definition.color,
      },
      selection: {
        field: "body",
        anchor: definition.clientId % 7,
        head: definition.clientId % 7,
      },
    });
    return {
      id: definition.id,
      doc,
      awareness,
      baselineVector: Y.encodeStateVector(doc),
    };
  });
}

function applyClientEdits(client: ScenarioClient): number {
  const body = documentText(client.doc, "body");
  switch (client.id) {
    case "browser":
      documentText(client.doc, "title").insert(
        COLLABORATION_EVALUATION_BASELINE.content.title.length,
        " from the browser",
      );
      documentFields(client.doc).set("browserState", "ready");
      documentTheme(client.doc).set("accent", "#FF375F");
      return 3;
    case "native":
      body.insert(0, "Mac edit. ");
      addUnique(documentAssets(client.doc), {
        id: "native-cover",
        kind: "image",
        src: "assets/native-cover.jpg",
      });
      documentTheme(client.doc).set("density", "compact");
      return 3;
    case "agent":
      body.insert(0, "Agent edit. ");
      addUnique(documentTags(client.doc), "agent-authored");
      documentPresentation(client.doc).set("templateId", "texttext.gallery");
      return 3;
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
      return 4;
  }
}

function applyInOrder(
  clients: ScenarioClient[],
  updates: Map<string, Uint8Array>,
  order: string[],
): void {
  for (const client of clients) {
    for (const id of order) {
      const update = updates.get(id);
      if (update) Y.applyUpdate(client.doc, update, "evaluation-relay");
    }
  }
}

export function evaluateMultiClientCollaboration(): CollaborationEvaluationResult {
  const clients = makeClients();
  const observerDoc = new Y.Doc();
  const observer = new Awareness(observerDoc);
  observer.setLocalState(null);
  let editOperations = 0;
  try {
    for (const client of clients) {
      editOperations += applyClientEdits(client);
      client.update = Y.encodeStateAsUpdate(client.doc, client.baselineVector);
    }

    const updates = new Map(
      clients.map((client) => [client.id, client.update ?? new Uint8Array()]),
    );
    const online = clients.filter((client) => client.id !== "offline");
    applyInOrder(online, updates, ["agent", "browser", "native"]);
    applyInOrder([clients[3]], updates, ["native", "browser", "agent"]);
    applyInOrder(clients, updates, ["offline"]);

    for (const source of clients) {
      const fullState = Y.encodeStateAsUpdate(source.doc);
      for (const target of clients) {
        Y.applyUpdate(target.doc, fullState, "evaluation-final-sync");
      }
      applyAwarenessUpdate(
        observer,
        encodeAwarenessUpdate(source.awareness, [source.awareness.clientID]),
        "evaluation-presence",
      );
    }

    const snapshots = clients.map((client) =>
      documentSnapshotFromYDoc(client.doc),
    );
    const divergentIndex = snapshots.findIndex(
      (snapshot) => !valuesEqual(snapshot, snapshots[0]),
    );
    invariant(
      divergentIndex === -1,
      `four collaboration clients did not converge at ${
        firstDifferencePath(snapshots[0], snapshots[divergentIndex]) || "document"
      }`,
    );
    const stateVectors = clients.map((client) =>
      bytesKey(Y.encodeStateVector(client.doc)),
    );
    invariant(
      stateVectors.every((stateVector) => stateVector === stateVectors[0]),
      "four collaboration clients have different CRDT state vectors",
    );

    const result: DocumentSnapshot = snapshots[0];
    invariant(result.content.title.endsWith(" from the browser"), "browser title edit was lost");
    invariant(result.content.subtitle?.endsWith(" after reconnect"), "offline edit was lost");
    invariant(result.content.body.includes("Mac edit."), "native body edit was lost");
    invariant(result.content.body.includes("Agent edit."), "agent body edit was lost");
    invariant(result.content.fields.browserState === "ready", "browser field was lost");
    invariant(result.content.fields.offlineState === "replayed", "offline field was lost");
    invariant(result.content.tags.includes("agent-authored"), "agent tag was lost");
    invariant(result.content.assets.length === 2, "concurrent assets did not merge");
    invariant(
      result.presentation.template.id === "texttext.gallery",
      "agent presentation change was lost",
    );
    invariant(result.presentation.theme.accent === "#FF375F", "accent change was lost");
    invariant(result.presentation.theme.density === "compact", "density change was lost");
    invariant(result.presentation.theme.measure === "wide", "offline look change was lost");
    invariant(observer.getStates().size === CLIENTS.length, "presence did not include every client");

    return {
      status: "pass",
      clients: clients.length,
      editOperations,
      relayRounds: 2,
      updateBytes: Array.from(updates.values()).reduce(
        (total, update) => total + update.byteLength,
        0,
      ),
      awarenessStates: observer.getStates().size,
      contentFields: Object.keys(result.content.fields).length,
      assets: result.content.assets.length,
      tags: result.content.tags.length,
      themeTokens: Object.keys(result.presentation.theme).length,
    };
  } finally {
    observer.destroy();
    observerDoc.destroy();
    for (const client of clients) {
      client.awareness.destroy();
      client.doc.destroy();
    }
  }
}
