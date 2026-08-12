import { afterEach, describe, expect, it } from "vitest";
import {
  isPublicOriginRequest,
  genericPublicNotFound,
  PUBLIC_ORIGIN_HEADER,
  sessionlessPublicRequestHeaders,
} from "@/lib/public-origin";
import {
  publicFolderPath,
  workspacePublicBaseUrl,
  blogWorkspacePostEditPath,
  blogWorkspacePostPath,
  workspacePublicPostPath,
  workspacePublicPostUrl,
} from "@/lib/public-paths";

const previousRootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN;

afterEach(() => {
  if (previousRootDomain === undefined) {
    delete process.env.NEXT_PUBLIC_ROOT_DOMAIN;
  } else {
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = previousRootDomain;
  }
});

describe("sessionless workspace origins", () => {
  it("removes viewer credentials before the tenant rewrite", () => {
    const source = new Headers({
      authorization: "Bearer secret",
      cookie: "authjs.session-token=secret; wr_app=1",
      "x-forwarded-authorization": "Bearer forwarded",
      "user-agent": "TextText test",
    });

    const sanitized = sessionlessPublicRequestHeaders(source);

    expect(sanitized.get("authorization")).toBeNull();
    expect(sanitized.get("cookie")).toBeNull();
    expect(sanitized.get("x-forwarded-authorization")).toBeNull();
    expect(sanitized.get("user-agent")).toBe("TextText test");
    expect(sanitized.get(PUBLIC_ORIGIN_HEADER)).toBe("1");
    expect(isPublicOriginRequest(sanitized)).toBe(true);
    expect(source.get("cookie")).toContain("authjs.session-token");
  });

  it("uses one constant response for every unavailable public path", async () => {
    const privatePath = genericPublicNotFound();
    const missingPath = genericPublicNotFound();

    expect(privatePath.status).toBe(404);
    expect(await privatePath.arrayBuffer()).toEqual(await missingPath.arrayBuffer());
    expect(privatePath.headers.get("content-type")).toBe(
      missingPath.headers.get("content-type"),
    );
  });

  it("builds workspace-owned folder-in-path URLs", () => {
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = "localhost:3100";

    expect(publicFolderPath("blog/research-notes")).toBe(
      "blog/research-notes",
    );
    expect(workspacePublicPostPath("blog/research-notes", "index")).toBe(
      "/blog/research-notes/index",
    );
    expect(workspacePublicBaseUrl("Clear-Slate")).toBe(
      "http://clear-slate.localhost:3100",
    );
    expect(
      workspacePublicPostUrl("clear-slate", "blog/research-notes", "index"),
    ).toBe("http://clear-slate.localhost:3100/blog/research-notes/index");
    const blog = { handle: "clear-slate", username: "writer" };
    const post = { id: "post-id", slug: "index" };
    expect(blogWorkspacePostPath(blog, "blog/research-notes", post)).toBe(
      "/@writer/blog/research-notes/index",
    );
    expect(blogWorkspacePostEditPath(blog, "blog/research-notes", post)).toBe(
      "/@writer/blog/research-notes/index?edit=1&id=post-id",
    );
  });

  it("rejects folder paths that could escape or collide with route syntax", () => {
    for (const value of ["", "/blog", "blog/../notes", "Blog", "blog//x"]) {
      expect(publicFolderPath(value)).toBeNull();
      expect(workspacePublicPostPath(value, "post")).toBeNull();
    }
  });
});
