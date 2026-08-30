import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  searchAccessibleWorkspacePostFiles: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/store", () => ({
  searchAccessibleWorkspacePostFiles: mocks.searchAccessibleWorkspacePostFiles,
}));

import { GET } from "@/app/api/workspace/search/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue({ sub: "owner-sub" });
  mocks.searchAccessibleWorkspacePostFiles.mockResolvedValue([
    {
      id: "deep-match",
      title: "Planning note",
      body: `${"private preface ".repeat(300)}cedar launch decision`,
    },
  ]);
});

describe("workspace deep-search API", () => {
  it("returns a bounded excerpt and never the full private body", async () => {
    const response = await GET(
      new Request(
        "https://texttext.example/api/workspace/search?handle=garden&query=cedar",
      ),
    );
    const payload = (await response.json()) as {
      matches: Array<{ postId: string; detail: string; score: number }>;
    };

    expect(response.status).toBe(200);
    expect(mocks.searchAccessibleWorkspacePostFiles).toHaveBeenCalledWith(
      "garden",
      { sub: "owner-sub" },
      ["cedar"],
    );
    expect(payload.matches).toHaveLength(1);
    expect(payload.matches[0]).toMatchObject({ postId: "deep-match" });
    expect(payload.matches[0]).not.toHaveProperty("body");
    expect(payload.matches[0].detail).toContain("cedar");
    expect(payload.matches[0].detail.length).toBeLessThan(300);
    expect(JSON.stringify(payload).length).toBeLessThan(500);
  });

  it("rejects missing workspace and undersized queries before content access", async () => {
    const missingHandle = await GET(
      new Request("https://texttext.example/api/workspace/search?query=cedar"),
    );
    const shortQuery = await GET(
      new Request(
        "https://texttext.example/api/workspace/search?handle=garden&query=ab",
      ),
    );

    expect(missingHandle.status).toBe(400);
    expect(shortQuery.status).toBe(400);
    expect(mocks.searchAccessibleWorkspacePostFiles).not.toHaveBeenCalled();
  });
});
