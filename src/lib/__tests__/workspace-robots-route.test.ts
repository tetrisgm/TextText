import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getBlog: vi.fn(),
}));

vi.mock("@/lib/store", () => ({
  getBlog: mocks.getBlog,
}));

const { GET } = await import("@/app/t/[handle]/robots.txt/route");
const previousRootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_ROOT_DOMAIN = "localhost:3100";
});

afterEach(() => {
  if (previousRootDomain === undefined) {
    delete process.env.NEXT_PUBLIC_ROOT_DOMAIN;
  } else {
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = previousRootDomain;
  }
});

describe("workspace robots route", () => {
  it("publishes workspace-local sitemap discovery", async () => {
    mocks.getBlog.mockResolvedValue({ handle: "clear-slate" });
    const response = await GET(
      new Request("http://clear-slate.localhost:3100/robots.txt"),
      { params: Promise.resolve({ handle: "clear-slate" }) },
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain(
      "Sitemap: http://clear-slate.localhost:3100/sitemap.xml",
    );
  });

  it("keeps unknown workspaces on the generic 404 boundary", async () => {
    mocks.getBlog.mockResolvedValue(null);
    const response = await GET(
      new Request("http://missing.localhost:3100/robots.txt"),
      { params: Promise.resolve({ handle: "missing" }) },
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not found");
  });
});
