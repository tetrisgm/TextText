import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { CommandLayer } from "@/components/keyboard/CommandLayer";
import { OPEN_COMMAND_PALETTE_EVENT, OPEN_KEYBOARD_SHORTCUTS_EVENT } from "@/components/keyboard/CommandPalette";
import { CommentsDialog } from "@/components/workspace/CommentsDialog";
import { ShareDialog } from "@/components/workspace/ShareDialog";
import { AddAgentPopover } from "@/components/workspace/AddAgentPopover";
import { FolderLookPicker } from "@/components/workspace/FolderLookPicker";
import { WorkspaceTabBar } from "@/components/workspace/WorkspaceTabBar";
import { AssistantContextPicker } from "@/components/workspace/assistant/AssistantContextPicker";
import { QuickActionControl } from "@/components/workspace/assistant/QuickActionControl";
import { SignInScreen } from "@/components/editor/SignInScreen";
import { ConfirmationDialog } from "@/components/ConfirmationDialog";
import { StatusAnnouncement } from "../StatusAnnouncement";
import { BUILTIN_TEMPLATES } from "@/lib/presentation/templates";
import { DEFAULT_CONTEXT_CHOICE } from "@/lib/ai/context-choice";
import type { WorkspacePoolPost } from "@/lib/pool/types";
import rail from "@/components/workspace/assistant/AssistantSidebar.module.css";
import "@/styles/tokens.css";
import "@/styles/broadsheet.css";
import "@/styles/apple.css";
import "@/styles/workspace.css";

declare global { interface Window { a11yAction: (name: string, args: unknown[]) => Promise<unknown>; a11yCalls: string[]; } }
window.a11yCalls = [];
const comments: Array<Record<string, unknown>> = [];
window.a11yAction = async (name, args) => {
  window.a11yCalls.push(name);
  if (name === "getFolderLookAction") return { allowed: true, templates: BUILTIN_TEMPLATES.slice(0, 4), library: [], current: null, targetItemCount: 2 };
  if (name === "listItemCommentsAction") return [...comments];
  if (name === "addItemCommentAction") {
    comments.push({ id: String(comments.length), body: args[2], authorName: "Reader", parentId: null, createdAt: "2026-09-06T12:00:00Z", updatedAt: "2026-09-06T12:00:00Z", resolved: false, anchor: null });
    return [...comments];
  }
  if (name === "resolveItemCommentAction") { comments.forEach(c => { if (c.id === args[2]) c.resolved = true; }); return [...comments]; }
  if (name === "getItemAccessSummaryAction") return { visibility: "private", pageVisibility: "private", direct: [], inherited: [], links: [] };
  return [];
};
const items = [{ id: "one", name: "First item", detail: "Notes" }, { id: "two", name: "Second item", detail: "Notes" }];
function Fixture() {
  const [modal, setModal] = useState("");
  const [posts, setPosts] = useState(items.map(i => ({ id: i.id, title: i.name })) as WorkspacePoolPost[]);
  const [active, setActive] = useState("one");
  const [choice, setChoice] = useState({ ...DEFAULT_CONTEXT_CHOICE, itemIds: ["one"] });
  const [contextOpen, setContextOpen] = useState(false);
  const [save, setSave] = useState<string | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  if (new URLSearchParams(location.search).has("signin")) return <SignInScreen />;
  return <CommandLayer><div className="applecms">
    <nav aria-label="Test entry points">
      {["Comments", "Share", "Folder look", "Confirmation"].map(name => <button key={name} onClick={() => setModal(name)}>{name}</button>)}
      <button onClick={() => window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE_EVENT))}>Command palette</button>
      <button onClick={() => window.dispatchEvent(new Event(OPEN_KEYBOARD_SHORTCUTS_EVENT))}>Keyboard shortcuts</button>
      <AddAgentPopover handle="writer" postId="item" marks={[]} grants={[]} loadError={false} reload={() => {}} onRemoved={() => {}} />
    </nav>
    <WorkspaceTabBar activePostId={active} posts={posts} previewPostId="two" onSelect={setActive}
      onClose={id => { setPosts(posts.filter(p => p.id !== id)); setActive(posts.find(p => p.id !== id)?.id ?? ""); }}
      onMove={(from, to) => { const next = [...posts]; next.splice(to, 0, next.splice(from, 1)[0]); setPosts(next); }} onPromote={() => window.a11yCalls.push("promote")} />
    <section role="main" tabIndex={-1} id="workspace-item-panel">
      <h1>Read and edit an item</h1>
      <textarea aria-label="Edit item" ref={composer} onChange={() => setSave("Saving")} />
      <button onClick={() => setSave("Saved")}>Finish save</button><StatusAnnouncement message={save} />
      <section className={rail.root} aria-label="Assistant controls" style={{ height: "auto" }}>
        <AssistantContextPicker items={items} choice={choice} onChange={setChoice} hasItem hasSelection
          focusComposer={() => composer.current?.focus()} open={contextOpen} onOpenChange={setContextOpen} />
        <QuickActionControl action={{ id: "summarize", label: "Summarize" }} className={rail.quickAction} onRun={id => window.a11yCalls.push(id)} />
        <QuickActionControl action={{ id: "translate", label: "Translate" }} className={rail.quickAction} onRun={(id, language) => window.a11yCalls.push(`${id}:${language}`)} />
      </section>
    </section>
    <CommentsDialog canResolve handle="writer" postId="item" postTitle="An item with a longer title" open={modal === "Comments"} onClose={() => setModal("")} />
    <ShareDialog handle="writer" postId="item" postTitle="An item" open={modal === "Share"} onClose={() => setModal("")} />
    {modal === "Folder look" && <FolderLookPicker handle="writer" folderPath="notes" folderName="Notes" onClose={() => setModal("")} />}
    <ConfirmationDialog open={modal === "Confirmation"} title="Delete item?" message="This moves the item to Trash." confirmLabel="Delete" onCancel={() => setModal("")} onConfirm={() => { window.a11yCalls.push("delete"); setModal(""); }} />
  </div></CommandLayer>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
