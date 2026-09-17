import { describe, expect, it } from "vitest";
import { oauthSubjectFor } from "../oauth-subject";

describe("oauthSubjectFor", () => {
  it("keeps Apple raw, prefixes Google and GitHub, and needs the id to exist", () => {
    expect(oauthSubjectFor("apple", "ignored", { sub: "001.abc" })).toBe("001.abc");
    expect(oauthSubjectFor("google", "ignored", { sub: "1099" })).toBe("google:1099");
    expect(oauthSubjectFor("github", "583231", { id: 583231 } as never)).toBe("github:583231");
    expect(oauthSubjectFor("github", undefined, {})).toBeNull();
    expect(oauthSubjectFor("google", "x", {})).toBeNull();
  });
});
