import { expect, it } from "vitest";
import { planFolderMove } from "@/sync/engine/folder-move-plan";
import { describeFrozenPreview } from "@/lib/ai/write-proposal-preview";
import { freezeFolderMoveReview, validateFolderMoveReview } from "./folder-move-review";

function fixture() {
  return planFolderMove({source:"Projects/One",destination:"Archive/One",manifestRevision:"a".repeat(64),folders:["Projects","Projects/One","Projects/One/Empty","Archive"],items:[{itemId:"note",relativePath:"Projects/One/Note.textpack",revision:"b".repeat(64)}],grants:[{id:"old",path:"Projects",signature:"old-folder",email:"reader@example.com",role:"viewer"},{id:"destination",path:"Archive",signature:"destination-folder",email:"editor@example.com",role:"editor"}]});
}
it("shows paths, counts and additional access without technical IDs", () => {
  const review = freezeFolderMoveReview(fixture());
  const description = describeFrozenPreview(review);
  expect(description).toContain('Move "Projects/One" to "Archive/One"');
  expect(description).toContain("1 file and 2 folders");
  expect(description).toContain("editor@example.com (editor)");
  expect(description).not.toContain(review.reviewedPlanHash);
});
it("retains an independent immutable review and refuses hidden access, changed files or replacement requests", () => {
  const plan = fixture(), review = freezeFolderMoveReview(plan);
  plan.items.length = 0;
  expect(review.plan.items).toHaveLength(1);
  const requested = {source:review.plan.source,destination:review.plan.destination};
  expect(validateFolderMoveReview(JSON.parse(JSON.stringify(review)),requested)).toEqual(review);
  for (const changes of [{items:[]},{addedAccess:[]},{preserveInherited:[]}]) {
    expect(() => validateFolderMoveReview({...review,plan:{...review.plan,...changes}},requested)).toThrow("Reviewed folder move changed");
  }
  expect(() => validateFolderMoveReview(review,{...requested,destination:"Different"})).toThrow("Reviewed folder move changed");
  expect(() => validateFolderMoveReview({...review,plan:{...review.plan,addedAccess:[{email:"someone",role:"owner",via:"Archive"}]}},requested)).toThrow();
});
it("keeps restored-file lifecycle fences and describes a move without added access", () => {
  const plan = fixture();
  const restored = {...plan,addedAccess:[],items:[{...plan.items[0],lifecycle:"restored-generation",restoreFromRevision:"c".repeat(64)}]};
  const review = freezeFolderMoveReview(restored);
  expect(review.plan.items[0]).toMatchObject({lifecycle:"restored-generation",restoreFromRevision:"c".repeat(64)});
  expect(describeFrozenPreview(review)).toContain("No additional access is granted.");
});
