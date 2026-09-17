import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const session = vi.hoisted(() => ({ user: null as null | { sub: string } }));
vi.mock("@/lib/session", () => ({ getCurrentUser: async () => session.user }));
vi.mock("@/app/editor/actions", () => ({
  resolveWorkspaceHomePath: async () => "/@writer",
  createStarterDraftPath: async () => "/@writer/blog/first-draft",
  createTemplateDraftPath: async (slug: string) => `/@writer/blog/${slug}`,
}));

const { GET } = await import("../route");

describe("/start", () => {
  beforeEach(() => {
    session.user = null;
  });

  it("sends a signed-out visitor to sign in with the intent, and drops the router's own parameter", async () => {
    const response = await GET(new NextRequest("https://texttext.app/start?to=home&_rsc=abc123"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://texttext.app/signin?callbackUrl=%2Fstart%3Fto%3Dhome");
    const bare = await GET(new NextRequest("https://texttext.app/start?_rsc=abc123"));
    expect(bare.headers.get("location")).toBe("https://texttext.app/signin?callbackUrl=%2Fstart");
  });

  it("answers a signed-in visitor with a real redirect even on a router-shaped URL", async () => {
    session.user = { sub: "apple-sub" };
    const home = await GET(new NextRequest("https://texttext.app/start?to=home&_rsc=abc123"));
    expect(home.status).toBe(307);
    expect(home.headers.get("location")).toBe("https://texttext.app/@writer");
    const draft = await GET(new NextRequest("https://texttext.app/start?_rsc=abc123"));
    expect(draft.headers.get("location")).toBe("https://texttext.app/@writer/blog/first-draft");
    const template = await GET(new NextRequest("https://texttext.app/start?template=recipe"));
    expect(template.headers.get("location")).toBe("https://texttext.app/@writer/blog/recipe");
  });
});
