"use client";

// The one-button approval card for a device link. The heavy lifting happened
// before this renders (code validated, app name loaded server-side); this
// just calls the approve action and settles into a done state.

import { useCallback, useState } from "react";
import { approveDeviceLinkAction } from "@/app/connect/link/actions";

type Phase = "idle" | "approving" | "done" | "error";

export function DeviceLinkApprove({ code }: { code: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  const approve = useCallback(() => {
    if (phase === "approving" || phase === "done") return;
    setPhase("approving");
    setError(null);
    void approveDeviceLinkAction(code)
      .then((result) => {
        if (result.ok) {
          setPhase("done");
          return;
        }
        setPhase("error");
        setError(result.error);
      })
      .catch(() => {
        setPhase("error");
        setError("Could not approve the link");
      });
  }, [code, phase]);

  if (phase === "done") {
    return (
      <p className="connect-link-done" role="status">
        Linked. You can return to the app; it connects on its own within a few
        seconds.
      </p>
    );
  }

  return (
    <div className="connect-link-actions">
      <button
        className="ac-btn ac-btn-filled"
        type="button"
        disabled={phase === "approving"}
        onClick={approve}
      >
        {phase === "approving" ? "Linking" : "Link this app"}
      </button>
      {error && (
        <p className="connect-link-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
