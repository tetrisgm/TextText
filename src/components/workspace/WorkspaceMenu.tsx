"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { SignOutButton } from "@/components/SignOutButton";
import { useEscapeLayer } from "@/components/keyboard/CommandLayer";
import { OPEN_KEYBOARD_SHORTCUTS_EVENT } from "@/components/keyboard/CommandPalette";
import styles from "./WorkspaceMenu.module.css";

export type WorkspaceMenuProps = {
  blogName: string;
  email: string | null;
  inNativeApp?: boolean;
  onHome?: () => void;
  onInvite?: () => void;
  onSettings?: () => void;
  signedIn?: boolean;
};

export function WorkspaceMenu({
  blogName,
  email,
  inNativeApp = false,
  onHome,
  onInvite,
  onSettings,
  signedIn = false,
}: WorkspaceMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);
  useEscapeLayer(open, "Workspace menu", close);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!rootRef.current?.contains(target)) close();
    };

    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [close, open]);

  return (
    <div className={`applecms ${styles.root}`} ref={rootRef}>
      <button
        className={styles.trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={styles.workspaceName}>{blogName}</span>
        <span className={styles.chevron} aria-hidden="true">
          <ChevronIcon />
        </span>
      </button>

      {open && (
        <div className={styles.menu} role="menu" aria-label="Workspace menu">
          <div className={styles.menuHeader} role="presentation">
            <div className={styles.headerName}>{blogName}</div>
            {email && <div className={styles.headerEmail}>{email}</div>}
          </div>

          <div className={styles.primaryActions} role="presentation">
            {onSettings && (
              <button
                className={styles.primaryAction}
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
            {onInvite && (
              <button
                className={styles.primaryAction}
                type="button"
                role="menuitem"
                onClick={() => {
                  onInvite();
                  close();
                }}
              >
                Invite members
              </button>
            )}
          </div>

          {onHome && (
            <button
              className={styles.menuItem}
              type="button"
              role="menuitem"
              onClick={() => {
                onHome();
                close();
              }}
            >
              Workspace home
            </button>
          )}

          {signedIn && !onInvite && (
            <button
              className={styles.menuItem}
              type="button"
              role="menuitem"
              disabled
            >
              Invite members
            </button>
          )}

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

          <Link
            className={styles.menuItem}
            href="/connect"
            role="menuitem"
            onClick={close}
          >
            Connect an agent
          </Link>

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
