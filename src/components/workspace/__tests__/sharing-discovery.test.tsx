import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { SharedWithMe } from "../SharedWithMe";
import type { SharedWithMeEntry } from "@/lib/shares";
const entry: SharedWithMeEntry = {
  scopeType: "item", postId: "review", role: "commenter", title: "Review",
  slug: "review", blogHandle: "team", blogUsername: "writer", blogName: "Team",
  updatedAt: "2026-09-05T00:00:00Z",
};
it.each(["editor", "commenter", "viewer"] as const)("renders the %s item permission", (role) => {
  const html = renderToStaticMarkup(<SharedWithMe entries={[{ ...entry, role }]} />);
  expect(html).toContain(`>${{ editor: "Edit", commenter: "Comment", viewer: "View" }[role]}<`);
  expect(html).toContain('href="/@writer/review"');
});
it.each(["member", "guest"] as const)("workspace %s opens the workspace itself", (role) => {
  const html = renderToStaticMarkup(<SharedWithMe entries={[{ ...entry, scopeType: "workspace", role, postId: "team", title: "Team", slug: "" }]} />);
  expect(html).toContain('href="/t/team"');
  expect(html).toContain(`>${role === "member" ? "Member" : "Guest"}<`);
  expect(html).toContain(">Workspace<");
});
