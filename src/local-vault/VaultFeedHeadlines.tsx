import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DocumentRenderer } from "@/components/document/DocumentRenderer";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import type { NormalizedEntry } from "@/lib/reading/feed-parse";
import { BUILTIN_TEMPLATES } from "@/lib/presentation/templates";
import { vaultRequest, type VaultFile } from "./bridge";
import { readDocument, writePayload } from "./model";
import { createFeedSubscriptionPack, createKeptFeedEntryPack, createReadFeedEntryPack, feedEntryHash, readFeedSubscription } from "@/lib/vault/rss";
import { encodeBase64 } from "./image-import";
import type { FolderPreview } from "./folder-collection";
import { clusterFeedStories, rankFeedClusters, type FeedStory, type FeedCluster } from "./feed-clusters";
import { readingActivity } from "./reading-activity";

type Headline = { externalKey: string; title: string; permalink: string | null; publishedAt: string | null; excerpt: string | null; imageUrl: string | null };
type FeedPage = { entries: Headline[] };
type SourceRow = { path: string; source: string; feedURL: string; topic: string | null };
type FullEntry = { feedURL: string; feedTitle: string; entry: NormalizedEntry };
type KeptEntry = { hash: string; path: string; title: string; source: string; topic?: string; keptAt: string; readAt?: string; progress?: number | string };
type KeptResponse = { hashes: string[]; entries: KeptEntry[] };
type ReadEntry = { hash: string; path: string; revision: string; title: string; source: string; topic?: string; readAt: string };
type ReadResponse = { hashes: string[]; entries: ReadEntry[] };
const storyTemplate = BUILTIN_TEMPLATES.find(template => template.id === "texttext.article");
const progressValue = (value: number | string | undefined): number => {
  const progress = Number(value);
  return Number.isInteger(progress) && progress >= 0 && progress <= 100 ? progress : 0;
};
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
const SHORT_READ_DWELL_MS = 8_000;
const SOURCE_CACHE_TTL_MS = 5 * 60_000;
const sourceCache = new Map<string, { stories: FeedStory[]; savedAt: number }>();

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
export function VaultFeedHeadlines({ sources, ready, sourceList, canAdd, canReadLater, canOpenBookmark, onOpenBookmark, onOpenHistory }: { sources: (FolderPreview & { path: string })[]; ready: boolean; sourceList: ReactNode; canAdd: boolean; canReadLater: boolean; canOpenBookmark: boolean; onOpenBookmark: (path: string) => void; onOpenHistory: (path: string) => void }) {
  const [tab, setTab] = useState("For You");
  const [search, setSearch] = useState("");
  const [stories, setStories] = useState<FeedStory[]>([]);
  const [rankedAt, setRankedAt] = useState(() => Date.now());
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [following, setFollowing] = useState("");
  const [interests, setInterests] = useState<Set<string>>(() => new Set());
  const [exploringInterests, setExploringInterests] = useState(false);
  const [profileDetail, setProfileDetail] = useState<{ kind: "publisher" | "topic"; value: string } | null>(null);
  const [followError, setFollowError] = useState("");
  const [confirmUnfollow, setConfirmUnfollow] = useState("");
  const [active, setActive] = useState<FeedStory | null>(null);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [full, setFull] = useState<{ key: string; value: FullEntry } | null>(null);
  const [storyError, setStoryError] = useState("");
  const [readerTextSize, setReaderTextSize] = useState(100);
  const [readerNotice, setReaderNotice] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<Set<string>>(() => new Set());
  const [keptHashes, setKeptHashes] = useState<Set<string> | null>(null);
  const [keptEntries, setKeptEntries] = useState<KeptEntry[]>([]);
  const [readEntries, setReadEntries] = useState<ReadEntry[]>([]);
  const [readHashes, setReadHashes] = useState<Set<string> | null>(null);
  const [keptError, setKeptError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [readStateBusy, setReadStateBusy] = useState("");
  const [readStateError, setReadStateError] = useState("");
  const [readingProgress, setReadingProgress] = useState(0);
  const readingProgressRef = useRef(0);
  const readingEngagedRef = useRef(false);
  const autoReadAttempted = useRef("");
  const readInFlight = useRef("");
  const markReadRef = useRef<(story: FeedStory) => Promise<void>>(async () => {});
  const [sourceLimit, setSourceLimit] = useState(8);
  const feedKey = useMemo(() => JSON.stringify(sources.map(source => {
    const fields = source.document?.content.fields;
    return fields?.texttextFeedSubscription === "v1" && typeof fields.feedUrl === "string"
      ? { path: source.path, feedURL: fields.feedUrl, source: source.title, topic: source.document?.content.tags[0] || null } : null;
  }).filter((row): row is SourceRow => row !== null)), [sources]);
  const sourceRows = useMemo(() => JSON.parse(feedKey) as SourceRow[], [feedKey]);
  const topics = [...new Set(sourceRows.map(row => row.topic).filter((topic): topic is string => Boolean(topic)))];
  const followedTopics = new Set(topics);
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
    if (!canReadLater || !ready) return;
    let live = true;
    void vaultRequest<ReadResponse>("readFeedEntries").then(value => {
      if (live) { setReadHashes(new Set(value.hashes)); setReadEntries(value.entries); setHistoryError(""); }
    }).catch(reason => { if (live) setHistoryError(reason instanceof Error ? reason.message : "Reading history could not be checked."); });
    return () => { live = false; };
  }, [canReadLater, ready]);
  useEffect(() => {
    if (!ready || !hasFeeds) {
      let live = true;
      queueMicrotask(() => { if (live) setStories([]); });
      return () => { live = false; };
    }
    const controller = new AbortController();
    let active = true;
    void Promise.resolve().then(async () => {
      setLoading(true); setError("");
      const next: FeedStory[] = [];
      const failures: string[] = [];
      for (const { feedURL, source, topic } of sourceRows.slice(0, sourceLimit)) {
        if (!active) return;
        const cacheKey = JSON.stringify([feedURL, source, topic]);
        const cached = sourceCache.get(cacheKey);
        if (cached && Date.now() - cached.savedAt < SOURCE_CACHE_TTL_MS) continue;
        sourceCache.delete(cacheKey);
        try {
          const page = await vaultRequest<FeedPage>("feedRead", { feedURL }, controller.signal);
          sourceCache.set(cacheKey, { stories: page.entries.slice(0, 12).map(entry => ({ ...entry, source, feedURL, topic })), savedAt: Date.now() });
          while (sourceCache.size > 32) sourceCache.delete(sourceCache.keys().next().value!);
        } catch (reason) {
          if (!controller.signal.aborted) failures.push(reason instanceof Error ? reason.message : "A source could not be read.");
        }
      }
      if (!active) return;
      const batches = sourceRows.slice(0, sourceLimit).map(({ feedURL, source, topic }) => sourceCache.get(JSON.stringify([feedURL, source, topic]))?.stories || []);
      for (let index = 0; index < 12 && next.length < 240; index++) {
        for (const batch of batches) if (batch[index] && next.length < 240) next.push(batch[index]);
      }
      next.sort((a, b) => Date.parse(b.publishedAt || "") - Date.parse(a.publishedAt || ""));
      setStories(next); setRankedAt(Date.now()); setError(failures[0] || ""); setLoading(false);
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
      const topic = story.topic || sourceRows.find(row => row.feedURL === story.feedURL)?.topic || undefined;
      const pack = await createKeptFeedEntryPack({ ...entry, topic }, "bookmark");
      const imported = await vaultRequest<{ path: string }>("importPack", { title: pack.title, folder: "Bookmarks", data: encodeBase64(pack.bytes) });
      setKeptHashes(previous => new Set([...(previous ?? []), hash]));
      setKeptEntries(previous => [{ hash, path: imported.path, title: pack.title, source: entry.feedTitle, topic, keptAt: new Date().toISOString() }, ...previous.filter(savedEntry => savedEntry.hash !== hash)]);
      setSaved(previous => new Set(previous).add(key));
      window.dispatchEvent(new Event("texttext:vault-changed"));
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "This story could not be saved.";
      if (activeKey === key) setStoryError(message); else setError(message);
    } finally { setSaving(null); }
  };
  const toggleKeptRead = async (entry: KeptEntry) => {
    if (!canAdd || readStateBusy) return;
    setReadStateBusy(entry.hash); setReadStateError("");
    try {
      const file = await vaultRequest<VaultFile>("read", { path: entry.path });
      const document = readDocument(file);
      if (!file.path.startsWith("Bookmarks/") || document.content.fields.texttextFeedEntry !== "v1" || document.content.fields.feedEntryHash !== entry.hash) {
        throw new Error("This saved story changed. Reopen Feeds and try again.");
      }
      const fields = { ...document.content.fields, texttextBookmarkReadAt: entry.readAt ? null : new Date().toISOString(), texttextFeedReadingProgress: entry.readAt ? null : 100 };
      await vaultRequest<VaultFile>("write", writePayload(file, { ...document, content: { ...document.content, fields } }));
      setKeptEntries(previous => previous.map(savedEntry => savedEntry.hash === entry.hash ? { ...savedEntry, readAt: typeof fields.texttextBookmarkReadAt === "string" ? fields.texttextBookmarkReadAt : undefined, progress: entry.readAt ? undefined : 100 } : savedEntry));
      window.dispatchEvent(new Event("texttext:vault-changed"));
    } catch (reason) { setReadStateError(reason instanceof Error ? reason.message : "The read state could not be saved."); }
    finally { setReadStateBusy(""); }
  };
  const markFeedRead = async (story: FeedStory) => {
    const key = `${story.feedURL}\n${story.externalKey}`;
    if (!canAdd || readStateBusy || readInFlight.current === key) return;
    readInFlight.current = key;
    setReaderNotice(""); setStoryError("");
    try {
      const hash = await feedEntryHash(story.feedURL, story.externalKey);
      const latestKept = await vaultRequest<KeptResponse>("keptFeedEntries");
      setKeptHashes(new Set(latestKept.hashes)); setKeptEntries(latestKept.entries);
      const kept = latestKept.entries.find(entry => entry.hash === hash);
      if (kept) {
        if (kept.readAt) { setReaderNotice("Already in reading history."); return; }
        await toggleKeptRead(kept);
        return;
      }
      setReadStateBusy(hash);
      const existing = await vaultRequest<ReadResponse>("readFeedEntries");
      setReadHashes(new Set(existing.hashes)); setReadEntries(existing.entries);
      if (existing.hashes.includes(hash)) { setReaderNotice("Already in reading history."); return; }
      const entry = full?.key === key ? full.value : await vaultRequest<FullEntry>("feedEntry", { feedURL: story.feedURL, externalKey: story.externalKey });
      if (entry.feedURL !== story.feedURL || entry.entry?.externalKey !== story.externalKey) throw new Error("This story changed. Refresh Feeds and try again.");
      const topic = story.topic || sourceRows.find(row => row.feedURL === story.feedURL)?.topic || undefined;
      const pack = await createReadFeedEntryPack({ ...entry, topic });
      const imported = await vaultRequest<VaultFile>("importPack", { title: pack.title, folder: "Feeds/History", data: encodeBase64(pack.bytes) });
      setReadHashes(previous => new Set([...(previous ?? []), hash]));
      setReadEntries(previous => [{ hash, path: imported.path, revision: imported.hash, title: pack.title, source: entry.feedTitle, topic, readAt: new Date().toISOString() }, ...previous.filter(record => record.hash !== hash)]);
      setReaderNotice("Added to reading history.");
      window.dispatchEvent(new Event("texttext:vault-changed"));
    } catch (reason) { setStoryError(reason instanceof Error ? reason.message : "This story could not be marked read."); }
    finally { readInFlight.current = ""; setReadStateBusy(""); }
  };
  markReadRef.current = markFeedRead;
  useEffect(() => { readingProgressRef.current = 0; readingEngagedRef.current = false; }, [activeKey]);
  const closeReader = () => {
    const story = active;
    const progress = Math.min(89, readingProgressRef.current);
    const engaged = readingEngagedRef.current;
    setActive(null); setReaderNotice("");
    if (!story || !canAdd || !engaged || progress < 15 || readInFlight.current) return;
    const key = `${story.feedURL}\n${story.externalKey}`;
    if (!saved.has(key)) return;
    void (async () => {
      const hash = await feedEntryHash(story.feedURL, story.externalKey);
      const entry = keptEntries.find(record => record.hash === hash);
      if (!entry || entry.readAt || progress < progressValue(entry.progress) + 10) return;
      const file = await vaultRequest<VaultFile>("read", { path: entry.path });
      const document = readDocument(file);
      if (!file.path.startsWith("Bookmarks/") || document.content.fields.texttextFeedEntry !== "v1" || document.content.fields.feedEntryHash !== hash) throw new Error("This saved story changed. Reopen Feeds and try again.");
      const current = document.content.fields.texttextFeedReadingProgress;
      if (typeof document.content.fields.texttextBookmarkReadAt === "string" || typeof current === "number" && progress < current + 10) return;
      await vaultRequest<VaultFile>("write", writePayload(file, { ...document, content: { ...document.content, fields: { ...document.content.fields, texttextFeedReadingProgress: progress } } }));
      setKeptEntries(previous => previous.map(record => record.hash === hash ? { ...record, progress } : record));
      window.dispatchEvent(new Event("texttext:vault-changed"));
    })().catch(reason => setReadStateError(reason instanceof Error ? reason.message : "Reading progress could not be saved."));
  };
  useEffect(() => {
    if (!active || full?.key !== activeKey) return;
    const scroller = document.querySelector<HTMLElement>(".vault-app>main");
    const content = document.querySelector<HTMLElement>(".vault-feed-reader-content");
    if (!scroller || !content) return;
    const key = activeKey;
    const startTop = scroller.scrollTop;
    let lastProgress = -1;
    let shortReadTimer: ReturnType<typeof setTimeout> | null = null;
    const update = () => {
      const viewport = scroller.getBoundingClientRect();
      const bounds = content.getBoundingClientRect();
      const available = Math.max(1, bounds.height - viewport.height);
      const progress = Math.max(0, Math.min(100, Math.round(((viewport.bottom - bounds.top) / Math.max(bounds.height, viewport.height)) * 100)));
      if (progress !== lastProgress) { lastProgress = progress; readingProgressRef.current = progress; setReadingProgress(progress); }
      if (scroller.scrollTop - startTop >= 80) readingEngagedRef.current = true;
      if (available > 80 && scroller.scrollTop - startTop >= 80 && progress >= 90 && autoReadAttempted.current !== key) {
        autoReadAttempted.current = key;
        void markReadRef.current(active);
      }
      const shortStoryVisible = bounds.height <= viewport.height + 80 && bounds.top >= viewport.top - 80 && bounds.bottom <= viewport.bottom + 80;
      if (shortStoryVisible && document.visibilityState === "visible" && autoReadAttempted.current !== key) {
        shortReadTimer ??= setTimeout(() => {
          shortReadTimer = null;
          if (document.visibilityState !== "visible" || autoReadAttempted.current === key) return;
          const currentViewport = scroller.getBoundingClientRect();
          const currentBounds = content.getBoundingClientRect();
          if (currentBounds.top >= currentViewport.top - 80 && currentBounds.bottom <= currentViewport.bottom + 80) {
            autoReadAttempted.current = key;
            void markReadRef.current(active);
          }
        }, SHORT_READ_DWELL_MS);
      } else if (shortReadTimer) { clearTimeout(shortReadTimer); shortReadTimer = null; }
    };
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    document.addEventListener("visibilitychange", update);
    return () => { scroller.removeEventListener("scroll", update); document.removeEventListener("visibilitychange", update); if (shortReadTimer) clearTimeout(shortReadTimer); };
  }, [activeKey, full, active]);
  const removeReadEntry = async (entry: ReadEntry) => {
    if (!canAdd || readStateBusy) return;
    setReadStateBusy(entry.hash); setReadStateError("");
    try {
      await vaultRequest("delete", { path: entry.path, hash: entry.revision });
      setReadEntries(previous => previous.filter(record => record.hash !== entry.hash));
      setReadHashes(previous => { const next = new Set(previous ?? []); next.delete(entry.hash); return next; });
      window.dispatchEvent(new Event("texttext:vault-changed"));
    } catch (reason) { setReadStateError(reason instanceof Error ? reason.message : "This history entry could not be removed."); }
    finally { setReadStateBusy(""); }
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
  const shareStory = async (story: FeedStory) => {
    if (!story.permalink) return;
    try {
      if (navigator.share) await navigator.share({ title: story.title, url: story.permalink });
      else { await navigator.clipboard.writeText(story.permalink); setReaderNotice("Story link copied."); }
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setReaderNotice("Could not share this story.");
    }
  };
  const storyMenu = (story: FeedStory) => <details className="vault-feed-story-menu">
    <summary aria-label={`More actions: ${story.title}`} title="More actions">•••</summary>
    <div>
      {readLaterAction(story)}
      <button type="button" disabled={!story.permalink} onClick={event => {
        event.currentTarget.closest("details")?.removeAttribute("open");
        void shareStory(story);
      }}>Share</button>
      {story.permalink && <a href={story.permalink} target="_blank" rel="noopener noreferrer">Open original</a>}
      <button type="button" disabled={!story.permalink} onClick={event => {
        event.currentTarget.closest("details")?.removeAttribute("open");
        void navigator.clipboard.writeText(story.permalink!).then(() => setReaderNotice("Story link copied."))
          .catch(() => setReaderNotice("Could not copy the story link."));
      }}>Copy link</button>
    </div>
  </details>;
  const followInterests = async () => {
    if (!canAdd || following || interests.size < (hasFeeds ? 1 : MIN_INTERESTS)) return;
    const chosen = RECOMMENDED.filter(source => interests.has(source.topic) && !sourceRows.some(row => row.feedURL === source.feedURL));
    setFollowing("selected interests"); setFollowError("");
    let added = 0;
    try {
      for (const source of chosen) {
        const pack = createFeedSubscriptionPack({ feedURL: source.feedURL, title: source.title, siteUrl: source.siteUrl, description: null, format: "rss", topic: source.topic });
        await vaultRequest("importPack", { title: pack.title, folder: "Feeds", data: encodeBase64(pack.bytes) });
        added++;
      }
      if (hasFeeds) { setExploringInterests(false); setInterests(new Set()); }
    } catch (reason) { setFollowError(`${added} of ${chosen.length} sources added. ${reason instanceof Error ? reason.message : "A source could not be added."}`); }
    finally { if (added) window.dispatchEvent(new Event("texttext:vault-changed")); setFollowing(""); }
  };
  const unfollowInterest = async (topic: string) => {
    if (!canAdd || following) return;
    const subscriptions = sourceRows.filter(row => row.topic === topic);
    if (!subscriptions.length) { setConfirmUnfollow(""); return; }
    setFollowing(topic); setFollowError("");
    let removed = 0;
    try {
      for (const subscription of subscriptions) {
        const file = await vaultRequest<VaultFile>("read", { path: subscription.path });
        const saved = readFeedSubscription(file);
        if (!file.path.startsWith("Feeds/") || saved?.feedURL !== subscription.feedURL || saved?.topic !== topic) {
          throw new Error("A subscription changed. Refresh Feeds and try again.");
        }
        await vaultRequest("delete", { path: file.path, hash: file.hash });
        removed++;
      }
      setConfirmUnfollow("");
    } catch (reason) {
      setFollowError(`${removed} of ${subscriptions.length} sources removed. ${reason instanceof Error ? reason.message : "A source could not be removed."}`);
    } finally {
      if (removed) window.dispatchEvent(new Event("texttext:vault-changed"));
      setFollowing("");
    }
  };
  const recommendations = <div className="vault-feed-recommendations"><h2>{hasFeeds ? "Explore interests" : "Personalize your feed"}</h2><p>{hasFeeds ? "Choose topics to follow, or select a followed topic to remove its sources." : "Choose at least ten topics. You can add individual sources later."}</p>
    <div role="group" aria-label="News interests">{INTEREST_GROUPS.map(group => <section className="vault-feed-interest-group" key={group.title}><h3>{group.title}</h3><div className="vault-feed-interests">{group.topics.map(topic => <button key={topic} type="button" aria-pressed={followedTopics.has(topic) || interests.has(topic)} disabled={!canAdd || Boolean(following)} onClick={() => { if (followedTopics.has(topic)) { setConfirmUnfollow(topic); return; } setConfirmUnfollow(""); setInterests(current => {
      const next = new Set(current);
      if (next.has(topic)) next.delete(topic); else next.add(topic);
      return next;
    }); }}><strong>{topic}</strong>{followedTopics.has(topic) && <small>Following</small>}</button>)}</div></section>)}</div>
    {confirmUnfollow && <div className="vault-feed-unfollow" role="group" aria-label={`Unfollow ${confirmUnfollow}`}><p>Remove {sourceRows.filter(row => row.topic === confirmUnfollow).length} {confirmUnfollow} {sourceRows.filter(row => row.topic === confirmUnfollow).length === 1 ? "source" : "sources"} from Feeds? You can restore them from Trash.</p><button type="button" disabled={Boolean(following)} onClick={() => setConfirmUnfollow("")}>Cancel</button><button type="button" disabled={Boolean(following)} onClick={() => void unfollowInterest(confirmUnfollow)}>{following ? "Removing…" : `Unfollow ${confirmUnfollow}`}</button></div>}
    <p className="vault-feed-interest-count" role="status">{hasFeeds ? `${interests.size} new ${interests.size === 1 ? "topic" : "topics"} selected` : `${interests.size} of ${MIN_INTERESTS} topics selected`}</p>
    <div className="vault-feed-interest-actions">{hasFeeds && <button type="button" onClick={() => { setExploringInterests(false); setInterests(new Set()); }}>Back to profile</button>}<button type="button" className="vault-feed-continue" disabled={!canAdd || interests.size < (hasFeeds ? 1 : MIN_INTERESTS) || Boolean(following)} onClick={() => void followInterests()}>{following ? "Adding sources…" : hasFeeds ? `Follow ${interests.size} ${interests.size === 1 ? "topic" : "topics"}` : `Continue with ${interests.size} ${interests.size === 1 ? "topic" : "topics"}`}</button></div>
    {followError && <p role="alert">{followError}</p>}
  </div>;
  const query = search.trim().toLocaleLowerCase();
  const visibleKept = keptEntries.filter(entry => !query || [entry.title, entry.source].some(value => value.toLocaleLowerCase().includes(query)));
  const completedKept = visibleKept.filter(entry => entry.readAt);
  const completedHashes = new Set(completedKept.map(entry => entry.hash));
  const visibleHistory = [
    ...completedKept.map(entry => ({ ...entry, kind: "kept" as const })),
    ...readEntries.filter(entry => !completedHashes.has(entry.hash) && (!query || [entry.title, entry.source].some(value => value.toLocaleLowerCase().includes(query))))
      .map(entry => ({ ...entry, kind: "read" as const })),
  ].sort((a, b) => Date.parse(b.readAt!) - Date.parse(a.readAt!));
  const readHistory = [...keptEntries.filter(entry => entry.readAt), ...readEntries.filter(entry => !keptEntries.some(kept => kept.hash === entry.hash && kept.readAt))];
  const activity = readingActivity(readHistory.flatMap(entry => entry.readAt ? [entry.readAt] : []));
  const topPublishers = [...readHistory.reduce((counts, entry) => counts.set(entry.source || "Unknown source", (counts.get(entry.source || "Unknown source") ?? 0) + 1), new Map<string, number>())]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, 5);
  const topicsBySource = new Map(sourceRows.filter(row => row.topic).map(row => [row.source, row.topic!]));
  const topReadingTopics = [...readHistory.reduce((counts, entry) => {
    const topic = entry.topic || topicsBySource.get(entry.source);
    if (topic) counts.set(topic, (counts.get(topic) ?? 0) + 1);
    return counts;
  }, new Map<string, number>())].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, 5);
  const profileStories = profileDetail ? readHistory.filter(entry => profileDetail.kind === "publisher"
    ? (entry.source || "Unknown source") === profileDetail.value
    : (entry.topic || topicsBySource.get(entry.source)) === profileDetail.value)
    .sort((left, right) => Date.parse(right.readAt || "") - Date.parse(left.readAt || "")) : [];
  const profile = profileDetail ? <div className="vault-feed-profile vault-feed-profile-detail"><button type="button" className="vault-feed-profile-back" onClick={() => setProfileDetail(null)}>‹ Back to profile</button><h2>{profileDetail.value}</h2><p>{profileStories.length} {profileStories.length === 1 ? "story read" : "stories read"}</p><ol className="vault-feed-saved-list">{profileStories.map(entry => <li key={entry.hash}><button type="button" disabled={!canOpenBookmark} onClick={() => keptEntries.some(kept => kept.path === entry.path && kept.readAt) ? onOpenBookmark(entry.path) : onOpenHistory(entry.path)}><span className="vault-feed-publisher">{entry.source || "Unknown source"}{entry.readAt && <time dateTime={entry.readAt}>{storyDate(entry.readAt)}</time>}</span><strong>{entry.title}</strong></button></li>)}</ol></div> : <div className="vault-feed-profile"><h2>Profile</h2><div className="vault-feed-profile-summary"><div className="vault-feed-profile-ring" role="img" aria-label={`${activity.daysThisWeek} of 7 days read in the past week`}><svg viewBox="0 0 100 100" aria-hidden="true"><circle className="vault-feed-profile-ring-track" cx="50" cy="50" r="42" pathLength="100" /><circle className="vault-feed-profile-ring-fill" cx="50" cy="50" r="42" pathLength="100" strokeDasharray={`${activity.daysThisWeek * 100 / 7} 100`} /></svg><strong>{activity.daysThisWeek}</strong><span>of 7 days</span></div><div className="vault-feed-profile-count"><strong>{readHistory.length}</strong><span>{readHistory.length === 1 ? "story read" : "stories read"}</span><small>{activity.streak ? `${activity.streak}-day reading streak` : "No current reading streak"}</small></div></div>
    <nav aria-label="Reading library"><button type="button" onClick={() => { setSearch(""); setTab("Read Later"); }}>Read Later <span>{keptEntries.length}</span></button><button type="button" onClick={() => { setSearch(""); setTab("History"); }}>Reading history <span>{readHistory.length}</span></button><button type="button" onClick={() => { setSearch(""); setTab("Sources"); }}>Subscriptions <span>{sourceRows.length}</span></button><button type="button" onClick={() => { setInterests(new Set()); setExploringInterests(true); }}>Explore interests <span>{topics.length}</span></button></nav>
    {topPublishers.length > 0 && <section aria-label="Most read publishers"><h3>Most read publishers</h3><ol>{topPublishers.map(([source, count]) => <li key={source}><button type="button" onClick={() => setProfileDetail({ kind: "publisher", value: source })}><span>{source}</span><span>{count}</span></button></li>)}</ol></section>}
    {topReadingTopics.length > 0 && <section aria-label="Reading topics"><h3>Reading topics</h3><ol>{topReadingTopics.map(([topic, count]) => <li key={topic}><button type="button" onClick={() => setProfileDetail({ kind: "topic", value: topic })}><span>{topic}</span><span>{count}</span></button></li>)}</ol></section>}
  </div>;
  const matchesStory = (story: FeedStory) => !query || [story.title, story.source, story.excerpt, story.topic].some(value => value?.toLocaleLowerCase().includes(query));
  const visibleStories = (tab === "Latest" ? stories : stories.filter(story => story.topic === tab)).filter(matchesStory);
  const coverage = useMemo(() => clusterFeedStories(stories), [stories]);
  const rankedCoverage = rankFeedClusters(coverage, rankedAt);
  const visibleCoverage = coverage.filter(group => !query || group.headline.toLocaleLowerCase().includes(query) || group.members.some(matchesStory));
  const visibleRankedCoverage = rankedCoverage.filter(group => !query || group.headline.toLocaleLowerCase().includes(query) || group.members.some(matchesStory));
  const visibleRankedStories = visibleRankedCoverage.flatMap(group => group.members.filter(matchesStory));
  const topicHeadlines = topics.includes(tab) ? clusterFeedStories(stories.filter(story => story.topic === tab))
    .filter(group => group.members.length > 1 && group.imageUrl && (!query || group.headline.toLocaleLowerCase().includes(query) || group.members.some(matchesStory))).slice(0, 8) : [];
  const rankedLeadIndex = visibleRankedStories.findIndex(story => Boolean(story.imageUrl));
  const latestLeadIndex = visibleStories.findIndex(story => Boolean(story.imageUrl));
  const activeGroup: FeedCluster | undefined = topicHeadlines.find(group => group.id === activeGroupId) ?? coverage.find(group => group.id === activeGroupId);
  const activeFull = full?.key === activeKey ? full.value : null;
  const readerDocument = activeFull && storyTemplate ? (() => {
    const document = emptyDocumentSnapshot({ id: storyTemplate.id, version: storyTemplate.version });
    document.content.title = activeFull.entry.title;
    document.content.body = activeFull.entry.bodyMarkdown || activeFull.entry.excerpt || "";
    document.content.fields = activeFull.entry.permalink ? { sourceUrl: activeFull.entry.permalink } : {};
    return document;
  })() : null;
  if (!ready) return <section className="vault-feed-home" aria-label="Latest stories"><p role="status">Reading feed subscriptions…</p></section>;
  if (!hasFeeds && !keptEntries.length && !readEntries.length) return <section className="vault-feed-home vault-feed-onboarding" aria-label="News interests">{recommendations}</section>;
  if (active) return <section className="vault-feed-reader" aria-label="Feed story">
    <div className="vault-feed-reading-progress" role="progressbar" aria-label="Reading progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={readingProgress}><span style={{ width: `${readingProgress}%` }} /></div>
    <header><button type="button" onClick={closeReader}>‹ Back to {activeGroup ? "coverage" : "Feeds"}</button><span>{active.source}</span><details className="vault-feed-reader-text-menu"><summary aria-label="Reading appearance">Aa</summary><div><button type="button" disabled={readerTextSize <= 80} onClick={() => setReaderTextSize(size => Math.max(80, size - 10))}>Smaller text</button><button type="button" disabled={readerTextSize >= 150} onClick={() => setReaderTextSize(size => Math.min(150, size + 10))}>Larger text</button></div></details></header>
    {storyError && <p role="alert">{storyError}</p>}
    {!activeFull && !storyError && <p role="status">Opening story…</p>}
    {activeFull && readerDocument && storyTemplate && <><div className="vault-feed-reader-content" style={{ zoom: readerTextSize / 100 }}><DocumentRenderer document={readerDocument} template={storyTemplate} metadata={{ author: active.source, date: storyDate(activeFull.entry.publishedAt) }} />
      {activeFull.entry.availability !== "full" && <p className="vault-feed-reader-availability">{activeFull.entry.availability === "excerpt" ? "This source provided an excerpt." : "This source provided only story details."}</p>}</div>
      <footer className="vault-feed-reader-actions"><button type="button" onClick={closeReader} aria-label="Back to feed">‹ <span>Back</span></button><button type="button" disabled={!activeFull.entry.permalink} onClick={() => void shareStory(active)} aria-label="Share story">↗ <span>Share</span></button>{readLaterAction(active)}<details><summary aria-label="More story actions">•••</summary><div>{activeFull.entry.permalink && <a href={activeFull.entry.permalink} target="_blank" rel="noopener noreferrer">Open original</a>}<button type="button" disabled={!activeFull.entry.permalink} onClick={() => void navigator.clipboard.writeText(activeFull.entry.permalink!).then(() => setReaderNotice("Story link copied.")).catch(() => setReaderNotice("Could not copy the story link."))}>Copy link</button><button type="button" disabled={!canAdd || Boolean(readStateBusy)} onClick={() => void markFeedRead(active)}>{readStateBusy ? "Saving…" : "Mark read"}</button></div></details></footer>{readerNotice && <p className="vault-feed-reader-notice" role="status">{readerNotice}</p>}</>}
  </section>;
  if (activeGroup) return <section className="vault-feed-coverage" aria-label="Headline coverage">
    <header><button type="button" onClick={() => setActiveGroupId(null)}>‹ {tab === "Headlines" ? "Headlines" : topics.includes(tab) ? tab : "For You"}</button></header>
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
    {readerNotice && <p className="vault-feed-list-notice" role="status">{readerNotice}</p>}
    {tab !== "Sources" && tab !== "Profile" && <label className="vault-feed-search"><svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4.5 4.5" /></svg><input type="search" aria-label={tab === "History" ? "Search reading history" : tab === "Read Later" ? "Search saved stories" : "Search loaded stories"} placeholder={tab === "History" ? "Search reading history" : tab === "Read Later" ? "Search saved stories" : "Search loaded stories"} value={search} onChange={event => setSearch(event.target.value)} /></label>}
    <nav className="vault-feed-topics" aria-label="News topics"><button aria-pressed={tab === "For You"} onClick={() => setTab("For You")}>For You</button>{topics.map(topic => <button key={topic} aria-pressed={tab === topic} onClick={() => setTab(topic)}>{topic.slice(0, 1).toUpperCase() + topic.slice(1)}</button>)}</nav>
    <nav className="vault-feed-sections" aria-label="Feed sections"><button aria-pressed={tab === "Headlines"} onClick={() => setTab("Headlines")}>Headlines</button><button aria-pressed={tab === "Latest"} onClick={() => setTab("Latest")}>Latest</button>{canReadLater && <><button aria-pressed={tab === "Read Later"} onClick={() => setTab("Read Later")}>Read Later</button><button aria-pressed={tab === "History"} onClick={() => setTab("History")}>History</button><button aria-pressed={tab === "Profile"} onClick={() => setTab("Profile")}>Profile</button></>}<button aria-pressed={tab === "Sources"} onClick={() => setTab("Sources")}>Sources</button></nav>
    {sourceRows.length > 8 && !["Sources", "Read Later", "History", "Profile"].includes(tab) && <div className="vault-feed-source-window"><span>Reading {Math.min(sourceLimit, sourceRows.length)} of {sourceRows.length} sources</span>{sourceLimit < sourceRows.length && <button type="button" disabled={loading} onClick={() => setSourceLimit(limit => limit + 8)}>Load more sources</button>}</div>}
    {tab === "Read Later" ? <><h2 className="vault-feed-headlines-title">Read Later</h2>{!keptHashes && !keptError && <p role="status">Reading saved stories…</p>}{readStateError && <p role="alert">{readStateError}</p>}{keptHashes && !visibleKept.length && <p>{query ? "No saved stories match this search." : "Stories saved from Feeds appear here and in Bookmarks."}</p>}<ol className="vault-feed-saved-list">{visibleKept.map(entry => <li key={entry.hash}><button type="button" disabled={!canOpenBookmark} onClick={() => onOpenBookmark(entry.path)}><span className="vault-feed-publisher"><span aria-hidden="true">{(entry.source || "S").slice(0, 1).toUpperCase()}</span>{entry.source || "Saved story"}{entry.keptAt && <time dateTime={entry.keptAt}>{storyDate(entry.keptAt)}</time>}</span><strong>{entry.title}</strong>{entry.readAt ? <small className="vault-feed-read-state">✓ Read</small> : progressValue(entry.progress) > 0 && <small className="vault-feed-read-state">{progressValue(entry.progress)}% read</small>}</button><button type="button" className="vault-feed-read-toggle" disabled={!canAdd || Boolean(readStateBusy)} aria-label={`Mark ${entry.title} ${entry.readAt ? "unread" : "read"}`} onClick={() => void toggleKeptRead(entry)}>{readStateBusy === entry.hash ? "Saving…" : entry.readAt ? "Mark unread" : "Mark read"}</button></li>)}</ol></> : tab === "History" ? <><h2 className="vault-feed-headlines-title">Reading history</h2><p className="vault-feed-history-intro">Stories you finish or mark read appear here, including ones you did not save.</p>{(!keptHashes || !readHashes) && !keptError && !historyError && <p role="status">Reading history…</p>}{readStateError && <p role="alert">{readStateError}</p>}{historyError && <p role="alert">{historyError}</p>}{keptHashes && readHashes && !visibleHistory.length && <p>{query ? "No read stories match this search." : "No stories in reading history yet."}</p>}<ol className="vault-feed-saved-list">{visibleHistory.map(entry => <li key={entry.hash}><button type="button" disabled={!canOpenBookmark} onClick={() => entry.kind === "kept" ? onOpenBookmark(entry.path) : onOpenHistory(entry.path)}><span className="vault-feed-publisher"><span aria-hidden="true">{(entry.source || "S").slice(0, 1).toUpperCase()}</span>{entry.source || "Read story"}{entry.readAt && <time dateTime={entry.readAt}>{storyDate(entry.readAt)}</time>}</span><strong>{entry.title}</strong><small className="vault-feed-read-state">✓ Read</small></button><button type="button" className="vault-feed-read-toggle" disabled={!canAdd || Boolean(readStateBusy)} aria-label={entry.kind === "kept" ? `Mark ${entry.title} unread` : `Remove ${entry.title} from history`} onClick={() => void (entry.kind === "kept" ? toggleKeptRead(entry) : removeReadEntry(entry))}>{readStateBusy === entry.hash ? "Saving…" : entry.kind === "kept" ? "Mark unread" : "Remove"}</button></li>)}</ol></> : tab === "Headlines" ? <><h2 className="vault-feed-headlines-title">Headlines</h2>{loading && <p role="status">Reading your sources…</p>}{error && <p role="status">{error}</p>}{!loading && !visibleCoverage.length && (query ? <p>No loaded stories match this search.</p> : ready && !hasFeeds ? recommendations : <p>Your sources have no headlines to show yet.</p>)}<ol className="vault-feed-coverage-list">{visibleCoverage.map(group => <li key={group.id}><button type="button" onClick={() => setActiveGroupId(group.id)}><span><strong>{group.headline}</strong><small>{group.members.length} {group.members.length === 1 ? "article" : "articles"} · {group.sources.join(", ")}</small></span>{group.imageUrl && /* eslint-disable-next-line @next/next/no-img-element */ <img src={group.imageUrl} alt="" referrerPolicy="no-referrer" loading="lazy" />}</button></li>)}</ol></> : tab === "Profile" ? (exploringInterests ? recommendations : profile) : tab === "Sources" ? <>{sourceList}{ready && !hasFeeds && recommendations}</> : tab === "For You" ? <>
      {loading && <p role="status">Reading your sources…</p>}{error && <p role="status">{error}</p>}
      {!loading && !visibleRankedStories.length && (query ? <p>No loaded stories match this search.</p> : ready && !hasFeeds ? recommendations : <p>Your sources have no stories to show yet.</p>)}
      <ol>{visibleRankedStories.map((story, index) => {
        const featured = Boolean(story.imageUrl && rankedLeadIndex >= 0 && (index === rankedLeadIndex || (index > rankedLeadIndex && (index - rankedLeadIndex) % 5 === 0)));
        return <li className={featured ? "vault-feed-featured" : ""} key={`${story.feedURL}:${story.externalKey}`}>
          {featured && /* eslint-disable-next-line @next/next/no-img-element */ <img className="vault-feed-lead" src={story.imageUrl!} alt="" loading="lazy" referrerPolicy="no-referrer" onError={event => { event.currentTarget.style.display = "none"; }} />}
          <div className="vault-feed-story"><div><span className="vault-feed-publisher"><span aria-hidden="true">{story.source.slice(0, 1).toUpperCase()}</span><span className="vault-feed-source-name">{story.source}</span>{story.publishedAt && <time dateTime={story.publishedAt}>{age(story.publishedAt)}</time>}</span>
            <button type="button" className="vault-feed-headline" onClick={() => setActive(story)}>{story.title}</button>
            {story.excerpt && <p>{story.excerpt}</p>}</div>
            {story.imageUrl && !featured && /* eslint-disable-next-line @next/next/no-img-element */ <img className="vault-feed-thumb" src={story.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={event => { event.currentTarget.style.display = "none"; }} />}
          </div>
          <div className="vault-feed-row-actions">{storyMenu(story)}</div>
        </li>;
      })}</ol>
    </> : <>
      {loading && <p role="status">Reading your sources…</p>}
      {error && <p role="status">{error}</p>}
      {!loading && !visibleStories.length && (query ? <p>No loaded stories match this search.</p> : ready && !hasFeeds ? recommendations : <p>Your sources have no stories to show yet.</p>)}
      {topicHeadlines.length > 0 && <section className="vault-feed-topic-headlines" aria-label="Topic headlines"><h2>Headlines</h2><div className="vault-feed-topic-carousel">{topicHeadlines.map(group => <button type="button" key={group.id} onClick={() => setActiveGroupId(group.id)} aria-label={`Coverage: ${group.headline}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}<img src={group.imageUrl!} alt="" loading="lazy" referrerPolicy="no-referrer" />
        <strong>{group.headline}</strong><small>{group.members.length} articles · {group.sources.length} sources</small>
      </button>)}</div></section>}
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
        <div className="vault-feed-row-actions">{storyMenu(story)}</div>
      </li>)}</ol>
    </>}
  </section>;
}
