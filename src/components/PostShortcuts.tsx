"use client";

import { startTransition, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { createArticleDraftPathAction } from "@/app/editor/actions";
import { useKey } from "@/components/keyboard/CommandLayer";
import { isTypingTarget } from "@/components/keyboard/typing-target";

const CLOSE_EDIT_MENU_EVENT = "post-edit-menu-close";

export function hasOpenEditMenu(): boolean {
  return Boolean(document.querySelector('[data-post-edit-menu-open="true"]'));
}

function useCreateArticleShortcut(owner: boolean, handle?: string) {
  const router = useRouter();
  const creatingRef = useRef(false);

  return useCallback(() => {
    if (!owner || creatingRef.current) return;
    creatingRef.current = true;
    startTransition(() => {
      void createArticleDraftPathAction(handle)
        .then((path) => {
          router.push(path);
        })
        .catch(() => {
          creatingRef.current = false;
        })
        .finally(() => {
          creatingRef.current = false;
        });
    });
  }, [handle, owner, router]);
}

export function PostShortcuts({
  homePath,
  previousPath,
  nextPath,
  owner,
  handle,
}: {
  homePath: string;
  previousPath?: string;
  nextPath?: string;
  owner: boolean;
  handle?: string;
}) {
  const router = useRouter();
  const createArticle = useCreateArticleShortcut(owner, handle);

  useKey({
    key: "Escape",
    label: "Go up",
    group: "Navigate",
    run: () => {
      if (hasOpenEditMenu()) {
        window.dispatchEvent(new CustomEvent(CLOSE_EDIT_MENU_EVENT));
        return;
      }
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      router.push(homePath);
    },
  });

  useKey({
    key: "j",
    label: "Next post",
    group: "Navigate",
    when: () => Boolean(nextPath),
    run: () => {
      if (nextPath) router.push(nextPath);
    },
  });

  useKey({
    key: "k",
    label: "Previous post",
    group: "Navigate",
    when: () => Boolean(previousPath),
    run: () => {
      if (previousPath) router.push(previousPath);
    },
  });

  useKey({
    key: "c",
    label: "New article",
    group: "Create",
    when: () => owner,
    run: createArticle,
  });

  return null;
}

export function BlogHomeShortcuts({
  owner,
  handle,
}: {
  owner: boolean;
  handle?: string;
}) {
  const createArticle = useCreateArticleShortcut(owner, handle);
  useKey({
    key: "c",
    label: "New article",
    group: "Create",
    when: () => owner,
    run: createArticle,
  });

  return null;
}

export { CLOSE_EDIT_MENU_EVENT };
export { isTypingTarget };
