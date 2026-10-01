import { beforeEach, describe, expect, it, vi } from "vitest";

const serveReleaseDownload = vi.hoisted(() => vi.fn(async () => new Response("fixture")));
vi.mock("@/lib/release-download.server", () => ({ serveReleaseDownload }));

const { GET, HEAD } = await import("./route");

describe("/downloads/[filename]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("forwards GET and Range through Next 16 async route params", async () => {
    const response = await GET(
      new Request("https://texttext.app/downloads/TextText-0.203.zip", { headers: { range: "bytes=1-2" } }),
      { params: Promise.resolve({ filename: "TextText-0.203.zip" }) },
    );
    expect(await response.text()).toBe("fixture");
    expect(serveReleaseDownload).toHaveBeenCalledWith("TextText-0.203.zip", { method: "GET", range: "bytes=1-2" });
  });

  it("uses metadata-only delivery for HEAD", async () => {
    await HEAD(
      new Request("https://texttext.app/downloads/appcast-0.203.xml", { method: "HEAD" }),
      { params: Promise.resolve({ filename: "appcast-0.203.xml" }) },
    );
    expect(serveReleaseDownload).toHaveBeenCalledWith("appcast-0.203.xml", { method: "HEAD" });
  });
});
