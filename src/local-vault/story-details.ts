import type { DocumentSnapshot } from "@/lib/documents/model";

export type StoryDetails = { previewTitle?: string | null; previewSubtitle?: string | null; topics: string[]; featuredImage?: string };

export function applyStoryDetails(document: DocumentSnapshot, details: StoryDetails): DocumentSnapshot {
  const fields = { ...document.content.fields };
  if (details.previewTitle === null) delete fields.texttextPreviewTitle;
  else if (details.previewTitle !== undefined) fields.texttextPreviewTitle = details.previewTitle;
  if (details.previewSubtitle === null) delete fields.texttextPreviewSubtitle;
  else if (details.previewSubtitle !== undefined) fields.texttextPreviewSubtitle = details.previewSubtitle;
  if (details.featuredImage) fields.texttextFeaturedImage = details.featuredImage;
  return { ...document, content: { ...document.content, tags: details.topics, fields } };
}
