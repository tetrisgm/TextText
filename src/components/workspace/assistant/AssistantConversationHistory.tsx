"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AssistantConversationSummary } from "./conversation-store";
import styles from "./AssistantConversationHistory.module.css";

type AssistantConversationHistoryProps = {
  activeConversationId: string | null;
  conversations: readonly AssistantConversationSummary[];
  onDeleteConversation?: (conversationId: string) => void;
  onNewConversation: () => void;
  onOpenConversation: (conversationId: string) => void;
  onSearchConversations?: (
    query: string,
  ) => readonly AssistantConversationSummary[];
  onTogglePinned: (conversationId: string) => void;
};

function HistoryIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
      <path d="M4 5.25h9.5M4 9.75h9.5M4 14.25h6.25" />
    </svg>
  );
}

function PinIcon({ pinned }: { pinned: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
      <path
        d={
          pinned
            ? "M7 3.75h6l-.8 4 2.05 2.05v1.2H5.75V9.8L7.8 7.75 7 3.75ZM10 11v5.25"
            : "M7 3.75h6l-.8 4 2.05 2.05v1.2H5.75V9.8L7.8 7.75 7 3.75ZM10 11v5.25"
        }
      />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
      <path d="M4.75 6h10.5M8.25 6V4.5h3.5V6M6 6l.6 9.5h6.8L14 6M8.5 8.75v4.5M11.5 8.75v4.5" />
    </svg>
  );
}

function NewChatIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
      <path d="M10 3.5v13M3.5 10h13" />
    </svg>
  );
}

function conversationDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(parsed);
}

export function AssistantConversationHistory({
  activeConversationId,
  conversations,
  onDeleteConversation,
  onNewConversation,
  onOpenConversation,
  onSearchConversations,
  onTogglePinned,
}: AssistantConversationHistoryProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Deleting asks once, inline: the first click turns the row's delete
  // control into a confirm, and any other interaction lets it lapse.
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(
    null,
  );
  const visibleConversations = useMemo(() => {
    if (onSearchConversations) return onSearchConversations(query);
    const normalized = query.trim().toLocaleLowerCase();
    return normalized
      ? conversations.filter((conversation) =>
          conversation.title.toLocaleLowerCase().includes(normalized),
        )
      : conversations;
  }, [conversations, onSearchConversations, query]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", closeOutside, true);
    return () => window.removeEventListener("pointerdown", closeOutside, true);
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={styles.root}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      }}
    >
      <button
        className={styles.trigger}
        type="button"
        aria-expanded={open}
        aria-label="Conversation history"
        title="Conversation history"
        onClick={() => setOpen((current) => !current)}
      >
        <HistoryIcon />
      </button>
      {open ? (
        <section className={styles.popover} aria-label="Conversation history">
          <div className={styles.popoverHeader}>
            <h3>Chats</h3>
            <button
              className={styles.newButton}
              type="button"
              aria-label="New chat"
              title="New chat"
              onClick={() => {
                onNewConversation();
                setOpen(false);
              }}
            >
              <NewChatIcon />
            </button>
          </div>
          <label className={styles.search}>
            <span className={styles.visuallyHidden}>Search chats</span>
            <input
              type="search"
              value={query}
              placeholder="Search chats"
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </label>
          {visibleConversations.length > 0 ? (
            <ul className={styles.list}>
              {visibleConversations.map((conversation) => (
                <li
                  className={styles.row}
                  data-active={
                    conversation.id === activeConversationId
                      ? "true"
                      : undefined
                  }
                  key={conversation.id}
                >
                  <button
                    className={styles.openButton}
                    type="button"
                    aria-current={
                      conversation.id === activeConversationId
                        ? "page"
                        : undefined
                    }
                    onClick={() => {
                      onOpenConversation(conversation.id);
                      setOpen(false);
                    }}
                  >
                    <span className={styles.chatTitle}>
                      {conversation.title}
                    </span>
                    <span className={styles.chatMeta}>
                      {conversationDate(conversation.updatedAt)}
                      {conversation.messageCount > 0
                        ? ` · ${conversation.messageCount}`
                        : ""}
                    </span>
                  </button>
                  <button
                    className={styles.pinButton}
                    type="button"
                    aria-pressed={conversation.pinned}
                    aria-label={`${conversation.pinned ? "Unpin" : "Pin"} chat ${conversation.title}`}
                    title={conversation.pinned ? "Unpin chat" : "Pin chat"}
                    onClick={() => onTogglePinned(conversation.id)}
                  >
                    <PinIcon pinned={conversation.pinned} />
                  </button>
                  {onDeleteConversation ? (
                    confirmingDeleteId === conversation.id ? (
                      <button
                        className={styles.deleteConfirm}
                        type="button"
                        aria-label={`Confirm delete chat ${conversation.title}`}
                        onClick={() => {
                          setConfirmingDeleteId(null);
                          onDeleteConversation(conversation.id);
                        }}
                      >
                        Delete?
                      </button>
                    ) : (
                      <button
                        className={styles.deleteButton}
                        type="button"
                        aria-label={`Delete chat ${conversation.title}`}
                        title="Delete chat"
                        onClick={() => setConfirmingDeleteId(conversation.id)}
                      >
                        <DeleteIcon />
                      </button>
                    )
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.empty}>No matching chats</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
