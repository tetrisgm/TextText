"use client";

import { useState } from "react";

type Stage = "idle" | "sending" | "done" | "failed";

export function ReportForm({ path, doc }: { path: string; doc: string }) {
  const [pageUrl, setPageUrl] = useState(path);
  const [reason, setReason] = useState("");
  const [email, setEmail] = useState("");
  // Honeypot: never shown to a person; bots that fill every field disqualify
  // themselves without a captcha punishing the humans.
  const [website, setWebsite] = useState("");
  const [stage, setStage] = useState<Stage>("idle");

  if (stage === "done") {
    return (
      <section>
        <h2>Report received</h2>
        <p>
          Thank you. A person will review it. If you left an email address, we
          will reply there when there is something to say.
        </p>
      </section>
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (stage === "sending") return;
    setStage("sending");
    try {
      const response = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: pageUrl,
          doc,
          reason,
          email: email.trim() || undefined,
          website,
        }),
      });
      setStage(response.ok ? "done" : "failed");
    } catch {
      setStage("failed");
    }
  };

  return (
    <form onSubmit={submit} className="texttext-report-form">
      <label>
        <span>Page being reported</span>
        <input
          type="text"
          value={pageUrl}
          onChange={(event) => setPageUrl(event.target.value)}
          placeholder="/t/handle/page"
          required
        />
      </label>
      <label>
        <span>What is wrong with it</span>
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={5}
          minLength={10}
          maxLength={2000}
          required
        />
      </label>
      <label>
        <span>Your email, only if you want a reply (optional)</span>
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      <div className="texttext-report-trap" aria-hidden="true">
        <label>
          Leave this empty
          <input
            type="text"
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
            tabIndex={-1}
            autoComplete="off"
          />
        </label>
      </div>
      {stage === "failed" ? (
        <p role="alert">
          That did not go through. Try again, or email{" "}
          <a href="mailto:security@TextText.app">security@TextText.app</a>.
        </p>
      ) : null}
      <button type="submit" disabled={stage === "sending"}>
        {stage === "sending" ? "Sending" : "Send report"}
      </button>
    </form>
  );
}
