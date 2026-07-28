"use client";

import { useEffect, useState } from "react";
import { updateBlogNameAction } from "@/app/editor/actions";
import {
  getWorkspaceAiSettingsAction,
  removeWorkspaceAiSettingsAction,
  saveWorkspaceAiSettingsAction,
  type WorkspaceAiSettingsState,
} from "@/app/editor/ai-config-actions";
import {
  listApiTokensAction,
  listOAuthConnectionsAction,
} from "@/app/editor/token-actions";
import { ConnectPanel } from "@/components/ConnectPanel";
import type { AssistantSkill } from "@/lib/ai/skills";
import type { ApiTokenSummary } from "@/lib/api-tokens";
import type { Blog } from "@/lib/content";
import type { OAuthConnectionSummary } from "@/lib/oauth-connections";
import {
  CLOUD_AI_CATALOG,
  defaultCloudAiModel,
  type CloudAiProvider,
} from "@/lib/ai/provider-catalog";
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
  const [connections, setConnections] =
    useState<OAuthConnectionSummary[] | null>(null);
  const [installValue, setInstallValue] = useState("");
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [aiSettings, setAiSettings] =
    useState<WorkspaceAiSettingsState | null>(null);
  const [aiProvider, setAiProvider] =
    useState<CloudAiProvider>("anthropic");
  const [aiKey, setAiKey] = useState("");
  const [aiModel, setAiModel] = useState(defaultCloudAiModel("anthropic"));
  const [aiEditing, setAiEditing] = useState(false);
  const [aiSaving, setAiSaving] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.allSettled([
      listApiTokensAction(),
      listOAuthConnectionsAction(),
    ]).then(([tokenResult, connectionResult]) => {
      if (cancelled) return;
      setTokens(
        tokenResult.status === "fulfilled" ? tokenResult.value : [],
      );
      setConnections(
        connectionResult.status === "fulfilled"
          ? connectionResult.value
          : [],
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getWorkspaceAiSettingsAction(blog.handle).then((next) => {
      if (cancelled) return;
      setAiSettings(next);
      if (next.provider) setAiProvider(next.provider);
      if (next.model) setAiModel(next.model);
    });
    return () => {
      cancelled = true;
    };
  }, [blog.handle]);

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

  const saveAi = async () => {
    if (!aiKey.trim() || aiSaving) return;
    setAiSaving(true);
    setAiError(null);
    try {
      const next = await saveWorkspaceAiSettingsAction(
        blog.handle,
        aiProvider,
        aiModel,
        aiKey,
      );
      setAiSettings(next);
      setAiKey("");
      setAiEditing(false);
    } catch (error) {
      setAiError(
        error instanceof Error ? error.message : "Could not save cloud AI",
      );
    } finally {
      setAiSaving(false);
    }
  };

  const removeAi = async () => {
    if (aiSaving) return;
    setAiSaving(true);
    setAiError(null);
    try {
      setAiSettings(await removeWorkspaceAiSettingsAction(blog.handle));
      setAiKey("");
      setAiEditing(false);
    } catch (error) {
      setAiError(
        error instanceof Error ? error.message : "Could not remove cloud AI",
      );
    } finally {
      setAiSaving(false);
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

        {aiSettings?.allowed && (
          <section className={styles.section} aria-labelledby="settings-ai">
            <div className={styles.sectionHeader}>
              <div>
                <h2 id="settings-ai">In-app assistant</h2>
                <p>
                  Connect your own provider API account and choose the model
                  Texttext uses. Keys are encrypted and scoped to this
                  workspace.
                </p>
              </div>
            </div>
            {aiSettings.configured && !aiEditing ? (
              <div className={styles.aiStatus}>
                <span>
                  <strong>Configured</strong>
                  <small>
                    {aiSettings.provider === "anthropic"
                      ? "Anthropic"
                      : "OpenAI"}
                    {aiSettings.model ? ` · ${aiSettings.model}` : ""}. The
                    saved key is write-only and cannot be viewed here.
                  </small>
                </span>
                <div className={styles.aiActions}>
                  <button
                    type="button"
                    className="ac-btn ac-btn-gray"
                    onClick={() => setAiEditing(true)}
                  >
                    Replace key
                  </button>
                  <button
                    type="button"
                    className="ac-btn ac-btn-plain"
                    disabled={aiSaving}
                    onClick={() => void removeAi()}
                  >
                    {aiSaving ? "Removing" : "Remove"}
                  </button>
                </div>
              </div>
            ) : (
              <form
                className={styles.aiForm}
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveAi();
                }}
              >
                <label>
                  <span>Provider</span>
                  <select
                    value={aiProvider}
                    onChange={(event) => {
                      const provider = event.currentTarget
                        .value as CloudAiProvider;
                      setAiProvider(provider);
                      setAiModel(defaultCloudAiModel(provider));
                    }}
                  >
                    <option value="anthropic">Anthropic</option>
                    <option value="openai">OpenAI</option>
                  </select>
                </label>
                <label>
                  <span>Model</span>
                  <select
                    value={aiModel}
                    onChange={(event) =>
                      setAiModel(event.currentTarget.value)
                    }
                  >
                    {CLOUD_AI_CATALOG[aiProvider].models.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.aiKeyField}>
                  <span>
                    API key ·{" "}
                    <a
                      href={
                        aiProvider === "anthropic"
                          ? "https://console.anthropic.com/settings/keys"
                          : "https://platform.openai.com/api-keys"
                      }
                      target="_blank"
                      rel="noreferrer"
                    >
                      Create one
                    </a>
                  </span>
                  <input
                    type="password"
                    value={aiKey}
                    autoComplete="new-password"
                    spellCheck={false}
                    placeholder="Paste a provider API key"
                    onChange={(event) => setAiKey(event.currentTarget.value)}
                  />
                </label>
                <div className={styles.aiActions}>
                  {aiSettings.configured && (
                    <button
                      type="button"
                      className="ac-btn ac-btn-plain"
                      onClick={() => {
                        setAiKey("");
                        setAiEditing(false);
                      }}
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    type="submit"
                    className="ac-btn ac-btn-filled"
                    disabled={!aiKey.trim() || aiSaving}
                  >
                    {aiSaving
                      ? "Saving"
                      : aiSettings.configured
                        ? "Replace key"
                        : "Add key"}
                  </button>
                </div>
              </form>
            )}
            {!aiSettings.configured && !aiEditing && (
              <p className={styles.aiNotConfigured}>Not configured</p>
            )}
            {aiError && (
              <p className={styles.error} role="alert">
                {aiError}
              </p>
            )}
            <p className={styles.aiNotConfigured}>
              Provider API usage is billed separately from ChatGPT and
              Claude.ai subscriptions. To use an existing subscription, connect
              Texttext from that app through{" "}
              <a href="/docs/ai" target="_blank" rel="noreferrer">
                MCP
              </a>
              .
            </p>
          </section>
        )}

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

        <section
          className={`${styles.section} ${styles.connect}`}
          aria-labelledby="settings-connect"
        >
          <div className={styles.sectionHeader}>
            <div>
              <h2 id="settings-connect">Claude, Codex, and ChatGPT</h2>
              <p>
                Let the AI clients you already use work directly with this
                workspace.
              </p>
            </div>
          </div>
          {tokens && connections ? (
            <ConnectPanel
              initialConnections={connections}
              initialTokens={tokens}
              origin="https://texttext.app"
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
