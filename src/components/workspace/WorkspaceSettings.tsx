"use client";

import { useEffect, useState } from "react";
import { updateBlogNameAction } from "@/app/editor/actions";
import { listApiTokensAction } from "@/app/editor/token-actions";
import { ConnectPanel } from "@/components/ConnectPanel";
import type { AssistantSkill } from "@/lib/ai/skills";
import type { ApiTokenSummary } from "@/lib/api-tokens";
import type { Blog } from "@/lib/content";
import { updateWorkspaceBlog } from "@/lib/pool/store";
import { ShareDialog } from "./ShareDialog";
import styles from "./WorkspaceSettings.module.css";

type SkillState = AssistantSkill & { enabled: boolean; source?: string };

export function WorkspaceSettings({
  blog,
  canManageSharing,
  onBack,
  onInstallSkill,
  onRemoveSkill,
  onToggleSkill,
  skills,
}: {
  blog: Blog;
  canManageSharing: boolean;
  onBack: () => void;
  onInstallSkill?: (reference: string) => Promise<unknown>;
  onRemoveSkill?: (skillId: string) => void;
  onToggleSkill?: (skillId: string, enabled: boolean) => void;
  skills: SkillState[];
}) {
  const [name, setName] = useState(blog.name);
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [tokens, setTokens] = useState<ApiTokenSummary[] | null>(null);
  const [installValue, setInstallValue] = useState("");
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listApiTokensAction()
      .then((next) => {
        if (!cancelled) setTokens(next);
      })
      .catch(() => {
        if (!cancelled) setTokens([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const saveName = async () => {
    const clean = name.trim().replace(/\s+/g, " ");
    if (!clean || saving) return;
    setSaving(true);
    setNameError(null);
    try {
      const result = await updateBlogNameAction(blog.handle, clean);
      if (!result.ok) throw new Error(result.error);
      updateWorkspaceBlog({ name: result.name });
      setName(result.name);
    } catch (error) {
      setNameError(error instanceof Error ? error.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const install = async () => {
    const reference = installValue.trim();
    if (!reference || !onInstallSkill || installing) return;
    setInstalling(true);
    setInstallError(null);
    try {
      await onInstallSkill(reference);
      setInstallValue("");
    } catch (error) {
      setInstallError(
        error instanceof Error ? error.message : "Could not install",
      );
    } finally {
      setInstalling(false);
    }
  };

  return (
    <main className={styles.page} aria-labelledby="workspace-settings-title">
      <div className={styles.inner}>
        <header className={styles.pageHeader}>
          <button type="button" className={styles.back} onClick={onBack}>
            <span aria-hidden="true">‹</span>
            Home
          </button>
          <h1 id="workspace-settings-title">Settings</h1>
        </header>

        <section className={styles.section} aria-labelledby="settings-workspace">
          <div className={styles.sectionHeader}>
            <div>
              <h2 id="settings-workspace">Workspace</h2>
              <p>Change the name shown across your workspace.</p>
            </div>
            {canManageSharing && (
              <button
                type="button"
                className="ac-btn ac-btn-gray"
                onClick={() => setMembersOpen(true)}
              >
                Invite members
              </button>
            )}
          </div>
          <form
            className={styles.nameForm}
            onSubmit={(event) => {
              event.preventDefault();
              void saveName();
            }}
          >
            <label>
              <span>Workspace name</span>
              <input
                value={name}
                maxLength={80}
                onChange={(event) => setName(event.currentTarget.value)}
              />
            </label>
            <button
              type="submit"
              className="ac-btn ac-btn-filled"
              disabled={!name.trim() || saving || name.trim() === blog.name}
            >
              {saving ? "Saving" : "Save name"}
            </button>
          </form>
          {nameError && (
            <p className={styles.error} role="alert">
              {nameError}
            </p>
          )}
        </section>

        <section className={styles.section} aria-labelledby="settings-skills">
          <div className={styles.sectionHeader}>
            <div>
              <h2 id="settings-skills">Skills</h2>
              <p>Choose the writing guidance available to the assistant.</p>
            </div>
          </div>
          <div className={styles.skills}>
            {skills.map((skill) => (
              <div className={styles.skillRow} key={skill.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={skill.enabled}
                    disabled={!onToggleSkill}
                    onChange={(event) =>
                      onToggleSkill?.(skill.id, event.currentTarget.checked)
                    }
                  />
                  <span>
                    <strong>{skill.name}</strong>
                    <small>{skill.description}</small>
                  </span>
                </label>
                {skill.source && onRemoveSkill && (
                  <button
                    type="button"
                    className="ac-btn ac-btn-plain"
                    onClick={() => onRemoveSkill(skill.id)}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
          {onInstallSkill && (
            <div className={styles.install}>
              <input
                type="url"
                value={installValue}
                aria-label="Skill link"
                placeholder="Paste a skills.sh link"
                onChange={(event) => setInstallValue(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void install();
                  }
                }}
              />
              <button
                type="button"
                className="ac-btn ac-btn-gray"
                disabled={!installValue.trim() || installing}
                onClick={() => void install()}
              >
                {installing ? "Installing" : "Install skill"}
              </button>
            </div>
          )}
          {installError && (
            <p className={styles.error} role="alert">
              {installError}
            </p>
          )}
        </section>

        <section className={`${styles.section} ${styles.connect}`} aria-labelledby="settings-connect">
          <div className={styles.sectionHeader}>
            <div>
              <h2 id="settings-connect">Connect an agent</h2>
              <p>Create tokens and copy setup for MCP or file sync.</p>
            </div>
          </div>
          {tokens ? (
            <ConnectPanel
              initialTokens={tokens}
              origin={
                typeof window === "undefined" ? "" : window.location.origin
              }
            />
          ) : (
            <p className={styles.loading} role="status">
              Loading connections
            </p>
          )}
        </section>
      </div>
      {canManageSharing && (
        <ShareDialog
          handle={blog.handle}
          scopeType="workspace"
          scopeId="workspace"
          title="Members"
          subtitle={blog.name}
          open={membersOpen}
          onClose={() => setMembersOpen(false)}
        />
      )}
    </main>
  );
}
