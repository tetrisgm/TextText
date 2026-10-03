import { describe, expect, it } from "vitest";
import { strFromU8 } from "fflate";
import type { NormalizedEntry } from "@/lib/reading/feed-parse";
import { openPack, encodePack } from "@/local-vault/pack";
import { readDocument, writePayload } from "@/local-vault/model";
import { createFeedSubscriptionPack, createKeptFeedEntryPack, createReadFeedEntryPack, feedEntryHash, publicFeedURL, readFeedSubscription } from "./rss";

const entry: NormalizedEntry = {
  externalKey: "id:article-1", declaredId: "article-1", title: "A careful article",
  permalink: "https://publisher.example/posts/1", externalUrl: null,
  authors: ["Ada"], publishedAt: "2026-09-30T10:00:00Z", updatedAt: null,
  availability: "full", bodyMarkdown: "# The full article\n\nComplete text.",
  bodyText: "The full article Complete text.", excerpt: "Complete text.", language: "en",
  attachments: [{ url: "https://publisher.example/image.jpg", mimeType: "image/jpeg" }],
};

describe("file-vault feeds", () => {
  it("creates a marked, self-contained subscription pack without saving feed entries", () => {
    const created = createFeedSubscriptionPack({ feedURL: "https://publisher.example/feed.xml#fragment", title: "Publisher", description: "Daily dispatches",
      siteUrl: "https://publisher.example/", format: "rss", topic: "Design" });
    const pack = openPack(created.bytes, "Reading/Publisher.textpack", "new");
    const subscription = readFeedSubscription(pack.file);
    expect(subscription).toEqual({ feedURL: "https://publisher.example/feed.xml", title: "Publisher",
      description: "Daily dispatches", siteUrl: "https://publisher.example/", format: "rss", topic: "Design" });
    expect(readDocument(pack.file).content.tags).toEqual(["design"]);
    expect(pack.file.templateJSON).toBeTruthy();
    expect(readDocument(pack.file).content.body).toBe("Daily dispatches");
    expect(Object.keys(pack.entries)).not.toContain(pack.prefix + "feed-entry.json");
    expect(readFeedSubscription({ documentJSON: JSON.stringify({ content: { fields: { feedUrl: "https://publisher.example/feed.xml" } } }) })).toBeNull();
  });

  it("keeps only the chosen entry as a complete independent article pack", async () => {
    const kept = await createKeptFeedEntryPack({ feedURL: "https://publisher.example/feed.xml", feedTitle: "Publisher", entry, keptAt: "2026-09-30T12:00:00Z" });
    const pack = openPack(kept.bytes, "Reading/A careful article.textpack", "new");
    const document = readDocument(pack.file);
    expect(document.content.body).toBe(entry.bodyMarkdown);
    expect(document.presentation.template.id).toBe("texttext.article");
    expect(document.content.fields).toMatchObject({ texttextFeedEntry: "v1", feedTitle: "Publisher",
      feedUrl: "https://publisher.example/feed.xml", sourceUrl: entry.permalink,
      authors: ["Ada"], keptAt: "2026-09-30T12:00:00.000Z" });
    expect(pack.file.templateJSON).toBeTruthy();
    expect(JSON.parse(strFromU8(pack.entries[pack.prefix + "feed-entry.json"]))).toMatchObject({
      version: 1, declaredId: "article-1", attachments: [{ url: "https://publisher.example/image.jpg" }],
    });
    // Ordinary edits preserve the feed provenance sidecar and pinned look.
    const edited = structuredClone(document); edited.content.body += "\n\nMy note.";
    const reopened = openPack(encodePack(pack, writePayload(pack.file, edited)), pack.file.path, "next");
    expect(readDocument(reopened.file).content.body).toContain("My note.");
    expect(reopened.entries[reopened.prefix + "feed-entry.json"]).toEqual(pack.entries[pack.prefix + "feed-entry.json"]);
  });

  it("saves a feed story as a bookmark TextPack for the reading library", async () => {
    const kept = await createKeptFeedEntryPack({ feedURL: "https://publisher.example/feed.xml", feedTitle: "Publisher", entry }, "bookmark");
    const pack = openPack(kept.bytes, "Bookmarks/A careful article.textpack", "new");
    const document = readDocument(pack.file);
    expect(document.presentation.template.id).toBe("texttext.bookmark");
    expect(document.content.body).toBe(entry.bodyMarkdown);
    expect(document.content.fields).toMatchObject({ sourceUrl: entry.permalink, texttextFeedEntry: "v1" });
    expect(document.content.fields.feedEntryHash).toBe(await feedEntryHash("https://publisher.example/feed.xml", entry.externalKey));
    expect(pack.entries[pack.prefix + "feed-entry.json"]).toBeTruthy();
  });

  it("records an unsaved read as an article TextPack without a keep marker", async () => {
    const read = await createReadFeedEntryPack({ feedURL: "https://publisher.example/feed.xml", feedTitle: "Publisher", entry, readAt: "2026-10-02T12:00:00Z" });
    const file = openPack(read.bytes, "Feeds/History/A careful article.textpack", "new");
    const document = readDocument(file.file);
    expect(document.presentation.template.id).toBe("texttext.article");
    expect(document.content.fields).toMatchObject({ texttextFeedHistoryEntry: "v1", feedEntryHash: await feedEntryHash("https://publisher.example/feed.xml", entry.externalKey), readAt: "2026-10-02T12:00:00.000Z" });
    expect(document.content.fields.texttextFeedEntry).toBeUndefined();
    expect(document.content.fields.keptAt).toBeUndefined();
  });

  it("refuses credentialed endpoints and strips credentialed feed links from kept articles", async () => {
    for (const url of ["file:///etc/passwd", "https://user:pass@publisher.example/feed", "https://publisher.example/feed?api_key=secret"]) {
      expect(() => publicFeedURL(url)).toThrow();
    }
    const kept = await createKeptFeedEntryPack({ feedURL: "https://publisher.example/feed", feedTitle: "Publisher",
      entry: { ...entry, permalink: "https://user:pass@publisher.example/posts/1", externalUrl: null,
        attachments: [{ url: "https://publisher.example/image?token=secret", mimeType: "image/png" }] } });
    const pack = openPack(kept.bytes, "Reading/Kept.textpack", "new");
    expect(readDocument(pack.file).content.fields.sourceUrl).toBeUndefined();
    expect(JSON.parse(strFromU8(pack.entries[pack.prefix + "feed-entry.json"])).attachments).toEqual([]);
  });
});
