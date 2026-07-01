// Shared content types + pure helpers for the reader. Helpers are hand-rolled
// (no Intl/Date) so they render identically on server and client with no
// timezone drift on the day.

export interface Blog {
  handle: string;
  name: string;
  author: string;
  tagline?: string;
  /** hex accent for the blog; posts may override */
  accent?: string;
  /** one-line standing bio for the end card */
  bioLine?: string;
}

export interface Post {
  slug: string;
  title: string;
  /** eyebrow label, e.g. "Case study" */
  kicker?: string;
  /** hex accent; falls back to the blog accent */
  accent?: string;
  cover?: string;
  coverCaption?: string;
  /** markdown body */
  body: string;
  /** ISO date, e.g. "2026-07-01" */
  date?: string;
  status: "draft" | "published";
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2026-06-25" -> "June 25, 2026"; bare years and unparseable values pass through. */
export function formatArticleDate(date: string | undefined): string {
  if (!date) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return date;
  const mi = Number(m[2]) - 1;
  if (mi < 0 || mi > 11) return date;
  return `${MONTHS[mi]} ${Number(m[3])}, ${m[1]}`;
}

/** Reading time in whole minutes at ~200 wpm, floored at 1. */
export function readingTimeMin(body: string | undefined): number {
  const words = body ? (body.trim().match(/\S+/g) || []).length : 0;
  return Math.max(1, Math.round(words / 200));
}

/** The accent a post renders with: its own, else the blog's, else none. */
export function postAccent(blog: Blog, post: Post): string | undefined {
  return post.accent || blog.accent || undefined;
}

/** Uppercase first letter for monogram avatars. */
export function monogram(name: string): string {
  return (name.trim()[0] || "W").toUpperCase();
}
