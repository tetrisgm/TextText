import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  WORKSPACE_TOOL_DEFINITIONS,
  parseWorkspaceToolInput,
  type WorkspaceToolName,
} from "../../src/lib/ai/tools";

type ExpectedTool = {
  mutability: "read" | "write";
  requiredScope: "read" | "sync";
  confirmation: "none" | "destructive" | "audience";
  readOnly: boolean;
  destructive: boolean;
  idempotent: boolean;
  openWorld: boolean;
};

type ToolDefinition = {
  mutability: ExpectedTool["mutability"];
  requiredScope: ExpectedTool["requiredScope"];
  confirmation: ExpectedTool["confirmation"];
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
};

const evaluations = [
  {
    id: "workflow.folder_trash_restore",
    run() {
      expectTool("list_trash", {
        mutability: "read",
        requiredScope: "read",
        confirmation: "none",
        readOnly: true,
        destructive: false,
        idempotent: true,
        openWorld: false,
      });
      expectTool("delete_folder", {
        mutability: "write",
        requiredScope: "sync",
        confirmation: "destructive",
        readOnly: false,
        destructive: true,
        idempotent: true,
        openWorld: false,
      });
      expectTool("restore_folder", {
        mutability: "write",
        requiredScope: "sync",
        confirmation: "audience",
        readOnly: false,
        destructive: false,
        idempotent: true,
        openWorld: false,
      });
      parse("delete_folder", { folder_id: "folder-1" });
      parse("restore_folder", { folder_id: "folder-1" });
      expectThrows(() =>
        parse("delete_folder", { folder_id: "folder-1", permanent: true }),
      );
    },
  },
  {
    id: "workflow.sharing_access",
    run() {
      expectTool("list_access", {
        mutability: "read",
        requiredScope: "sync",
        confirmation: "none",
        readOnly: true,
        destructive: false,
        idempotent: true,
        openWorld: false,
      });
      expectTool("grant_access", {
        mutability: "write",
        requiredScope: "sync",
        confirmation: "audience",
        readOnly: false,
        destructive: false,
        idempotent: false,
        openWorld: false,
      });
      expectTool("set_access_role", {
        mutability: "write",
        requiredScope: "sync",
        confirmation: "audience",
        readOnly: false,
        destructive: true,
        idempotent: true,
        openWorld: false,
      });
      expectTool("revoke_access", {
        mutability: "write",
        requiredScope: "sync",
        confirmation: "audience",
        readOnly: false,
        destructive: true,
        idempotent: true,
        openWorld: false,
      });
      parse("grant_access", {
        scope_type: "folder",
        scope_id: "folder-1",
        email: "reader@example.com",
        role: "viewer",
      });
      expectThrows(() =>
        parse("grant_access", {
          scope_type: "workspace",
          email: "reader@example.com",
          role: "viewer",
        }),
      );
    },
  },
  {
    id: "workflow.comments",
    run() {
      expectTool("list_comments", {
        mutability: "read",
        requiredScope: "read",
        confirmation: "none",
        readOnly: true,
        destructive: false,
        idempotent: true,
        openWorld: false,
      });
      expectTool("add_comment", {
        mutability: "write",
        requiredScope: "sync",
        confirmation: "none",
        readOnly: false,
        destructive: false,
        idempotent: false,
        openWorld: false,
      });
      expectTool("set_comment_resolved", {
        mutability: "write",
        requiredScope: "sync",
        confirmation: "none",
        readOnly: false,
        destructive: true,
        idempotent: true,
        openWorld: false,
      });
      parse("add_comment", {
        id: "item-1",
        body: "Review this section.",
        anchor_field: "body",
        anchor_exact: "section",
        anchor_start: 12,
        anchor_end: 19,
      });
      expectThrows(() =>
        parse("add_comment", {
          id: "item-1",
          body: "Review this section.",
          anchor_field: "body",
          anchor_exact: "section",
          anchor_start: 19,
          anchor_end: 12,
        }),
      );
    },
  },
  {
    id: "workflow.bookmark_recapture",
    run() {
      expectTool("recapture_bookmark", {
        mutability: "write",
        requiredScope: "sync",
        confirmation: "none",
        readOnly: false,
        destructive: true,
        idempotent: false,
        openWorld: true,
      });
      parse("recapture_bookmark", {
        id: "bookmark-1",
        if_match_hash: "capture-hash",
      });
      expectThrows(() =>
        parse("recapture_bookmark", {
          id: "bookmark-1",
          source_url: "https://other.example/",
        }),
      );
    },
  },
  {
    id: "workflow.cover_assets",
    run() {
      expectTool("list_item_assets", {
        mutability: "read",
        requiredScope: "read",
        confirmation: "none",
        readOnly: true,
        destructive: false,
        idempotent: true,
        openWorld: false,
      });
      expectTool("add_item_asset", {
        mutability: "write",
        requiredScope: "sync",
        confirmation: "none",
        readOnly: false,
        destructive: false,
        idempotent: false,
        openWorld: true,
      });
      expectTool("remove_item_asset", {
        mutability: "write",
        requiredScope: "sync",
        confirmation: "destructive",
        readOnly: false,
        destructive: true,
        idempotent: true,
        openWorld: false,
      });
      expectTool("set_item_cover", {
        mutability: "write",
        requiredScope: "sync",
        confirmation: "none",
        readOnly: false,
        destructive: true,
        idempotent: true,
        openWorld: false,
      });
      parse("add_item_asset", {
        id: "item-1",
        source_url: "https://assets.example/cover.jpg",
        placement: "cover",
        if_match_hash: "asset-hash",
      });
      parse("set_item_cover", {
        id: "item-1",
        source: "url",
        url: "https://assets.example/cover.jpg",
        if_match_hash: "cover-hash",
      });
      expectThrows(() =>
        parse("set_item_cover", {
          id: "item-1",
          source: "auto",
          url: "https://assets.example/cover.jpg",
        }),
      );
    },
  },
] as const;

function definition(name: string): ToolDefinition {
  const value = (WORKSPACE_TOOL_DEFINITIONS as Record<string, unknown>)[name];
  assert(value, `missing tool ${name}`);
  return value as ToolDefinition;
}

function expectTool(name: string, expected: ExpectedTool) {
  const tool = definition(name);
  assert(tool.mutability === expected.mutability, `${name} mutability`);
  assert(tool.requiredScope === expected.requiredScope, `${name} scope`);
  assert(tool.confirmation === expected.confirmation, `${name} confirmation`);
  assert(tool.annotations.readOnlyHint === expected.readOnly, `${name} read-only`);
  assert(
    tool.annotations.destructiveHint === expected.destructive,
    `${name} destructive`,
  );
  assert(
    tool.annotations.idempotentHint === expected.idempotent,
    `${name} idempotent`,
  );
  assert(tool.annotations.openWorldHint === expected.openWorld, `${name} open-world`);
}

function parse(name: string, input: unknown) {
  return parseWorkspaceToolInput(name as WorkspaceToolName, input);
}

function expectThrows(operation: () => unknown) {
  let threw = false;
  try {
    operation();
  } catch {
    threw = true;
  }
  assert(threw, "invalid fixture was accepted");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const output = process.argv[2];
  const sourceCommit = process.argv[3];
  const contractHash = process.argv[4];
  if (
    !output ||
    !/^[0-9a-f]{40}$/.test(sourceCommit ?? "") ||
    !/^[0-9a-f]{64}$/.test(contractHash ?? "")
  ) {
    console.error(
      "usage: workflow-capability-eval.ts <output.json> <source-commit> <contract-hash>",
    );
    process.exit(64);
  }

  const failed: string[] = [];
  for (const evaluation of evaluations) {
    try {
      evaluation.run();
    } catch {
      failed.push(evaluation.id);
    }
  }
  const target = resolve(output);
  if (failed.length > 0) {
    await rm(target, { force: true });
    console.error(`workflow capability evaluation failed: ${failed.join(", ")}`);
    process.exit(1);
  }

  const payload = {
    schemaVersion: 1,
    sourceCommit,
    contractHash,
    generatedAt: new Date().toISOString(),
    checks: evaluations.map((evaluation) => ({
      id: evaluation.id,
      status: "pass",
    })),
  };
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, target);
  await chmod(target, 0o600);
  console.log(`workflow capabilities: pass (${payload.checks.length} checks)`);
}

void main().catch(() => {
  console.error("workflow capability evaluator failed");
  process.exitCode = 1;
});
