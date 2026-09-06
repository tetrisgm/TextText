/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ prefetch: vi.fn(), push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/components/keyboard/CommandLayer", () => ({ useEscapeLayer: vi.fn() }));
vi.mock("@/components/workspace/WorkspaceActionBarPortal", () => ({ WorkspaceActionBarPortal: ({ children }: any) => children }));
vi.mock("@/components/workspace/ParticipantsRow", () => ({ ParticipantsRow: () => null }));
vi.mock("@/components/workspace/ShareDialog", () => ({ ShareDialog: () => null }));
vi.mock("@/app/editor/actions", () => ({ recaptureBookmarkAction: vi.fn(), saveEditablePostAction: vi.fn() }));
import { PostActionBar } from "@/components/PostActionBar";
it("round7: public named commenter has a comment entry point", () => {
  const html = renderToStaticMarkup(<PostActionBar mode="read" owner={false} canEditPost={false} canManagePost={false} canCommentPost
    blog={{ handle: "writer", name: "Team", author: "Owner" } as any}
    post={{ id: "item", slug: "review", title: "Review", type: "article", status: "published", body: "Hello", tags: [], links: [] } as any}
    adjacent={{ previous: null, next: null }} homePath="/@writer" postPath="/@writer/review" />);
  expect(html).toMatch(/>Comments?</);
});
