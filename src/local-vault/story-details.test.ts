import { describe, expect, it } from "vitest";
import { emptyDocumentSnapshot } from "@/lib/documents/model";
import { applyStoryDetails } from "./story-details";

describe("story publish details", () => {
  it("keeps the article unchanged while setting its preview and topics", () => {
    const original = emptyDocumentSnapshot({ id: "texttext.article", version: 1 });
    original.content.title = "Article title";
    original.content.subtitle = "Article subtitle";
    original.content.body = "The written story.";
    original.content.fields.cover = "assets/article-cover.png";
    const updated = applyStoryDetails(original, { previewTitle: "Preview title", previewSubtitle: "Preview subtitle",
      topics: ["writing"], featuredImage: "assets/second.png" });
    expect(updated.content.title).toBe("Article title");
    expect(updated.content.subtitle).toBe("Article subtitle");
    expect(updated.content.body).toBe("The written story.");
    expect(updated.content.fields).toEqual({ cover: "assets/article-cover.png", texttextPreviewTitle: "Preview title",
      texttextPreviewSubtitle: "Preview subtitle", texttextFeaturedImage: "assets/second.png" });
    expect(updated.content.tags).toEqual(["writing"]);
    expect(original.content.fields).toEqual({ cover: "assets/article-cover.png" });
  });

  it("resets custom preview text to follow later article edits", () => {
    const original = emptyDocumentSnapshot({ id: "texttext.article", version: 1 });
    original.content.fields.texttextPreviewTitle = "Old preview";
    original.content.fields.texttextPreviewSubtitle = "Old subtitle";
    const updated = applyStoryDetails(original, { previewTitle: null, previewSubtitle: null, topics: [] });
    expect(updated.content.fields.texttextPreviewTitle).toBeUndefined();
    expect(updated.content.fields.texttextPreviewSubtitle).toBeUndefined();
  });
});
