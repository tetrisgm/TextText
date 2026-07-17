"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import Link from "next/link";
import { SignOutButton } from "@/components/SignOutButton";
import { useEscapeLayer } from "@/components/keyboard/CommandLayer";
import { OPEN_KEYBOARD_SHORTCUTS_EVENT } from "@/components/keyboard/CommandPalette";
import styles from "./WorkspaceMenu.module.css";

export type WorkspaceMenuProps = {
  blogName: string;
  email: string | null;
  inNativeApp?: boolean;
  onInvite?: () => void;
  onSettings?: () => void;
  signedIn?: boolean;
};

export function WorkspaceMenu({
  blogName,
  email,
  inNativeApp = false,
  onInvite,
  onSettings,
  signedIn = false,
}: WorkspaceMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);
  const closeAndFocus = useCallback(() => {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);
  useEscapeLayer(open, "Workspace menu", closeAndFocus);

  const focusMenuEdge = useCallback((edge: "first" | "last") => {
    window.requestAnimationFrame(() => {
      const items = Array.from(
        menuRef.current?.querySelectorAll<HTMLElement>(
          '[role="menuitem"]:not([disabled])',
        ) ?? [],
      );
      items[edge === "first" ? 0 : items.length - 1]?.focus();
    });
  }, []);

  const moveMenuFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      return;
    }
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        '[role="menuitem"]:not([disabled])',
      ),
    );
    if (items.length === 0) return;
    event.preventDefault();
    const currentIndex = items.findIndex(
      (item) => item === document.activeElement,
    );
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowDown"
            ? (currentIndex + 1 + items.length) % items.length
            : (currentIndex - 1 + items.length) % items.length;
    items[nextIndex]?.focus();
  };

  useEffect(() => {
    if (!open) return;

    document.documentElement.classList.add("workspace-menu-open");

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!rootRef.current?.contains(target)) close();
    };

    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.documentElement.classList.remove("workspace-menu-open");
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [close, open]);

  return (
    <div className={`applecms ${styles.root}`} ref={rootRef}>
      <button
        ref={triggerRef}
        className={styles.trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          setOpen(true);
          focusMenuEdge(event.key === "ArrowDown" ? "first" : "last");
        }}
      >
        <span className={styles.workspaceName}>{blogName}</span>
        <span className={styles.chevron} aria-hidden="true">
          <ChevronIcon />
        </span>
      </button>

      {open && (
        <div
          ref={menuRef}
          className={styles.menu}
          role="menu"
          aria-label="Workspace menu"
          onKeyDown={moveMenuFocus}
        >
          <div className={styles.menuHeader} role="presentation">
            <div className={styles.headerName}>{blogName}</div>
            {email && <div className={styles.headerEmail}>{email}</div>}
          </div>

          {onSettings && (
            <button
              className={styles.menuItem}
              type="button"
              role="menuitem"
              onClick={() => {
                onSettings();
                close();
              }}
            >
              Settings
            </button>
          )}

          {onInvite ? (
            <button
              className={styles.menuItem}
              type="button"
              role="menuitem"
              onClick={() => {
                onInvite();
                close();
              }}
            >
              Invite members
            </button>
          ) : signedIn ? (
            <button
              className={styles.menuItem}
              type="button"
              role="menuitem"
              disabled
            >
              Invite members
            </button>
          ) : null}

          <button
            className={styles.menuItem}
            type="button"
            role="menuitem"
            onClick={() => {
              window.dispatchEvent(new Event(OPEN_KEYBOARD_SHORTCUTS_EVENT));
              close();
            }}
          >
            Keyboard shortcuts
          </button>

          {!inNativeApp && (
            <Link
              className={styles.menuItem}
              href="/download"
              role="menuitem"
              onClick={close}
            >
              Download the Mac app
            </Link>
          )}

          <div className={styles.divider} role="separator" />

          {signedIn && (
            <SignOutButton
              className={styles.signOutButton}
              role="menuitem"
              aria-label="Log out"
            />
          )}
        </div>
      )}
    </div>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M4.5 6.25 8 9.75l3.5-3.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}

export default WorkspaceMenu;
