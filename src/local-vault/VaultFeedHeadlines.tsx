import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DocumentRenderer } from "@/components/document/DocumentRenderer";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import type { NormalizedEntry } from "@/lib/reading/feed-parse";
import { BUILTIN_TEMPLATES } from "@/lib/presentation/templates";
import { vaultRequest } from "./bridge";
import { createFeedSubscriptionPack, createKeptFeedEntryPack, feedEntryHash } from "@/lib/vault/rss";
import { encodeBase64 } from "./image-import";
import type { FolderPreview } from "./folder-collection";
import { clusterFeedStories, rankFeedClusters, type FeedStory, type FeedCluster } from "./feed-clusters";

type Headline = { externalKey: string; title: string; permalink: string | null; publishedAt: string | null; excerpt: string | null; imageUrl: string | null };
type FeedPage = { entries: Headline[] };
type SourceRow = { source: string; feedURL: string; topic: string | null };
type FullEntry = { feedURL: string; feedTitle: string; entry: NormalizedEntry };
type KeptEntry = { hash: string; path: string; title: string; source: string; keptAt: string };
type KeptResponse = { hashes: string[]; entries: KeptEntry[] };
const storyTemplate = BUILTIN_TEMPLATES.find(template => template.id === "texttext.article");
const RECOMMENDED = [
  { title: "The Verge", topic: "Tech", feedURL: "https://www.theverge.com/rss/index.xml", siteUrl: "https://www.theverge.com" },
  { title: "Ars Technica", topic: "Tech", feedURL: "https://feeds.arstechnica.com/arstechnica/index", siteUrl: "https://arstechnica.com" },
  { title: "Wired", topic: "AI", feedURL: "https://www.wired.com/feed/rss", siteUrl: "https://www.wired.com" },
  { title: "TechCrunch", topic: "Startups", feedURL: "https://techcrunch.com/feed/", siteUrl: "https://techcrunch.com" },
  { title: "MIT Technology Review", topic: "AI", feedURL: "https://www.technologyreview.com/feed/", siteUrl: "https://www.technologyreview.com" },
  { title: "Hacker News: Front Page", topic: "Programming", feedURL: "https://hnrss.org/frontpage", siteUrl: "https://news.ycombinator.com" },
  { title: "Quanta Magazine", topic: "Science", feedURL: "https://www.quantamagazine.org/feed/", siteUrl: "https://www.quantamagazine.org" },
  { title: "Nature News", topic: "Science", feedURL: "https://www.nature.com/nature.rss", siteUrl: "https://www.nature.com" },
  { title: "NASA", topic: "Space", feedURL: "https://www.nasa.gov/news-release/feed/", siteUrl: "https://www.nasa.gov" },
  { title: "Dezeen", topic: "Design", feedURL: "https://www.dezeen.com/feed/", siteUrl: "https://www.dezeen.com" },
  { title: "ArchDaily", topic: "Architecture", feedURL: "https://www.archdaily.com/feed", siteUrl: "https://www.archdaily.com" },
  { title: "BBC News: World", topic: "World", feedURL: "https://feeds.bbci.co.uk/news/world/rss.xml", siteUrl: "https://www.bbc.com/news/world" },
  { title: "The Guardian: World", topic: "World", feedURL: "https://www.theguardian.com/world/rss", siteUrl: "https://www.theguardian.com/world" },
  { title: "NPR: News", topic: "World", feedURL: "https://feeds.npr.org/1001/rss.xml", siteUrl: "https://www.npr.org" },
  { title: "Polygon", topic: "Gaming", feedURL: "https://www.polygon.com/rss/index.xml", siteUrl: "https://www.polygon.com" },
  { title: "Rock Paper Shotgun", topic: "Gaming", feedURL: "https://www.rockpapershotgun.com/feed", siteUrl: "https://www.rockpapershotgun.com" },
  { title: "BBC News: U.S. & Canada", topic: "U.S.", feedURL: "https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml", siteUrl: "https://www.bbc.com/news/world/us_and_canada" },
  { title: "BBC News: Business", topic: "Business", feedURL: "https://feeds.bbci.co.uk/news/business/rss.xml", siteUrl: "https://www.bbc.com/news/business" },
  { title: "BBC News: Health", topic: "Health", feedURL: "https://feeds.bbci.co.uk/news/health/rss.xml", siteUrl: "https://www.bbc.com/news/health" },
  { title: "BBC News: Entertainment", topic: "Entertainment", feedURL: "https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml", siteUrl: "https://www.bbc.com/news/entertainment_and_arts" },
  { title: "The Guardian: Politics", topic: "Politics", feedURL: "https://www.theguardian.com/politics/rss", siteUrl: "https://www.theguardian.com/politics" },
  { title: "BBC Sport", topic: "Sports", feedURL: "https://feeds.bbci.co.uk/sport/rss.xml", siteUrl: "https://www.bbc.com/sport" },
  { title: "The Guardian: Environment", topic: "Environment", feedURL: "https://www.theguardian.com/environment/rss", siteUrl: "https://www.theguardian.com/environment" },
  { title: "The Guardian: Culture", topic: "Culture", feedURL: "https://www.theguardian.com/culture/rss", siteUrl: "https://www.theguardian.com/culture" },
  { title: "Eater", topic: "Food", feedURL: "https://www.eater.com/rss/index.xml", siteUrl: "https://www.eater.com" },
  { title: "The Guardian: Travel", topic: "Travel", feedURL: "https://www.theguardian.com/travel/rss", siteUrl: "https://www.theguardian.com/travel" },
  { title: "Pitchfork", topic: "Music", feedURL: "https://pitchfork.com/rss/news/", siteUrl: "https://pitchfork.com" },
] as const;
const INTEREST_GROUPS = [
  { title: "Most popular", topics: ["Tech", "World", "Business", "Science", "Sports"] },
  { title: "Technology", topics: ["AI", "Startups", "Programming", "Gaming", "Space"] },
  { title: "Lifestyle", topics: ["Health", "Food", "Travel", "Design", "Architecture"] },
  { title: "Culture and society", topics: ["Entertainment", "Culture", "Music", "U.S.", "Politics", "Environment"] },
] as const;
const MIN_INTERESTS = 10;

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
function sourceSummary(sources: string[]): string {
  return sources.length > 2 ? `${sources.slice(0, 2).join(", ")} +${sources.length - 2}` : sources.join(", ");
}

/** The index is read only and transient. Opening Feeds reads each source once;
 * a timer never polls, and stories become TextPacks only when a person keeps one. */
export function VaultFeedHeadlines({ sources, ready, sourceList, canAdd, canReadLater, canOpenBookmark, onOpenBookmark }: { sources: FolderPreview[]; ready: boolean; sourceList: ReactNode; canAdd: boolean; canReadLater: boolean; canOpenBookmark: boolean; onOpenBookmark: (path: string) => void }) {
  const [tab, setTab] = useState("For You");
  const [search, setSearch] = useState("");
  const [stories, setStories] = useState<FeedStory[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [following, setFollowing] = useState("");
  const [interests, setInterests] = useState<Set<string>>(() => new Set());
  const [followError, setFollowError] = useState("");
  const [active, setActive] = useState<FeedStory | null>(null);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [full, setFull] = useState<{ key: string; value: FullEntry } | null>(null);
  const [storyError, setStoryError] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<Set<string>>(() => new Set());
  const [keptHashes, setKeptHashes] = useState<Set<string> | null>(null);
  const [keptEntries, setKeptEntries] = useState<KeptEntry[]>([]);
  const [keptError, setKeptError] = useState("");
  const [sourceLimit, setSourceLimit] = useState(8);
  const cachedSources = useRef(new Map<string, FeedStory[]>());
  const feedKey = useMemo(() => JSON.stringify(sources.map(source => {
    const fields = source.document?.content.fields;
    return fields?.texttextFeedSubscription === "v1" && typeof fields.feedUrl === "string"
      ? { feedURL: fields.feedUrl, source: source.title, topic: source.document?.content.tags[0] || null } : null;
  }).filter((row): row is SourceRow => row !== null)), [sources]);
  const sourceRows = useMemo(() => JSON.parse(feedKey) as SourceRow[], [feedKey]);
  const topics = [...new Set(sourceRows.map(row => row.topic).filter((topic): topic is string => Boolean(topic)))];
  const hasFeeds = sourceRows.length > 0;
  useEffect(() => {
    if (!canReadLater || !ready) return;
    let active = true;
    void vaultRequest<KeptResponse>("keptFeedEntries").then(value => {
      if (active) { setKeptHashes(new Set(value.hashes)); setKeptEntries(value.entries); setKeptError(""); }
    }).catch(reason => { if (active) setKeptError(reason instanceof Error ? reason.message : "Saved stories could not be checked."); });
    return () => { active = false; };
  }, [canReadLater, ready]);
  useEffect(() => {
    if (!ready || !hasFeeds) { setStories([]); return; }
    const controller = new AbortController();
    let active = true;
    void Promise.resolve().then(async () => {
      setLoading(true); setError("");
      const next: FeedStory[] = [];
      const failures: string[] = [];
      for (const { feedURL, source, topic } of sourceRows.slice(0, sourceLimit)) {
        if (!active) return;
        const cacheKey = JSON.stringify([feedURL, source, topic]);
        if (cachedSources.current.has(cacheKey)) continue;
        try {
          const page = await vaultRequest<FeedPage>("feedRead", { feedURL }, controller.signal);
          cachedSources.current.set(cacheKey, page.entries.slice(0, 12).map(entry => ({ ...entry, source, feedURL, topic })));
          while (cachedSources.current.size > 32) cachedSources.current.delete(cachedSources.current.keys().next().value!);
        } catch (reason) {
          if (!controller.signal.aborted) failures.push(reason instanceof Error ? reason.message : "A source could not be read.");
        }
      }
      if (!active) return;
      const batches = sourceRows.slice(0, sourceLimit).map(({ feedURL, source, topic }) => cachedSources.current.get(JSON.stringify([feedURL, source, topic])) || []);
      for (let index = 0; index < 12 && next.length < 240; index++) {
        for (const batch of batches) if (batch[index] && next.length < 240) next.push(batch[index]);
      }
      next.sort((a, b) => Date.parse(b.publishedAt || "") - Date.parse(a.publishedAt || ""));
      setStories(next); setError(failures[0] || ""); setLoading(false);
    });
    return () => { active = false; controller.abort(); };
  }, [feedKey, ready, hasFeeds, sourceRows, sourceLimit]);
  const activeKey = active ? `${active.feedURL}\n${active.externalKey}` : "";
  useEffect(() => {
    if (!keptHashes?.size || !stories.length) return;
    let current = true;
    void Promise.all(stories.map(async story => ({ key: `${story.feedURL}\n${story.externalKey}`, hash: await feedEntryHash(story.feedURL, story.externalKey) })))
      .then(rows => { if (current) setSaved(previous => new Set([...previous, ...rows.filter(row => keptHashes.has(row.hash)).map(row => row.key)])); })
      .catch(reason => { if (current) setKeptError(reason instanceof Error ? reason.message : "Saved stories could not be matched."); });
    return () => { current = false; };
  }, [stories, keptHashes]);
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
  const saveStory = async (story: FeedStory) => {
    const key = `${story.feedURL}\n${story.externalKey}`;
    if (saving || saved.has(key) || !canAdd) return;
    setSaving(key);
    if (activeKey === key) setStoryError(""); else setError("");
    try {
      const hash = await feedEntryHash(story.feedURL, story.externalKey);
      const existing = await vaultRequest<KeptResponse>("keptFeedEntries");
      setKeptHashes(new Set(existing.hashes));
      setKeptEntries(existing.entries);
      if (existing.hashes.includes(hash)) { setSaved(previous => new Set(previous).add(key)); return; }
      const entry = full?.key === key ? full.value : await vaultRequest<FullEntry>("feedEntry", { feedURL: story.feedURL, externalKey: story.externalKey });
      if (entry.feedURL !== story.feedURL || entry.entry?.externalKey !== story.externalKey) throw new Error("This story no longer matches the selected feed entry. Refresh Feeds and try again.");
      const pack = await createKeptFeedEntryPack(entry, "bookmark");
      const imported = await vaultRequest<{ path: string }>("importPack", { title: pack.title, folder: "Bookmarks", data: encodeBase64(pack.bytes) });
      setKeptHashes(previous => new Set([...(previous ?? []), hash]));
      setKeptEntries(previous => [{ hash, path: imported.path, title: pack.title, source: entry.feedTitle, keptAt: new Date().toISOString() }, ...previous.filter(savedEntry => savedEntry.hash !== hash)]);
      setSaved(previous => new Set(previous).add(key));
      window.dispatchEvent(new Event("texttext:vault-changed"));
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "This story could not be saved.";
      if (activeKey === key) setStoryError(message); else setError(message);
    } finally { setSaving(null); }
  };
  const readLaterAction = (story: FeedStory) => {
    const key = `${story.feedURL}\n${story.externalKey}`;
    const kept = saved.has(key);
    return <button type="button" className="vault-feed-read-later" aria-label={`${kept ? "Saved" : "Read later"}: ${story.title}`}
      disabled={!canAdd || Boolean(saving) || kept} onClick={() => void saveStory(story)}>
      <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true" fill={kept ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"><path d="M5 3h10v14l-5-3.4L5 17z" /></svg>
      {saving === key ? "Saving…" : kept ? "Saved" : "Read later"}
    </button>;
  };
  const followInterests = async () => {
    if (!canAdd || following || interests.size < MIN_INTERESTS) return;
    const chosen = RECOMMENDED.filter(source => interests.has(source.topic) && !sourceRows.some(row => row.feedURL === source.feedURL));
    setFollowing("selected interests"); setFollowError("");
    let added = 0;
    try {
      for (const source of chosen) {
        const pack = createFeedSubscriptionPack({ feedURL: source.feedURL, title: source.title, siteUrl: source.siteUrl, description: null, format: "rss", topic: source.topic });
        await vaultRequest("importPack", { title: pack.title, folder: "Feeds", data: encodeBase64(pack.bytes) });
        added++;
      }
    } catch (reason) { setFollowError(`${added} of ${chosen.length} sources added. ${reason instanceof Error ? reason.message : "A source could not be added."}`); }
    finally { if (added) window.dispatchEvent(new Event("texttext:vault-changed")); setFollowing(""); }
  };
  const recommendations = <div className="vault-feed-recommendations"><h2>Personalize your feed</h2><p>Choose at least ten topics. You can add individual sources later.</p>
    <div role="group" aria-label="News interests">{INTEREST_GROUPS.map(group => <section className="vault-feed-interest-group" key={group.title}><h3>{group.title}</h3><div className="vault-feed-interests">{group.topics.map(topic => <button key={topic} type="button" aria-pressed={interests.has(topic)} disabled={!canAdd || Boolean(following)} onClick={() => setInterests(current => {
      const next = new Set(current);
      if (next.has(topic)) next.delete(topic); else next.add(topic);
      return next;
    })}><strong>{topic}</strong></button>)}</div></section>)}</div>
    <p className="vault-feed-interest-count" role="status">{interests.size} of {MIN_INTERESTS} topics selected</p>
    <button type="button" className="vault-feed-continue" disabled={!canAdd || interests.size < MIN_INTERESTS || Boolean(following)} onClick={() => void followInterests()}>{following ? "Adding sources…" : `Continue with ${interests.size} ${interests.size === 1 ? "topic" : "topics"}`}</button>
    {followError && <p role="alert">{followError}</p>}
  </div>;
  const query = search.trim().toLocaleLowerCase();
  const visibleKept = keptEntries.filter(entry => !query || [entry.title, entry.source].some(value => value.toLocaleLowerCase().includes(query)));
  const matchesStory = (story: FeedStory) => !query || [story.title, story.source, story.excerpt, story.topic].some(value => value?.toLocaleLowerCase().includes(query));
  const visibleStories = (tab === "Latest" ? stories : stories.filter(story => story.topic === tab)).filter(matchesStory);
  const coverage = useMemo(() => clusterFeedStories(stories), [stories]);
  const rankedCoverage = rankFeedClusters(coverage, Date.now());
  const visibleCoverage = coverage.filter(group => !query || group.headline.toLocaleLowerCase().includes(query) || group.members.some(matchesStory));
  const visibleRankedCoverage = rankedCoverage.filter(group => !query || group.headline.toLocaleLowerCase().includes(query) || group.members.some(matchesStory));
  const rankedLeadIndex = visibleRankedCoverage.findIndex(group => Boolean(group.imageUrl));
  const latestLeadIndex = visibleStories.findIndex(story => Boolean(story.imageUrl));
  const activeGroup: FeedCluster | undefined = coverage.find(group => group.id === activeGroupId);
  const activeFull = full?.key === activeKey ? full.value : null;
  const readerDocument = activeFull && storyTemplate ? (() => {
    const document = emptyDocumentSnapshot({ id: storyTemplate.id, version: storyTemplate.version });
    document.content.title = activeFull.entry.title;
    document.content.body = activeFull.entry.bodyMarkdown || activeFull.entry.excerpt || "";
    document.content.fields = activeFull.entry.permalink ? { sourceUrl: activeFull.entry.permalink } : {};
    return document;
  })() : null;
  if (!ready) return <section className="vault-feed-home" aria-label="Latest stories"><p role="status">Reading feed subscriptions…</p></section>;
  if (!hasFeeds && !keptEntries.length) return <section className="vault-feed-home vault-feed-onboarding" aria-label="News interests">{recommendations}</section>;
  if (active) return <section className="vault-feed-reader" aria-label="Feed story">
    <header><button type="button" onClick={() => setActive(null)}>‹ Back to {activeGroup ? "coverage" : "Feeds"}</button><span>{active.source}</span></header>
    {storyError && <p role="alert">{storyError}</p>}
    {!activeFull && !storyError && <p role="status">Opening story…</p>}
    {activeFull && readerDocument && storyTemplate && <><div className="vault-feed-reader-content"><DocumentRenderer document={readerDocument} template={storyTemplate} metadata={{ author: active.source, date: storyDate(activeFull.entry.publishedAt) }} />
      {activeFull.entry.availability !== "full" && <p className="vault-feed-reader-availability">{activeFull.entry.availability === "excerpt" ? "This source provided an excerpt." : "This source provided only story details."}</p>}</div>
      <footer><button type="button" disabled={!canAdd || Boolean(saving) || saved.has(activeKey)} onClick={() => void saveStory(active)}>{saving === activeKey ? "Saving…" : saved.has(activeKey) ? "Saved to Bookmarks" : "Save to Bookmarks"}</button>{activeFull.entry.permalink && <a href={activeFull.entry.permalink} target="_blank" rel="noopener noreferrer">Open original</a>}</footer></>}
  </section>;
  if (activeGroup) return <section className="vault-feed-coverage" aria-label="Headline coverage">
    <header><button type="button" onClick={() => setActiveGroupId(null)}>‹ {tab === "Headlines" ? "Headlines" : "For You"}</button></header>
    <h1>{activeGroup.headline}</h1>
    <p>{activeGroup.members.length} {activeGroup.members.length === 1 ? "article" : "articles"} · {activeGroup.sources.join(", ")}</p>
    {activeGroup.imageUrl && /* eslint-disable-next-line @next/next/no-img-element */ <img className="vault-feed-coverage-image" src={activeGroup.imageUrl} alt="" referrerPolicy="no-referrer" />}
    <ol>{activeGroup.members.map(member => <li key={`${member.feedURL}:${member.externalKey}`}><span className="vault-feed-publisher">{member.source}{member.publishedAt && <time dateTime={member.publishedAt}>{age(member.publishedAt)}</time>}</span>
      <button type="button" onClick={() => setActive(member)}>{member.title}</button>
      {member.excerpt && <p>{member.excerpt}</p>}
    </li>)}</ol>
  </section>;
  return <section className="vault-feed-home" aria-label="Latest stories">
    {keptError && <p role="alert">Saved stories could not be checked: {keptError}</p>}
    {tab !== "Sources" && <label className="vault-feed-search"><svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4.5 4.5" /></svg><input type="search" aria-label={tab === "Read Later" ? "Search saved stories" : "Search loaded stories"} placeholder={tab === "Read Later" ? "Search saved stories" : "Search loaded stories"} value={search} onChange={event => setSearch(event.target.value)} /></label>}
    <nav className="vault-feed-topics" aria-label="News topics"><button aria-pressed={tab === "For You"} onClick={() => setTab("For You")}>For You</button>{topics.map(topic => <button key={topic} aria-pressed={tab === topic} onClick={() => setTab(topic)}>{topic.slice(0, 1).toUpperCase() + topic.slice(1)}</button>)}</nav>
    <nav className="vault-feed-sections" aria-label="Feed sections"><button aria-pressed={tab === "Headlines"} onClick={() => setTab("Headlines")}>Headlines</button><button aria-pressed={tab === "Latest"} onClick={() => setTab("Latest")}>Latest</button>{canReadLater && <button aria-pressed={tab === "Read Later"} onClick={() => setTab("Read Later")}>Read Later</button>}<button aria-pressed={tab === "Sources"} onClick={() => setTab("Sources")}>Sources</button></nav>
    {sourceRows.length > 8 && !["Sources", "Read Later"].includes(tab) && <div className="vault-feed-source-window"><span>Reading {Math.min(sourceLimit, sourceRows.length)} of {sourceRows.length} sources</span>{sourceLimit < sourceRows.length && <button type="button" disabled={loading} onClick={() => setSourceLimit(limit => limit + 8)}>Load more sources</button>}</div>}
    {tab === "Read Later" ? <><h2 className="vault-feed-headlines-title">Read Later</h2>{!keptHashes && !keptError && <p role="status">Reading saved stories…</p>}{keptHashes && !visibleKept.length && <p>{query ? "No saved stories match this search." : "Stories saved from Feeds appear here and in Bookmarks."}</p>}<ol className="vault-feed-saved-list">{visibleKept.map(entry => <li key={entry.hash}><button type="button" disabled={!canOpenBookmark} onClick={() => onOpenBookmark(entry.path)}><span className="vault-feed-publisher"><span aria-hidden="true">{(entry.source || "S").slice(0, 1).toUpperCase()}</span>{entry.source || "Saved story"}{entry.keptAt && <time dateTime={entry.keptAt}>{storyDate(entry.keptAt)}</time>}</span><strong>{entry.title}</strong></button></li>)}</ol></> : tab === "Headlines" ? <><h2 className="vault-feed-headlines-title">Headlines</h2>{loading && <p role="status">Reading your sources…</p>}{error && <p role="status">{error}</p>}{!loading && !visibleCoverage.length && (query ? <p>No loaded stories match this search.</p> : ready && !hasFeeds ? recommendations : <p>Your sources have no headlines to show yet.</p>)}<ol className="vault-feed-coverage-list">{visibleCoverage.map(group => <li key={group.id}><button type="button" onClick={() => setActiveGroupId(group.id)}><span><strong>{group.headline}</strong><small>{group.members.length} {group.members.length === 1 ? "article" : "articles"} · {group.sources.join(", ")}</small></span>{group.imageUrl && /* eslint-disable-next-line @next/next/no-img-element */ <img src={group.imageUrl} alt="" referrerPolicy="no-referrer" loading="lazy" />}</button></li>)}</ol></> : tab === "Sources" ? <>{sourceList}{ready && !hasFeeds && recommendations}</> : tab === "For You" ? <>
      {loading && <p role="status">Reading your sources…</p>}{error && <p role="status">{error}</p>}
      {!loading && !visibleRankedCoverage.length && (query ? <p>No loaded stories match this search.</p> : ready && !hasFeeds ? recommendations : <p>Your sources have no stories to show yet.</p>)}
      <ol>{visibleRankedCoverage.map((group, index) => {
        const story = group.members[0];
        const featured = Boolean(group.imageUrl && rankedLeadIndex >= 0 && (index === rankedLeadIndex || (index > rankedLeadIndex && (index - rankedLeadIndex) % 5 === 0)));
        return <li className={featured ? "vault-feed-featured" : ""} key={group.id}>
          {featured && /* eslint-disable-next-line @next/next/no-img-element */ <img className="vault-feed-lead" src={group.imageUrl!} alt="" loading="lazy" referrerPolicy="no-referrer" onError={event => { event.currentTarget.style.display = "none"; }} />}
          <div className="vault-feed-story"><div><span className="vault-feed-publisher" title={group.sources.join(", ")}><span aria-hidden="true">{story.source.slice(0, 1).toUpperCase()}</span><span className="vault-feed-source-name">{sourceSummary(group.sources)}</span>{story.publishedAt && <time dateTime={story.publishedAt}>{age(story.publishedAt)}</time>}</span>
            <button type="button" className="vault-feed-headline" onClick={() => group.members.length > 1 ? setActiveGroupId(group.id) : setActive(story)}>{group.headline}</button>
            {group.members.length > 1 ? <p>{group.members.length} articles covering this story</p> : story.excerpt && <p>{story.excerpt}</p>}</div>
            {group.imageUrl && !featured && /* eslint-disable-next-line @next/next/no-img-element */ <img className="vault-feed-thumb" src={group.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={event => { event.currentTarget.style.display = "none"; }} />}
          </div>
          {group.members.length === 1 && readLaterAction(story)}
        </li>;
      })}</ol>
    </> : <>
      {loading && <p role="status">Reading your sources…</p>}
      {error && <p role="status">{error}</p>}
      {!loading && !visibleStories.length && (query ? <p>No loaded stories match this search.</p> : ready && !hasFeeds ? recommendations : <p>Your sources have no stories to show yet.</p>)}
      <ol>{visibleStories.map((story, index) => <li className={story.imageUrl && latestLeadIndex >= 0 && (index === latestLeadIndex || (index > latestLeadIndex && (index - latestLeadIndex) % 5 === 0)) ? "vault-feed-featured" : ""} key={`${story.feedURL}:${story.externalKey}`}>
        {story.imageUrl && latestLeadIndex >= 0 && (index === latestLeadIndex || (index > latestLeadIndex && (index - latestLeadIndex) % 5 === 0)) && /* eslint-disable-next-line @next/next/no-img-element */ <img className="vault-feed-lead" src={story.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = "none"; }} />}
        <div className="vault-feed-story">
        <div>
        <span className="vault-feed-publisher"><span aria-hidden="true">{story.source.slice(0, 1).toUpperCase()}</span>{story.source}{story.publishedAt && <time dateTime={story.publishedAt}>{age(story.publishedAt)}</time>}</span>
        <button type="button" className="vault-feed-headline" onClick={() => setActive(story)}>{story.title}</button>
        {story.excerpt && <p>{story.excerpt}</p>}
        </div>
        {story.imageUrl && !(latestLeadIndex >= 0 && (index === latestLeadIndex || (index > latestLeadIndex && (index - latestLeadIndex) % 5 === 0))) && /* eslint-disable-next-line @next/next/no-img-element */ <img className="vault-feed-thumb" src={story.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = "none"; }} />}
        </div>
        {readLaterAction(story)}
      </li>)}</ol>
    </>}
  </section>;
}
