"use client";

// The interactive face of a poll node. Renders the ballot from the document's
// own options rows, hydrates the live tally from /api/respond, records one
// response per reader, and shows proportional result bars once the reader has
// voted or the poll has closed. When the page is not a published public post
// (editor preview, template gallery, render gates) the tally endpoint 404s
// and the widget stays a quiet static ballot.

import { useCallback, useEffect, useMemo, useState } from "react";

type Aggregate = {
  open: boolean;
  multiple: boolean;
  labels: string[];
  total: number;
  counts: Record<string, number>;
  viewer: string[] | null;
};

type Props = {
  postId: string;
  fieldId: string;
  labels: string[];
  multiple: boolean;
  closed: boolean;
};

export function PollWidget({ postId, fieldId, labels, multiple, closed }: Props) {
  const [aggregate, setAggregate] = useState<Aggregate | null>(null);
  const [live, setLive] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const endpoint = useMemo(
    () =>
      `/api/respond?post=${encodeURIComponent(postId)}&field=${encodeURIComponent(fieldId)}`,
    [postId, fieldId],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(endpoint, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as Aggregate;
        if (cancelled) return;
        setAggregate(data);
        setLive(true);
        if (data.viewer && data.viewer.length > 0) setPicked(data.viewer);
      } catch {
        // Stay a static ballot when the tally is unreachable.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [endpoint]);

  const submit = useCallback(
    async (values: string[]) => {
      setPending(true);
      setNotice(null);
      try {
        const res = await fetch("/api/respond", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ post: postId, field: fieldId, values }),
        });
        const data = (await res.json()) as Aggregate & { error?: string };
        if (!res.ok) {
          setNotice(data.error ?? "Your response was not recorded.");
          return;
        }
        setAggregate(data);
        setPicked(data.viewer ?? values);
      } catch {
        setNotice("Your response was not recorded.");
      } finally {
        setPending(false);
      }
    },
    [postId, fieldId],
  );

  const effectiveLabels = aggregate?.labels ?? labels;
  if (effectiveLabels.length === 0) return null;
  const isOpen = aggregate ? aggregate.open : !closed;
  const voted = (aggregate?.viewer?.length ?? 0) > 0;
  const showResults = voted || !isOpen;
  const total = aggregate?.total ?? 0;

  const toggle = (label: string) => {
    if (!live || pending || !isOpen) return;
    if (!multiple) {
      void submit([label]);
      return;
    }
    setPicked((current) =>
      current.includes(label)
        ? current.filter((entry) => entry !== label)
        : [...current, label],
    );
  };

  return (
    <div className="tt-poll" data-open={isOpen ? "true" : "false"}>
      <ul className="tt-poll-options">
        {effectiveLabels.map((label) => {
          const countValue = aggregate?.counts[label] ?? 0;
          const share = total > 0 ? countValue / total : 0;
          const chosen = showResults
            ? (aggregate?.viewer ?? []).includes(label)
            : picked.includes(label);
          return (
            <li key={label}>
              <button
                type="button"
                className="tt-poll-option"
                data-chosen={chosen ? "true" : undefined}
                disabled={!live || pending || !isOpen}
                onClick={() => toggle(label)}
              >
                {showResults ? (
                  <span
                    className="tt-poll-fill"
                    style={{ width: `${Math.round(share * 100)}%` }}
                    aria-hidden="true"
                  />
                ) : null}
                <span className="tt-poll-label">
                  <span className="tt-poll-mark" aria-hidden="true">
                    {chosen ? "●" : "○"}
                  </span>
                  {label}
                </span>
                {showResults ? (
                  <span className="tt-poll-count">
                    {countValue}
                    {total > 0 ? ` · ${Math.round(share * 100)}%` : ""}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="tt-poll-footer">
        {multiple && isOpen && !showResults ? (
          <button
            type="button"
            className="tt-poll-submit"
            disabled={!live || pending || picked.length === 0}
            onClick={() => void submit(picked)}
          >
            Vote
          </button>
        ) : null}
        <span className="tt-poll-meta">
          {!isOpen
            ? `Closed · ${total} ${total === 1 ? "response" : "responses"}`
            : showResults
              ? `${total} ${total === 1 ? "response" : "responses"} · tap to change yours`
              : live
                ? multiple
                  ? "Pick any that apply"
                  : "Pick one"
                : ""}
        </span>
        {notice ? <span className="tt-poll-notice">{notice}</span> : null}
      </div>
    </div>
  );
}
