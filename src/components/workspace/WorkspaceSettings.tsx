"use client";

import { useEffect, useState } from "react";
import { updateBlogNameAction } from "@/app/editor/actions";
import {
  getWorkspaceAiSettingsAction,
  removeWorkspaceAiSettingsAction,
  saveWorkspaceAiSettingsAction,
  type WorkspaceAiSettingsState,
} from "@/app/editor/ai-config-actions";
import type { Blog } from "@/lib/content";
import {
  CLOUD_AI_CATALOG,
  defaultCloudAiModel,
  type CloudAiProvider,
} from "@/lib/ai/provider-catalog";
import { updateWorkspaceBlog } from "@/lib/pool/store";
import { AgentIntegrationHome } from "./AgentIntegrationHome";
import { AiConnectionSettings } from "./AiConnectionSettings";
import { McpConnections } from "./McpConnections";
import { connectApple, connectGoogle } from "@/app/editor/connect-provider-actions";
import DeleteAccountDialog, {
  type AccountOverview,
  type DeleteAccountStage,
} from "./DeleteAccountDialog";
import { ShareDialog } from "./ShareDialog";
import styles from "./WorkspaceSettings.module.css";

export function WorkspaceSettings({
  blog,
  canManageSharing,
  onBack,
}: {
  blog: Blog;
  canManageSharing: boolean;
  onBack: () => void;
}) {
  const [name, setName] = useState(blog.name);
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [account, setAccount] = useState<AccountOverview | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteStage, setDeleteStage] = useState<DeleteAccountStage>("idle");

  const [aiSettings, setAiSettings] =
    useState<WorkspaceAiSettingsState | null>(null);
  const [aiProvider, setAiProvider] =
    useState<CloudAiProvider>("anthropic");
  const [aiKey, setAiKey] = useState("");
  const [aiModel, setAiModel] = useState(defaultCloudAiModel("anthropic"));
  const [aiEditing, setAiEditing] = useState(false);
  const [aiSaving, setAiSaving] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Self-contained fetch, like WorkspaceMenuMount does. A 404 is the normal
  // answer for a collaborator or a signed-out viewer, and leaving account
  // makes the section fail closed.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/account", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as AccountOverview;
        if (!cancelled) setAccount(data);
      } catch {
        // Offline or signed out. The section simply does not appear.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Deliberately does NOT dismiss before the request, which is what the Trash
  // call sites do. There is no optimistic update here and no page to return to,
  // so the dialog stays open and pending until the server answers, then the
  // whole window navigates away.
  const confirmDeleteAccount = async (confirmation: string) => {
    setDeletePending(true);
    setDeleteStage("idle");
    try {
      const response = await fetch("/api/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "delete-account", confirmation }),
      });
      if (response.status === 404 || response.status === 401) {
        setDeleteStage("signedOut");
        return;
      }
      if (!response.ok) {
        setDeleteStage("failed");
        return;
      }
      const result = (await response.json()) as {
        ok: boolean;
        complete: boolean;
      };
      if (!result.ok) {
        setDeleteStage("failed");
        return;
      }
      if (!result.complete) {
        setDeleteStage("incomplete");
        return;
      }
      // Local copies go too. Leaving the drafts and the offline pool behind
      // would keep the documents on a shared machine after the account is gone.
      try {
        const { clearWorkspaceStorage } = await import("@/lib/pool/storage");
        await clearWorkspaceStorage();
      } catch {
        // Best effort; the account is already gone server side.
      }
      window.location.replace("/goodbye");
    } catch {
      setDeleteStage("failed");
    } finally {
      setDeletePending(false);
    }
  };

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
                <h2 id="settings-ai">AI</h2>
                <p>
                  Choose how an agent works with your TextText workspace.
                </p>
              </div>
            </div>
            <AiConnectionSettings />
            <h3 className={styles.subsectionTitle}>API key connections</h3>
            <p className={styles.aiNotConfigured}>
              These advanced connections use your provider API account. Keys are encrypted and scoped to this workspace.
            </p>
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
              TextText from that app through{" "}
              <a href="/docs/ai" target="_blank" rel="noreferrer">
                MCP
              </a>
              .
            </p>
          </section>
        )}

        <McpConnections handle={blog.handle} />

        <section className={styles.section} aria-label="AI connections">
          <AgentIntegrationHome compact />
        </section>

        {/* Only when the viewer owns an account. A collaborator, a guest
            workspace and a failed fetch all render nothing, and this
            describes the VIEWER's own account rather than the blog prop, since
            a collaborator can open Settings on a workspace they do not own. */}
        {account && (
          <section
            className={styles.section}
            id="account"
            aria-labelledby="settings-account"
          >
            <h2 id="settings-account">Account</h2>
            <p>
              {account.email
                ? `Signed in as ${account.email}.`
                : "Signed in with Apple."}
            </p>
            {/* One account, several ways in. Each Connect button starts an
                ordinary provider sign-in carrying a signed link intent, so the
                new provider attaches to THIS account instead of minting a
                second one. That second-account trap is exactly what split the
                owner's own writing across two workspaces. */}
            <div className={styles.identityRow}>
              <strong>Ways to sign in</strong>
              <ul>
                {["apple", "google", "email"].map((provider) => {
                  const connected = account.identities.includes(provider);
                  const label =
                    provider === "apple"
                      ? "Apple"
                      : provider === "google"
                        ? "Google"
                        : "Email link";
                  return (
                    <li key={provider}>
                      <span>{label}</span>
                      {connected ? (
                        <span className={styles.identityOn}>Connected</span>
                      ) : provider === "email" ? (
                        <span className={styles.identityOff}>
                          Sign in once with an emailed link to connect it
                        </span>
                      ) : (
                        <form
                          action={provider === "apple" ? connectApple : connectGoogle}
                        >
                          <button type="submit" className="ac-btn ac-btn-plain">
                            Connect {label}
                          </button>
                        </form>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className={styles.dangerBlock}>
              <strong>Delete account</strong>
              <p>
                Deleting removes your account, the workspace {account.workspaceName},
                and everything in it. This cannot be undone.
              </p>
              <button
                type="button"
                className="ac-btn ac-btn-plain ac-danger"
                onClick={() => {
                  setDeleteStage("idle");
                  setDeleteOpen(true);
                }}
              >
                Delete account
              </button>
            </div>
          </section>
        )}
      </div>
      {/* Mounted only while open, so the confirmation field starts empty on
          every open without an effect resetting it. */}
      {account && deleteOpen && (
        <DeleteAccountDialog
          open
          account={account}
          pending={deletePending}
          stage={deleteStage}
          onCancel={() => setDeleteOpen(false)}
          onConfirm={confirmDeleteAccount}
        />
      )}
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
