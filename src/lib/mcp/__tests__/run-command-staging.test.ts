import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// run_command executes a mapped tool through the shared executor, which
// does not itself stage hosted proposals (the registry does, before calling
// it). The case must therefore apply the same gate; this pins that it does.
describe("run_command on hosted MCP", () => {
  it("stages the same tools a direct call would stage", () => {
    const source = readFileSync(new URL("../tools.ts", import.meta.url), "utf8");
    const start = source.indexOf('case "run_command"');
    expect(start).toBeGreaterThan(0);
    const body = source.slice(start, source.indexOf("return jsonResult(outcome)", start));
    expect(body).toContain("hostedToolNeedsProposal(tool, toolArgs)");
    expect(body).toContain("stageHostedToolProposal(tool, toolArgs, extra)");
  });
});
