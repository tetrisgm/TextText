import type {
  DocumentFieldRow,
  DocumentFieldValue,
  DocumentSnapshot,
} from "@/lib/documents/model";

const LIVING_BRIEF_TEMPLATE_ID = "texttext.brief";
type LivingBriefSourceStatus =
  "current" | "changed" | "missing" | "unverified";

type LivingBriefClaimStatus = "supported" | "review" | "unsupported";

type LivingBriefSource = {
  sourceId: string;
  title: string;
  itemId?: string;
  url?: string;
  capturedHash?: string;
  status: LivingBriefSourceStatus;
  note?: string;
};

type LivingBriefClaim = {
  claimId: string;
  claim: string;
  sourceId: string;
  evidence?: string;
  status: LivingBriefClaimStatus;
};

type LivingBriefWritingRule = {
  instruction: string;
  scope: "document" | "selection" | "publication";
  enabled: boolean;
};

type LivingBrief = {
  sources: LivingBriefSource[];
  claims: LivingBriefClaim[];
  writingRules: LivingBriefWritingRule[];
};

export type CurrentBriefSource = {
  itemId: string;
  title: string;
  hash: string;
};

type LivingBriefSourceReview = LivingBriefSource & {
  currentHash?: string;
  affectedClaimIds: string[];
};

function rows(value: DocumentFieldValue | undefined): DocumentFieldRow[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is DocumentFieldRow =>
      typeof entry === "object" && entry !== null && !Array.isArray(entry),
  );
}

function stringValue(row: DocumentFieldRow, key: string): string | undefined {
  const value = row[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sourceStatus(value: string | undefined): LivingBriefSourceStatus {
  return value === "current" ||
    value === "changed" ||
    value === "missing" ||
    value === "unverified"
    ? value
    : "unverified";
}

function claimStatus(value: string | undefined): LivingBriefClaimStatus {
  return value === "supported" || value === "review" || value === "unsupported"
    ? value
    : "review";
}

function ruleScope(value: string | undefined): LivingBriefWritingRule["scope"] {
  return value === "selection" || value === "publication" ? value : "document";
}

export function isLivingBrief(document: DocumentSnapshot): boolean {
  return document.presentation.template.id === LIVING_BRIEF_TEMPLATE_ID;
}

export function parseLivingBrief(document: DocumentSnapshot): LivingBrief {
  const sourceRows = rows(document.content.fields.sources);
  const claimRows = rows(document.content.fields.claims);
  const ruleRows = rows(document.content.fields.writingRules);

  return {
    sources: sourceRows.flatMap((row, index) => {
      const title = stringValue(row, "title");
      if (!title) return [];
      return [
        {
          sourceId: stringValue(row, "sourceId") ?? `source-${index + 1}`,
          title,
          itemId: stringValue(row, "itemId"),
          url: stringValue(row, "url"),
          capturedHash: stringValue(row, "capturedHash"),
          status: sourceStatus(stringValue(row, "status")),
          note: stringValue(row, "note"),
        },
      ];
    }),
    claims: claimRows.flatMap((row, index) => {
      const claim = stringValue(row, "claim");
      const sourceId = stringValue(row, "sourceId");
      if (!claim || !sourceId) return [];
      return [
        {
          claimId: stringValue(row, "claimId") ?? `claim-${index + 1}`,
          claim,
          sourceId,
          evidence: stringValue(row, "evidence"),
          status: claimStatus(stringValue(row, "status")),
        },
      ];
    }),
    writingRules: ruleRows.flatMap((row) => {
      const instruction = stringValue(row, "instruction");
      if (!instruction) return [];
      return [
        {
          instruction,
          scope: ruleScope(stringValue(row, "scope")),
          enabled: row.enabled !== false,
        },
      ];
    }),
  };
}

/** The living brief is intentionally stricter than a generic rows template.
 * An agent may not call prose "grounded" unless every claim points at one
 * visible source and workspace sources record the exact version it read. */
export function validateLivingBriefDocument(
  document: DocumentSnapshot,
): DocumentSnapshot {
  if (!isLivingBrief(document)) return document;
  const brief = parseLivingBrief(document);
  if (brief.sources.length === 0) {
    throw new Error("A Living brief needs at least one source.");
  }
  if (brief.claims.length === 0) {
    throw new Error("A Living brief needs at least one claim.");
  }
  const sourceIds = new Set<string>();
  for (const source of brief.sources) {
    if (sourceIds.has(source.sourceId)) {
      throw new Error(`Source id ${source.sourceId} is duplicated.`);
    }
    sourceIds.add(source.sourceId);
    if (source.itemId && !source.capturedHash) {
      throw new Error(
        `Workspace source ${source.sourceId} needs the captured content hash.`,
      );
    }
    if (!source.itemId && !source.url) {
      throw new Error(
        `Source ${source.sourceId} needs a workspace item id or URL.`,
      );
    }
  }
  const claimIds = new Set<string>();
  for (const claim of brief.claims) {
    if (claimIds.has(claim.claimId)) {
      throw new Error(`Claim id ${claim.claimId} is duplicated.`);
    }
    claimIds.add(claim.claimId);
    if (!sourceIds.has(claim.sourceId)) {
      throw new Error(
        `Claim ${claim.claimId} references unknown source ${claim.sourceId}.`,
      );
    }
    if (claim.status === "supported" && !claim.evidence) {
      throw new Error(
        `Supported claim ${claim.claimId} needs a quoted or summarized evidence passage.`,
      );
    }
  }
  return document;
}

export function reviewLivingBriefSources(
  brief: LivingBrief,
  currentSources: readonly CurrentBriefSource[],
): {
  sources: LivingBriefSourceReview[];
  affectedClaims: LivingBriefClaim[];
  summary: Record<LivingBriefSourceStatus, number> & {
    affectedClaims: number;
  };
} {
  const currentById = new Map(
    currentSources.map((source) => [source.itemId, source] as const),
  );
  const claimsBySource = new Map<string, LivingBriefClaim[]>();
  for (const claim of brief.claims) {
    const claims = claimsBySource.get(claim.sourceId) ?? [];
    claims.push(claim);
    claimsBySource.set(claim.sourceId, claims);
  }

  const affected = new Map<string, LivingBriefClaim>();
  const reviewed = brief.sources.map((source) => {
    const current = source.itemId ? currentById.get(source.itemId) : undefined;
    const status: LivingBriefSourceStatus = !source.itemId
      ? "unverified"
      : !current
        ? "missing"
        : source.capturedHash && source.capturedHash === current.hash
          ? "current"
          : "changed";
    const affectedClaimIds =
      status === "current" || status === "unverified"
        ? []
        : (claimsBySource.get(source.sourceId) ?? []).map((claim) => {
            affected.set(claim.claimId, claim);
            return claim.claimId;
          });
    return {
      ...source,
      title: current?.title ?? source.title,
      status,
      currentHash: current?.hash,
      affectedClaimIds,
    };
  });

  return {
    sources: reviewed,
    affectedClaims: [...affected.values()],
    summary: {
      current: reviewed.filter((source) => source.status === "current").length,
      changed: reviewed.filter((source) => source.status === "changed").length,
      missing: reviewed.filter((source) => source.status === "missing").length,
      unverified: reviewed.filter((source) => source.status === "unverified")
        .length,
      affectedClaims: affected.size,
    },
  };
}
