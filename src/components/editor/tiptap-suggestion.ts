import type { Editor, Range } from "@tiptap/core";
import { posToDOMRect } from "@tiptap/core";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

type SuggestionMatch = {
  range: Range;
  query: string;
  text: string;
};

type SuggestionState = {
  active: boolean;
  range: Range;
  query: string;
  text: string;
  decorationId: string | null;
  dismissed: {
    from: number;
    text: string;
  } | null;
};

export type SuggestionProps<I = unknown, TSelected = I> = {
  editor: Editor;
  range: Range;
  query: string;
  text: string;
  items: I[];
  command: (item: TSelected) => void;
  clientRect: () => DOMRect | null;
};

export type SuggestionKeyDownProps = {
  view: EditorView;
  event: KeyboardEvent;
  range: Range;
};

type SuggestionRenderer<I, TSelected> = {
  onStart?: (props: SuggestionProps<I, TSelected>) => void;
  onUpdate?: (props: SuggestionProps<I, TSelected>) => void;
  onKeyDown?: (props: SuggestionKeyDownProps) => boolean;
  onExit?: () => void;
};

type SuggestionCommandProps<I> = {
  editor: Editor;
  range: Range;
  props: I;
};

type SuggestionAllowProps = {
  editor: Editor;
  state: EditorState;
  range: Range;
  query: string;
  text: string;
};

type SuggestionItemsProps = {
  editor: Editor;
  query: string;
};

export type SuggestionOptions<I = unknown, TSelected = I> = {
  pluginKey?: PluginKey | string;
  editor: Editor;
  char?: string;
  allowSpaces?: boolean;
  allowedPrefixes?: string[] | null;
  startOfLine?: boolean;
  decorationTag?: string;
  decorationClass?: string;
  decorationContent?: string;
  decorationEmptyClass?: string;
  command?: (props: SuggestionCommandProps<TSelected>) => void;
  items?: (props: SuggestionItemsProps) => I[];
  render?: () => SuggestionRenderer<I, TSelected>;
  allow?: (props: SuggestionAllowProps) => boolean;
};

export const SuggestionPluginKey = new PluginKey<SuggestionState>("suggestion");

const inactiveState: SuggestionState = {
  active: false,
  range: { from: 0, to: 0 },
  query: "",
  text: "",
  decorationId: null,
  dismissed: null,
};

function pluginKeyFrom(value: PluginKey | string | undefined) {
  if (!value) return SuggestionPluginKey;
  return typeof value === "string" ? new PluginKey<SuggestionState>(value) : value;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findSuggestionMatch({
  char,
  allowSpaces,
  allowedPrefixes,
  startOfLine,
  state,
}: {
  char: string;
  allowSpaces: boolean;
  allowedPrefixes: string[] | null;
  startOfLine: boolean;
  state: EditorState;
}): SuggestionMatch | null {
  const { selection } = state;

  if (!selection.empty) return null;

  const $position = selection.$from;
  const textBefore = $position.parent.textBetween(
    0,
    $position.parentOffset,
    "\n",
    "\ufffc",
  );
  const charIndex = textBefore.lastIndexOf(char);

  if (charIndex < 0) return null;

  const textBeforeChar = textBefore.slice(0, charIndex);
  const prefix = textBeforeChar.slice(-1);

  if (startOfLine && textBeforeChar.trim().length > 0) return null;
  if (
    !startOfLine &&
    charIndex > 0 &&
    allowedPrefixes &&
    !allowedPrefixes.includes(prefix)
  ) {
    return null;
  }

  const query = textBefore.slice(charIndex + char.length);

  if (!allowSpaces && /\s/.test(query)) return null;

  const text = `${char}${query}`;
  const from = $position.pos - text.length;

  if (!new RegExp(`^${escapeRegExp(char)}`).test(text)) return null;

  return {
    range: { from, to: $position.pos },
    query,
    text,
  };
}

function shouldStayDismissed(
  dismissed: SuggestionState["dismissed"],
  match: SuggestionMatch,
) {
  return (
    dismissed !== null &&
    dismissed.from === match.range.from &&
    match.text.startsWith(dismissed.text)
  );
}

function stateFromMatch(match: SuggestionMatch, dismissed: SuggestionState["dismissed"]) {
  return {
    active: true,
    range: match.range,
    query: match.query,
    text: match.text,
    decorationId: `suggestion-${match.range.from}-${match.range.to}`,
    dismissed,
  };
}

function propsFor<I, TSelected>({
  editor,
  items,
  pluginKey,
  command,
  view,
  state,
}: {
  editor: Editor;
  items: (props: SuggestionItemsProps) => I[];
  pluginKey: PluginKey<SuggestionState>;
  command: (props: SuggestionCommandProps<TSelected>) => void;
  view: EditorView;
  state: SuggestionState;
}): SuggestionProps<I, TSelected> {
  const commandForItem = (item: TSelected) => {
    command({
      editor,
      range: state.range,
      props: item,
    });
  };

  const clientRect = () => {
    const decoration = state.decorationId
      ? view.dom.querySelector(`[data-suggestion-id="${state.decorationId}"]`)
      : null;

    if (decoration) return decoration.getBoundingClientRect();

    try {
      return posToDOMRect(view, state.range.from, state.range.to);
    } catch {
      return null;
    }
  };

  return {
    editor,
    range: state.range,
    query: state.query,
    text: state.text,
    items: items({ editor, query: state.query }),
    command: commandForItem,
    clientRect,
  };
}

export function exitSuggestion(
  view: EditorView,
  pluginKeyRef: PluginKey = SuggestionPluginKey,
) {
  view.dispatch(view.state.tr.setMeta(pluginKeyRef, { exit: true }));
}

export function Suggestion<I = unknown, TSelected = I>({
  pluginKey: pluginKeyOption,
  editor,
  char = "@",
  allowSpaces = false,
  allowedPrefixes = [" "],
  startOfLine = false,
  decorationTag = "span",
  decorationClass = "suggestion",
  decorationContent = "",
  decorationEmptyClass = "is-empty",
  command = () => undefined,
  items = () => [],
  render = () => ({}),
  allow = () => true,
}: SuggestionOptions<I, TSelected>) {
  const pluginKey = pluginKeyFrom(pluginKeyOption);
  const renderer = render();
  let exitQueued = false;

  const dispatchExit = (view: EditorView) => {
    if (exitQueued) return;
    exitQueued = true;
    queueMicrotask(() => {
      exitQueued = false;
      const current = pluginKey.getState(view.state);
      if (current?.active) exitSuggestion(view, pluginKey);
    });
  };

  return new Plugin<SuggestionState>({
    key: pluginKey,
    state: {
      init: () => inactiveState,
      apply(transaction: Transaction, previous: SuggestionState, _old, state) {
        const meta = transaction.getMeta(pluginKey);

        if (meta?.exit) {
          return {
            ...inactiveState,
            dismissed: previous.active
              ? {
                  from: previous.range.from,
                  text: previous.text,
                }
              : previous.dismissed,
          };
        }

        if (!editor.isEditable) {
          return inactiveState;
        }

        const match = findSuggestionMatch({
          char,
          allowSpaces,
          allowedPrefixes,
          startOfLine,
          state,
        });

        if (!match) return inactiveState;

        if (shouldStayDismissed(previous.dismissed, match)) {
          return {
            ...inactiveState,
            dismissed: previous.dismissed,
          };
        }

        if (
          !allow({
            editor,
            state,
            range: match.range,
            query: match.query,
            text: match.text,
          })
        ) {
          return inactiveState;
        }

        return stateFromMatch(match, null);
      },
    },
    view: (view) => ({
      update: (nextView, previousState) => {
        const previous = previousState ? pluginKey.getState(previousState) : null;
        const current = pluginKey.getState(nextView.state);

        if (!current?.active) {
          if (previous?.active) renderer.onExit?.();
          return;
        }

        const props = propsFor({
          editor,
          items,
          pluginKey,
          command,
          view: nextView,
          state: current,
        });

        if (props.items.length === 0 && current.query.length > 0) {
          dispatchExit(nextView);
          return;
        }

        if (!previous?.active) {
          renderer.onStart?.(props);
          return;
        }

        renderer.onUpdate?.(props);
      },
      destroy: () => {
        const current = pluginKey.getState(view.state);
        if (current?.active) renderer.onExit?.();
      },
    }),
    props: {
      decorations(state) {
        const current = pluginKey.getState(state);

        if (!current?.active) return DecorationSet.empty;

        return DecorationSet.create(state.doc, [
          Decoration.inline(current.range.from, current.range.to, {
            nodeName: decorationTag,
            class: [
              decorationClass,
              current.query.length === 0 ? decorationEmptyClass : "",
            ]
              .filter(Boolean)
              .join(" "),
            "data-suggestion-id": current.decorationId ?? "",
            "data-suggestion-content": decorationContent,
          }),
        ]);
      },
      handleKeyDown(view, event) {
        const current = pluginKey.getState(view.state);

        if (!current?.active) return false;

        const handled = renderer.onKeyDown?.({
          view,
          event,
          range: current.range,
        });

        if (handled) return true;

        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          exitSuggestion(view, pluginKey);
          editor.commands.focus();
          return true;
        }

        return false;
      },
    },
  });
}
