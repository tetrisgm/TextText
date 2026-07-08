"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  availableWorkspaceCommands,
  commandShortcutLabel,
  dynamicWorkspaceCommands,
} from "@/lib/commands/workspace";
import type { AppCommand, CommandContext } from "@/lib/commands/types";
import type {
  WorkspacePoolPayload,
  WorkspacePoolPost,
} from "@/lib/pool/types";
import {
  blogHomePath,
  blogPostPath,
} from "@/lib/public-paths";
import { isTypingTarget } from "./typing-target";

export const OPEN_COMMAND_PALETTE_EVENT = "write:open-command-palette";
export const OPEN_KEYBOARD_SHORTCUTS_EVENT = "write:open-keyboard-shortcuts";

type PaletteResult = {
  id: string;
  label: string;
  detail?: string;
  group: string;
  shortcut?: string;
  run: () => void | Promise<void>;
};

function displayTitle(value: string): string {
  return value.trim() || "Untitled";
}

function oneLine(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function compactPath(path: string): string {
  return path.replace(/^blog\/?/, "") || "Blog";
}

function folderHref(pool: WorkspacePoolPayload, folderPath: string): string {
  const params = new URLSearchParams({ folder: folderPath });
  return `${blogHomePath(pool.blog)}?${params.toString()}`;
}

function scoreText(query: string, text: string): number | null {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return 0;
  const normalizedText = text.toLowerCase();
  if (normalizedText.includes(normalizedQuery)) {
    return normalizedText.indexOf(normalizedQuery);
  }

  let score = 0;
  let position = 0;
  for (const char of normalizedQuery) {
    const found = normalizedText.indexOf(char, position);
    if (found === -1) return null;
    score += found - position + 1;
    position = found + 1;
  }
  return score + normalizedText.length / 1000;
}

function matchesQuery(query: string, values: string[]): number | null {
  let best: number | null = null;
  for (const value of values) {
    const score = scoreText(query, value);
    if (score === null) continue;
    best = best === null ? score : Math.min(best, score);
  }
  return best;
}

function handleFromPathname(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "t" || !parts[1]) return null;
  try {
    return decodeURIComponent(parts[1]);
  } catch {
    return null;
  }
}

function commandResult(command: AppCommand, ctx: CommandContext): PaletteResult {
  return {
    id: `command:${command.id}`,
    label: command.label,
    group: command.group,
    shortcut: commandShortcutLabel(command),
    run: () => command.run(ctx),
  };
}

type ShortcutSheetRow = {
  id: string;
  label: string;
  group: string;
  shortcut: string;
};

function postResult(
  post: WorkspacePoolPost,
  pool: WorkspacePoolPayload,
  ctx: CommandContext,
): PaletteResult {
  return {
    id: `post:${post.id}`,
    label: displayTitle(post.title),
    detail: oneLine(post.excerpt) || post.slug,
    group: post.status === "published" ? "Posts" : "Drafts",
    run: () => {
      if (ctx.workspace?.blog.handle === pool.blog.handle) {
        ctx.workspace.openPost(post.id);
        return;
      }
      ctx.navigate(blogPostPath(pool.blog, post));
    },
  };
}

function folderResult(
  folder: WorkspacePoolPayload["folders"][number],
  pool: WorkspacePoolPayload,
  ctx: CommandContext,
): PaletteResult {
  return {
    id: `folder:${folder.id}`,
    label: folder.name,
    detail: compactPath(folder.path),
    group: "Folders",
    run: () => {
      if (ctx.workspace?.blog.handle === pool.blog.handle) {
        ctx.workspace.openFolder(folder.path);
        return;
      }
      ctx.navigate(folderHref(pool, folder.path));
    },
  };
}

export function CommandPalette({
  commandContext,
  initialQuery,
  onClose,
  open,
}: {
  commandContext: () => CommandContext;
  initialQuery: string;
  onClose: () => void;
  open: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const wasOpenRef = useRef(open);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [fallbackPool, setFallbackPool] =
    useState<WorkspacePoolPayload | null>(null);
  const [fallbackHandle, setFallbackHandle] = useState<string | null>(null);
  const ctx = commandContext();
  const pool = ctx.pool ?? fallbackPool;
  const paletteOpen = open && !shortcutsOpen;
  const dialogOpen = open || shortcutsOpen;

  const closeDialog = () => {
    setShortcutsOpen(false);
    onClose();
  };

  useEffect(() => {
    if (!paletteOpen) return;
    setQuery(initialQuery);
    setSelected(0);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [initialQuery, paletteOpen]);

  useEffect(() => {
    if (wasOpenRef.current && !open) setShortcutsOpen(false);
    wasOpenRef.current = open;
  }, [open]);

  useEffect(() => {
    const openCommandPalette = () => {
      setShortcutsOpen(false);
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "k",
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    };
    const openShortcuts = () => {
      setShortcutsOpen(true);
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "k",
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key !== "?") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      openShortcuts();
    };
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, openCommandPalette);
    window.addEventListener(OPEN_KEYBOARD_SHORTCUTS_EVENT, openShortcuts);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, openCommandPalette);
      window.removeEventListener(OPEN_KEYBOARD_SHORTCUTS_EVENT, openShortcuts);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!dialogOpen || ctx.pool || fallbackPool) return;
    const handle = handleFromPathname(window.location.pathname);
    if (!handle || fallbackHandle === handle) return;
    setFallbackHandle(handle);
    const params = new URLSearchParams({ handle });
    void fetch(`/api/workspace/pool?${params.toString()}`, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: WorkspacePoolPayload | null) => {
        if (payload?.version === 1) setFallbackPool(payload);
      })
      .catch(() => {
        // The fallback is best effort. Guests and collaborators may not have
        // an owner pool, so an empty local palette is a valid result.
      });
  }, [ctx.pool, dialogOpen, fallbackHandle, fallbackPool]);

  const results = useMemo(() => {
    const slashMode = query.trimStart().startsWith("/");
    const cleanQuery = slashMode ? query.trimStart().slice(1).trim() : query;
    const commands = [
      ...availableWorkspaceCommands(ctx),
      ...dynamicWorkspaceCommands(ctx),
    ].map((command) => commandResult(command, ctx));

    const commandRows = commands
      .map((result) => ({
        result,
        score: matchesQuery(cleanQuery, [
          result.label,
          result.group,
          result.detail ?? "",
        ]),
      }))
      .filter((entry): entry is { result: PaletteResult; score: number } =>
        entry.score !== null,
      );

    const navigationRows = slashMode || !pool
      ? []
      : [
          ...pool.posts.map((post) => postResult(post, pool, ctx)),
          ...pool.folders.map((folder) => folderResult(folder, pool, ctx)),
        ]
          .map((result) => ({
            result,
            score: matchesQuery(cleanQuery, [
              result.label,
              result.group,
              result.detail ?? "",
            ]),
          }))
          .filter((entry): entry is { result: PaletteResult; score: number } =>
            entry.score !== null,
          );

    return [...commandRows, ...navigationRows]
      .sort((a, b) => a.score - b.score || a.result.label.localeCompare(b.result.label))
      .slice(0, 12)
      .map((entry) => entry.result);
  }, [ctx, pool, query]);

  const shortcutRows = useMemo<ShortcutSheetRow[]>(() => {
    const rows: ShortcutSheetRow[] = [
      {
        id: "system.palette",
        label: "Open command palette",
        group: "Workspace",
        shortcut: "⌘K",
      },
      {
        id: "system.shortcuts",
        label: "Keyboard shortcuts",
        group: "Workspace",
        shortcut: "?",
      },
      {
        id: "system.slash",
        label: "Editor commands",
        group: "Editor",
        shortcut: "/",
      },
    ];
    for (const command of availableWorkspaceCommands(ctx)) {
      const shortcut = commandShortcutLabel(command);
      if (!shortcut) continue;
      rows.push({
        id: command.id,
        label: command.label,
        group: command.group,
        shortcut,
      });
    }
    const seen = new Set<string>();
    return rows.filter((row) => {
      const key = `${row.label}:${row.shortcut}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [ctx]);

  useEffect(() => {
    setSelected((current) =>
      results.length === 0 ? 0 : Math.min(current, results.length - 1),
    );
  }, [results.length]);

  if (!dialogOpen) return null;

  const runSelected = () => {
    const result = results[selected];
    if (!result) return;
    closeDialog();
    void Promise.resolve(result.run());
  };

  const onInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelected((current) =>
        results.length === 0 ? 0 : (current + 1) % results.length,
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelected((current) =>
        results.length === 0
          ? 0
          : current <= 0
            ? results.length - 1
            : current - 1,
      );
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      runSelected();
    }
  };

  return (
    <div
      className="command-palette-backdrop applecms"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeDialog();
      }}
    >
      <div
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label={shortcutsOpen ? "Keyboard shortcuts" : "Command palette"}
      >
        {shortcutsOpen ? (
          <>
            <div
              className="command-palette-input"
              style={{
                alignItems: "center",
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span>Keyboard shortcuts</span>
              <button
                type="button"
                className="command-palette-shortcut"
                style={{ cursor: "pointer" }}
                onClick={closeDialog}
              >
                Done
              </button>
            </div>
            <div className="command-palette-results" role="list">
              {shortcutRows.map((row) => (
                <div
                  key={row.id}
                  className="command-palette-row"
                  role="listitem"
                  style={{ cursor: "default" }}
                >
                  <span className="command-palette-copy">
                    <span className="command-palette-label">{row.label}</span>
                    <span className="command-palette-detail">{row.group}</span>
                  </span>
                  <span className="command-palette-shortcut">
                    {row.shortcut}
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <input
              ref={inputRef}
              className="command-palette-input"
              value={query}
              placeholder="Search or type / for commands"
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={(event) => {
                setQuery(event.currentTarget.value);
                setSelected(0);
              }}
              onKeyDown={onInputKeyDown}
            />
            <div className="command-palette-results" role="listbox">
              {results.length === 0 ? (
                <div className="command-palette-empty">No results</div>
              ) : (
                results.map((result, index) => (
                  <button
                    key={result.id}
                    type="button"
                    className={`command-palette-row${
                      index === selected ? " is-selected" : ""
                    }`}
                    role="option"
                    aria-selected={index === selected}
                    onMouseEnter={() => setSelected(index)}
                    onClick={() => {
                      closeDialog();
                      void Promise.resolve(result.run());
                    }}
                  >
                    <span className="command-palette-copy">
                      <span className="command-palette-label">{result.label}</span>
                      <span className="command-palette-detail">
                        {result.group}
                        {result.detail ? ` / ${result.detail}` : ""}
                      </span>
                    </span>
                    {result.shortcut && (
                      <span className="command-palette-shortcut">
                        {result.shortcut}
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
