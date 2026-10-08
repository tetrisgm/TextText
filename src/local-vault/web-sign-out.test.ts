import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signOutFromWeb } from "./web-sign-out";

describe("browser account sign out", () => {
  const flush = vi.fn(), request = vi.fn(), navigate = vi.fn();
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("window", { texttextFlushForSignOut: flush, location: { origin: "https://texttext.test", assign: navigate } });
    vi.stubGlobal("fetch", request);
  });
  afterEach(() => vi.unstubAllGlobals());
  it("never invalidates the session when pending edits cannot be saved", async () => {
    flush.mockResolvedValue(false);
    await expect(signOutFromWeb()).rejects.toThrow("not finished saving");
    expect(request).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled();
  });
  it("waits for durable save before requesting sign out", async () => {
    let finish!: (value: boolean) => void;
    flush.mockReturnValue(new Promise<boolean>(resolve => { finish = resolve; }));
    request.mockResolvedValueOnce(Response.json({ csrfToken: "csrf" })).mockResolvedValueOnce(Response.json({ url: "https://foreign.test/" }));
    const result = signOutFromWeb();
    await Promise.resolve(); expect(request).not.toHaveBeenCalled();
    finish(true); await result;
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][0]).toBe("/api/auth/signout");
    expect(request.mock.calls[1][1].body.get("csrfToken")).toBe("csrf");
    expect(navigate).toHaveBeenCalledWith("/signin");
  });
  it("keeps the page open if save throws or sign out fails", async () => {
    flush.mockRejectedValueOnce(new Error("disk full"));
    await expect(signOutFromWeb()).rejects.toThrow("disk full");
    expect(request).not.toHaveBeenCalled();
    flush.mockResolvedValue(true);
    request.mockResolvedValueOnce(Response.json({ csrfToken: "csrf" })).mockResolvedValueOnce(new Response(null, { status: 503 }));
    await expect(signOutFromWeb()).rejects.toThrow("Could not sign out");
    expect(navigate).not.toHaveBeenCalled();
  });
});
