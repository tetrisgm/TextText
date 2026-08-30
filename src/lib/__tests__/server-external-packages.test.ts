import { describe, expect, it } from "vitest";

import nextConfig from "../../../next.config";

describe("server package identity", () => {
  it("keeps Yjs and its awareness peer externalized together", () => {
    expect(nextConfig.serverExternalPackages).toEqual(
      expect.arrayContaining(["yjs", "y-protocols"]),
    );
  });
});
