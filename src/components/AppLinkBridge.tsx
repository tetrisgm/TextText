"use client";

// Runs inside the Texttext desktop app's web view after sign-in. It mints a sync
// token for the signed-in account and hands it to the native app over the
// WKScriptMessageHandler bridge (window.webkit.messageHandlers.writeApp), then
// the app takes over: it stores the token, starts folder sync, and loads the
// workspace. In a normal browser (no bridge) it just points people at the app.

import { useEffect, useState } from "react";
import { mintAppTokenAction } from "@/app/connect/app/actions";

type WriteAppWindow = typeof window & {
  __WRITE_APP__?: boolean;
  __WRITE_DEVICE__?: string;
  webkit?: {
    messageHandlers?: {
      writeApp?: { postMessage: (message: unknown) => void };
    };
  };
};

type State = "checking" | "linking" | "linked" | "browser" | "error";

export function AppLinkBridge() {
  const [state, setState] = useState<State>("checking");

  useEffect(() => {
    const w = window as WriteAppWindow;
    const bridge = w.__WRITE_APP__ === true ? w.webkit?.messageHandlers?.writeApp : undefined;
    if (!bridge) {
      setState("browser");
      return;
    }
    setState("linking");
    mintAppTokenAction(w.__WRITE_DEVICE__ ?? "this Mac")
      .then((result) => {
        if ("error" in result) {
          setState("error");
          return;
        }
        bridge.postMessage({
          action: "linked",
          token: result.token,
          origin: result.origin,
        });
        setState("linked");
      })
      .catch(() => setState("error"));
  }, []);

  return (
    <div className="applecms connect-shell">
      <main className="connect-main" style={{ textAlign: "center" }}>
        {state === "browser" ? (
          <>
            <h1 className="connect-title">Open the Texttext app</h1>
            <p className="connect-lede">
              This page connects the Texttext desktop app to your account. Open
              Texttext on your Mac and sign in there.
            </p>
          </>
        ) : state === "error" ? (
          <>
            <h1 className="connect-title">Could not connect</h1>
            <p className="connect-lede">
              Something went wrong linking this Mac. Try opening Texttext again.
            </p>
          </>
        ) : (
          <>
            <h1 className="connect-title">
              {state === "linked" ? "Connected" : "Connecting your Mac"}
            </h1>
            <p className="connect-lede">
              {state === "linked"
                ? "Opening your workspace."
                : "Linking this Mac to your account."}
            </p>
          </>
        )}
      </main>
    </div>
  );
}
