"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import type { RefObject } from "react";
import { useRouter } from "next/navigation";
import {
  claimBlog,
  createPostAndRedirectAction,
  updateBlogAction,
  updateBlogNameAction,
} from "@/app/editor/actions";
import type { BlogCardStyle, BlogHomeLayout, PostType } from "@/lib/content";

type ActionError = string | null;
type BlogSettingKey = "cardStyle" | "homeLayout";

const POST_TYPE_OPTIONS: Array<{ type: PostType; label: string }> = [
  { type: "article", label: "Article" },
  { type: "project", label: "Project" },
  { type: "talk", label: "Talk" },
];
const CARD_STYLE_OPTIONS: Array<{ value: BlogCardStyle; label: string }> = [
  { value: "cover", label: "Cover" },
  { value: "minimal", label: "Minimal" },
];
const HOME_LAYOUT_OPTIONS: Array<{ value: BlogHomeLayout; label: string }> = [
  { value: "cards", label: "Cards" },
  { value: "timeline", label: "Timeline" },
];

function signInUrl(handle: string): string {
  const callbackUrl = `/t/${encodeURIComponent(handle)}?claim=1`;
  return `/api/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`;
}

function cleanDraftName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function useDismissPopover<T extends HTMLElement>(
  open: boolean,
  ref: RefObject<T | null>,
  onClose: () => void,
) {
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const node = ref.current;
      if (!node || !(event.target instanceof Node)) return;
      if (!node.contains(event.target)) onClose();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };

    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [onClose, open, ref]);
}

export function CreatePostTypePicker({ handle }: { handle: string }) {
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const closePicker = useCallback(() => setOpen(false), []);
  useDismissPopover(open, pickerRef, closePicker);

  return (
    <div className="blog-create-picker" ref={pickerRef}>
      <button
        className="blog-create-button ac-btn ac-btn-filled"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        Create
      </button>
      {open && (
        <div
          className="blog-create-popover"
          data-post-edit-menu-open="true"
          role="menu"
          aria-label="Choose post type"
        >
          {POST_TYPE_OPTIONS.map((option) => (
            <form
              key={option.type}
              className="blog-create-option-form"
              action={createPostAndRedirectAction}
            >
              <input type="hidden" name="handle" value={handle} />
              <input type="hidden" name="type" value={option.type} />
              <button
                className="blog-create-option"
                type="submit"
                role="menuitem"
              >
                {option.label}
              </button>
            </form>
          ))}
        </div>
      )}
    </div>
  );
}

export function BlogDisplaySettings({
  handle,
  initialCardStyle,
  initialHomeLayout,
}: {
  handle: string;
  initialCardStyle: BlogCardStyle;
  initialHomeLayout: BlogHomeLayout;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [cardStyle, setCardStyle] = useState(initialCardStyle);
  const [homeLayout, setHomeLayout] = useState(initialHomeLayout);
  const [pending, setPending] = useState<BlogSettingKey | null>(null);
  const [error, setError] = useState<ActionError>(null);
  const [, startTransition] = useTransition();
  const settingsRef = useRef<HTMLDivElement>(null);
  const closeSettings = useCallback(() => setOpen(false), []);
  useDismissPopover(open, settingsRef, closeSettings);

  useEffect(() => {
    setCardStyle(initialCardStyle);
    setHomeLayout(initialHomeLayout);
    setError(null);
  }, [initialCardStyle, initialHomeLayout]);

  const commit = useCallback(
    (key: BlogSettingKey, value: BlogCardStyle | BlogHomeLayout) => {
      const previous = { cardStyle, homeLayout };
      const next =
        key === "cardStyle"
          ? { cardStyle: value as BlogCardStyle, homeLayout }
          : { cardStyle, homeLayout: value as BlogHomeLayout };

      if (
        next.cardStyle === previous.cardStyle &&
        next.homeLayout === previous.homeLayout
      ) {
        return;
      }

      setCardStyle(next.cardStyle);
      setHomeLayout(next.homeLayout);
      setError(null);
      setPending(key);

      startTransition(() => {
        void updateBlogAction(
          key === "cardStyle"
            ? { cardStyle: next.cardStyle }
            : { homeLayout: next.homeLayout },
          handle,
        )
          .then((saved) => {
            setCardStyle(saved.cardStyle);
            setHomeLayout(saved.homeLayout);
            router.refresh();
          })
          .catch(() => {
            setCardStyle(previous.cardStyle);
            setHomeLayout(previous.homeLayout);
            setError("Could not save");
          })
          .finally(() => {
            setPending((current) => (current === key ? null : current));
          });
      });
    },
    [cardStyle, handle, homeLayout, router],
  );

  return (
    <div className="blog-settings-picker" ref={settingsRef}>
      <button
        className="blog-settings-button ac-btn ac-btn-gray"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        Settings
      </button>
      {open && (
        <div
          className="blog-settings-popover"
          data-post-edit-menu-open="true"
          role="dialog"
          aria-label="Blog settings"
        >
          <div className="blog-settings-section">
            <span className="blog-settings-label">Card style</span>
            <div
              className="ac-segmented blog-settings-segmented"
              role="group"
              aria-label="Card style"
            >
              {CARD_STYLE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`ac-segmented-button${
                    cardStyle === option.value ? " ac-active" : ""
                  }`}
                  aria-pressed={cardStyle === option.value}
                  disabled={Boolean(pending)}
                  onClick={() => commit("cardStyle", option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="blog-settings-section">
            <span className="blog-settings-label">Home layout</span>
            <div
              className="ac-segmented blog-settings-segmented"
              role="group"
              aria-label="Home layout"
            >
              {HOME_LAYOUT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`ac-segmented-button${
                    homeLayout === option.value ? " ac-active" : ""
                  }`}
                  aria-pressed={homeLayout === option.value}
                  disabled={Boolean(pending)}
                  onClick={() => commit("homeLayout", option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <span className="ac-sr-only" role="status">
            {pending ? "Saving" : ""}
          </span>
          {error && (
            <span className="blog-home-control-error" role="alert">
              {error}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function BlogNameForm({
  handle,
  initialName,
}: {
  handle: string;
  initialName: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<ActionError>(null);
  const [saving, setSaving] = useState(false);
  const [, startTransition] = useTransition();
  const committedName = useRef(initialName);
  const requestId = useRef(0);
  const skipNextBlur = useRef(false);

  useEffect(() => {
    committedName.current = initialName;
    setName(initialName);
    setError(null);
  }, [initialName]);

  const commitName = useCallback(
    (value: string) => {
      const nextName = cleanDraftName(value);
      setName(nextName);
      setError(null);

      if (nextName === committedName.current) return;

      const currentRequestId = requestId.current + 1;
      requestId.current = currentRequestId;
      setSaving(true);
      startTransition(() => {
        void updateBlogNameAction(handle, nextName)
          .then((result) => {
            if (requestId.current !== currentRequestId) return;
            if (!result.ok) {
              setError(result.error);
              return;
            }

            const savedName = result.name;
            committedName.current = savedName;
            setName((currentName) =>
              cleanDraftName(currentName) === nextName ? savedName : currentName,
            );
            router.refresh();
          })
          .catch(() => {
            if (requestId.current === currentRequestId) {
              setError("Could not save");
            }
          })
          .finally(() => {
            if (requestId.current === currentRequestId) {
              setSaving(false);
            }
          });
      });
    },
    [handle, router],
  );

  return (
    <div
      className="blog-name-form"
      aria-busy={saving}
    >
      <input
        className="blog-name-input"
        value={name}
        placeholder="Name your blog"
        aria-label="Blog name"
        onBlur={(event) => {
          if (skipNextBlur.current) {
            skipNextBlur.current = false;
            return;
          }
          commitName(event.currentTarget.value);
        }}
        onChange={(event) => {
          setName(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
            return;
          }

          if (event.key === "Escape") {
            event.preventDefault();
            skipNextBlur.current = true;
            setName(committedName.current);
            setError(null);
            event.currentTarget.blur();
          }
        }}
      />
      {error && (
        <span className="blog-home-control-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export function ClaimBlogButton({
  handle,
  publicPath,
  signedIn,
  authConfigured,
  autoClaim = false,
}: {
  handle: string;
  publicPath: string;
  signedIn: boolean;
  authConfigured: boolean;
  autoClaim?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<ActionError>(null);
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [pending, startTransition] = useTransition();
  const autoStarted = useRef(false);
  const copiedTimer = useRef<number | null>(null);
  const disabled = claiming || pending;
  const publicUrl = origin ? `${origin}${publicPath}` : publicPath;

  const runClaim = useCallback(() => {
    setError(null);
    if (!signedIn) {
      if (!authConfigured) {
        setError("Sign-in is not configured.");
        return;
      }
      window.location.assign(signInUrl(handle));
      return;
    }

    setClaiming(true);
    startTransition(() => {
      void claimBlog(handle)
        .then((result) => {
          if (!result.ok) {
            if (result.signInRequired && authConfigured) {
              window.location.assign(signInUrl(handle));
              return;
            }
            setError(result.error);
            return;
          }
          router.replace(`/t/${encodeURIComponent(result.handle)}`);
          router.refresh();
        })
        .catch(() => setError("Could not claim"))
        .finally(() => setClaiming(false));
    });
  }, [authConfigured, handle, router, signedIn]);

  const copyPublicLink = useCallback(
    (input: HTMLInputElement) => {
      input.select();
      if (!navigator.clipboard) return;
      void navigator.clipboard
        .writeText(publicUrl)
        .then(() => {
          setCopied(true);
          if (copiedTimer.current !== null) {
            window.clearTimeout(copiedTimer.current);
          }
          copiedTimer.current = window.setTimeout(() => {
            setCopied(false);
            copiedTimer.current = null;
          }, 1400);
        })
        .catch(() => {});
    },
    [publicUrl],
  );

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (!autoClaim || !signedIn || autoStarted.current) return;
    autoStarted.current = true;
    runClaim();
  }, [autoClaim, runClaim, signedIn]);

  useEffect(() => {
    return () => {
      if (copiedTimer.current !== null) {
        window.clearTimeout(copiedTimer.current);
      }
    };
  }, []);

  return (
    <div className="blog-claim-row applecms">
      <label className="blog-public-link">
        <span className="blog-public-link-label">Link to this page:</span>
        <input
          className="blog-public-link-field"
          value={publicUrl}
          readOnly
          aria-label="Link to this page:"
          onClick={(event) => copyPublicLink(event.currentTarget)}
          onFocus={(event) => event.currentTarget.select()}
        />
      </label>
      <button
        className="blog-claim-button ac-btn ac-btn-gray"
        type="button"
        disabled={disabled}
        onClick={runClaim}
      >
        {disabled ? "Claiming" : "Claim to keep it forever"}
      </button>
      <span className="ac-sr-only" role="status">
        {copied ? "Copied" : ""}
      </span>
      {error && (
        <span className="blog-home-control-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
