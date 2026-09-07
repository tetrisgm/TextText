import React, { type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Blog, Folder } from "@/lib/content";
import type { WorkspacePoolPayload } from "@/lib/pool/types";

// These are SSR copy/permission tests. Only I/O and child boundaries are
// mocked; React state, effects and JSX keep their production implementation.
const driver = vi.hoisted(() => ({
  getAiSettings: vi.fn(), getTools: vi.fn(), createFolder: vi.fn(), createItem: vi.fn(),
  poolError: null as string | null, refresh: vi.fn(), load: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/t/writer" }));
vi.mock("@/components/keyboard/CommandLayer", () => ({ useEscapeLayer: vi.fn() }));
vi.mock("@/app/editor/actions", () => ({ createRootFolderAction: driver.createFolder,
  updateBlogAction: vi.fn(), renameFolderAction: vi.fn(), createWorkspacePostAction: vi.fn(), movePostToFolderAction: vi.fn(),
  setEditablePostStatusAction: vi.fn(), toggleEditablePostStarredAction: vi.fn(), listItemCommentsAction: vi.fn(),
  addItemCommentAction: vi.fn(), replyItemCommentAction: vi.fn(), reopenItemCommentAction: vi.fn(), resolveItemCommentAction: vi.fn(),
}));
vi.mock("@/app/editor/share-actions", () => new Proxy({}, { get: (_, key) => key === "then" ? undefined : vi.fn() }));
vi.mock("@/app/editor/agent-skill-metadata-actions", () => ({ getWorkspaceAgentSkillMetadataAction: vi.fn() }));
vi.mock("@/lib/pool/store", () => ({
  useWorkspacePool: () => ({ error: driver.poolError, refreshing: false }),
  refreshWorkspacePool: driver.refresh,
  useWorkspacePostDocument: () => ({ entry: { status: "error", error: "offline" }, load: driver.load }),
  updateFolder: vi.fn(),
}));
vi.mock("@/components/workspace/WorkspaceActionBarPortal", () => ({ WorkspaceActionBarPortal: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/components/workspace/ShareDialog", () => ({ ShareDialog: () => null }));
vi.mock("@/components/PostActionBar", () => ({ PostActionBar: () => null }));
vi.mock("@/components/BacklinksPanel", () => ({ BacklinksPanel: () => null }));


vi.mock("@/app/editor/agent-connect-actions", () => new Proxy({}, { get: (_, key) => key === "then" ? undefined : vi.fn() }));
vi.mock("@/app/editor/token-actions", () => new Proxy({}, { get: (_, key) => key === "then" ? undefined : vi.fn() }));
vi.mock("@/app/editor/ai-config-actions", () => ({ getWorkspaceAiSettingsAction: driver.getAiSettings, removeWorkspaceAiSettingsAction: vi.fn(), saveWorkspaceAiSettingsAction: vi.fn() }));
vi.mock("@/app/editor/connect-provider-actions", () => new Proxy({}, { get: (_, key) => key === "then" ? undefined : vi.fn() }));
vi.mock("@/app/editor/mcp-connection-actions", () => new Proxy({}, { get: (_, key) => key === "then" ? undefined : key === "getMcpConnectionsAction" ? driver.getTools : vi.fn() }));
vi.mock("@/app/editor/agent-instructions-actions", () => new Proxy({}, { get: (_, key) => key === "then" ? undefined : vi.fn() }));
import { WorkspaceRootLanding } from "../WorkspaceRootPages";
import { SharedPage, StarredPage, TrashPage } from "../WorkspaceSpecialPages";
import { FolderPage } from "@/components/FolderPage";
import { ErrorBody, WorkspacePostReader } from "../WorkspaceItemViews";
import { AiConnectionSettings } from "../AiConnectionSettings";
import { AssistantConversation } from "../assistant/AssistantConversation";
import { emptyDocumentSnapshot, type DocumentSnapshot } from "@/lib/documents/model";
import { getBuiltinTemplate } from "@/lib/presentation/templates";
import { isDocumentBlank } from "@/components/document/TemplateGallery";
import { EditorSaveNotice, editorSaveLabel } from "@/components/document/EditorSaveNotice";
import ErrorPage from "@/app/error";
import GlobalError from "@/app/global-error";
import NotFound from "@/app/not-found";
import TenantNotFound from "@/app/t/[handle]/not-found";
import { compileItemTypeBlueprint } from "@/lib/presentation/item-type-blueprint";
import { ItemTypeCollectionPreview } from "../ItemTypeCollectionPreview";

const blog: Blog = { handle: "writer", name: "Writing", author: "Writer", homeLayout: "list" };
const pool: WorkspacePoolPayload = { version: 1, blogId: "workspace", blog, folders: [], counts: {}, posts: [], templates: [], fetchedAt: "2026-09-06T12:00:00Z" };
const folder: Folder = { id: "notes", name: "Notes", path: "notes", mode: "notes", position: 0 };
const template = getBuiltinTemplate("texttext.note")!;
const emptyPost = { id: "00000000-0000-4000-8000-000000000001", slug: "untitled", title: "", body: "", type: "note" as const, status: "draft" as const, document: emptyDocumentSnapshot({ id: template.id, version: template.version }) };
const focusCapture = vi.fn(), queryChange = vi.fn();
const render = renderToStaticMarkup;
function landing(testPool = pool, query = "", source: "query" | "tag" = "query", canManageItems = true) {
  return <WorkspaceRootLanding pool={testPool} query={query} source={source} canManageItems={canManageItems}
    focusRequestKey={0} selectedPostId={null} selectedPostIds={new Set()} selectedSectionPath={null}
    assistantConnection={null} settingsHref="/t/writer/settings" onFocusCapture={focusCapture} onQueryChange={queryChange}
    onOpenPost={vi.fn()} onOpenSection={vi.fn()} onSelectPost={vi.fn()} onSelectSection={vi.fn()}
    onOpenAssistant={vi.fn()} onBuildItemType={vi.fn()} onUseAssistantPrompt={vi.fn()} />;
}
function reader(document: DocumentSnapshot, canManagePost = true) {
  return <WorkspacePostReader blog={blog} pool={pool} poolPost={{ ...emptyPost, document, blogId: pool.blogId }} homePath="/t/writer" canManagePost={canManagePost} canCommentPost={false} onNavigate={vi.fn()} onSearch={vi.fn()} onOpenTag={vi.fn()} searchFocusRequestKey={0} />;
}
function findButton(node: ReactNode, label: string): React.ReactElement<{ onClick: () => void }> | undefined {
  if (!React.isValidElement<{ children?: ReactNode; onClick?: () => void }>(node)) return;
  if (node.type === "button" && node.props.children === label) return node as React.ReactElement<{ onClick: () => void }>;
  for (const child of React.Children.toArray(node.props.children)) {
    const found = findButton(child, label);
    if (found) return found;
  }
}
beforeEach(() => { vi.clearAllMocks(); driver.poolError = null; });

describe("first run without a Home composer", () => {
  it.each([false, true])("keeps Home list-only with existing items %s", returning => {
    const html = render(landing({ ...pool, folders: [folder], posts: returning ? [{ ...emptyPost, blogId: pool.blogId, folderId: folder.id, title: "Existing note" }] : [] }));
    expect(html).not.toContain('aria-label="Save to TextText"');
    if (!returning) {
      expect(html).toContain("Write your first note");
      expect(html).toContain("Open a folder to write and save a note.");
      expect(html).not.toContain("box above");
    }
  });
  it("the first-note action routes to the notes folder without creating an item on Home", () => {
    let tree: ReactNode;
    function InspectLanding() {
      tree = WorkspaceRootLanding(landing({ ...pool, folders: [folder] }).props);
      return tree;
    }
    render(<InspectLanding />);
    findButton(tree, "Write your first note")!.props.onClick();
    expect(focusCapture).toHaveBeenCalledWith("notes");
    expect(driver.createItem).not.toHaveBeenCalled();
    expect(driver.createFolder).not.toHaveBeenCalled();
  });
  it("does not promise a note composer in an article-only folder", () => {
    const html = render(landing({ ...pool, folders: [{ ...folder, id: "blog", path: "blog", mode: "blog" }] }));
    expect(html).toContain("Create a notes folder");
    expect(html).not.toContain("Write your first note");
  });
  it("offers folder creation before capture when no folders exist", () => {
    const html = render(landing());
    expect(html).toContain("Create a notes folder");
    expect(html).not.toContain("Write your first note");
    expect(html).not.toContain('aria-label="Save to TextText"');
  });
  it("does not offer mutation controls to a viewer", () => {
    const html = render(landing(pool, "", "query", false));
    expect(html).not.toContain(">Create a notes folder</button>");
    expect(html).not.toContain(">Write your first note</button>");
  });
  it.each([false, true])("empty folder respects create permission %s", canCreate => {
    const html = render(<FolderPage blog={blog} folder={folder} handle="writer" items={[]} canCreateItems={canCreate} canEditItems={false} />);
    expect(html).toContain("This folder is empty.");
    expect(html).toContain('href="/t/writer"');
    expect(html.includes(">Write a note</button>")).toBe(canCreate);
  });
  it.each([
    ["query", "absent", "No matching items."],
    ["tag", "missing", "No items with this tag."],
    ["query", "2026-09-01", "No items were created or edited that day."],
  ] as const)("empty %s search %s has accurate copy", (source, query, copy) => {
    expect(render(landing(pool, query, source))).toContain(copy);
    expect(render(landing(pool, query, source))).not.toContain("Full search is unavailable.");
  });
  it.each([
    ["trash", <TrashPage key="trash" handle="writer" pool={pool} selectedPostId={null} onSelectPost={vi.fn()} />, "Trash is empty."],
    ["shared", <SharedPage key="shared" pool={pool} />, "No shared items yet."],
    ["starred", <StarredPage key="starred" pool={pool} owner />, "No starred items yet."],
  ])("empty %s has an exit", (_name, node, copy) => {
    const html = render(node); expect(html).toContain(copy); expect(html).toContain('href="/t/writer"');
  });
  it("empty collection preview explains the source", () => {
    const custom = compileItemTypeBlueprint({ name: "Tasks", fields: [], collection: { layout: "list" } }, { id: "tasks" });
    expect(render(<ItemTypeCollectionPreview items={[]} template={custom} label="Folder preview" />)).toContain("This folder has no items to preview.");
  });
  it("unconfigured AI keeps writing optional", () => {
    expect(render(<AssistantConversation messages={[]} submitting={false} aiSettingsHref="/t/writer/settings" />)).toContain("You can keep writing without connecting.");
    expect(render(<AiConnectionSettings cloudConfigured={false} />)).toContain("No provider key is saved.");
  });
});

describe("truthful recovery copy", () => {
  it.each(["offline", "error"] as const)("%s save offers the actual retry callback", state => {
    const retry = vi.fn(); const tree = EditorSaveNotice({ state, onRetry: retry });
    expect(render(tree)).toContain("Keep this page open or copy your text");
    findButton(tree, "Retry saving")!.props.onClick();
    expect(retry).toHaveBeenCalledOnce();
  });
  it.each(["local", "saving", "saved"] as const)("%s does not render a failure", state => {
    expect(render(<EditorSaveNotice state={state} onRetry={vi.fn()} />)).toBe("");
  });
  it("distinguishes connecting from pending writes and preserves the specific error", () => {
    expect(editorSaveLabel("local", true, false)).toBe("Connecting");
    expect(editorSaveLabel("local", true, true)).toBe("Waiting to save");
    expect(editorSaveLabel("local", false)).toBe("On this device");
    expect(editorSaveLabel("offline", true)).toBe("Offline");
    expect(editorSaveLabel("error", true, true, "Permission denied")).toBe("Permission denied");
    expect(editorSaveLabel("error", true)).toBe("Save not confirmed");
    expect(editorSaveLabel("saved", true)).toBe("Saved");
  });
  it.each(["Request failed", "Share revoked", "not found", "permission denied"])("load error %s keeps the evidence without inferring an owner action", message => {
    const retry = vi.fn(); const tree = ErrorBody({ message, onRetry: retry, homeHref: "/t/writer" });
    const html = render(tree);
    expect(html).toContain("This item could not be loaded.");
    expect(html).toContain(message);
    expect(html).not.toContain("Ask them for a new invitation");
    expect(html).not.toContain("The owner");
    findButton(tree, "Reload item")!.props.onClick(); expect(retry).toHaveBeenCalledOnce();
  });
  it.each([ErrorPage, GlobalError])("root error stays route-agnostic and uses Next retry", Boundary => {
    const retry = vi.fn(); const tree = Boundary({ error: new Error("failed"), retry });
    const html = render(tree);
    expect(html).toContain("Try loading this page again, or go home.");
    expect(html).not.toContain("Saved items"); expect(html).not.toContain("editing");
    findButton(tree, "Try again")!.props.onClick(); expect(retry).toHaveBeenCalledOnce();
  });
  it("root 404 is generic, while the tenant 404 explains an unavailable link", () => {
    const html = render(<NotFound />);
    expect(html).toContain("Check the address"); expect(html).not.toContain("owner"); expect(html).not.toContain("your items");
    expect(render(<TenantNotFound />)).toContain("Check the link with the person who shared it.");
  });
});

describe("document emptiness", () => {
  it.each([false, true])("empty document respects edit permission %s", canManage => {
    const html = render(reader(emptyPost.document, canManage));
    expect(html).toContain("This document is empty.");
    expect(html.includes(">Start writing</button>")).toBe(canManage);
  });
  it.each([
    { title: "Title" }, { body: "Body" }, { subtitle: "Subtitle" }, { tags: ["kept"] },
    { assets: [{ id: "photo", kind: "image" as const, src: "https://example.com/photo.png" }] },
    { fields: { count: 0 } }, { fields: { done: false } }, { fields: { text: "Text" } },
  ] as Partial<DocumentSnapshot["content"]>[])("does not label meaningful content empty: %j", content => {
    const document = { ...emptyPost.document, content: { ...emptyPost.document.content, ...content } };
    expect(render(reader(document))).not.toContain("This document is empty.");
    expect(isDocumentBlank(document)).toBe(false);
  });
});


it("unconfirmed catch-up does not diagnose an offline connection or a failed save", () => {
  expect(editorSaveLabel("unconfirmed", true)).toBe("Connection not confirmed");
  const html = render(<EditorSaveNotice state="unconfirmed" onRetry={vi.fn()} />);
  expect(html).toContain("The connection has not been confirmed.");
  expect(html).not.toContain("You are offline"); expect(html).not.toContain("failed");
  expect(html).not.toContain("Reconnect");
});
