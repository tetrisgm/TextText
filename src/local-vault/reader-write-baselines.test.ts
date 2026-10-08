import { describe, expect, it } from "vitest";
import { ReaderWriteBaselines } from "./reader-write-baselines";

describe("bookmark reader write baselines", () => {
  it("releases completed files and their assets while navigating a large library", () => {
    const baselines = new ReaderWriteBaselines<{ hash: string; assets: string[] }>();
    for (let index = 0; index < 100; index++) {
      const path = `Bookmarks/${index}.textpack`;
      baselines.set(path, { hash: "saved", assets: ["large-image-data"] });
      baselines.settled(0);
      expect(baselines.size).toBe(0);
    }
    const fresh = { hash: "external-change", assets: [] };
    expect(baselines.get("Bookmarks/0.textpack") ?? fresh).toBe(fresh);
  });
  it("retains the latest acknowledged hash for queued and debounced writes, then releases it", () => {
    const baselines = new ReaderWriteBaselines<{ hash: string }>();
    baselines.set("a", { hash: "first-ack" });
    baselines.set("b", { hash: "other-ack" });
    baselines.settled(1);
    expect(baselines.get("a")?.hash).toBe("first-ack");
    baselines.set("a", { hash: "second-ack" });
    baselines.settled(0, "a");
    expect(baselines.size).toBe(1);
    expect(baselines.get("a")?.hash).toBe("second-ack");
    baselines.settled(0);
    expect(baselines.size).toBe(0);
  });
});
