"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { deleteEditablePostAction, saveEditablePostAction } from "@/app/editor/actions";
import type { Blog, Post } from "@/lib/content";
import { ProjectReader } from "@/components/ProjectReader";
import { Reader } from "@/components/Reader";
import { TalkReader } from "@/components/TalkReader";

type DraftState = {
  title: string;
  kicker: string;
  body: string;
  status: Post["status"];
  slug: string;
  accent: string;
};

type SaveState = "saved" | "saving" | "error";

function initialDraft(post: Post): DraftState {
  return {
    title: post.title,
    kicker: post.kicker ?? "",
    body: post.body,
    status: post.status,
    slug: post.slug,
    accent: post.accent ?? "",
  };
}

function isHexColor(value: string | undefined): value is string {
  return Boolean(value && /^#[0-9a-fA-F]{6}$/.test(value));
}

function slugify(value: string, fallback: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return slug || fallback;
}

function isPlaceholderSlug(slug: string): boolean {
  return slug.startsWith("untitled-");
}

function uniqueSlug(base: string, usedSlugs: readonly string[]): string {
  const used = new Set(usedSlugs);
  if (!used.has(base)) return base;

  for (let index = 2; index < 100; index += 1) {
    const suffix = `-${index}`;
    const root = base.slice(0, 80 - suffix.length).replace(/-+$/g, "");
    const candidate = `${root || "post"}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }

  const suffix = `-${Date.now().toString(36)}`;
  const root = base.slice(0, 80 - suffix.length).replace(/-+$/g, "");
  return `${root || "post"}${suffix}`;
}

function autoGrow(node: HTMLTextAreaElement | null) {
  if (!node) return;
  node.style.height = "0px";
  node.style.height = `${node.scrollHeight}px`;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function postPath(handle: string, slug: string): string {
  return `/t/${encodeURIComponent(handle)}/${encodeURIComponent(slug)}`;
}

function payloadFor(id: string, draft: DraftState, fallbackSlug: string) {
  return {
    id,
    title: draft.title,
    kicker: draft.kicker,
    body: draft.body,
    status: draft.status,
    slug: slugify(draft.slug, fallbackSlug),
    accent: draft.accent || null,
  };
}

function payloadKey(payload: ReturnType<typeof payloadFor>): string {
  return JSON.stringify(payload);
}

export function PostEditLayer({
  blog,
  post,
  usedSlugs = [],
}: {
  blog: Blog;
  post: Post;
  usedSlugs?: string[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(() => initialDraft(post));
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const skipSaveRef = useRef(true);
  const currentSlugRef = useRef(post.slug);
  const autoSlugAllowedRef = useRef(isPlaceholderSlug(post.slug));
  const latestKeyRef = useRef("");
  const lastSavedKeyRef = useRef("");
  const saveTimerRef = useRef<number | null>(null);
  const postId = post.id;

  useEffect(() => {
    setDraft(initialDraft(post));
    setSaveState("saved");
    setError(null);
    setMenuOpen(false);
    currentSlugRef.current = post.slug;
    autoSlugAllowedRef.current = isPlaceholderSlug(post.slug);
    skipSaveRef.current = true;
  }, [post.id]);

  useEffect(() => {
    autoGrow(titleRef.current);
  }, [draft.title, post.type]);

  useEffect(() => {
    autoGrow(bodyRef.current);
  }, [draft.body, post.type]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!postId) {
      setSaveState("error");
      setError("Post cannot be edited");
      return;
    }

    const payload = payloadFor(postId, draft, currentSlugRef.current);
    const key = payloadKey(payload);
    latestKeyRef.current = key;

    if (skipSaveRef.current) {
      skipSaveRef.current = false;
      lastSavedKeyRef.current = key;
      return;
    }

    if (key === lastSavedKeyRef.current) {
      setSaveState("saved");
      return;
    }

    setSaveState("saving");
    setError(null);

    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      const sentKey = key;
      const sentSlug = payload.slug;

      startTransition(() => {
        void saveEditablePostAction(payload)
          .then((saved) => {
            if (latestKeyRef.current !== sentKey) return;
            lastSavedKeyRef.current = sentKey;
            setSaveState("saved");
            setError(null);

            if (saved.slug !== currentSlugRef.current) {
              currentSlugRef.current = saved.slug;
              window.history.replaceState(
                window.history.state,
                "",
                `${postPath(blog.handle, saved.slug)}?edit=1`,
              );
            }

            if (saved.slug !== sentSlug) {
              setDraft((current) => ({ ...current, slug: saved.slug }));
            }
          })
          .catch((saveError) => {
            if (latestKeyRef.current !== sentKey) return;
            setSaveState("error");
            setError(errorMessage(saveError, "Could not save"));
          });
      });
    }, 800);

    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [blog.handle, draft, postId, router]);

  const updateDraft = useCallback((patch: Partial<DraftState>) => {
    setDraft((current) => ({ ...current, ...patch }));
  }, []);

  const deriveSlugFromTitle = useCallback(
    (titleValue: string) => {
      if (!autoSlugAllowedRef.current) return;

      const title = titleValue.trim();
      if (!title || title.toLowerCase() === "untitled") return;

      setDraft((current) => {
        if (!autoSlugAllowedRef.current) return current;
        if (!isPlaceholderSlug(current.slug)) {
          autoSlugAllowedRef.current = false;
          return current;
        }

        const nextSlug = uniqueSlug(slugify(title, "post"), usedSlugs);
        autoSlugAllowedRef.current = false;
        return nextSlug === current.slug ? current : { ...current, slug: nextSlug };
      });
    },
    [usedSlugs],
  );

  useEffect(() => {
    deriveSlugFromTitle(post.title);
  }, [deriveSlugFromTitle, post.id, post.title]);

  const displayPost = useMemo<Post>(
    () => ({
      ...post,
      title: draft.title,
      kicker: draft.kicker || undefined,
      body: draft.body,
      status: draft.status,
      slug: draft.slug || post.slug,
      accent: draft.accent || undefined,
    }),
    [draft, post],
  );

  const titleClass =
    post.type === "project"
      ? "project-title edit-title-field"
      : post.type === "talk"
        ? "talk-detail-title edit-title-field"
        : "reader-title edit-title-field";

  const slots = {
    title: (
      <textarea
        ref={titleRef}
        id={post.type === "project" ? "project-title" : undefined}
        className={titleClass}
        aria-label="Title"
        placeholder="Untitled"
        rows={1}
        value={draft.title}
        onChange={(event) => updateDraft({ title: event.currentTarget.value })}
        onBlur={(event) => deriveSlugFromTitle(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            deriveSlugFromTitle(event.currentTarget.value);
            bodyRef.current?.focus();
          }
        }}
      />
    ),
    body: (
      <textarea
        ref={bodyRef}
        className="edit-body-field"
        aria-label="Body"
        placeholder="Start writing"
        value={draft.body}
        onChange={(event) => updateDraft({ body: event.currentTarget.value })}
      />
    ),
  };

  const colorValue = isHexColor(draft.accent)
    ? draft.accent
    : isHexColor(blog.accent)
      ? blog.accent
      : "#0066cc";

  const saveText =
    saveState === "saving" ? "Saving" : saveState === "error" ? error : "Saved";

  const deletePost = useCallback(() => {
    if (!postId || deleting) return;
    if (!window.confirm("Delete this post?")) return;
    setDeleting(true);
    setSaveState("saving");
    setError(null);
    startTransition(() => {
      void deleteEditablePostAction(postId)
        .then(({ handle }) => {
          router.push(`/t/${encodeURIComponent(handle)}`);
        })
        .catch((deleteError) => {
          setDeleting(false);
          setSaveState("error");
          setError(errorMessage(deleteError, "Could not delete"));
        });
    });
  }, [deleting, postId, router]);

  return (
    <>
      <div className="post-edit-toolbar" aria-label="Post editor">
        <span
          className={`post-edit-save-state is-${saveState}`}
          role="status"
          aria-live="polite"
        >
          {saveText}
        </span>
        <div className="post-visibility-toggle" aria-label="Visibility">
          <button
            type="button"
            className={draft.status === "published" ? "active" : ""}
            onClick={() => updateDraft({ status: "published" })}
          >
            Public
          </button>
          <button
            type="button"
            className={draft.status === "draft" ? "active" : ""}
            onClick={() => updateDraft({ status: "draft" })}
          >
            Unlisted
          </button>
        </div>
        <div className="post-edit-menu-wrap">
          <button
            type="button"
            className="post-edit-menu-button"
            aria-label="Post settings"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            ...
          </button>
          {menuOpen && (
            <div className="post-edit-menu">
              <label className="post-edit-menu-field">
                <span>Kicker</span>
                <input
                  className="post-edit-kicker-menu"
                  value={draft.kicker}
                  placeholder="Optional kicker"
                  onChange={(event) =>
                    updateDraft({ kicker: event.currentTarget.value })
                  }
                />
              </label>
              <label className="post-edit-menu-field">
                <span>Accent color</span>
                <span className="post-edit-color-row">
                  <input
                    className="post-edit-color"
                    type="color"
                    aria-label="Accent color"
                    value={colorValue}
                    onChange={(event) =>
                      updateDraft({ accent: event.currentTarget.value })
                    }
                  />
                  <button
                    className="post-edit-inherit"
                    type="button"
                    onClick={() => updateDraft({ accent: "" })}
                  >
                    Inherit
                  </button>
                </span>
              </label>
              <label className="post-edit-menu-field">
                <span>Slug</span>
                <input
                  className="post-edit-slug"
                  value={draft.slug}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(event) => {
                    autoSlugAllowedRef.current = false;
                    updateDraft({ slug: slugify(event.currentTarget.value, "") });
                  }}
                  onBlur={() => {
                    autoSlugAllowedRef.current = false;
                    updateDraft({
                      slug: slugify(draft.slug, currentSlugRef.current),
                    });
                  }}
                />
              </label>
              <button
                className="post-edit-delete"
                type="button"
                disabled={!postId || deleting}
                onClick={deletePost}
              >
                {deleting ? "Deleting" : "Delete post"}
              </button>
            </div>
          )}
        </div>
      </div>

      {post.type === "talk" ? (
        <TalkReader blog={blog} post={displayPost} slots={slots} />
      ) : post.type === "project" ? (
        <ProjectReader blog={blog} post={displayPost} slots={slots} />
      ) : (
        <Reader blog={blog} post={displayPost} slots={slots} />
      )}
    </>
  );
}
