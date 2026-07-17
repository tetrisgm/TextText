import { mergeAttributes, Node } from "@tiptap/core";
import type { MarkdownNodeSpec } from "tiptap-markdown";

export const Subtitle = Node.create({
  name: "subtitle",
  group: "block",
  content: "inline*",
  defining: true,

  parseHTML() {
    return [{ tag: "h6" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "h6",
      mergeAttributes(HTMLAttributes, {
        class: "body-editor-subtitle",
        "data-subtitle": "true",
      }),
      0,
    ];
  },

  addStorage() {
    const markdown: MarkdownNodeSpec = {
      serialize(state, node) {
        state.write("###### ");
        state.renderInline(node);
        state.closeBlock(node);
      },
      parse: {},
    };
    return { markdown };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Alt-4": () => this.editor.commands.setNode(this.name),
    };
  },
});
