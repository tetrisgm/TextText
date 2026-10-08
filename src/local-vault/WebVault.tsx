"use client";

import { useEffect, useState } from "react";
import { VaultApp } from "./VaultApp";
import { WebAccount } from "./WebAccount";
import { setVaultTransport } from "./bridge";
import { createWebVaultTransport } from "./web-transport";
import { watchWebWorkspace } from "./web-watch";

export function WebVault({ workspaceId, name, accountEmail, accountName }: { workspaceId: string; name: string; accountEmail: string | null; accountName: string | null }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const transport = createWebVaultTransport(workspaceId, name);
    const release = setVaultTransport(transport.request);
    const watcher = watchWebWorkspace({
      visible: () => document.visibilityState === "visible" && navigator.onLine,
      wait: transport.wait, refresh: transport.refresh,
      changed: () => window.dispatchEvent(new Event("texttext:vault-changed")),
    });
    const visibility = watcher.visibilityChanged;
    // Mount children only after the external transport has been registered.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReady(true);
    window.addEventListener("focus", visibility);
    window.addEventListener("online", visibility);
    window.addEventListener("offline", visibility);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      watcher.dispose();
      release(); transport.destroy();
      window.removeEventListener("focus", visibility);
      window.removeEventListener("online", visibility);
      window.removeEventListener("offline", visibility);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [workspaceId, name]);
  return ready ? <VaultApp allowFolderPicker={false} accountMenu={<WebAccount email={accountEmail} name={accountName} />} /> : <p>Opening workspace…</p>;
}
