import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from "react";
import { isSafeLinkHref } from "@/lib/content";
import type { WikiLinkRenderTargets } from "@/lib/wikilinks";
import { splitWikiLinkText } from "@/lib/wikilink-syntax";

type MarkdownNode = {
  type?: string;
  value?: string;
  url?: string;
  data?: { hProperties?: Record<string, unknown> };
  children?: MarkdownNode[];
};

export function remarkWikiLinks(targets: WikiLinkRenderTargets) {
  return function wikiLinkAttacher() {
    return function transformWikiLinks(tree: MarkdownNode) {
      const visit = (node: MarkdownNode) => {
        if (!node.children || node.type === "link") return;
        const children: MarkdownNode[] = [];
        for (const child of node.children) {
          if (child.type !== "text" || typeof child.value !== "string") {
            visit(child);
            children.push(child);
            continue;
          }
          for (const part of splitWikiLinkText(child.value)) {
            if (part.kind === "text") {
              if (part.value) children.push({ type: "text", value: part.value });
              continue;
            }
            const target = targets[part.target];
            if (!target || !isSafeLinkHref(target.href)) {
              children.push({ type: "text", value: part.label });
              continue;
            }
            children.push({
              type: "link",
              url: target.href,
              data: {
                hProperties: {
                  className: "wiki-link",
                  "data-wiki-link": part.target,
                },
              },
              children: [{ type: "text", value: part.label }],
            });
          }
        }
        node.children = children;
      };
      visit(tree);
    };
  };
}

export function WikiLinkAnchor({
  children,
  href,
  onNavigate,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  children?: ReactNode;
  onNavigate?: (href: string) => Promise<void> | void;
  "data-wiki-link"?: string;
}) {
  const wikiTarget = (props as { "data-wiki-link"?: string })[
    "data-wiki-link"
  ];
  const onClick =
    onNavigate && href && wikiTarget
      ? (event: MouseEvent<HTMLAnchorElement>) => {
          event.preventDefault();
          void onNavigate(href);
        }
      : undefined;
  return (
    <a {...props} href={href} onClick={onClick}>
      {children}
    </a>
  );
}
