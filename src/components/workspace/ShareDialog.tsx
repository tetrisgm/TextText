"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { FormEvent, MouseEvent as ReactMouseEvent } from "react";
import {
  listScopeSharesAction,
  revokeScopeShareAction,
  shareScopeAction,
  updateScopeShareRoleAction,
} from "@/app/editor/actions";
import { useEscapeLayer } from "@/components/keyboard/CommandLayer";
import type { ScopeShare, ScopeShareRole } from "@/lib/shares";
import type { CollaboratorScopeType } from "@/lib/permissions";
import styles from "./ShareDialog.module.css";

type ShareDialogProps = {
  handle: string;
  postId?: string;
  postTitle?: string;
  scopeType?: CollaboratorScopeType;
  scopeId?: string;
  title?: string;
  subtitle?: string;
  open: boolean;
  onClose: () => void;
};

function classNames(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function defaultRole(scopeType: CollaboratorScopeType): ScopeShareRole {
  return scopeType === "workspace" ? "guest" : "viewer";
}

function roleLabel(role: ScopeShareRole): string {
  if (role === "editor") return "Can edit";
  if (role === "viewer") return "Can view";
  if (role === "member") return "Member";
  return "Guest";
}

function roleOptions(scopeType: CollaboratorScopeType) {
  return scopeType === "workspace"
    ? (["member", "guest"] as const)
    : (["editor", "viewer"] as const);
}

function scopeCopy(scopeType: CollaboratorScopeType): string {
  if (scopeType === "workspace") return "Workspace access";
  if (scopeType === "folder") return "Folder access";
  return "Page access";
}

function shareUrlFromLocation(): string {
  if (typeof window === "undefined") return "";
  const url = new URL(window.location.href);
  url.searchParams.delete("edit");
  url.searchParams.delete("id");
  url.search = url.searchParams.toString();
  return url.toString();
}

export function ShareDialog({
  handle,
  postId,
  postTitle,
  scopeType = "item",
  scopeId,
  title = "Share",
  subtitle,
  open,
  onClose,
}: ShareDialogProps) {
  const resolvedScopeId = scopeId ?? postId ?? "";
  const resolvedSubtitle = subtitle ?? postTitle ?? scopeCopy(scopeType);
  const titleId = useId();
  const emailId = useId();
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [shares, setShares] = useState<ScopeShare[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ScopeShareRole>(() => defaultRole(scopeType));
  const [loading, setLoading] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    if (!resolvedScopeId) return;

    let active = true;
    async function loadShares() {
      // The dialog can mount during hydration. Start the state transition in
      // the next microtask so opening it does not cascade another render from
      // inside the effect itself.
      await Promise.resolve();
      if (!active) return;
      setLoading(true);
      setError(null);
      setConfirmingId(null);
      setRole(defaultRole(scopeType));

      try {
        const nextShares = await listScopeSharesAction(
          handle,
          scopeType,
          resolvedScopeId,
        );
        if (active) setShares(nextShares);
      } catch (loadError) {
        if (active) {
          setError(errorMessage(loadError, "Could not load sharing."));
          setShares([]);
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadShares();

    return () => {
      active = false;
    };
  }, [handle, open, resolvedScopeId, scopeType]);

  useEscapeLayer(open, "Share dialog", onClose);

  const closeFromBackdrop = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) onClose();
    },
    [onClose],
  );

  const invite = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (inviting) return;

      const nextEmail = email.trim().toLowerCase();
      if (!nextEmail) return;

      const previousShares = shares;
      const optimisticShare: ScopeShare = {
        id: `optimistic-${nextEmail}`,
        email: nextEmail,
        role,
        accepted: false,
        createdAt: new Date().toISOString(),
      };

      setInviting(true);
      setError(null);
      setConfirmingId(null);
      setShares((current) => {
        const existingIndex = current.findIndex(
          (share) => share.email.toLowerCase() === nextEmail,
        );
        if (existingIndex === -1) return [...current, optimisticShare];

        return current.map((share, index) =>
          index === existingIndex ? { ...share, role } : share,
        );
      });

      try {
        const nextShares = await shareScopeAction(
          handle,
          scopeType,
          resolvedScopeId,
          nextEmail,
          role,
        );
        setShares(nextShares);
        setEmail("");
      } catch (inviteError) {
        setShares(previousShares);
        setError(errorMessage(inviteError, "Could not send invite."));
      } finally {
        setInviting(false);
      }
    },
    [email, handle, inviting, resolvedScopeId, role, scopeType, shares],
  );

  const revoke = useCallback(
    async (share: ScopeShare) => {
      if (revokingId || share.id.startsWith("optimistic-")) return;

      const previousShares = shares;
      setRevokingId(share.id);
      setError(null);
      setShares((current) => current.filter((item) => item.id !== share.id));

      try {
        const nextShares = await revokeScopeShareAction(
          handle,
          scopeType,
          resolvedScopeId,
          share.id,
        );
        setShares(nextShares);
        setConfirmingId(null);
      } catch (revokeError) {
        setShares(previousShares);
        setError(errorMessage(revokeError, "Could not revoke access."));
      } finally {
        setRevokingId(null);
      }
    },
    [handle, resolvedScopeId, revokingId, scopeType, shares],
  );

  const updateRole = useCallback(
    async (share: ScopeShare, nextRole: ScopeShareRole) => {
      if (updatingId || share.id.startsWith("optimistic-")) return;
      const previousShares = shares;
      setUpdatingId(share.id);
      setError(null);
      setShares((current) =>
        current.map((item) =>
          item.id === share.id ? { ...item, role: nextRole } : item,
        ),
      );
      try {
        const nextShares = await updateScopeShareRoleAction(
          handle,
          scopeType,
          resolvedScopeId,
          share.id,
          nextRole,
        );
        setShares(nextShares);
      } catch (roleError) {
        setShares(previousShares);
        setError(errorMessage(roleError, "Could not change role."));
      } finally {
        setUpdatingId(null);
      }
    },
    [handle, resolvedScopeId, scopeType, shares, updatingId],
  );

  const copyLink = useCallback(async () => {
    setError(null);
    try {
      const shareUrl = shareUrlFromLocation();
      if (!navigator.clipboard || !shareUrl) {
        throw new Error("Clipboard is unavailable.");
      }
      await navigator.clipboard.writeText(shareUrl);
      setCopyState("copied");
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopyState("idle"), 1400);
    } catch (copyError) {
      setCopyState("idle");
      setError(errorMessage(copyError, "Could not copy link."));
    }
  }, []);

  if (!open || !resolvedScopeId) return null;

  const trimmedEmail = email.trim();
  const options = roleOptions(scopeType);

  return (
    <div className={`applecms ${styles.backdrop}`} onMouseDown={closeFromBackdrop}>
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={styles.header}>
          <div className={styles.titleGroup}>
            <h2 className={styles.title} id={titleId}>
              {title}
            </h2>
            <p className={styles.subtitle}>{resolvedSubtitle}</p>
          </div>
          <button
            className={styles.iconButton}
            type="button"
            aria-label="Close sharing"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>

        <form className={styles.inviteForm} onSubmit={invite}>
          <label className={styles.emailLabel} htmlFor={emailId}>
            Email
          </label>
          <input
            className={styles.emailInput}
            id={emailId}
            type="email"
            value={email}
            placeholder="name@example.com"
            autoComplete="email"
            disabled={inviting}
            onChange={(event) => setEmail(event.currentTarget.value)}
          />
          <select
            className={styles.roleSelect}
            value={role}
            disabled={inviting}
            aria-label="Invite role"
            onChange={(event) =>
              setRole(event.currentTarget.value as ScopeShareRole)
            }
          >
            {options.map((option) => (
              <option key={option} value={option}>
                {roleLabel(option)}
              </option>
            ))}
          </select>
          <button
            className={classNames(styles.button, styles.primaryButton)}
            type="submit"
            disabled={!trimmedEmail || inviting}
          >
            {inviting ? "Inviting" : "Invite"}
          </button>
        </form>

        {error && (
          <p className={styles.error} role="status">
            {error}
          </p>
        )}

        <div className={styles.peopleSection}>
          <div className={styles.sectionLabel}>People</div>
          {loading ? (
            <div className={styles.emptyState}>Loading people</div>
          ) : shares.length === 0 ? (
            <div className={styles.emptyState}>No one invited</div>
          ) : (
            <ul className={styles.shareList}>
              {shares.map((share) => {
                const confirming = confirmingId === share.id;
                const pending = share.id.startsWith("optimistic-");
                return (
                  <li
                    className={styles.shareRow}
                    data-pending={pending ? "true" : undefined}
                    key={share.id}
                  >
                    <div className={styles.personAvatar} aria-hidden="true">
                      {share.email.slice(0, 1).toUpperCase()}
                    </div>
                    <div className={styles.personMain}>
                      <div className={styles.personEmail}>{share.email}</div>
                      <div className={styles.personState}>
                        {share.accepted ? "accepted" : "invited"}
                      </div>
                    </div>
                    <select
                      className={styles.personRoleSelect}
                      value={share.role}
                      disabled={
                        pending ||
                        Boolean(revokingId) ||
                        updatingId === share.id
                      }
                      aria-label={`Role for ${share.email}`}
                      onChange={(event) => {
                        void updateRole(
                          share,
                          event.currentTarget.value as ScopeShareRole,
                        );
                      }}
                    >
                      {options.map((option) => (
                        <option key={option} value={option}>
                          {roleLabel(option)}
                        </option>
                      ))}
                    </select>
                    {confirming ? (
                      <div className={styles.confirmActions}>
                        <span className={styles.confirmText}>Remove access?</span>
                        <button
                          className={classNames(styles.inlineButton, styles.dangerButton)}
                          type="button"
                          disabled={Boolean(revokingId)}
                          onClick={() => {
                            void revoke(share);
                          }}
                        >
                          Remove
                        </button>
                        <button
                          className={styles.inlineButton}
                          type="button"
                          disabled={Boolean(revokingId)}
                          onClick={() => setConfirmingId(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        className={classNames(styles.inlineButton, styles.dangerButton)}
                        type="button"
                        disabled={pending || Boolean(revokingId)}
                        onClick={() => setConfirmingId(share.id)}
                      >
                        Revoke
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className={styles.generalAccess}>
          <div>
            <div className={styles.generalTitle}>General access</div>
            <div className={styles.generalCopy}>Only people invited</div>
          </div>
          <button
            className={classNames(styles.button, styles.secondaryButton)}
            type="button"
            onClick={() => {
              void copyLink();
            }}
          >
            {copyState === "copied" ? "Copied" : "Copy link"}
          </button>
        </div>
      </section>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M4.25 4.25 11.75 11.75M11.75 4.25 4.25 11.75"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}

export default ShareDialog;
