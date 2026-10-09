import { useEffect, useRef, useState } from "react";
import type { VaultListing } from "./bridge";
import { vaultRequest } from "./bridge";
import { ARTICLE_ENRICHMENT_EVENT, ARTICLE_ENRICHMENT_CHANGED_EVENT, readArticleEnrichmentQueue, removeArticleEnrichment,
  runArticleEnrichmentTick } from "./article-enrichment";

export function ArticleEnrichmentWorker({ listing, enabled, skipPath, onChanged }: {
  listing: VaultListing;
  enabled: boolean;
  skipPath?: string;
  onChanged: () => void;
}) {
  const onChangedRef = useRef(onChanged);
  const [queuedRevision, setQueuedRevision] = useState(0);
  useEffect(() => { onChangedRef.current = onChanged; }, [onChanged]);
  useEffect(() => {
    const queued = (event: Event) => {
      const root = (event as CustomEvent<{ root?: unknown }>).detail?.root;
      if (root === listing.root) setQueuedRevision((value) => value + 1);
    };
    window.addEventListener(ARTICLE_ENRICHMENT_EVENT, queued);
    return () => window.removeEventListener(ARTICLE_ENRICHMENT_EVENT, queued);
  }, [listing.root]);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const controller = new AbortController();
    void Promise.resolve().then(async () => {
      const attempted = new Set<string>();
      for (;;) {
        const paths = readArticleEnrichmentQueue(listing.root);
        const path = paths.find((entry) => entry !== skipPath && !attempted.has(entry));
        if (!active || !path) return;
        attempted.add(path);
        try {
          const result = await runArticleEnrichmentTick([path], vaultRequest, { signal: controller.signal });
          if (!active) return;
          if (result.outcome) removeArticleEnrichment(listing.root, path);
          if (result.outcome === "written" || result.outcome === "failed") {
            window.dispatchEvent(new CustomEvent(ARTICLE_ENRICHMENT_CHANGED_EVENT, { detail: { path } }));
            onChangedRef.current();
          }
        } catch (error) {
          if (controller.signal.aborted) throw error;
          // Keep this path for a later app session or queue event, then let
          // other newly created links continue in this bounded pass.
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
      }
    }).catch(() => { /* The saved links remain available for the next scan or explicit retry. */ });
    return () => { active = false; controller.abort(); };
  }, [enabled, listing.root, queuedRevision, skipPath]);
  return null;
}
