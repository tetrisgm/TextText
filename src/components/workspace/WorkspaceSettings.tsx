"use client";

import { useEffect, useState } from "react";
import { updateBlogNameAction } from "@/app/editor/actions";
import {
  listApiTokensAction,
  revokeApiTokenAction,
} from "@/app/editor/token-actions";
import {
  getWorkspaceAiSettingsAction,
  removeWorkspaceAiSettingsAction,
  saveWorkspaceAiSettingsAction,
  type WorkspaceAiSettingsState,
} from "@/app/editor/ai-config-actions";
import type { Blog } from "@/lib/content";
import type { AiConnectionSnapshot } from "@/lib/ai/connection-state";
import type { ApiTokenSummary } from "@/lib/api-tokens";
import { apiTokenKindLabel } from "@/lib/api-token-kinds";
import {
  CLOUD_AI_CATALOG,
  defaultCloudAiModel,
  type CloudAiProvider,
} from "@/lib/ai/provider-catalog";
import { updateWorkspaceBlog } from "@/lib/pool/store";
import {
  AI_CONNECTION_PROOF_PROMPT,
  AiConnectionSettings,
  TRY_AI_IN_TEXTTEXT_EVENT,
} from "./AiConnectionSettings";
import { McpConnections } from "./McpConnections";
import { AgentInstructionsSettings } from "./AgentInstructionsSettings";
import { connectApple, connectGoogle } from "@/app/editor/connect-provider-actions";
import DeleteAccountDialog, {
  type AccountOverview,
  type DeleteAccountStage,
} from "./DeleteAccountDialog";
import { ShareDialog } from "./ShareDialog";
import { ConnectionGallery } from "./ConnectionGallery";
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
  const [tokens, setTokens] = useState<ApiTokenSummary[]>([]);
  const [tokensError, setTokensError] = useState<string | null>(null);
  const [revokingToken, setRevokingToken] = useState<string | null>(null);
  const [confirmingTokenId, setConfirmingTokenId] = useState<string | null>(
    null,
  );
  const [tokensLoading, setTokensLoading] = useState(false);
  const [tokensVisible, setTokensVisible] = useState(false);
  const [mcpCount, setMcpCount] = useState<number | null>(null);
  const [nativeConnection, setNativeConnection] =
    useState<AiConnectionSnapshot | null>(null);

  function formatTokenDate(value: string | null): string {
    if (!value) return "Never used";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Never used";
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    })}`;
  }

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

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        setTokensLoading(true);
        const next = await listApiTokensAction();
        if (!cancelled) {
          setTokens(next);
          setTokensVisible(true);
          setTokensError(null);
        }
      } catch {
        if (!cancelled) {
          setTokens([]);
          setTokensVisible(false);
          setTokensError("Could not load connected app tokens.");
        }
      } finally {
        if (!cancelled) setTokensLoading(false);
      }
    })();
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

  const tryAiInTextText = () => {
    onBack();
    window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent(TRY_AI_IN_TEXTTEXT_EVENT, {
          detail: { prompt: AI_CONNECTION_PROOF_PROMPT },
        }),
      );
    }, 0);
  };

  const aiOverviewLabel =
    nativeConnection?.state === "ready"
      ? `Codex with ChatGPT${nativeConnection.accountEmail ? ` · ${nativeConnection.accountEmail}` : ""}`
      : nativeConnection?.state === "connecting"
        ? "Codex is connecting"
        : nativeConnection?.state === "rate-limited"
          ? "Codex is rate-limited"
        : aiSettings === null
          ? "Checking"
          : aiSettings.configured
            ? `${aiSettings.provider === "anthropic" ? "Anthropic" : "OpenAI"}${aiSettings.model ? ` · ${aiSettings.model}` : ""}`
            : "Not configured";

  const revokeToken = async (tokenId: string) => {
    setTokensError(null);
    setRevokingToken(tokenId);
    try {
      await revokeApiTokenAction(tokenId);
      setTokens((previous) => previous.filter((token) => token.id !== tokenId));
      setConfirmingTokenId(null);
    } catch {
      setTokensError("Could not revoke this token.");
    } finally {
      setRevokingToken(null);
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

        <section
          className={styles.section}
          aria-labelledby="settings-connections-overview"
        >
          <div className={styles.sectionHeader}>
            <div>
              <h2 id="settings-connections-overview">Connections</h2>
              <p>
                Everything that can access this workspace, with a direct path
                to its controls.
              </p>
            </div>
          </div>
          <ul className={styles.connectionOverview}>
            <li>
              <a href="#settings-ai">TextText AI</a>
              <span>{aiOverviewLabel}</span>
            </li>
            <li>
              <a href="#settings-connected-clients">AI and app clients</a>
              <span>
                {tokensLoading
                  ? "Loading"
                  : tokensVisible
                    ? `${tokens.length} active ${tokens.length === 1 ? "client" : "clients"}`
                    : "Sign in to manage"}
              </span>
            </li>
            <li>
              <a href="#settings-mcp">Other MCP servers</a>
              <span>
                {mcpCount === null
                  ? "Loading"
                  : `${mcpCount} connected ${mcpCount === 1 ? "server" : "servers"}`}
              </span>
            </li>
            <li>
              <a href="#settings-account">Sign-in methods</a>
              <span>
                {account
                  ? `${account.identities.length} connected ${account.identities.length === 1 ? "method" : "methods"}`
                  : "Workspace owner only"}
              </span>
            </li>
          </ul>
        </section>

        <ConnectionGallery
          cloudConfigured={Boolean(aiSettings?.configured)}
          nativeReady={nativeConnection?.state === "ready"}
          clientCount={tokensVisible ? tokens.length : null}
          mcpCount={mcpCount}
        />

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
            <AiConnectionSettings
              onTryInTextText={tryAiInTextText}
              onConnectionChange={setNativeConnection}
            />
            <AgentInstructionsSettings handle={blog.handle} />
            <h3 className={styles.subsectionTitle} id="api-key-connections">
              API key connections
            </h3>
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
                    saved key is write-only and cannot be viewed here. This
                    provider and model were verified when the key was saved.
                  </small>
                </span>
                <div className={styles.aiActions}>
                  <button
                    type="button"
                    className="ac-btn ac-btn-filled"
                    onClick={tryAiInTextText}
                  >
                    Try in TextText
                  </button>
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
              Provider API usage is billed separately from consumer AI
              subscriptions. See the guide for the supported ways to use Claude
              or Codex without a provider key.{" "}
              <a href="/docs/ai" target="_blank" rel="noreferrer">
                Read the AI guide
              </a>
              .
            </p>
          </section>
        )}

        <McpConnections handle={blog.handle} onCountChange={setMcpCount} />

        {(tokensVisible || Boolean(account)) && (
          <section
            className={styles.section}
            id="settings-connected-clients"
            aria-labelledby="settings-connections"
          >
            <div className={styles.sectionHeader}>
              <div>
                <h2 id="settings-connections">Connected clients</h2>
                <p>API tokens used by TextText apps and external AI clients.</p>
              </div>
              <a href="/connect" className={styles.connectionAddLink}>
                Add client token
              </a>
            </div>

            {tokensLoading && !tokens.length ? (
              <p className={styles.aiNotConfigured}>Loading clients.</p>
            ) : tokens.length > 0 ? (
              <ul className={styles.connectionList}>
                {tokens.map((token) => (
                  <li className={styles.connectionRow} key={token.id}>
                    <div className={styles.connectionMain}>
                      <span className={styles.connectionName}>
                        {token.name}
                      </span>
                      <span className={styles.connectionMeta}>
                        {apiTokenKindLabel(token.kind)} · {" "}
                        Created {formatTokenDate(token.createdAt)} · Last used{" "}
                        {token.lastUsedAt
                          ? formatTokenDate(token.lastUsedAt)
                          : "never"}
                      </span>
                    </div>
                    <div className={styles.connectionActions}>
                      {confirmingTokenId === token.id ? (
                        <>
                          <button
                            type="button"
                            className="ac-btn ac-btn-plain"
                            onClick={() => setConfirmingTokenId(null)}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="ac-btn ac-btn-plain ac-danger"
                            disabled={revokingToken === token.id}
                            onClick={() => void revokeToken(token.id)}
                          >
                            {revokingToken === token.id
                              ? "Revoking"
                              : "Confirm revoke"}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="ac-btn ac-btn-plain ac-danger"
                          onClick={() => setConfirmingTokenId(token.id)}
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.aiNotConfigured}>
                No connected clients yet.
              </p>
            )}

            {tokensError && (
              <p className={styles.error} role="alert">
                {tokensError}
              </p>
            )}
          </section>
        )}

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
                  // Every row reads the same way: the name, then its state or
                  // the one action that changes it. Three different shapes for
                  // three rows of one list is what made this read as broken.
                  return (
                    <li key={provider}>
                      <span>{label}</span>
                      {connected ? (
                        <span className={styles.identityOn}>Connected</span>
                      ) : provider === "email" ? (
                        <span className={styles.identityOff}>Not connected</span>
                      ) : (
                        <form
                          action={provider === "apple" ? connectApple : connectGoogle}
                        >
                          <button type="submit" className="ac-btn ac-btn-plain">
                            Connect
                          </button>
                        </form>
                      )}
                    </li>
                  );
                })}
              </ul>
              <p className={styles.identityNote}>
                Signing in once with an emailed link connects it.
              </p>
            </div>
            {/* One control, not a red heading above a red link of the same
                name. The sentence says what happens; the button does it. */}
            <div className={styles.dangerBlock}>
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
