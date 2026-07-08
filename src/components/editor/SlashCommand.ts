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
  SlashMenu,
  type SlashCommandItem,
  type SlashMenuHandle,
} from "@/components/editor/SlashMenu";

type SlashCommandOptions = {
  mediaEnabled: boolean;
  onChooseImage?: () => void;
};

const slashCommandPluginKey = new PluginKey("slashCommand");

const textCommands: SlashCommandItem[] = [
  {
    id: "slash-command-text",
    action: "paragraph",
    label: "Text",
    hint: "Plain paragraph",
    icon: "T",
    aliases: ["paragraph", "body"],
  },
  {
    id: "slash-command-heading-1",
    action: "heading1",
    label: "Heading 1",
    hint: "Large section title",
    icon: "H1",
    aliases: ["h1", "title"],
  },
  {
    id: "slash-command-heading-2",
    action: "heading2",
    label: "Heading 2",
    hint: "Medium section title",
    icon: "H2",
    aliases: ["h2", "subtitle"],
  },
  {
    id: "slash-command-heading-3",
    action: "heading3",
    label: "Heading 3",
    hint: "Small section title",
    icon: "H3",
    aliases: ["h3", "subheading"],
  },
];

const listCommands: SlashCommandItem[] = [
  {
    id: "slash-command-bullet-list",
    action: "bulletList",
    label: "Bulleted list",
    hint: "Simple list",
    icon: "UL",
    aliases: ["bullet", "unordered", "list"],
  },
  {
    id: "slash-command-numbered-list",
    action: "orderedList",
    label: "Numbered list",
    hint: "Ordered steps",
    icon: "OL",
    aliases: ["number", "ordered", "list"],
  },
  {
    id: "slash-command-todo-list",
    action: "taskList",
    label: "To-do list",
    hint: "Tasks with checkboxes",
    icon: "[]",
    aliases: ["todo", "task", "checklist", "checkbox"],
  },
];

const blockCommands: SlashCommandItem[] = [
  {
    id: "slash-command-quote",
    action: "blockquote",
    label: "Quote",
    hint: "Quoted block",
    icon: ">",
    aliases: ["blockquote", "pullquote"],
  },
  {
    id: "slash-command-code-block",
    action: "codeBlock",
    label: "Code block",
    hint: "Preformatted text",
    icon: "</>",
    aliases: ["code", "pre"],
  },
  {
    id: "slash-command-divider",
    action: "horizontalRule",
    label: "Divider",
    hint: "Horizontal rule",
    icon: "HR",
    aliases: ["horizontal", "rule", "separator"],
  },
];

const imageCommand: SlashCommandItem = {
  id: "slash-command-image",
  action: "image",
  label: "Image",
  hint: "Upload from device",
  icon: "IMG",
  aliases: ["photo", "picture", "media"],
};

function commandItems(mediaEnabled: boolean): SlashCommandItem[] {
  const items = [...textCommands, ...listCommands, ...blockCommands];
  return mediaEnabled ? [...items, imageCommand] : items;
}

function searchableText(item: SlashCommandItem): string {
  return `${item.label} ${item.hint} ${item.aliases.join(" ")}`.toLowerCase();
}

function filteredItems(query: string, mediaEnabled: boolean): SlashCommandItem[] {
  const normalizedQuery = query.trim().toLowerCase();
  const items = commandItems(mediaEnabled);

  if (!normalizedQuery) return items;

  return items.filter((item) => searchableText(item).includes(normalizedQuery));
}

function deleteQuery(editor: Editor, range: Range) {
  return editor.chain().focus().deleteRange(range);
}

function setList(editor: Editor, range: Range, list: SlashCommandItem["action"]) {
  const chain = deleteQuery(editor, range);

  if (list === "bulletList" && !editor.isActive("bulletList")) {
    chain.toggleBulletList();
  }

  if (list === "orderedList" && !editor.isActive("orderedList")) {
    chain.toggleOrderedList();
  }

  if (list === "taskList" && !editor.isActive("taskList")) {
    chain.toggleTaskList();
  }

  chain.run();
}

function runCommand({
  editor,
  range,
  item,
  onChooseImage,
}: {
  editor: Editor;
  range: Range;
  item: SlashCommandItem;
  onChooseImage?: () => void;
}) {
  switch (item.action) {
    case "paragraph":
      deleteQuery(editor, range).setParagraph().run();
      return;
    case "heading1":
      deleteQuery(editor, range).setHeading({ level: 1 }).run();
      return;
    case "heading2":
      deleteQuery(editor, range).setHeading({ level: 2 }).run();
      return;
    case "heading3":
      deleteQuery(editor, range).setHeading({ level: 3 }).run();
      return;
    case "bulletList":
    case "orderedList":
    case "taskList":
      setList(editor, range, item.action);
      return;
    case "blockquote": {
      const chain = deleteQuery(editor, range);
      if (!editor.isActive("blockquote")) chain.setBlockquote();
      chain.run();
      return;
    }
    case "codeBlock":
      deleteQuery(editor, range).setCodeBlock().run();
      return;
    case "horizontalRule":
      deleteQuery(editor, range).setHorizontalRule().run();
      return;
    case "image":
      deleteQuery(editor, range).run();
      onChooseImage?.();
      return;
  }
}

function slashAllowed({
  editor,
  state,
  range,
  text,
}: {
  editor: Editor;
  state: Editor["state"];
  range: Range;
  text: string;
}) {
  if (!editor.isEditable) return false;

  const $from = state.doc.resolve(range.from);
  const parent = $from.parent;

  if (!parent.isTextblock || parent.type.spec.code) return false;

  const parentOffset = $from.parentOffset;
  const textBefore = parent.textBetween(0, parentOffset, "\n", "\n");
  const textAfter = parent.textBetween(
    Math.min(parentOffset + text.length, parent.content.size),
    parent.content.size,
    "\n",
    "\n",
  );

  if (parentOffset === 0) {
    return textAfter.trim().length === 0;
  }

  return /\s$/.test(textBefore);
}

export const SlashCommand = Extension.create<SlashCommandOptions>({
  name: "slashCommand",

  addOptions() {
    return {
      mediaEnabled: true,
      onChooseImage: undefined,
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashCommandItem>({
        editor: this.editor,
        pluginKey: slashCommandPluginKey,
        char: "/",
        allowedPrefixes: null,
        allowSpaces: false,
        decorationClass: "slash-command-decoration",
        allow: ({ state, range, text }) =>
          slashAllowed({ editor: this.editor, state, range, text }),
        items: ({ query }) => filteredItems(query, this.options.mediaEnabled),
        command: ({ editor, range, props }) => {
          runCommand({
            editor,
            range,
            item: props,
            onChooseImage: this.options.onChooseImage,
          });
        },
        render: () => {
          let element: HTMLDivElement | null = null;
          let root: Root | null = null;
          const menuRef = createRef<SlashMenuHandle>();

          const destroyMenu = () => {
            root?.unmount();
            element?.remove();
            root = null;
            element = null;
          };

          const renderMenu = (props: SuggestionProps<SlashCommandItem>) => {
            if (!element) {
              element = document.createElement("div");
              element.className = "applecms slash-command-host";
              document.body.appendChild(element);
              root = createRoot(element);
            }

            root?.render(
              createElement(SlashMenu, {
                ...props,
                ref: menuRef,
                onClose: () => {
                  exitSuggestion(props.editor.view, slashCommandPluginKey);
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
