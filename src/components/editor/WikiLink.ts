import { mergeAttributes, Node } from "@tiptap/core";
import type { MarkdownNodeSpec } from "tiptap-markdown";
import {
  parseWikiLinkInner,
  serializeWikiLink,
} from "@/lib/wikilink-syntax";

type InlineState = {
  src: string;
  pos: number;
  posMax: number;
  push: (type: string, tag: string, nesting: number) => {
    attrSet: (name: string, value: string) => void;
    content: string;
  };
};

type MarkdownItLike = {
  inline: {
    ruler: {
      before: (
        beforeName: string,
        ruleName: string,
        rule: (state: InlineState, silent: boolean) => boolean,
      ) => void;
    };
  };
  renderer: {
    rules: Record<
      string,
      (tokens: Array<{ attrs?: [string, string][] }>, index: number) => string
    >;
  };
  utils: { escapeHtml: (value: string) => string };
};

const configuredMarkdownIts = new WeakSet<object>();

function tokenAttribute(
  token: { attrs?: [string, string][] },
  name: string,
): string {
  return token.attrs?.find(([key]) => key === name)?.[1] ?? "";
}

export function installWikiLinkMarkdownRule(markdownItInput: unknown) {
  const markdownIt = markdownItInput as MarkdownItLike;
  if (configuredMarkdownIts.has(markdownIt as object)) return;
  configuredMarkdownIts.add(markdownIt as object);
  markdownIt.inline.ruler.before(
    "link",
    "wiki_link",
    (state: InlineState, silent: boolean) => {
      if (state.src.slice(state.pos, state.pos + 2) !== "[[") return false;
      const close = state.src.indexOf("]]", state.pos + 2);
      if (close < 0 || close + 2 > state.posMax) return false;
      const reference = parseWikiLinkInner(
        state.src.slice(state.pos + 2, close),
      );
      if (!reference) return false;
      if (!silent) {
        const token = state.push("wiki_link", "span", 0);
        token.attrSet("data-wiki-link", reference.target);
        token.attrSet("data-wiki-label", reference.label);
        token.content = reference.label;
      }
      state.pos = close + 2;
      return true;
    },
  );

  markdownIt.renderer.rules.wiki_link = (tokens, index) => {
    const target = markdownIt.utils.escapeHtml(
      tokenAttribute(tokens[index]!, "data-wiki-link"),
    );
    const label = markdownIt.utils.escapeHtml(
      tokenAttribute(tokens[index]!, "data-wiki-label"),
    );
    return `<span class="wiki-link-node" data-wiki-link="${target}" data-wiki-label="${label}">${label}</span>`;
  };
}

export const wikiLinkMarkdownSpec: MarkdownNodeSpec = {
  serialize(state, node) {
    state.write(
      serializeWikiLink({
        target: String(node.attrs.target ?? ""),
        label: String(node.attrs.label ?? node.attrs.target ?? ""),
      }),
    );
  },
  parse: {
    setup(markdownIt) {
      installWikiLinkMarkdownRule(markdownIt);
    },
  },
};

export const WikiLink = Node.create({
  name: "wikiLink",
  inline: true,
  group: "inline",
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      target: { default: "" },
      label: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-wiki-link]",
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) return false;
          const target = element.dataset.wikiLink ?? "";
          const label =
            element.dataset.wikiLabel ?? element.textContent ?? target;
          return { target, label };
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const target = String(node.attrs.target ?? "");
    const label = String(node.attrs.label ?? target);
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        class: "wiki-link-node",
        "data-wiki-link": target,
        "data-wiki-label": label,
        title: `Open ${label}`,
      }),
      label,
    ];
  },

  addStorage() {
    return { markdown: wikiLinkMarkdownSpec };
  },
});
