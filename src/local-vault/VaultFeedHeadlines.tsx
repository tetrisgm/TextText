import { useEffect, useMemo, useState, type ReactNode } from "react";
import { vaultRequest } from "./bridge";
import type { FolderPreview } from "./folder-collection";

type Headline = { externalKey: string; title: string; permalink: string | null; publishedAt: string | null; excerpt: string | null; imageUrl: string | null };
type FeedPage = { entries: Headline[] };
type Story = Headline & { source: string; feedURL: string };

function age(value: string): string {
  const elapsed = Math.max(0, Date.now() - Date.parse(value));
  if (!Number.isFinite(elapsed)) return "";
  const hours = Math.floor(elapsed / 3_600_000);
  return hours < 1 ? "now" : hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

/** The index is read only and transient. Opening Feeds reads each source once;
 * a timer never polls, and stories become TextPacks only when a person keeps one. */
export function VaultFeedHeadlines({ sources, ready, sourceList }: { sources: FolderPreview[]; ready: boolean; sourceList: ReactNode }) {
  const [tab, setTab] = useState<"headlines" | "sources">("headlines");
  const [stories, setStories] = useState<Story[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const feedKey = useMemo(() => sources.map(source => {
    const fields = source.document?.content.fields;
    return fields?.texttextFeedSubscription === "v1" && typeof fields.feedUrl === "string" ? `${fields.feedUrl}\t${source.title}` : "";
  }).filter(Boolean).slice(0, 8).join("\n"), [sources]);
  useEffect(() => {
    if (!ready || !feedKey) return;
    const controller = new AbortController();
    let active = true;
    void Promise.resolve().then(async () => {
      setLoading(true); setError("");
      const next: Story[] = [];
      const failures: string[] = [];
      for (const line of feedKey.split("\n")) {
        if (!active) return;
        const [feedURL, source] = line.split("\t");
        try {
          const page = await vaultRequest<FeedPage>("feedRead", { feedURL }, controller.signal);
          next.push(...page.entries.slice(0, 12).map(entry => ({ ...entry, source, feedURL })));
        } catch (reason) {
          if (!controller.signal.aborted) failures.push(reason instanceof Error ? reason.message : "A source could not be read.");
        }
      }
      if (!active) return;
      next.sort((a, b) => Date.parse(b.publishedAt || "") - Date.parse(a.publishedAt || ""));
      setStories(next.slice(0, 60)); setError(failures[0] || ""); setLoading(false);
    });
    return () => { active = false; controller.abort(); };
  }, [feedKey, ready]);
  return <section className="vault-feed-home" aria-label="Latest stories">
    <nav aria-label="Feed sections"><button aria-pressed={tab === "headlines"} onClick={() => setTab("headlines")}>For You</button><button aria-pressed={tab === "sources"} onClick={() => setTab("sources")}>Sources</button></nav>
    {tab === "sources" ? sourceList : <>
      {loading && <p role="status">Reading your sources…</p>}
      {error && <p role="status">{error}</p>}
      {!loading && !stories.length && <p>Your sources have no stories to show yet.</p>}
      <ol>{stories.map((story, index) => <li className={story.imageUrl && index % 5 === 4 ? "vault-feed-featured" : ""} key={`${story.feedURL}:${story.externalKey}`}>
        {story.imageUrl && index % 5 === 4 && /* eslint-disable-next-line @next/next/no-img-element */ <img className="vault-feed-lead" src={story.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = "none"; }} />}
        <div className="vault-feed-story">
        <div>
        <span className="vault-feed-publisher"><span aria-hidden="true">{story.source.slice(0, 1).toUpperCase()}</span>{story.source}{story.publishedAt && <time dateTime={story.publishedAt}>{age(story.publishedAt)}</time>}</span>
        {story.permalink ? <a href={story.permalink} target="_blank" rel="noopener noreferrer">{story.title}</a> : <strong>{story.title}</strong>}
        {story.excerpt && <p>{story.excerpt}</p>}
        </div>
        {story.imageUrl && index % 5 !== 4 && /* eslint-disable-next-line @next/next/no-img-element */ <img className="vault-feed-thumb" src={story.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = "none"; }} />}
        </div>
      </li>)}</ol>
    </>}
  </section>;
}
