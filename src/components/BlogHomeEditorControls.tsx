"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import type {
  CSSProperties,
  ReactNode,
  RefObject,
} from "react";
import { useRouter } from "next/navigation";
import {
  createDraftAction,
  updateBlogAction,
  updateBlogNameAction,
} from "@/app/editor/actions";
import { useEscapeLayer } from "@/components/keyboard/CommandLayer";
import { BlogHomeShortcuts } from "@/components/PostShortcuts";
import type { PostType } from "@/lib/content";

type ActionError = string | null;
type NamingFlightStyle = Pick<
  CSSProperties,
  "left" | "position" | "top" | "transform" | "width"
>;
type BlogHomeShellProps = {
  handle: string;
  blogName: string;
  initialName: string;
  tagline?: string;
  canEdit: boolean;
  publicPath: string;
  initialNamingCeremony: boolean;
  style?: CSSProperties;
  children: ReactNode;
};

const POST_TYPE_OPTIONS: Array<{ type: PostType; label: string }> = [
  { type: "article", label: "Article" },
  { type: "project", label: "Media post" },
  { type: "talk", label: "Video post" },
];
const NAME_FLIGHT_MS = 520;

function postEditPath(
  publicPath: string,
  post: { id?: string; slug: string },
): string {
  const params = new URLSearchParams({ edit: "1" });
  if (post.id) params.set("id", post.id);
  return `${publicPath}/${encodeURIComponent(post.slug)}?${params.toString()}`;
}

function cleanDraftName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function useDismissPopover<T extends HTMLElement>(
  open: boolean,
  ref: RefObject<T | null>,
  onClose: () => void,
) {
  useEscapeLayer(open, "Popover", onClose);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const node = ref.current;
      if (!node || !(event.target instanceof Node)) return;
      if (!node.contains(event.target)) onClose();
    };

    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [onClose, open, ref]);
}

function shouldReduceMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function BlogHomeShell({
  handle,
  blogName,
  initialName,
  tagline,
  canEdit,
  publicPath,
  initialNamingCeremony,
  style,
  children,
}: BlogHomeShellProps) {
  const namingKey = `${handle}:${initialNamingCeremony}:${initialName}:${blogName}`;
  const [namingState, setNamingState] = useState(() => ({
    key: namingKey,
    active: initialNamingCeremony,
    savedName: null as string | null,
  }));
  let namingCeremonyActive = namingState.active;
  let displayBlogName = namingState.savedName ?? (initialName || blogName);
  if (namingState.key !== namingKey) {
    const nextNamingState = {
      key: namingKey,
      active: initialNamingCeremony,
      savedName: null,
    };
    setNamingState(nextNamingState);
    namingCeremonyActive = nextNamingState.active;
    displayBlogName = initialName || blogName;
  }

  const showFolderActions = canEdit && !namingCeremonyActive;
  const shortcutsActive = canEdit && !namingCeremonyActive;
  const rootClassName = `blog-home${
    namingCeremonyActive ? " is-naming-ceremony" : ""
  }${showFolderActions ? " has-editor-actions" : ""}`;

  return (
    <main className={rootClassName} style={style}>
      {shortcutsActive && <BlogHomeShortcuts owner={canEdit} handle={handle} />}
      {showFolderActions && (
        <BlogFolderActionBar handle={handle} publicPath={publicPath} />
      )}
      <header className="blog-home-header">
        <div className="blog-home-heading">
          <div className="blog-home-copy">
            {canEdit && namingCeremonyActive ? (
              <BlogNameForm
                key={`${handle}:${initialName}`}
                handle={handle}
                initialName={initialName}
                ceremonyActive={namingCeremonyActive}
                onCeremonyComplete={(savedName) => {
                  setNamingState({
                    key: namingKey,
                    active: false,
                    savedName,
                  });
                }}
              />
            ) : (
              <h1 className="blog-home-name">{displayBlogName}</h1>
            )}
            {!namingCeremonyActive && (
              <div className="blog-home-meta">
                {tagline && <p className="blog-home-tagline">{tagline}</p>}
              </div>
            )}
          </div>
        </div>
      </header>
      {children}
    </main>
  );
}

function BlogFolderActionBar({
  handle,
  publicPath,
}: {
  handle: string;
  publicPath: string;
}) {
  return (
    <div className="blog-home-action-bar applecms" aria-label="Folder controls">
      <div className="blog-home-action-toolbar ac-chrome">
        <CreatePostTypePicker handle={handle} publicPath={publicPath} />
      </div>
    </div>
  );
}

export function CreatePostTypePicker({
  handle,
  publicPath,
}: {
  handle: string;
  publicPath: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<ActionError>(null);
  const [pendingType, setPendingType] = useState<PostType | null>(null);
  const [, startTransition] = useTransition();
  const pickerRef = useRef<HTMLDivElement>(null);
  const closePicker = useCallback(() => setOpen(false), []);
  useDismissPopover(open, pickerRef, closePicker);

  const createPost = useCallback(
    (type: PostType) => {
      setError(null);
      setPendingType(type);
      startTransition(() => {
        void createDraftAction(type, handle)
          .then((post) => {
            setOpen(false);
            router.push(postEditPath(publicPath, post));
          })
          .catch((createError) => {
            setError(
              createError instanceof Error
                ? createError.message
                : "Could not create post",
            );
          })
          .finally(() => setPendingType(null));
      });
    },
    [handle, publicPath, router],
  );

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
            <button
              key={option.type}
              className="blog-create-option"
              type="button"
              role="menuitem"
              disabled={pendingType !== null}
              onClick={() => createPost(option.type)}
            >
              {pendingType === option.type ? "Creating" : option.label}
            </button>
          ))}
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
  ceremonyActive = false,
  onCeremonyComplete,
}: {
  handle: string;
  initialName: string;
  ceremonyActive?: boolean;
  onCeremonyComplete?: (savedName: string) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<ActionError>(null);
  const [saving, setSaving] = useState(false);
  const [flying, setFlying] = useState(false);
  const [flightStyle, setFlightStyle] = useState<NamingFlightStyle>();
  const [, startTransition] = useTransition();
  const formRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const committedName = useRef(initialName);
  const savedNameRef = useRef(initialName);
  const requestId = useRef(0);
  const skipNextBlur = useRef(false);
  const flightComplete = useRef(false);
  const flightTimer = useRef<number | null>(null);
  const flightFrames = useRef<number[]>([]);

  useEffect(() => {
    if (!ceremonyActive || flying) return;
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [ceremonyActive, flying]);

  useEffect(() => {
    if (ceremonyActive) {
      flightComplete.current = false;
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      setFlying(false);
      setFlightStyle(undefined);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [ceremonyActive, handle]);

  useEffect(() => {
    return () => {
      if (flightTimer.current !== null) {
        window.clearTimeout(flightTimer.current);
      }
      for (const frame of flightFrames.current) {
        window.cancelAnimationFrame(frame);
      }
      flightFrames.current = [];
    };
  }, []);

  const finishCeremony = useCallback(() => {
    if (flightComplete.current) return;
    flightComplete.current = true;

    if (flightTimer.current !== null) {
      window.clearTimeout(flightTimer.current);
      flightTimer.current = null;
    }

    setFlying(false);
    setFlightStyle(undefined);
    onCeremonyComplete?.(savedNameRef.current);
  }, [onCeremonyComplete]);

  const startCeremonyFlight = useCallback(() => {
    if (!ceremonyActive) {
      router.refresh();
      return;
    }

    const form = formRef.current;
    const target = targetRef.current;
    if (!form || !target || shouldReduceMotion()) {
      finishCeremony();
      return;
    }

    const startRect = form.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    setFlying(true);
    setFlightStyle({
      position: "fixed",
      top: startRect.top,
      left: startRect.left,
      width: startRect.width,
      transform: "none",
    });

    const firstFrame = window.requestAnimationFrame(() => {
      const secondFrame = window.requestAnimationFrame(() => {
        setFlightStyle({
          position: "fixed",
          top: targetRect.top,
          left: targetRect.left,
          width: targetRect.width,
          transform: "none",
        });
      });
      flightFrames.current.push(secondFrame);
    });
    flightFrames.current.push(firstFrame);

    flightTimer.current = window.setTimeout(
      finishCeremony,
      NAME_FLIGHT_MS + 120,
    );
  }, [ceremonyActive, finishCeremony, router]);

  const commitName = useCallback(
    (value: string) => {
      if (saving || flying) return;

      const nextName = cleanDraftName(value);
      setName(nextName);
      setError(null);

      if (ceremonyActive && !nextName) {
        return;
      }

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
            savedNameRef.current = savedName;
            setName((currentName) =>
              cleanDraftName(currentName) === nextName ? savedName : currentName,
            );
            if (ceremonyActive) {
              startCeremonyFlight();
            } else {
              router.refresh();
            }
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
    [
      ceremonyActive,
      flying,
      handle,
      router,
      saving,
      startCeremonyFlight,
    ],
  );

  const cleanedName = cleanDraftName(name);
  const canConfirm = Boolean(cleanedName) && !saving && !flying;
  const formClassName = `blog-name-form${
    ceremonyActive ? " is-ceremony" : ""
  }${flying ? " is-flying" : ""}`;

  return (
    <>
      {ceremonyActive && (
        <div
          className="blog-name-form blog-name-target"
          ref={targetRef}
          aria-hidden="true"
        >
          <div className="blog-name-input blog-name-target-input">
            {cleanedName || "Name your page"}
          </div>
        </div>
      )}
      <div
        className={formClassName}
        ref={formRef}
        style={flightStyle}
        aria-busy={saving}
        onTransitionEnd={(event) => {
          if (
            !flying ||
            event.target !== formRef.current ||
            event.propertyName !== "top"
          ) {
            return;
          }
          finishCeremony();
        }}
      >
        <div className="blog-name-field-row">
          <input
            ref={inputRef}
            className="blog-name-input"
            value={name}
            placeholder="Name your page"
            aria-label="Page name"
            aria-describedby={
              ceremonyActive ? "blog-name-ceremony-note" : undefined
            }
            autoFocus={ceremonyActive}
            disabled={flying}
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
                commitName(event.currentTarget.value);
                return;
              }

              if (event.key === "Escape") {
                event.preventDefault();
                skipNextBlur.current = true;
                setName(committedName.current);
                setError(null);
                if (!ceremonyActive) {
                  event.currentTarget.blur();
                }
              }
            }}
          />
          {ceremonyActive && (
            <button
              className="blog-name-confirm ac-btn ac-btn-filled"
              type="button"
              disabled={!canConfirm}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => commitName(name)}
            >
              {saving ? "Confirming" : "Confirm"}
            </button>
          )}
        </div>
        {ceremonyActive && (
          <p className="blog-name-ceremony-note" id="blog-name-ceremony-note">
            You can change it later
          </p>
        )}
        {error && (
          <span className="blog-home-control-error" role="alert">
            {error}
          </span>
        )}
      </div>
    </>
  );
}
