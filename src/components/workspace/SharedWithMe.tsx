import Link from "next/link";
import type { SharedWithMeEntry } from "@/lib/shares";
import { blogPostPath } from "@/lib/public-paths";
import styles from "./SharedWithMe.module.css";

type SharedWithMeProps = {
  entries: SharedWithMeEntry[];
};

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function formatUpdatedAt(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return `Updated ${iso}`;

  const monthIndex = Number(match[2]) - 1;
  const month = MONTHS[monthIndex];
  if (!month) return `Updated ${iso}`;

  return `Updated ${month} ${Number(match[3])}, ${match[1]}`;
}

function roleLabel(role: SharedWithMeEntry["role"]): string {
  return role === "editor" ? "Editor" : "Viewer";
}

export function SharedWithMe({ entries }: SharedWithMeProps) {
  if (entries.length === 0) return null;

  return (
    <ul className={`applecms ${styles.list}`} aria-label="Shared with me">
      {entries.map((entry) => {
        const href = blogPostPath(
          {
            handle: entry.blogHandle,
            username: entry.blogUsername ?? undefined,
          },
          { slug: entry.slug },
        );
        const title = entry.title.trim() || "Untitled";

        return (
          <li className={styles.item} key={entry.postId}>
            <Link className={styles.link} href={href}>
              <span className={styles.main}>
                <span className={styles.title}>{title}</span>
                <span className={styles.meta}>from {entry.blogName}</span>
              </span>
              <span className={styles.side}>
                <span className={styles.roleChip}>{roleLabel(entry.role)}</span>
                <time className={styles.time} dateTime={entry.updatedAt}>
                  {formatUpdatedAt(entry.updatedAt)}
                </time>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export default SharedWithMe;
