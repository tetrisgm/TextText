import { Extension } from "@tiptap/core";
import type { Editor, Range } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { createElement, createRef } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import {
  Suggestion,
  exitSuggestion,
} from "@tiptap/suggestion";
import type {
  SuggestionKeyDownProps,
  SuggestionProps,
} from "@tiptap/suggestion";
import {
  WikiLinkMenu,
  type WikiLinkCommandItem,
  type WikiLinkMenuHandle,
} from "@/components/editor/WikiLinkMenu";

export type WikiLinkSuggestionPost = {
  slug: string;
  title: string;
};

export type WikiLinkCreatedPost = WikiLinkSuggestionPost;

type WikiLinkCommandOptions = {
  posts: WikiLinkSuggestionPost[];
  onCreateNote?: (title: string) => Promise<WikiLinkCreatedPost | null>;
};

const wikiLinkPluginKey = new PluginKey("wikiLinkCommand");

function cleanLabel(value: string, fallback: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/\]+/g, "").trim() || fallback;
}

export function wikiLinkCommandItems(
  query: string,
  posts: readonly WikiLinkSuggestionPost[],
): WikiLinkCommandItem[] {
  const normalized = query.trim().toLowerCase();
  const matches: WikiLinkCommandItem[] = posts
    .filter((post) => {
      if (!normalized) return true;
      return `${post.title} ${post.slug}`.toLowerCase().includes(normalized);
    })
    .slice(0, 8)
    .map((post) => ({
      id: `wiki-link-${post.slug}`,
      kind: "post" as const,
      slug: post.slug,
      title: post.title.trim() || post.slug,
      query,
    }));
  if (query.trim()) {
    matches.push({
      id: "wiki-link-create",
      kind: "create",
      title: cleanLabel(query, "Untitled"),
      query,
    });
  }
  return matches;
}

function insertWikiLink(
  editor: Editor,
  range: Range,
  post: WikiLinkSuggestionPost,
) {
  const label = cleanLabel(post.title, post.slug);
  editor
    .chain()
    .focus()
    .deleteRange(range)
    .insertContent({
      type: "wikiLink",
      attrs: { target: post.slug, label },
    })
    .insertContent(" ")
    .run();
}

function wikiLinkAllowed({
  editor,
  state,
  range,
  query,
}: {
  editor: Editor;
  state: Editor["state"];
  range: Range;
  query: string;
}) {
  if (!editor.isEditable || query.includes("]]")) return false;
  const parent = state.doc.resolve(range.from).parent;
  return parent.isTextblock && !parent.type.spec.code;
}

export const WikiLinkCommand = Extension.create<WikiLinkCommandOptions>({
  name: "wikiLinkCommand",

  addOptions() {
    return { posts: [], onCreateNote: undefined };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion<WikiLinkCommandItem>({
        editor: this.editor,
        pluginKey: wikiLinkPluginKey,
        char: "[[",
        allowedPrefixes: null,
        allowSpaces: true,
        decorationClass: "wiki-link-decoration",
        allow: ({ state, range, query }) =>
          wikiLinkAllowed({ editor: this.editor, state, range, query }),
        items: ({ query }) => wikiLinkCommandItems(query, this.options.posts),
        command: ({ editor, range, props }) => {
          if (props.kind === "post" && props.slug) {
            insertWikiLink(editor, range, {
              slug: props.slug,
              title: props.title,
            });
            return;
          }
          const create = this.options.onCreateNote;
          if (!create) return;
          const expected = `[[${props.query}`;
          void create(props.title).then((post) => {
            if (!post || editor.isDestroyed) return;
            const safeTo = Math.min(range.to, editor.state.doc.content.size);
            const current = editor.state.doc.textBetween(
              range.from,
              safeTo,
              "\n",
              "\ufffc",
            );
            const nextRange =
              current === expected
                ? { ...range, to: safeTo }
                : {
                    from: editor.state.selection.from,
                    to: editor.state.selection.to,
                  };
            insertWikiLink(editor, nextRange, post);
          });
        },
        render: () => {
          let element: HTMLDivElement | null = null;
          let root: Root | null = null;
          const menuRef = createRef<WikiLinkMenuHandle>();

          const destroyMenu = () => {
            root?.unmount();
            element?.remove();
            root = null;
            element = null;
          };

          const renderMenu = (props: SuggestionProps<WikiLinkCommandItem>) => {
            if (!element) {
              element = document.createElement("div");
              element.className = "applecms slash-command-host";
              document.body.appendChild(element);
              root = createRoot(element);
            }
            root?.render(
              createElement(WikiLinkMenu, {
                ...props,
                ref: menuRef,
                onClose: () => {
                  exitSuggestion(props.editor.view, wikiLinkPluginKey);
                  props.editor.commands.focus();
                },
              }),
            );
          };

          return {
            onStart: renderMenu,
            onUpdate: renderMenu,
            onKeyDown: (props: SuggestionKeyDownProps) =>
              menuRef.current?.onKeyDown(props) ?? false,
            onExit: destroyMenu,
          };
        },
      }),
    ];
  },
});
