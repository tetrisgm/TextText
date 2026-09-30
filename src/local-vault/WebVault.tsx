"use client";

import { useEffect, useState } from "react";
import { VaultApp } from "./VaultApp";
import { setVaultTransport } from "./bridge";
import { createWebVaultTransport } from "./web-transport";

export function WebVault({ workspaceId, name }: { workspaceId: string; name: string }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const transport = createWebVaultTransport(workspaceId, name);
    const release = setVaultTransport(transport.request);
    let controller: AbortController | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const visible = () => !stopped && document.visibilityState === "visible" && navigator.onLine;
    const changed = () => window.dispatchEvent(new Event("texttext:vault-changed"));
    const listen = () => {
      if (!visible() || controller) return;
      const active = new AbortController(); controller = active;
      void (async () => {
        try {
          while (visible() && !active.signal.aborted) {
            if (await transport.wait(active.signal)) changed();
          }
        } catch {
          // One outstanding request waits on server filesystem events. A
          // disconnected tab backs off; hidden tabs hold no request open.
          if (visible() && !active.signal.aborted) retry = setTimeout(listen, 5000);
        } finally { if (controller === active) controller = null; }
      })();
    };
    const visibility = () => {
      if (!visible()) { controller?.abort(); if (retry) clearTimeout(retry); retry = null; }
      else { void transport.refresh().then((value) => { if (value) changed(); }).catch(() => {}); listen(); }
    };
    // Mount children only after the external transport has been registered.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReady(true); listen();
    window.addEventListener("focus", visibility);
    window.addEventListener("online", visibility);
    window.addEventListener("offline", visibility);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      stopped = true; controller?.abort(); if (retry) clearTimeout(retry);
      release(); transport.destroy();
      window.removeEventListener("focus", visibility);
      window.removeEventListener("online", visibility);
      window.removeEventListener("offline", visibility);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [workspaceId, name]);
  return ready ? <VaultApp allowFolderPicker={false} /> : <p>Opening workspace…</p>;
}
