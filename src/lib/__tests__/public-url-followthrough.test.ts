import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const rootRobots = (await import("@/app/robots")).default;
const { accountDeletionConsequences } = await import(
  "@/lib/account-deletion-copy"
);
const {
  platformReportUrl,
  workspacePublicBaseUrl,
} = await import("@/lib/public-paths");

const root = new URL("../../../", import.meta.url);
const previousRootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN;

beforeEach(() => {
  process.env.NEXT_PUBLIC_ROOT_DOMAIN = "localhost:3100";
});

afterEach(() => {
  if (previousRootDomain === undefined) {
    delete process.env.NEXT_PUBLIC_ROOT_DOMAIN;
  } else {
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = previousRootDomain;
  }
});

describe("public URL migration follow-through", () => {
  it("leaves a tenant origin for the platform report form", () => {
    expect(
      platformReportUrl(
        "/blog/research/field-notes",
        "74341338-11a9-4ca4-b205-041dc0ce3bb3",
      ),
    ).toBe(
      "http://localhost:3100/report?path=%2Fblog%2Fresearch%2Ffield-notes&doc=74341338-11a9-4ca4-b205-041dc0ce3bb3",
    );
  });

  it("describes account deletion with the workspace-owned public address", () => {
    const consequences = accountDeletionConsequences({
      identities: [],
      email: null,
      username: null,
      handle: "clear-slate",
      workspaceName: "Clear Slate",
      documents: 2,
      publishedDocuments: 1,
      collaborators: 0,
      apiTokens: 0,
      hasCloudAiKey: false,
      confirmationPhrase: "delete clear slate",
    });
    const copy = consequences.join(" ");

    expect(copy).toContain("clear-slate.localhost:3100");
    expect(copy).not.toContain("/t/clear-slate");
  });

  it("removes legacy demo sitemaps from root robots discovery", () => {
    expect(rootRobots().sitemap).toBe("http://localhost:3100/sitemap.xml");
    expect(JSON.stringify(rootRobots())).not.toMatch(/\/(?:@demo|t\/demo)/);
  });

  it("derives connector examples from the configured public root", () => {
    expect(workspacePublicBaseUrl("alice")).toBe(
      "http://alice.localhost:3100",
    );
  });

  it("keeps shipped examples and health checks off retired public shapes", () => {
    const paths = [
      "README.md",
      "ARCHITECTURE.md",
      "public/openapi/sync-v1.yaml",
      "src/app/openapi.json/route.ts",
      "src/app/report/ReportForm.tsx",
      "src/lib/presentation/exemplars.ts",
      "mac/Sources/TextText/AppHealthReporter.swift",
    ];
    const retired = [
      /canonical: .*\/@alice\//,
      /TextText\.app\/@demo\//,
      /TextText\.app\/t\/demo\//,
      /placeholder="\/t\/handle\/page"/,
    ];

    for (const path of paths) {
      const source = readFileSync(new URL(path, root), "utf8");
      for (const pattern of retired) {
        expect(source, `${path}: ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});
