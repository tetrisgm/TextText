"use client";

import {
  useCallback,
  useEffect,
  useId,
  useSyncExternalStore,
  type ComponentProps,
} from "react";
import { CollaboratorMark } from "@/components/collab/CollaboratorMark";
import { ShortcutTooltip } from "@/components/keyboard/ShortcutTooltip";
import {
  assistantBoundarySnapshot,
  loadAssistantBoundary,
  subscribeAssistantBoundary,
} from "./assistant-boundary";
import type { AssistantConversation } from "./AssistantConversation";
import type {
  AssistantConversationState,
  AssistantConversationView,
} from "./AssistantConversationState";
import type {
  AssistantSidebar,
  AssistantSidebarProps,
} from "./AssistantSidebar";
import styles from "./AssistantLauncher.module.css";

const EMPTY_CONVERSATION: AssistantConversationView = {
  conversations: [],
  hydrating: true,
  messages: [],
  pendingConversations: [],
  pendingProposalCount: 0,
};

function useAssistantBoundary() {
  return useSyncExternalStore(
    subscribeAssistantBoundary,
    assistantBoundarySnapshot,
    () => null,
  );
}

function isAssistantToggleShortcut(event: KeyboardEvent): boolean {
  return (
    !event.altKey &&
    event.shiftKey &&
    (event.metaKey || event.ctrlKey) &&
    event.key.toLowerCase() === "a"
  );
}

function SidebarIcon() {
  return (
    <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect
        x="2.75"
        y="3.25"
        width="12.5"
        height="11.5"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M11.25 3.75v10.5M8.75 6.75 10.9 9l-2.15 2.25"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function AssistantLauncher(props: AssistantSidebarProps) {
  const generatedPanelId = useId();
  const panelId = props.panelId ?? `assistant-sidebar-${generatedPanelId}`;
  const pendingCount = props.pendingCount ?? 0;
  const launcherBusy = props.launcherBusy ?? false;
  const agent = props.agent;
  const showAssistant = useCallback(() => {
    void loadAssistantBoundary();
    props.onStateChange("pinned");
  }, [props]);

  useEffect(() => {
    const onToggleShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isAssistantToggleShortcut(event)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      showAssistant();
    };
    window.addEventListener("keydown", onToggleShortcut, true);
    return () => window.removeEventListener("keydown", onToggleShortcut, true);
  }, [showAssistant]);

  const label =
    pendingCount > 0
      ? `${pendingCount} assistant ${pendingCount === 1 ? "approval" : "approvals"} waiting`
      : launcherBusy
        ? "Assistant is working"
        : agent
          ? `Chat with ${agent.name}`
          : "Open assistant";
  const ariaLabel =
    pendingCount > 0
      ? `Open assistant, ${pendingCount} ${pendingCount === 1 ? "approval" : "approvals"} waiting`
      : launcherBusy
        ? "Open assistant (working)"
        : agent
          ? `Chat with ${agent.name}`
          : "Open assistant";

  return (
    <div
      className={["applecms", styles.root, props.className]
        .filter(Boolean)
        .join(" ")}
      data-assistant-sidebar=""
      data-layout={props.layout ?? "auto"}
      data-state="hidden"
    >
      <ShortcutTooltip
        className={styles.launcherWrap}
        label={label}
        keys="⌘⇧A"
        placement="top"
      >
        <button
          className={styles.launcher}
          type="button"
          aria-controls={panelId}
          aria-expanded="false"
          aria-keyshortcuts="Meta+Shift+A Control+Shift+A"
          aria-label={ariaLabel}
          onClick={showAssistant}
        >
          {agent ? (
            <span
              className={styles.launcherAvatar}
              style={{ backgroundColor: agent.color }}
            >
              <CollaboratorMark provider={agent.provider} name={agent.name} />
            </span>
          ) : (
            <SidebarIcon />
          )}
          {launcherBusy ? (
            <span className={styles.launcherBusy} aria-hidden="true" />
          ) : null}
          {pendingCount > 0 ? (
            <span className={styles.launcherPending} aria-hidden="true">
              {pendingCount > 9 ? "9+" : pendingCount}
            </span>
          ) : null}
        </button>
      </ShortcutTooltip>
    </div>
  );
}

export function LazyAssistantSidebar(props: ComponentProps<typeof AssistantSidebar>) {
  const modules = useAssistantBoundary();
  useEffect(() => {
    if (props.state !== "hidden") void loadAssistantBoundary();
  }, [props.state]);
  if (modules) return <modules.sidebar.AssistantSidebar {...props} />;
  return props.state === "hidden" ? <AssistantLauncher {...props} /> : null;
}

export function LazyAssistantConversation(
  props: ComponentProps<typeof AssistantConversation>,
) {
  const modules = useAssistantBoundary();
  if (!modules) return null;
  return <modules.conversation.AssistantConversation {...props} />;
}

export function LazyAssistantConversationState(
  props: ComponentProps<typeof AssistantConversationState>,
) {
  const modules = useAssistantBoundary();
  if (!modules) return props.children?.(EMPTY_CONVERSATION) ?? null;
  return <modules.conversationState.AssistantConversationState {...props} />;
}
