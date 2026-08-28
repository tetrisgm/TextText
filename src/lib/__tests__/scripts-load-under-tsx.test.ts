import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";

/**
 * tsc checks scripts/ as ESM. tsx runs them as CJS. The two disagree about
 * top-level await, so `npx tsc --noEmit` can pass a file that dies the
 * instant anyone runs it.
 *
 * That is not hypothetical: eval-sidebar-looks.ts shipped a top-level await
 * that type-checked clean and then failed with a TransformError, which the
 * eval runner reported as a plain FAIL with an esbuild stack in place of a
 * reason. Nothing in the gate would have caught it, because no test loads
 * these files and the evals are not run on every change.
 */
describe("scripts run under tsx, not just tsc", () => {
  const dir = "scripts";
  const files = readdirSync(dir).filter((name) => name.endsWith(".ts"));

  it("finds the scripts to check", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(files)("%s transforms the way tsx transforms it", (name) => {
    const source = readFileSync(join(dir, name), "utf8");
    expect(() =>
      transformSync(source, {
        loader: "ts",
        format: "cjs",
        target: "node22",
        sourcefile: name,
      }),
    ).not.toThrow();
  });
});
