"use client";

// Runs inside the TextText desktop app's web view after sign-in. It mints a sync
// token for the signed-in account and hands it to the native app over the
// WKScriptMessageHandler bridge (window.webkit.messageHandlers.textTextApp), then
// the app takes over: it stores the token, starts folder sync, and loads the
// workspace. In a normal browser (no bridge) it just points people at the app.

import { useEffect, useState } from "react";
import { mintAppTokenAction } from "@/app/connect/app/actions";

type TextTextAppWindow = typeof window & {
  __TEXTTEXT_APP__?: boolean;
  __TEXTTEXT_DEVICE__?: string;
  webkit?: {
    messageHandlers?: {
      textTextApp?: { postMessage: (message: unknown) => void };
    };
  };
};

type State = "checking" | "linking" | "linked" | "browser" | "error";

export function AppLinkBridge() {
  const [state, setState] = useState<State>("checking");

  useEffect(() => {
    const w = window as TextTextAppWindow;
    const bridge = w.__TEXTTEXT_APP__ === true ? w.webkit?.messageHandlers?.textTextApp : undefined;
    if (!bridge) {
      setState("browser");
      return;
    }
    setState("linking");
    mintAppTokenAction(w.__TEXTTEXT_DEVICE__ ?? "this Mac")
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
            <h1 className="connect-title">Open the TextText app</h1>
            <p className="connect-lede">
              This page connects the TextText desktop app to your account. Open
              TextText on your Mac and sign in there.
            </p>
          </>
        ) : state === "error" ? (
          <>
            <h1 className="connect-title">Could not connect</h1>
            <p className="connect-lede">
              Something went wrong linking this Mac. Try opening TextText again.
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
