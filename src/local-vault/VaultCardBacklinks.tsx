"use client";

import { useEffect, useRef, useState } from "react";
import { noteCardBacklinkExcerpt, noteCardHref } from "@/lib/note-card-links";
import { vaultRequest, type VaultFile } from "./bridge";

type Source = { path: string; title: string; excerpt: string };

export function VaultCardBacklinks({ itemId, onOpen }: { itemId: string; onOpen: (path: string) => void }) {
  const generation = useRef(0);
  useEffect(() => () => { generation.current += 1; }, []);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sources, setSources] = useState<Source[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState("");
  const load = async () => {
    const request = ++generation.current;
    if (open) { setOpen(false); setLoading(false); return; }
    const current = () => generation.current === request;
    setOpen(true);
    setLoading(true);
    setError("");
    try {
      const page = await vaultRequest<{ items: { path: string; title: string }[]; truncated?: boolean }>("search", { query: noteCardHref(itemId).slice(1) });
      if (!current()) return;
      const candidates = page.items.filter(item => item.path.startsWith("Notes/") && item.path.endsWith(".textpack"));
      const found: Source[] = [];
      for (let offset = 0; offset < candidates.length; offset += 4) {
        if (!current()) return;
        const batch = await Promise.allSettled(candidates.slice(offset, offset + 4).map(async item => {
          const file = await vaultRequest<VaultFile>("read", { path: item.path });
          const excerpt = noteCardBacklinkExcerpt(file.markdown, itemId);
          const content = file.documentJSON ? JSON.parse(file.documentJSON) as { content?: { title?: string } } : null;
          const title = content?.content?.title?.trim() || item.title.split("/").at(-1)?.replace(/\.textpack$/i, "") || "Untitled card";
          return excerpt ? { path: file.path, title, excerpt } : null;
        }));
        for (const result of batch) if (result.status === "fulfilled" && result.value) found.push(result.value);
      }
      if (!current()) return;
      setSources(found);
      setTruncated(Boolean(page.truncated));
    } catch (reason) { if (current()) setError(reason instanceof Error ? reason.message : "Linked cards could not be found."); }
    finally { if (current()) setLoading(false); }
  };
  return <div className="vault-card-backlinks">
    <button type="button" aria-expanded={open} onClick={() => void load()}>↶ {open ? "Hide links" : "Linked from"}</button>
    {open && <div className="vault-card-backlink-list" role="region" aria-label="Cards linking here">
      {loading ? <p>Finding linked cards…</p> : error ? <p role="alert">{error}</p> : <>
        {sources.length ? sources.map(source => <button type="button" key={source.path} onClick={() => onOpen(source.path)}><strong>{source.title}</strong><span>{source.excerpt}</span></button>) : <p>No cards link here yet.</p>}
        {truncated && <p>More cards may link here. Search was limited to the first results.</p>}
      </>}
    </div>}
  </div>;
}
