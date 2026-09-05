import type { ItemAccessSummary } from "@/lib/store";
import styles from "./ShareDialog.module.css";

function roleLabel(role: "editor" | "commenter" | "viewer") {
  return role === "editor" ? "Can edit" : role === "commenter" ? "Can comment" : "Can view";
}

export function GeneralItemAccess({ summary, loading }: { summary: ItemAccessSummary | null; loading: boolean }) {
  return <div className={styles.generalCopy}>{!summary ? loading ? "Loading access" : "Access summary unavailable"
    : summary.visibility === "public" ? "Anyone with the link can read. This page is public."
    : summary.pageVisibility === "link" ? "Anyone with the link can read. This page is unlisted."
    : summary.visibility === "link" ? "Anyone with an active access link can read. The ordinary page link requires named access."
    : "Only the owner and people with direct or inherited access can open this page."}</div>;
}

export function ItemAccessDetails({ summary, canChange, confirmingId, setConfirmingId, setManagedScope, revokeLink }: {
  summary: ItemAccessSummary;
  canChange: boolean;
  confirmingId: string | null;
  setConfirmingId: (id: string | null) => void;
  setManagedScope: (scope: ItemAccessSummary["inherited"][number]) => void;
  revokeLink: (id: string) => Promise<void>;
}) {
  return (<div className={styles.inheritedSection}>
          {summary.inherited.length > 0 && <>
            <div className={styles.sectionLabel}>Inherited access</div>
            <ul className={styles.shareList}>{summary.inherited.map((grant) => <li className={styles.shareRow} key={grant.id}>
              <div className={styles.personMain}>
                <div className={styles.personEmail}>{grant.email}</div>
                <div className={styles.personState}>Via {grant.scopeName} ({grant.scopeType})</div>
              </div>
              <span className={styles.roleChip}>{roleLabel(grant.role)}</span>
              <button className={styles.inlineButton} type="button" disabled={!canChange}
                aria-label={`Manage access via ${grant.scopeName}`} onClick={() => setManagedScope(grant)}>Manage</button>
            </li>)}</ul>
          </>}
          {summary.links.length > 0 && <>
            <div className={styles.sectionLabel}>Active access links</div>
            <p className={styles.generalCopy}>These separate links grant access without an invitation. Removing a person does not revoke a link.</p>
            <ul className={styles.shareList}>{summary.links.map((link) => <li className={styles.shareRow} key={link.id}>
              <div className={styles.personMain}>
                <div className={styles.personEmail}>{link.label || "Access link"}</div>
                <div className={styles.personState}>{link.expiresAt ? `Expires ${new Date(link.expiresAt).toLocaleString()}` : "No expiry"}</div>
              </div>
              <span className={styles.roleChip}>{roleLabel(link.role)}</span>
              {confirmingId === link.id ? <div className={styles.confirmActions}>
                <span className={styles.confirmText}>Revoke this link?</span>
                <button className={`${styles.inlineButton} ${styles.dangerButton}`} type="button"
                  disabled={!canChange} onClick={() => { void revokeLink(link.id); }}>Revoke link</button>
                <button className={styles.inlineButton} type="button" disabled={!canChange}
                  onClick={() => setConfirmingId(null)}>Cancel</button>
              </div> : <button className={`${styles.inlineButton} ${styles.dangerButton}`} type="button"
                disabled={!canChange} onClick={() => setConfirmingId(link.id)}>Revoke</button>}
            </li>)}</ul>
          </>}
        </div>);
}
