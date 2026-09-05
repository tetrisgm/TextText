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
  getItemAccessSummaryAction,
  revokeItemAccessLinkAction,
  listScopeSharesAction,
  revokeScopeShareAction,
  shareScopeAction,
  updateScopeShareRoleAction,
} from "@/app/editor/actions";
import { useEscapeLayer } from "@/components/keyboard/CommandLayer";
import type { ItemAccessSummary } from "@/lib/store";
import type { ScopeShare, ScopeShareRole } from "@/lib/shares";
import type { CollaboratorScopeType } from "@/lib/permissions";
import styles from "./ShareDialog.module.css";
import { GeneralItemAccess, ItemAccessDetails } from "./ItemAccessDetails";

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
  if (role === "commenter") return "Can comment";
  if (role === "viewer") return "Can view";
  if (role === "member") return "Member";
  return "Guest";
}

function roleOptions(scopeType: CollaboratorScopeType) {
  return scopeType === "workspace"
    ? (["member", "guest"] as const)
    : (["editor", "commenter", "viewer"] as const);
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

export function ShareDialog(props: ShareDialogProps) {
  if (!props.open) return null;
  return <ShareDialogContent
    key={`${props.handle}:${props.scopeType ?? "item"}:${props.scopeId ?? props.postId}`}
    {...props}
  />;
}

function ShareDialogContent({
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
  const dialogRef = useRef<HTMLElement>(null);
  const activeRef = useRef(true);
  const requestRef = useRef(0);
  const [summary, setSummary] = useState<ItemAccessSummary | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [managedScope, setManagedScope] = useState<ItemAccessSummary["inherited"][number] | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [shares, setShares] = useState<ScopeShare[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ScopeShareRole>(() => defaultRole(scopeType));
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");

  const reload = useCallback(async () => {
    const request = ++requestRef.current;
    await Promise.resolve();
    const current = () => activeRef.current && requestRef.current === request;
    if (!current()) return null;
    setLoading(true);
    setSummary(null);
    setError(null);
    try {
      if (scopeType === "item") {
        const next = await getItemAccessSummaryAction(handle, resolvedScopeId);
        if (current()) { setSummary(next); setShares(next.direct); }
        return current() ? next : null;
      }
      const next = await listScopeSharesAction(handle, scopeType, resolvedScopeId);
      if (current()) setShares(next);
      return null;
    } catch {
      if (current()) {
        setShares([]);
        setError("Access summary unavailable. Try again before changing access.");
      }
      return null;
    } finally {
      if (current()) setLoading(false);
    }
  }, [handle, resolvedScopeId, scopeType]);

  useEffect(() => {
    activeRef.current = true;
    queueMicrotask(() => { if (activeRef.current) void reload(); });
    return () => {
      activeRef.current = false;
      requestRef.current += 1;
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, [reload]);

  useEffect(() => {
    const previous = document.activeElement;
    dialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [managedScope]);

  useEscapeLayer(open && !managedScope, "Share dialog", onClose);

  const closeFromBackdrop = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) onClose();
    },
    [onClose],
  );

  const busy = inviting || Boolean(revokingId) || Boolean(updatingId);
  const canChange = !loading && !error && !busy && (scopeType !== "item" || Boolean(summary));

  const invite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextEmail = email.trim().toLowerCase();
    if (!canChange || !nextEmail) return;
    setInviting(true);
    setNotice(null);
    setConfirmingId(null);
    setSummary(null);
    try {
      const result = await shareScopeAction(handle, scopeType, resolvedScopeId, nextEmail, role);
      if (!activeRef.current) return;
      setNotice(`Access granted to ${nextEmail}. ${result.emailStatus === "sent"
        ? "Email sent. Delivery to the inbox is not confirmed."
        : result.emailStatus === "failed"
          ? "Email failed. Retry the invitation to send it again."
          : "Email not sent. Share the link with them directly."}`);
      if (result.emailStatus !== "failed") setEmail("");
      await reload();
    } catch (inviteError) {
      if (activeRef.current) {
        await reload();
        setError(errorMessage(inviteError, "Could not confirm access. Refresh before retrying."));
      }
    } finally {
      if (activeRef.current) setInviting(false);
    }
  };

  const revoke = async (share: ScopeShare) => {
    if (!canChange) return;
    setRevokingId(share.id);
    setNotice(null);
    setSummary(null);
    try {
      await revokeScopeShareAction(handle, scopeType, resolvedScopeId, share.id);
      if (!activeRef.current) return;
      setConfirmingId(null);
      const next = await reload();
      if (!activeRef.current) return;
      const remaining = next?.inherited.filter((grant) => grant.email === share.email) ?? [];
      setNotice(`Direct access removed for ${share.email}. ${remaining.length
        ? `Access remains via ${remaining.map((grant) => grant.scopeName).join(", ")}. ` : ""}${
        next?.visibility !== "private" && next
          ? "Public or link access still remains."
          : next ? "Other access is shown below." : "Review the current scope and item access before assuming access has ended."
      }`);
    } catch (revokeError) {
      if (activeRef.current) {
        await reload();
        setError(errorMessage(revokeError, "Could not confirm removal. Refresh before retrying."));
      }
    } finally {
      if (activeRef.current) setRevokingId(null);
    }
  };

  const updateRole = async (share: ScopeShare, nextRole: ScopeShareRole) => {
    if (!canChange) return;
    setUpdatingId(share.id);
    setNotice(null);
    setSummary(null);
    try {
      await updateScopeShareRoleAction(handle, scopeType, resolvedScopeId, share.id, nextRole);
      if (activeRef.current) await reload();
    } catch (roleError) {
      if (activeRef.current) {
        await reload();
        setError(errorMessage(roleError, "Could not confirm role. Refresh before retrying."));
      }
    } finally {
      if (activeRef.current) setUpdatingId(null);
    }
  };

  const revokeLink = async (linkId: string) => {
    if (!canChange) return;
    setRevokingId(linkId);
    setNotice(null);
    setSummary(null);
    try {
      await revokeItemAccessLinkAction(handle, resolvedScopeId, linkId);
      if (!activeRef.current) return;
      setConfirmingId(null);
      const next = await reload();
      if (activeRef.current) setNotice(`Link revoked. ${next?.visibility === "public"
        ? "The page is still public."
        : next?.visibility === "link" ? "Other link access still remains."
        : "Named and inherited access are separate. Review the current access below."}`);
    } catch (linkError) {
      if (activeRef.current) {
        await reload();
        setError(errorMessage(linkError, "Could not confirm link revocation."));
      }
    } finally {
      if (activeRef.current) setRevokingId(null);
    }
  };

  const copyLink = useCallback(async () => {
    setError(null);
    try {
      const shareUrl = scopeType === "item"
        ? summary ? new URL(summary.pagePath, window.location.origin).toString() : ""
        : shareUrlFromLocation();
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
  }, [scopeType, summary]);

  if (!open || !resolvedScopeId) return null;

  if (managedScope) return <ShareDialog
    handle={handle} scopeType={managedScope.scopeType} scopeId={managedScope.scopeId}
    subtitle={managedScope.scopeName} open onClose={() => {
      setManagedScope(null);
      void reload();
    }}
  />;

  const trimmedEmail = email.trim();
  const options = roleOptions(scopeType);

  return (
    <div className={`applecms ${styles.backdrop}`} onMouseDown={closeFromBackdrop}>
      <section
        ref={dialogRef}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]',
          ));
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault(); last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault(); first?.focus();
          }
        }}
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
            disabled={!canChange}
            onChange={(event) => setEmail(event.currentTarget.value)}
          />
          <select
            className={styles.roleSelect}
            value={role}
            disabled={!canChange}
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
            disabled={!trimmedEmail || !canChange}
          >
            {inviting ? "Inviting" : "Invite"}
          </button>
        </form>

        {error && (
          <p className={styles.error} role="status">
            {error} <button className={styles.inlineButton} type="button"
              disabled={busy || loading} onClick={() => { void reload(); }}>Refresh access</button>
          </p>
        )}

        {notice && <p className={styles.notice} role="status">{notice}</p>}

        <div className={styles.peopleSection}>
          {summary?.owner && <div className={styles.shareRow}>
            <div className={styles.personMain}>
              <div className={styles.personEmail}>{summary.owner.name}</div>
              <div className={styles.personState}>{summary.owner.email} · Workspace owner</div>
            </div>
            <span className={styles.roleChip}>Owner · Full access</span>
          </div>}
          <div className={styles.sectionLabel}>People</div>
          {loading ? (
            <div className={styles.emptyState}>Loading people</div>
          ) : error || (scopeType === "item" && !summary) ? (
            <div className={styles.emptyState}>Access details unavailable</div>
          ) : shares.length === 0 ? (
            <div className={styles.emptyState}>No direct invitations</div>
          ) : (
            <ul className={styles.shareList}>
              {shares.map((share) => {
                const confirming = confirmingId === share.id;
                const pending = busy;
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
                        {share.accepted ? "Access granted · Direct invitation" : "Access granted · Sign in with this email"}
                      </div>
                    </div>
                    <select
                      className={styles.personRoleSelect}
                      value={share.role}
                      disabled={
                        pending || !canChange
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
                        <span className={styles.confirmText}>Remove direct access?</span>
                        <button
                          className={classNames(styles.inlineButton, styles.dangerButton)}
                          type="button"
                          disabled={!canChange}
                          onClick={() => {
                            void revoke(share);
                          }}
                        >
                          Remove
                        </button>
                        <button
                          className={styles.inlineButton}
                          type="button"
                          disabled={!canChange}
                          onClick={() => setConfirmingId(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        className={classNames(styles.inlineButton, styles.dangerButton)}
                        type="button"
                        disabled={pending || !canChange}
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

        {summary && <ItemAccessDetails summary={summary} canChange={canChange}
          confirmingId={confirmingId} setConfirmingId={setConfirmingId}
          setManagedScope={setManagedScope} revokeLink={revokeLink} />}

        <div className={styles.generalAccess}>
          <div>
            <div className={styles.generalTitle}>General access</div>
            {scopeType === "item" ? <GeneralItemAccess summary={summary} loading={loading || busy} />
              : <div className={styles.generalCopy}>Direct invitations for this scope. Items may also have other grants or links.</div>}
          </div>
          <button
            className={classNames(styles.button, styles.secondaryButton)}
            disabled={scopeType === "item" && !summary}
            type="button"
            onClick={() => {
              void copyLink();
            }}
          >
            {copyState === "copied" ? "Copied" : "Copy page link"}
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
