import { isPrivatePostType, type PostType } from "@/lib/content";
import type { DocumentVisibility } from "@/lib/documents/model";

export function resolveDocumentVisibility({
  requested,
  existing,
  compatibilityType,
}: {
  requested?: DocumentVisibility;
  existing?: DocumentVisibility;
  compatibilityType: PostType;
}): DocumentVisibility {
  if (isPrivatePostType(compatibilityType)) return "private";
  return requested ?? existing ?? "private";
}
