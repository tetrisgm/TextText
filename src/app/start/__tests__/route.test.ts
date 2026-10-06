import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const session = vi.hoisted(() => ({ user: null as null | { sub: string } }));
const templateDraft = vi.hoisted(() => vi.fn(async (slug: string) => `/@writer/blog/${slug}`));
const workspaceHome = vi.hoisted(() => vi.fn(async () => "/@writer"));
vi.mock("@/lib/session", () => ({ getCurrentUser: async () => session.user }));
vi.mock("@/app/editor/actions", () => ({
  resolveWorkspaceHomePath: workspaceHome,
  createStarterDraftPath: async () => "/@writer/blog/first-draft",
  createTemplateDraftPath: templateDraft,
}));

const { GET } = await import("../route");
const { AccountLinkRequiredError } = await import("@/lib/store");

describe("/start", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.user = null;
    vi.stubEnv("AUTH_URL", "https://texttext.app");
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each(["http", "https"])("redirects the %s loopback listener to the public sign-in host", async (protocol) => {
    const response = await GET(new NextRequest(`${protocol}://localhost:3400/start?to=home`, {
      headers: { host: "texttext.app", "x-forwarded-proto": "https" },
    }));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://texttext.app/signin?callbackUrl=%2Fstart%3Fto%3Dhome");
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
    expect(templateDraft).toHaveBeenCalledWith("recipe", false);
    const seeded = await GET(new NextRequest("https://texttext.app/start?template=gallery&seed=1"));
    expect(seeded.headers.get("location")).toBe("https://texttext.app/@writer/blog/gallery");
    expect(templateDraft).toHaveBeenCalledWith("gallery", true);
  });

  it("routes a matching-email account to linking guidance", async () => {
    session.user = { sub: "new-provider" };
    workspaceHome.mockRejectedValueOnce(new AccountLinkRequiredError());
    const response = await GET(new NextRequest("https://texttext.app/start?to=home"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://texttext.app/signin?error=AccountLinkRequired");
  });

  it("rejects an invalid template query without creating a generic draft", async () => {
    session.user = { sub: "apple-sub" };
    const response = await GET(new NextRequest("https://texttext.app/start?template=%2Fbad&seed=1"));
    expect(response.headers.get("location")).toBe("https://texttext.app/templates");
    expect(templateDraft).not.toHaveBeenCalled();
  });
});
