"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { SignOutButton } from "@/components/SignOutButton";
import styles from "./WorkspaceMenu.module.css";

export type WorkspaceMenuProps = {
  blogName: string;
  email: string | null;
  settingsHref: string;
  onInvite?: () => void;
};

export function WorkspaceMenu({
  blogName,
  email,
  settingsHref,
  onInvite,
}: WorkspaceMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!rootRef.current?.contains(target)) close();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
    };

    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
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

          <Link
            className={styles.menuItem}
            href={settingsHref}
            role="menuitem"
            onClick={close}
          >
            Settings
          </Link>

          <button
            className={styles.menuItem}
            type="button"
            role="menuitem"
            disabled={!onInvite}
            onClick={() => {
              if (!onInvite) return;
              onInvite();
              close();
            }}
          >
            Invite members
          </button>

          <div className={styles.divider} role="separator" />

          <SignOutButton
            className={styles.signOutButton}
            role="menuitem"
            aria-label="Log out"
          />
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
