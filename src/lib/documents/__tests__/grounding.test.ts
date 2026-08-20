import { describe, expect, it } from "vitest";
import {
  parseLivingBrief,
  reviewLivingBriefSources,
  validateLivingBriefDocument,
} from "@/lib/documents/grounding";
import type { DocumentSnapshot } from "@/lib/documents/model";

const brief: DocumentSnapshot = {
  schemaVersion: 1,
  content: {
    title: "Launch brief",
    body: "The decision in one page.",
    tags: [],
    assets: [],
    fields: {
      sources: [
        {
          sourceId: "research",
          title: "Research notes",
          itemId: "item-research",
          capturedHash: "hash-old",
          status: "current",
        },
        {
          sourceId: "interview",
          title: "Interview transcript",
          itemId: "item-interview",
          capturedHash: "hash-gone",
          status: "current",
        },
        {
          sourceId: "web",
          title: "Public announcement",
          url: "https://example.com/announcement",
          status: "unverified",
        },
      ],
      claims: [
        {
          claimId: "claim-market",
          claim: "The audience needs a shorter setup.",
          sourceId: "research",
          evidence: "Four of five sessions stalled during setup.",
          status: "supported",
        },
        {
          claimId: "claim-language",
          claim: "People describe the product as a writing workspace.",
          sourceId: "interview",
          evidence: "Three participants called it their writing workspace.",
          status: "supported",
        },
      ],
      writingRules: [
        {
          instruction: "Use plain language.",
          scope: "publication",
          enabled: true,
        },
      ],
    },
  },
  presentation: {
    template: { id: "texttext.brief", version: 1 },
    theme: {},
  },
};

describe("living brief grounding", () => {
  it("parses sources, claims, and writing rules from canonical fields", () => {
    expect(parseLivingBrief(brief)).toMatchObject({
      sources: [
        { sourceId: "research", itemId: "item-research" },
        { sourceId: "interview", itemId: "item-interview" },
        { sourceId: "web", status: "unverified" },
      ],
      claims: [
        { claimId: "claim-market", sourceId: "research" },
        { claimId: "claim-language", sourceId: "interview" },
      ],
      writingRules: [
        {
          instruction: "Use plain language.",
          scope: "publication",
          enabled: true,
        },
      ],
    });
  });

  it("names changed and missing sources plus the claims they affect", () => {
    const review = reviewLivingBriefSources(parseLivingBrief(brief), [
      {
        itemId: "item-research",
        title: "Research notes, revised",
        hash: "hash-new",
      },
    ]);

    expect(review.summary).toEqual({
      current: 0,
      changed: 1,
      missing: 1,
      unverified: 1,
      affectedClaims: 2,
    });
    expect(review.sources[0]).toMatchObject({
      title: "Research notes, revised",
      status: "changed",
      currentHash: "hash-new",
      affectedClaimIds: ["claim-market"],
    });
    expect(review.sources[1]).toMatchObject({
      status: "missing",
      affectedClaimIds: ["claim-language"],
    });
    expect(review.affectedClaims.map((claim) => claim.claimId)).toEqual([
      "claim-market",
      "claim-language",
    ]);
  });

  it("rejects briefs that only look grounded", () => {
    expect(validateLivingBriefDocument(brief)).toBe(brief);
    const ungrounded: DocumentSnapshot = structuredClone(brief);
    ungrounded.content.fields.claims = [
      {
        claimId: "claim-invented",
        claim: "An invented assertion",
        sourceId: "source-that-does-not-exist",
        status: "supported",
      },
    ];
    expect(() => validateLivingBriefDocument(ungrounded)).toThrow(
      /unknown source/,
    );
  });
});
