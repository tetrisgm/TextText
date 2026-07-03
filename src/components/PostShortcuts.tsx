"use client";

import { startTransition, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createArticleDraftPathAction } from "@/app/editor/actions";

const CLOSE_EDIT_MENU_EVENT = "post-edit-menu-close";

function isTypingTarget(target: EventTarget | null): boolean {
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

function hasOpenEditMenu(): boolean {
  return Boolean(document.querySelector('[data-post-edit-menu-open="true"]'));
}

function newDraftTarget(path: string): string {
  return `${path}?edit=1`;
}

function useCreateArticleShortcut(owner: boolean) {
  const router = useRouter();
  const creatingRef = useRef(false);

  return useCallback(() => {
    if (!owner || creatingRef.current) return;
    creatingRef.current = true;
    startTransition(() => {
      void createArticleDraftPathAction()
        .then((path) => {
          router.push(newDraftTarget(path));
        })
        .catch(() => {
          creatingRef.current = false;
        })
        .finally(() => {
          creatingRef.current = false;
        });
    });
  }, [owner, router]);
}

export function PostShortcuts({
  homePath,
  previousPath,
  nextPath,
  owner,
}: {
  homePath: string;
  previousPath?: string;
  nextPath?: string;
  owner: boolean;
}) {
  const router = useRouter();
  const createArticle = useCreateArticleShortcut(owner);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && hasOpenEditMenu()) {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent(CLOSE_EDIT_MENU_EVENT));
        return;
      }

      if (isTypingTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "Escape") {
        event.preventDefault();
        router.push(homePath);
        return;
      }

      const key = event.key.toLowerCase();
      const targetPath =
        key === "j" || event.key === "ArrowRight"
          ? nextPath
          : key === "k" || event.key === "ArrowLeft"
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

export function BlogHomeShortcuts({ owner }: { owner: boolean }) {
  const createArticle = useCreateArticleShortcut(owner);

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
