"use client";

import { useEffect, useState } from "react";
import { parseSharedVaults, sharedFileHref, sharedFolderHref, sharedWorkspaceHref, type SharedVaultWorkspace } from "@/local-vault/shared-vaults";

export function SharedVaults() {
  const [workspaces, setWorkspaces] = useState<SharedVaultWorkspace[] | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/vault/shared", { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(response.status === 401 ? "Sign in to see shared files." : "Shared files could not be loaded.");
        return parseSharedVaults(await response.json());
      })
      .then(value => { if (!controller.signal.aborted) { setWorkspaces(value); setError(""); } })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Shared files could not be loaded."); });
    return () => controller.abort();
  }, [attempt]);

  return <section className="shared-section" aria-labelledby="shared-vaults-title">
    <h2 id="shared-vaults-title">Shared files</h2>
    {error ? <p role="alert">{error} <button type="button" onClick={() => { setError(""); setAttempt(value => value + 1); }}>Retry</button></p> :
      workspaces === null ? <p role="status">Loading shared files…</p> :
      workspaces.length === 0 ? <p>No file workspaces have been shared with you yet.</p> :
      <ul className="shared-vault-list">{workspaces.map(workspace => <li className="shared-vault-card" key={workspace.id}>
        <a className="shared-vault-title" href={sharedWorkspaceHref(workspace.id)}>{workspace.name}</a>
        {!!workspace.folders.length && <ul aria-label={`Shared folders in ${workspace.name}`}>{workspace.folders.slice(0, 5).map(folder =>
          <li key={folder}><a href={sharedFolderHref(workspace.id, folder)}>{folder}/</a></li>)}</ul>}
        {!!workspace.items.length && <ul aria-label={`Shared files in ${workspace.name}`}>{workspace.items.slice(0, 8).map(item =>
          <li key={item.itemId}><a href={sharedFileHref(workspace.id, item.relativePath)}>{item.relativePath}</a></li>)}</ul>}
        {(workspace.items.length > 8 || workspace.folders.length > 5) && <p>Open this workspace to see all shared files.</p>}
      </li>)}</ul>}
  </section>;
}
