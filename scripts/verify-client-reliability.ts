import {
  createOptimisticWorkspacePost,
  createWorkspaceItemIdentityRegistry,
  mergeCreatedWorkspacePost,
} from "@/components/workspace/useLocalWorkspaceInteraction";
import { evaluateMultiClientCollaboration } from "@/lib/collab/evaluation";
import type {
  WorkspacePoolPayload,
  WorkspacePoolPost,
} from "@/lib/pool/types";

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function emptyPool(): WorkspacePoolPayload {
  return {
    version: 1,
    blogId: "reliability-workspace",
    fetchedAt: "2026-07-23T00:00:00.000Z",
    blog: {
      handle: "reliability",
      name: "Reliability",
      author: "TextText",
      tagline: "",
      homeLayout: "grid",
    },
    folders: [
      { id: "blog", name: "Blog", path: "blog", mode: "blog", position: 0 },
      { id: "notes", name: "Notes", path: "notes", mode: "notes", position: 1 },
      {
        id: "bookmarks",
        name: "Bookmarks",
        path: "bookmarks",
        mode: "bookmarks",
        position: 2,
      },
    ],
    posts: [],
    trashedPosts: [],
    trashedFolders: [],
    counts: {},
    templates: [],
    initialDocuments: [],
  };
}

function savedPost(
  optimistic: WorkspacePoolPost,
  index: number,
): WorkspacePoolPost {
  return {
    ...optimistic,
    id: `saved-${index}`,
    slug: `saved-${index}`,
    title: "Server placeholder",
    excerpt: "Server placeholder",
  };
}

const pool = emptyPool();
const identity = createWorkspaceItemIdentityRegistry();
const createdAt = Date.parse("2026-07-23T00:00:00.000Z");
const optimistic = Array.from({ length: 120 }, (_, index) => {
  if (index % 3 === 0) {
    return createOptimisticWorkspacePost(
      pool,
      { type: "article", folderPath: "blog" },
      createdAt,
    );
  }
  if (index % 3 === 1) {
    return createOptimisticWorkspacePost(
      pool,
      { type: "note", folderPath: "notes" },
      createdAt,
    );
  }
  return createOptimisticWorkspacePost(
    pool,
    {
      type: "bookmark",
      folderPath: "bookmarks",
      url: `https://TextText.app/reliability/${index}`,
    },
    createdAt,
  );
});

invariant(
  new Set(optimistic.map((post) => post.id)).size === optimistic.length,
  "same-tick page creation produced duplicate client identities",
);

const reconciled = optimistic.map((post, index) => {
  const stableKey = identity.stableKey(post.id);
  const saved = savedPost(post, index);
  identity.reconcile(post.id, saved.id);
  const merged = mergeCreatedWorkspacePost(saved, {
    ...post,
    title: `Local title ${index}`,
    excerpt: `Local draft ${index}`,
  });
  invariant(
    identity.stableKey(saved.id) === stableKey,
    "server adoption replaced the live editor identity",
  );
  invariant(
    merged.title === `Local title ${index}` &&
      merged.excerpt === `Local draft ${index}`,
    "server adoption replaced a newer local draft",
  );
  return merged;
});

for (let cycle = 0; cycle < 20; cycle += 1) {
  const result = evaluateMultiClientCollaboration();
  invariant(result.clients === 4, "collaboration evaluation lost a client");
  invariant(
    result.awarenessStates === 4,
    "collaboration presence did not converge",
  );
}

console.log(
  JSON.stringify({
    status: "pass",
    sameTickCreations: optimistic.length,
    reconciledItems: reconciled.length,
    collaborationClients: 4,
    collaborationCycles: 20,
  }),
);
