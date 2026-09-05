import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { presencePeersEqual } from "@/lib/collab/usePresence";

const source = readFileSync(
  new URL("../collab/usePresence.ts", import.meta.url),
  "utf8",
);

const peer = {
  clientId: "client-1",
  userName: "Ramine",
  color: "#123456",
  awareness: "cursor-state",
  participantType: "person" as const,
  provider: "openai",
};

describe("reader presence polling", () => {
  it("preserves state identity when every visible peer field is unchanged", () => {
    expect(presencePeersEqual([peer], [{ ...peer }])).toBe(true);
    expect(
      presencePeersEqual([peer], [{ ...peer, awareness: "new-cursor" }]),
    ).toBe(false);
    expect(
      presencePeersEqual([peer], [{ ...peer, provider: "anthropic" }]),
    ).toBe(false);
    expect(presencePeersEqual([peer], [])).toBe(false);
  });

  it("stops the interval while hidden and reads immediately when visible", () => {
    expect(source).toContain('document.visibilityState === "hidden"');
    expect(source).toContain('document.addEventListener("visibilitychange"');
    expect(source).toContain("stopTimer();\n        setState({ postId, peers: [] })");
    expect(source).toContain("else start()");
    expect(source).toContain("void read();\n      timer = setInterval");
    expect(source).toContain('document.removeEventListener("visibilitychange"');
  });
  it("clears the reader's peers when authorization is lost", () => {
    expect(source).toContain("res.status === 401 || res.status === 403 || res.status === 410");
    expect(source).toContain("if (!cancelled) setState({ postId, peers: [] })");
  });

});
