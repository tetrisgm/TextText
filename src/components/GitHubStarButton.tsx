"use client";

import { useEffect, useState } from "react";

const repositoryHref = "https://github.com/tetrisgm/TextText";
const repositoryApiHref = "https://api.github.com/repos/tetrisgm/TextText";

export function GitHubStarButton({ initialCount = 1 }: { initialCount?: number }) {
  const [starCount, setStarCount] = useState(initialCount);

  useEffect(() => {
    const controller = new AbortController();

    fetch(repositoryApiHref, {
      cache: "no-store",
      headers: { Accept: "application/vnd.github+json" },
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error("GitHub count unavailable");
        return response.json() as Promise<{ stargazers_count?: unknown }>;
      })
      .then((repository) => {
        if (typeof repository.stargazers_count === "number") {
          setStarCount(repository.stargazers_count);
        }
      })
      .catch(() => {
        // The finished button and its last known count remain useful offline.
      });

    return () => controller.abort();
  }, []);

  const formattedCount = new Intl.NumberFormat(undefined, {
    notation: starCount >= 1000 ? "compact" : "standard",
  }).format(starCount);

  return (
    <a
      className="texttext-github-button"
      href={repositoryHref}
      target="_blank"
      rel="noreferrer"
      aria-label={`Star TextText on GitHub, ${starCount} ${
        starCount === 1 ? "star" : "stars"
      }`}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 .7a11.5 11.5 0 0 0-3.64 22.4c.58.1.79-.25.79-.56v-2.23c-3.23.7-3.91-1.37-3.91-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.78 1.19 1.78 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.58-.29-5.29-1.29-5.29-5.68 0-1.25.45-2.28 1.19-3.08-.12-.29-.52-1.47.11-3.04 0 0 .97-.31 3.16 1.18a10.95 10.95 0 0 1 5.76 0c2.19-1.49 3.15-1.18 3.15-1.18.64 1.57.24 2.75.12 3.04.74.8 1.19 1.83 1.19 3.08 0 4.4-2.72 5.38-5.31 5.67.42.36.79 1.07.79 2.16v3.2c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z" />
      </svg>
      <span>Star</span>
      <span className="texttext-github-star-count" aria-live="polite">
        {formattedCount}
      </span>
    </a>
  );
}
