import type { Metadata } from "next";
import "@/styles/connect.css";

export const metadata: Metadata = { title: "TextText AI troubleshooting" };

export default function TroubleshootingPage() {
  return <div className="applecms connect-shell"><main className="connect-main connect-doc">
    <p className="connect-provider-kicker">Troubleshooting</p><h1 className="connect-title">When AI is not working</h1>
    <section className="connect-section"><h2 className="connect-section-title">The native option is unavailable</h2><p className="connect-body">The embedded agent requires the TextText Mac app and an executable Codex runtime. Update or install Codex, restart TextText, and use AI Settings to retry. Browser sessions should use external MCP or API-key mode.</p></section>
    <section className="connect-section"><h2 className="connect-section-title">The account is not connected</h2><p className="connect-body">Choose Connect again, finish the browser authorization, then wait for the account and plan status to appear. If the account is rate-limited, wait for the displayed reset time or use another configured provider.</p></section>
    <section className="connect-section"><h2 className="connect-section-title">The client has no tools</h2><p className="connect-body">Restart the client after installing the plugin. Confirm that it is using the TextText MCP URL and that the OAuth approval completed. Remove and reconnect the client from Connect if its authorization is stale.</p></section>
    <section className="connect-section"><h2 className="connect-section-title">A write failed</h2><p className="connect-body">Ask the agent to read the latest document and retry. TextText rejects stale writes to protect newer edits. For a destructive action, explicitly confirm it in the app.</p></section>
  </main></div>;
}
