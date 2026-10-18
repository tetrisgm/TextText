import { describe, expect, it } from "vitest";
import { repositoryPathsInText } from "../../../scripts/lib/repository-paths";

describe("documentation source path references", () => {
  const source = ["release", "oracle", "bootstrap-database.mjs"].join("/");

  it("does not treat shell variable names as source directories", () => {
    for (const prefix of ["$release/", "${release}/", "$ROOT/", "${ROOT}/"]) {
      expect(repositoryPathsInText(`node "${prefix}${source}"`)).toEqual([]);
    }
  });

  it("still checks literal source references beside variable paths", () => {
    const missing = ["scripts", "missing-release-step.mjs"].join("/");
    expect(repositoryPathsInText(`node "$release/${source}"; node "${missing}"; see \`${source}\`.`))
      .toEqual([missing, source]);
  });

  it("does not require the generated app before its release build", () => {
    const artifact = ["mac", "build", "TextText.app"].join("/");
    const unknown = ["mac", "build", "Missing.swift"].join("/");
    const otherApp = ["mac", "build", "Other.app"].join("/");
    expect(repositoryPathsInText(`Build ${artifact}; inspect ${unknown} and ${otherApp}.`))
      .toEqual([unknown, otherApp]);
  });

  it("does not reinterpret nested dependency paths as repository roots", () => {
    expect(repositoryPathsInText(`node_modules/dependency/${source}`)).toEqual([]);
  });
});
