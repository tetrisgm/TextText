import { useEffect, useMemo, useState, type ReactNode } from "react";
import { DocumentRenderer } from "@/components/document/DocumentRenderer";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import type { NormalizedEntry } from "@/lib/reading/feed-parse";
import { BUILTIN_TEMPLATES } from "@/lib/presentation/templates";
import { vaultRequest } from "./bridge";
import { createFeedSubscriptionPack, createKeptFeedEntryPack } from "@/lib/vault/rss";
import { encodeBase64 } from "./image-import";
import type { FolderPreview } from "./folder-collection";

type Headline = { externalKey: string; title: string; permalink: string | null; publishedAt: string | null; excerpt: string | null; imageUrl: string | null };
type FeedPage = { entries: Headline[] };
type Story = Headline & { source: string; feedURL: string; topic: string | null };
type SourceRow = { source: string; feedURL: string; topic: string | null };
type FullEntry = { feedURL: string; feedTitle: string; entry: NormalizedEntry };
const storyTemplate = BUILTIN_TEMPLATES.find(template => template.id === "texttext.article");
const RECOMMENDED = [
  { title: "The Verge", topic: "Technology", feedURL: "https://www.theverge.com/rss/index.xml", siteUrl: "https://www.theverge.com" },
  { title: "Ars Technica", topic: "Technology", feedURL: "https://feeds.arstechnica.com/arstechnica/index", siteUrl: "https://arstechnica.com" },
  { title: "Quanta Magazine", topic: "Science", feedURL: "https://www.quantamagazine.org/feed/", siteUrl: "https://www.quantamagazine.org" },
  { title: "Dezeen", topic: "Design", feedURL: "https://www.dezeen.com/feed/", siteUrl: "https://www.dezeen.com" },
  { title: "BBC News: World", topic: "World", feedURL: "https://feeds.bbci.co.uk/news/world/rss.xml", siteUrl: "https://www.bbc.com/news/world" },
  { title: "Polygon", topic: "Gaming", feedURL: "https://www.polygon.com/rss/index.xml", siteUrl: "https://www.polygon.com" },
] as const;

function age(value: string): string {
  const elapsed = Math.max(0, Date.now() - Date.parse(value));
  if (!Number.isFinite(elapsed)) return "";
  const hours = Math.floor(elapsed / 3_600_000);
  return hours < 1 ? "now" : hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}
function storyDate(value: string | null): string | undefined {
  if (!value || !Number.isFinite(Date.parse(value))) return undefined;
  return new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

/** The index is read only and transient. Opening Feeds reads each source once;
 * a timer never polls, and stories become TextPacks only when a person keeps one. */
export function VaultFeedHeadlines({ sources, ready, sourceList, canAdd }: { sources: FolderPreview[]; ready: boolean; sourceList: ReactNode; canAdd: boolean }) {
  const [tab, setTab] = useState("For You");
  const [stories, setStories] = useState<Story[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [following, setFollowing] = useState("");
  const [followError, setFollowError] = useState("");
  const [active, setActive] = useState<Story | null>(null);
  const [full, setFull] = useState<{ key: string; value: FullEntry } | null>(null);
  const [storyError, setStoryError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<Set<string>>(() => new Set());
  const feedKey = useMemo(() => JSON.stringify(sources.map(source => {
    const fields = source.document?.content.fields;
    return fields?.texttextFeedSubscription === "v1" && typeof fields.feedUrl === "string"
      ? { feedURL: fields.feedUrl, source: source.title, topic: source.document?.content.tags[0] || null } : null;
  }).filter((row): row is SourceRow => row !== null).slice(0, 8)), [sources]);
  const sourceRows = useMemo(() => JSON.parse(feedKey) as SourceRow[], [feedKey]);
  const topics = [...new Set(sourceRows.map(row => row.topic).filter((topic): topic is string => Boolean(topic)))];
  const hasFeeds = sourceRows.length > 0;
  useEffect(() => {
    if (!ready || !hasFeeds) { setStories([]); return; }
    const controller = new AbortController();
    let active = true;
    void Promise.resolve().then(async () => {
      setLoading(true); setError("");
      const next: Story[] = [];
      const failures: string[] = [];
      for (const { feedURL, source, topic } of sourceRows) {
        if (!active) return;
        try {
          const page = await vaultRequest<FeedPage>("feedRead", { feedURL }, controller.signal);
          next.push(...page.entries.slice(0, 12).map(entry => ({ ...entry, source, feedURL, topic })));
        } catch (reason) {
          if (!controller.signal.aborted) failures.push(reason instanceof Error ? reason.message : "A source could not be read.");
        }
      }
      if (!active) return;
      next.sort((a, b) => Date.parse(b.publishedAt || "") - Date.parse(a.publishedAt || ""));
      setStories(next.slice(0, 60)); setError(failures[0] || ""); setLoading(false);
    });
    return () => { active = false; controller.abort(); };
  }, [feedKey, ready, hasFeeds, sourceRows]);
  const activeKey = active ? `${active.feedURL}\n${active.externalKey}` : "";
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const { feedURL, externalKey } = active;
    Promise.resolve().then(() => { setStoryError(""); setFull(null); });
    void vaultRequest<FullEntry>("feedEntry", { feedURL, externalKey }, controller.signal)
      .then(value => {
        if (value.feedURL !== feedURL || value.entry?.externalKey !== externalKey) throw new Error("This story no longer matches the selected feed entry. Refresh Feeds and try again.");
        if (!controller.signal.aborted) setFull({ key: `${feedURL}\n${externalKey}`, value });
      })
      .catch(reason => { if (!controller.signal.aborted) setStoryError(reason instanceof Error ? reason.message : "This story could not be opened."); });
    return () => controller.abort();
  }, [activeKey]);
  const saveStory = async () => {
    if (!active || !full || full.key !== activeKey || saving || saved.has(activeKey) || !canAdd) return;
    setSaving(true); setStoryError("");
    try {
      const pack = await createKeptFeedEntryPack(full.value, "bookmark");
      await vaultRequest("importPack", { title: pack.title, folder: "Bookmarks", data: encodeBase64(pack.bytes) });
      setSaved(previous => new Set(previous).add(activeKey));
      window.dispatchEvent(new Event("texttext:vault-changed"));
    } catch (reason) { setStoryError(reason instanceof Error ? reason.message : "This story could not be saved."); }
    finally { setSaving(false); }
  };
  const follow = async (source: typeof RECOMMENDED[number]) => {
    if (!canAdd || following) return;
    setFollowing(source.title); setFollowError("");
    try {
      const pack = createFeedSubscriptionPack({ feedURL: source.feedURL, title: source.title, siteUrl: source.siteUrl, description: null, format: "rss", topic: source.topic });
      await vaultRequest("importPack", { title: pack.title, folder: "Feeds", data: encodeBase64(pack.bytes) });
      window.dispatchEvent(new Event("texttext:vault-changed"));
    } catch (reason) { setFollowError(reason instanceof Error ? reason.message : "This source could not be added."); }
    finally { setFollowing(""); }
  };
  const recommendations = <div className="vault-feed-recommendations"><h2>Choose your sources</h2><p>Follow publishers to build your news feed. Stories load when you open Feeds.</p>
    {followError && <p role="alert">{followError}</p>}
    <ul>{RECOMMENDED.map(source => <li key={source.feedURL}><span><strong>{source.title}</strong><small>{source.topic}</small></span><button disabled={!canAdd || Boolean(following)} onClick={() => void follow(source)}>{following === source.title ? "Adding…" : "Follow"}</button></li>)}</ul>
  </div>;
  const visibleStories = tab === "For You" ? stories : stories.filter(story => story.topic === tab);
  const activeFull = full?.key === activeKey ? full.value : null;
  const readerDocument = activeFull && storyTemplate ? (() => {
    const document = emptyDocumentSnapshot({ id: storyTemplate.id, version: storyTemplate.version });
    document.content.title = activeFull.entry.title;
    document.content.body = activeFull.entry.bodyMarkdown || activeFull.entry.excerpt || "";
    document.content.fields = activeFull.entry.permalink ? { sourceUrl: activeFull.entry.permalink } : {};
    return document;
  })() : null;
  if (active) return <section className="vault-feed-reader" aria-label="Feed story">
    <header><button type="button" onClick={() => setActive(null)}>‹ Back to Feeds</button><span>{active.source}</span></header>
    {storyError && <p role="alert">{storyError}</p>}
    {!activeFull && !storyError && <p role="status">Opening story…</p>}
    {activeFull && readerDocument && storyTemplate && <><div className="vault-feed-reader-content"><DocumentRenderer document={readerDocument} template={storyTemplate} metadata={{ author: active.source, date: storyDate(activeFull.entry.publishedAt) }} />
      {activeFull.entry.availability !== "full" && <p className="vault-feed-reader-availability">{activeFull.entry.availability === "excerpt" ? "This source provided an excerpt." : "This source provided only story details."}</p>}</div>
      <footer><button type="button" disabled={!canAdd || saving || saved.has(activeKey)} onClick={() => void saveStory()}>{saving ? "Saving…" : saved.has(activeKey) ? "Saved to Bookmarks" : "Save to Bookmarks"}</button>{activeFull.entry.permalink && <a href={activeFull.entry.permalink} target="_blank" rel="noopener noreferrer">Open original</a>}</footer></>}
  </section>;
  return <section className="vault-feed-home" aria-label="Latest stories">
    <nav aria-label="Feed sections"><button aria-pressed={tab === "For You"} onClick={() => setTab("For You")}>For You</button>{topics.map(topic => <button key={topic} aria-pressed={tab === topic} onClick={() => setTab(topic)}>{topic.slice(0, 1).toUpperCase() + topic.slice(1)}</button>)}<button aria-pressed={tab === "Sources"} onClick={() => setTab("Sources")}>Sources</button></nav>
    {tab === "Sources" ? <>{sourceList}{ready && !hasFeeds && recommendations}</> : <>
      {loading && <p role="status">Reading your sources…</p>}
      {error && <p role="status">{error}</p>}
      {!loading && !visibleStories.length && (ready && !hasFeeds ? recommendations : <p>Your sources have no stories to show yet.</p>)}
      <ol>{visibleStories.map((story, index) => <li className={story.imageUrl && index % 5 === 4 ? "vault-feed-featured" : ""} key={`${story.feedURL}:${story.externalKey}`}>
        {story.imageUrl && index % 5 === 4 && /* eslint-disable-next-line @next/next/no-img-element */ <img className="vault-feed-lead" src={story.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = "none"; }} />}
        <div className="vault-feed-story">
        <div>
        <span className="vault-feed-publisher"><span aria-hidden="true">{story.source.slice(0, 1).toUpperCase()}</span>{story.source}{story.publishedAt && <time dateTime={story.publishedAt}>{age(story.publishedAt)}</time>}</span>
        <button type="button" className="vault-feed-headline" onClick={() => setActive(story)}>{story.title}</button>
        {story.excerpt && <p>{story.excerpt}</p>}
        </div>
        {story.imageUrl && index % 5 !== 4 && /* eslint-disable-next-line @next/next/no-img-element */ <img className="vault-feed-thumb" src={story.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = "none"; }} />}
        </div>
      </li>)}</ol>
    </>}
  </section>;
}
