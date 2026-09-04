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
  workspaceShortcutRows,
} from "@/lib/commands/workspace";
import { dedupePaletteEntries } from "@/lib/commands/palette";
import { plainTextExcerpt } from "@/lib/content";
import { itemFolderLabel, itemKindLabel } from "@/lib/workspace/item-labels";
import { workspaceMouseMoved } from "@/lib/workspace-hover";
import type { AppCommand, CommandContext } from "@/lib/commands/types";
import type {
  WorkspacePoolPayload,
  WorkspacePoolPost,
} from "@/lib/pool/types";
import {
  blogHomePath,
  blogPostPath,
} from "@/lib/public-paths";
import { folderPathForPoolPost } from "@/lib/pool/selectors";

export const OPEN_COMMAND_PALETTE_EVENT = "texttext:open-command-palette";
export const OPEN_KEYBOARD_SHORTCUTS_EVENT = "texttext:open-keyboard-shortcuts";

type PaletteResult = {
  id: string;
  label: string;
  detail?: string;
  group: string;
  searchText?: string;
  shortcut?: string;
  run: () => void | Promise<void>;
};

function displayTitle(value: string): string {
  return value.trim() || "Untitled";
}

function oneLine(value: string | undefined): string {
  // Through the same prose reduction the list rows use: a preview taken raw
  // put "Open **Settings**" and stray backticks into the palette, because a
  // document's first line is Markdown and the palette is not a renderer.
  return plainTextExcerpt(value ?? "").replace(/\s+/g, " ").trim();
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

type ShortcutSheetGroup = {
  group: string;
  rows: ShortcutSheetRow[];
};

function postResult(
  post: WorkspacePoolPost,
  pool: WorkspacePoolPayload,
  ctx: CommandContext,
): PaletteResult {
  const folder = itemFolderLabel(post, pool);
  const kind = itemKindLabel(post.type);
  const preview = oneLine(post.excerpt) || oneLine(post.bodyPreview);
  return {
    id: `post:${post.id}`,
    label: displayTitle(post.title),
    // Retrieval results name the human place and content kind. A storage slug
    // is an implementation detail, and "Drafts" is not where a note lives.
    detail: preview ? `${kind} · ${preview}` : kind,
    group: folder,
    searchText: oneLine(post.bodyPreview),
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
  shortcutsOpen,
}: {
  commandContext: () => CommandContext;
  initialQuery: string;
  onClose: () => void;
  open: boolean;
  shortcutsOpen: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [fallbackPool, setFallbackPool] =
    useState<WorkspacePoolPayload | null>(null);
  const fallbackHandleRef = useRef<string | null>(null);
  const ctx = commandContext();
  const pool = ctx.pool ?? fallbackPool;
  const paletteOpen = open && !shortcutsOpen;
  const dialogOpen = open;

  const closeDialog = () => {
    onClose();
  };

  useEffect(() => {
    if (!paletteOpen) return;
    const frame = window.requestAnimationFrame(() => {
      setQuery(initialQuery);
      setSelected(0);
      inputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [initialQuery, paletteOpen]);

  useEffect(() => {
    if (!dialogOpen || ctx.pool || fallbackPool) return;
    const handle = handleFromPathname(window.location.pathname);
    if (!handle || fallbackHandleRef.current === handle) return;
    fallbackHandleRef.current = handle;
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
  }, [ctx.pool, dialogOpen, fallbackPool]);

  const results = useMemo(() => {
    const slashMode = query.trimStart().startsWith("/");
    const cleanQuery = slashMode ? query.trimStart().slice(1).trim() : query;
    const commands = [
      ...availableWorkspaceCommands(ctx),
      ...dynamicWorkspaceCommands(ctx),
    ]
      .filter((command) => command.showInPalette !== false)
      .map((command) => commandResult(command, ctx));

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
              result.searchText ?? "",
            ]),
          }))
          .filter((entry): entry is { result: PaletteResult; score: number } =>
            entry.score !== null,
          );

    const contextualFilter: Array<{ result: PaletteResult; score: number }> =
      !slashMode &&
      cleanQuery.trim() &&
      ctx.workspace?.viewLevel === "section"
        ? [
            {
              score: -1,
              result: {
                id: `filter:${cleanQuery}`,
                label: `Filter this folder for “${cleanQuery}”`,
                detail: "Current folder",
                group: "Search",
                run: () => {
                  window.dispatchEvent(
                    new CustomEvent("texttext:filter-current-folder", {
                      detail: { query: cleanQuery },
                    }),
                  );
                },
              },
            },
          ]
        : [];

    return dedupePaletteEntries(
        [...contextualFilter, ...commandRows, ...navigationRows]
          .sort(
            (a, b) =>
              a.score - b.score || a.result.label.localeCompare(b.result.label),
          )
          .slice(0, 12)
          .map((entry) => entry.result),
    );
  }, [ctx, pool, query]);

  const shortcutGroups = useMemo<ShortcutSheetGroup[]>(() => {
    const preferred = [
      "Navigate",
      "Read",
      "Create",
      "Act",
      "Command bar",
      "Workspace",
    ];
    const registryRows = workspaceShortcutRows();
    const byGroup = new Map<string, ShortcutSheetRow[]>();
    for (const row of registryRows) {
      const list = byGroup.get(row.group);
      if (list) list.push(row);
      else byGroup.set(row.group, [row]);
    }
    const ordered = [
      ...preferred.filter((group) => byGroup.has(group)),
      ...[...byGroup.keys()].filter((group) => !preferred.includes(group)),
    ];
    return ordered.map((group) => ({
      group,
      rows: byGroup.get(group) ?? [],
    }));
  }, []);

  const selectedIndex =
    results.length === 0 ? 0 : Math.min(selected, results.length - 1);

  if (!dialogOpen) return null;

  const runSelected = () => {
    const result = results[selectedIndex];
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
      className={`command-palette-backdrop applecms${
        shortcutsOpen ? " is-sheet" : ""
      }`}
      role="presentation"
      onWheel={(event) => {
        if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
          event.preventDefault();
        }
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeDialog();
      }}
    >
      <div
        className={`command-palette${shortcutsOpen ? " command-palette--sheet" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={shortcutsOpen ? "Keyboard shortcuts" : "Command palette"}
      >
        {shortcutsOpen ? (
          <>
            <div className="command-sheet-header">
              <div className="command-sheet-titles">
                <span className="command-sheet-title">Keyboard shortcuts</span>
                <span className="command-sheet-subtitle">
                  Press ? anytime to open this. Esc to close.
                </span>
              </div>
              <button
                type="button"
                className="command-sheet-done"
                onClick={closeDialog}
              >
                Close
              </button>
            </div>
            <div className="command-sheet-columns" role="list">
              {shortcutGroups.map((group) => (
                <div
                  key={group.group}
                  className="command-shortcut-group"
                  role="group"
                  aria-label={group.group}
                >
                  <div className="command-shortcut-heading">{group.group}</div>
                  {group.rows.map((row) => (
                    <div
                      key={row.id}
                      className="command-sheet-row"
                      role="listitem"
                    >
                      <span className="command-sheet-row-label">
                        {row.label}
                      </span>
                      <span className="command-sheet-keys">
                        {row.shortcut
                          .split(", ")
                          .map((chord, chordIndex) => (
                            <kbd
                              key={`${row.id}-${chordIndex}`}
                              className="command-sheet-key"
                            >
                              {chord}
                            </kbd>
                          ))}
                      </span>
                    </div>
                  ))}
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
                      index === selectedIndex ? " is-selected" : ""
                    }`}
                    role="option"
                    aria-selected={index === selectedIndex}
                    onMouseMove={(event) => {
                      if (workspaceMouseMoved(event.clientX, event.clientY)) {
                        setSelected(index);
                      }
                    }}
                    onClick={() => {
                      closeDialog();
                      void Promise.resolve(result.run());
                    }}
                  >
                    <span className="command-palette-copy">
                      {/* A command is a thing you type; a document is a thing
                          you wrote. Mono for the first, prose for the second,
                          so the two kinds of row never read as one list. */}
                      <span
                        className={`command-palette-label${
                          result.id.startsWith("command:") ? " is-command" : ""
                        }`}
                      >
                        {result.label}
                      </span>
                      <span className="command-palette-detail">
                        {result.group}
                        {result.detail ? ` / ${result.detail}` : ""}
                      </span>
                    </span>
                    {result.shortcut && (
                      <span className="command-palette-shortcut">
                        {result.shortcut.split(", ").map((chord, chordIndex) => (
                          <kbd key={`${result.id}-${chordIndex}`}>{chord}</kbd>
                        ))}
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
            {/* What to type, for someone who opened this and went blank. Real
                queries, not a legend: each one runs if you click it. */}
            <div className="command-palette-suggestions">
              <span>Try</span>
              {PALETTE_SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => {
                    setQuery(suggestion);
                    setSelected(0);
                    inputRef.current?.focus();
                  }}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Openers, not a taxonomy: the shapes of query the palette answers well. */
const PALETTE_SUGGESTIONS = ["/new", "notes", "starred", "/settings"] as const;
