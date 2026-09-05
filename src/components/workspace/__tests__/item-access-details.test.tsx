import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ItemAccessSummary } from "@/lib/store";
import { GeneralItemAccess, ItemAccessDetails } from "../ItemAccessDetails";
const summary: ItemAccessSummary = {
  itemId: "item", visibility: "private", pageVisibility: "private", pagePath: "/@writer/blog/story",
  owner: { id: "owner", name: "Owner", email: null, role: "owner" }, direct: [],
  inherited: [
    { id: "folder", email: "reader@example.com", role: "editor", scopeType: "folder", scopeId: "folder", scopeName: "Reviews" },
    { id: "workspace", email: "teammate@example.com", role: "viewer", scopeType: "workspace", scopeId: "workspace", scopeName: "Team" },
  ],
  links: [],
};
const controls = { canChange: true, confirmingId: null, setConfirmingId: vi.fn(), setManagedScope: vi.fn(), revokeLink: vi.fn() };
describe("item access presentation", () => {
  it.each([
    ["public", "public", "Anyone with the link can read. This page is public."],
    ["link", "link", "Anyone with the link can read. This page is unlisted."],
    ["link", "private", "Anyone with an active access link can read. The ordinary page link requires named access."],
    ["private", "private", "Only the owner and people with direct or inherited access can open this page."],
  ] as const)("describes effective %s and page %s access", (visibility, pageVisibility, copy) => {
    expect(renderToStaticMarkup(<GeneralItemAccess summary={{ ...summary, visibility, pageVisibility }} loading={false} />)).toContain(copy);
  });
  it("keeps loading and unavailable states honest", () => {
    for (const loading of [true, false]) {
      const html = renderToStaticMarkup(<GeneralItemAccess summary={null} loading={loading} />);
      expect(html).toContain(loading ? "Loading access" : "Access summary unavailable");
      expect(html).not.toMatch(/Only|invited|private/);
    }
  });
  it("shows inherited roles and scope management even when no direct invitations remain", () => {
    const html = renderToStaticMarkup(<ItemAccessDetails summary={summary} {...controls} />);
    for (const copy of ["reader@example.com", "Via Reviews (folder)", "Can edit", "Via Team (workspace)",
      "Can view", 'aria-label="Manage access via Reviews"', 'aria-label="Manage access via Team"']) expect(html).toContain(copy);
  });
  it("labels every active link with its own role and confirmation, without claiming invites revoke links", () => {
    const withLinks = { ...summary, links: [
      { id: "link", label: "Review link", role: "commenter" as const, expiresAt: null },
    ] };
    const html = renderToStaticMarkup(<ItemAccessDetails summary={withLinks} {...controls} confirmingId="link" />);
    for (const copy of ["Review link", "Can comment", "No expiry", "Revoke this link?", "Revoke link",
      "Removing a person does not revoke a link."]) expect(html).toContain(copy);
  });
  it("disables scope and link controls while an operation is pending", () => {
    const html = renderToStaticMarkup(<ItemAccessDetails summary={summary} {...controls} canChange={false} />);
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });
});
