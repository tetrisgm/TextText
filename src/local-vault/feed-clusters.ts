export type FeedStory = {
  externalKey: string;
  title: string;
  permalink: string | null;
  publishedAt: string | null;
  excerpt: string | null;
  imageUrl: string | null;
  source: string;
  feedURL: string;
  topic: string | null;
};

export type FeedCluster = { id: string; headline: string; members: FeedStory[]; sources: string[]; imageUrl: string | null };
const STOP = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "at", "by", "from", "is", "are", "was", "were", "its", "it", "as", "this", "that", "be", "has", "have", "how", "why", "what", "new", "now", "after", "over", "into"]);
const WINDOW = 3 * 24 * 60 * 60 * 1000;

function tokens(title: string): Set<string> {
  return new Set(title.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(token => token.length >= 3 && !STOP.has(token)));
}
function related(left: Set<string>, right: Set<string>): boolean {
  if (left.size < 3 || right.size < 3) return false;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared++;
  return shared / (left.size + right.size - shared) >= 0.5;
}
function date(story: FeedStory): number { return story.publishedAt ? Date.parse(story.publishedAt) : NaN; }
function storyId(story: FeedStory): string { return `${story.feedURL}\n${story.externalKey}`; }
function storyLink(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.hash = "";
    for (const name of [...url.searchParams.keys()]) if (/^(utm_.*|fbclid|gclid|ref)$/i.test(name)) url.searchParams.delete(name);
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    url.searchParams.sort();
    return url.href;
  } catch { return null; }
}

/** Pure, bounded grouping over the current feed page. A similar headline only
 * groups cross-publisher coverage close in time; identical canonical links
 * group even when the publisher wrote a different title. */
export function clusterFeedStories(stories: readonly FeedStory[]): FeedCluster[] {
  const groups: Array<{ members: FeedStory[]; words: Set<string>; links: Set<string> }> = [];
  for (const story of stories) {
    const words = tokens(story.title);
    const link = storyLink(story.permalink);
    const group = groups.find(candidate => {
      if (link && candidate.links.has(link)) return true;
      if (candidate.members.some(member => member.source === story.source)) return false;
      const time = date(story);
      return Number.isFinite(time) && candidate.members.some(member => Number.isFinite(date(member)) && Math.abs(date(member) - time) <= WINDOW) && related(candidate.words, words);
    });
    if (!group) groups.push({ members: [story], words, links: new Set(link ? [link] : []) });
    else {
      group.members.push(story);
      if (link) group.links.add(link);
      for (const word of words) group.words.add(word);
    }
  }
  return groups.map(group => {
    const members = group.members.slice().sort((left, right) => (date(right) || 0) - (date(left) || 0));
    return {
      id: storyId(group.members[0]),
      headline: members.map(member => member.title).sort((left, right) => left.length - right.length)[0] || "Story",
      members,
      sources: [...new Set(members.map(member => member.source))],
      imageUrl: members.find(member => member.imageUrl)?.imageUrl || null,
    };
  });
}
