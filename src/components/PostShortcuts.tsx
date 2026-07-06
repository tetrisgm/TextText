"use client";

import { startTransition, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createArticleDraftPathAction } from "@/app/editor/actions";

const CLOSE_EDIT_MENU_EVENT = "post-edit-menu-close";

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return true;
  }
  const element = target as HTMLElement;
  return element.isContentEditable;
}

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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

      if (event.key === "Escape") {
        if (hasOpenEditMenu()) {
          event.preventDefault();
          window.dispatchEvent(new CustomEvent(CLOSE_EDIT_MENU_EVENT));
          return;
        }

        event.preventDefault();
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        router.push(homePath);
        return;
      }

      if (isTypingTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const key = event.key.toLowerCase();
      const targetPath =
        key === "j"
          ? nextPath
          : key === "k"
            ? previousPath
            : undefined;

      if (targetPath) {
        event.preventDefault();
        router.push(targetPath);
        return;
      }

      if (key === "c" && owner) {
        event.preventDefault();
        createArticle();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [createArticle, homePath, nextPath, owner, previousPath, router]);

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

  useEffect(() => {
    if (!owner) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key.toLowerCase() !== "c") return;

      event.preventDefault();
      createArticle();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [createArticle, owner]);

  return null;
}

export { CLOSE_EDIT_MENU_EVENT };
