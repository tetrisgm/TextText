"use client";

import { useSyncExternalStore } from "react";
import { refreshWorkspacePool, useWorkspacePool } from "@/lib/pool/store";

export function subscribeToWorkspaceConnectivity(listener: () => void) {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

export function WorkspaceConnectionNotice({ handle, blogId }: { handle: string; blogId: string }) {
  const online = useSyncExternalStore(subscribeToWorkspaceConnectivity, () => navigator.onLine, () => true);
  const { refreshing } = useWorkspacePool();
  return <WorkspaceConnectionStatus online={online} refreshing={refreshing} onRefresh={() => void refreshWorkspacePool(handle, blogId)} />;
}

export function WorkspaceConnectionStatus({ online, refreshing, onRefresh }: { online: boolean; refreshing: boolean; onRefresh: () => void }) {
  if (online) return null;
  return <div className="workspace-post-body-status" role="status">
    <p>You are offline. You can open items already stored on this device. Recent changes may not have reached your other devices. Keep any unsaved text open.</p>
    <button type="button" className="ac-btn ac-btn-gray" disabled={refreshing} onClick={onRefresh}>
      {refreshing ? "Checking connection" : "Check connection"}
    </button>
  </div>;
}
