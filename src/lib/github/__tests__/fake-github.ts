import type { GithubFetch } from "../app.server";
import { gitBlobSha } from "../textpack";

/**
 * Enough of GitHub's Git Data and Contents APIs, in memory, for the backup
 * to run end to end: one repository, one branch, blobs by sha, trees as
 * flat path maps, commits as a chain.
 */
export function fakeGithub(options: { repository?: string; defaultBranch?: string; empty?: boolean } = {}) {
  const repository = options.repository ?? "octo/backup";
  const branch = options.defaultBranch ?? "main";
  const blobs = new Map<string, Uint8Array>();
  const trees = new Map<string, Map<string, string>>();
  const commits = new Map<string, { tree: string; parents: string[]; message: string }>();
  const refs = new Map<string, string>();
  const calls: string[] = [];
  let counter = 0;
  const id = (prefix: string) => `${prefix}${(counter += 1).toString(16).padStart(40 - prefix.length, "0")}`;
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  const putBlob = (bytes: Uint8Array) => {
    const sha = gitBlobSha(bytes);
    blobs.set(sha, bytes);
    return sha;
  };
  const commitTree = (tree: Map<string, string>, message: string, parents: string[]) => {
    const treeSha = id("t");
    trees.set(treeSha, tree);
    const sha = id("c");
    commits.set(sha, { tree: treeSha, parents, message });
    refs.set(branch, sha);
    return sha;
  };
  if (!options.empty) commitTree(new Map([["README.md", putBlob(new TextEncoder().encode("# repo\n"))]]), "init", []);

  const fetcher: GithubFetch = async (url, init) => {
    const method = init?.method ?? "GET";
    const u = new URL(url);
    const path = u.pathname;
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    calls.push(`${method} ${path}`);
    if (path.startsWith("/app/installations/") && path.endsWith("/access_tokens")) return json(201, { token: "ghs_fake", expires_at: new Date(Date.now() + 3600_000).toISOString() });
    if (path === "/installation/repositories") return json(200, { repositories: [{ full_name: repository, private: true, default_branch: branch, permissions: { push: true } }] });
    if (path === `/repos/${repository}`) return json(200, { default_branch: branch });
    if (path === `/repos/${repository}/git/ref/heads/${branch}`) {
      const sha = refs.get(branch);
      return sha ? json(200, { object: { sha } }) : json(404, { message: "Not Found" });
    }
    if (path.startsWith(`/repos/${repository}/git/commits/`) && method === "GET") {
      const commit = commits.get(path.split("/").pop()!);
      return commit ? json(200, { tree: { sha: commit.tree } }) : json(404, { message: "Not Found" });
    }
    if (path === `/repos/${repository}/git/blobs` && method === "POST") {
      return json(201, { sha: putBlob(Buffer.from(String(body.content), "base64")) });
    }
    if (path === `/repos/${repository}/git/trees` && method === "POST") {
      const base = trees.get(String(body.base_tree));
      if (!base) return json(404, { message: "base tree" });
      const next = new Map(base);
      for (const entry of body.tree as Array<{ path: string; sha: string | null }>) {
        if (entry.sha === null) next.delete(entry.path);
        else {
          if (!blobs.has(entry.sha)) return json(422, { message: `unknown blob ${entry.path}` });
          next.set(entry.path, entry.sha);
        }
      }
      const sha = id("t");
      trees.set(sha, next);
      return json(201, { sha });
    }
    if (path === `/repos/${repository}/git/commits` && method === "POST") {
      const sha = id("c");
      commits.set(sha, { tree: String(body.tree), parents: body.parents as string[], message: String(body.message) });
      return json(201, { sha });
    }
    if (path === `/repos/${repository}/git/refs/heads/${branch}` && method === "PATCH") {
      refs.set(branch, String(body.sha));
      return json(200, { object: { sha: body.sha } });
    }
    if (path.startsWith(`/repos/${repository}/contents/`)) {
      const file = decodeURIComponent(path.slice(`/repos/${repository}/contents/`.length));
      if (method === "PUT") {
        const head = refs.get(branch);
        const tree = new Map(head ? trees.get(commits.get(head)!.tree) : []);
        tree.set(file, putBlob(Buffer.from(String(body.content), "base64")));
        commitTree(tree, String(body.message), head ? [head] : []);
        return json(201, {});
      }
      const head = refs.get(branch);
      const sha = head ? trees.get(commits.get(head)!.tree)?.get(file) : undefined;
      if (!sha) return json(404, { message: "Not Found" });
      return json(200, { content: Buffer.from(blobs.get(sha)!).toString("base64"), encoding: "base64" });
    }
    return json(404, { message: `unhandled ${method} ${path}` });
  };

  const headTree = () => {
    const head = refs.get(branch);
    return head ? new Map(trees.get(commits.get(head)!.tree)) : new Map<string, string>();
  };
  const fileText = (file: string) => {
    const sha = headTree().get(file);
    return sha ? Buffer.from(blobs.get(sha)!).toString("utf8") : null;
  };
  return { fetcher, calls, headTree, fileText, commitCount: () => commits.size, blobs };
}
