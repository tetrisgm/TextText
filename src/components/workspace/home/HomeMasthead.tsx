"use client";

import { useEffect, useState } from "react";
import { fetchReadingOverview } from "@/lib/reading/client";
import styles from "./Home.module.css";

/**
 * The top of the dashboard: who is here, what day it is, and how much arrived.
 *
 * It sits above both columns rather than inside the news, so a narrow window
 * can put the workspace's own shelf first without the greeting ending up
 * halfway down the page.
 */

export function greetingFor(date: Date): string {
  const hour = date.getHours();
  if (hour < 5) return "Still up";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function HomeMasthead({ handle }: { handle: string }) {
  const [counts, setCounts] = useState<{ newToday: number; sources: number } | null>(null);
  // Set after mount, so the server's HTML and the first client render agree.
  const [today, setToday] = useState<string | null>(null);
  const [greeting, setGreeting] = useState("Welcome back");

  useEffect(() => {
    let cancelled = false;
    // The clock and the counts both land after the first paint, never during
    // it: the server has no idea what time it is where the person is, and a
    // greeting that changes on hydration is a flash of the wrong thing.
    const stamp = () => {
      if (cancelled) return;
      const now = new Date();
      setToday(now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }));
      setGreeting(greetingFor(now));
    };
    void fetchReadingOverview(handle)
      .then((overview) => {
        if (cancelled) return;
        setCounts({ newToday: overview.totals.newSince24h, sources: overview.sources.length });
        stamp();
      })
      .catch(stamp);
    return () => {
      cancelled = true;
    };
  }, [handle]);

  return (
    <div className={`applecms ${styles.masthead}`}>
      <div>
        <h1 className={styles.greeting}>{greeting}</h1>
        <p className={styles.dateline}>
          {today}
          {counts && counts.newToday > 0 && (
            <>
              {today ? " · " : ""}
              <b>{counts.newToday} new today</b>
            </>
          )}
          {counts && counts.sources > 0 && ` · ${counts.sources} ${counts.sources === 1 ? "source" : "sources"}`}
        </p>
      </div>
    </div>
  );
}
