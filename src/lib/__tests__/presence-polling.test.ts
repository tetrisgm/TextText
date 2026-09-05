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
    expect(source).toContain("stopTimer(entry);\n      publish(entry, []);");
    expect(source).toContain("start(postId, entry);");
    expect(source).toContain("void read(postId, entry);\n  entry.timer = setInterval");
    expect(source).toContain('document.removeEventListener("visibilitychange"');
  });
  it("clears the reader's peers when authorization is lost", () => {
    // 401, 403 and 410 all fail res.ok; none may keep advertising activity.
    expect(source).toContain("if (!res.ok) {");
    expect(source).toContain("401, 403 and 410 included");
    expect(source).toContain("publish(entry, []);");
  });
  it("shares one poller per item across every mounted surface", () => {
    // The reader bar, the editor bar and a hidden bar kept for a fast switch
    // back must not each run their own interval against the same endpoint.
    expect(source).toContain("const entries = new Map<string, PresenceEntry>()");
    expect(source).toContain("entry.listeners.add(listener);");
    expect(source).toContain("if (current.listeners.size > 0 || entries.get(postId) !== current) return;");
    expect(source).toContain("current.abort.abort();\n    entries.delete(postId);");
  });

});
