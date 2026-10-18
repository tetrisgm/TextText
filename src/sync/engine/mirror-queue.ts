/** Select existing durable operations only. Native adapters own queue order,
 * filesystem leases, capabilities and final revalidation. No payload, path or
 * credential crosses this boundary, and this policy never allocates an ID.
 */
export interface MirrorQueueCandidate {
  operationId: string;
  conflicted: boolean;
  editorOwned: boolean;
  recoveryBlocked: boolean;
  permitted: boolean;
}
export interface MirrorQueueObservation {
  candidates: MirrorQueueCandidate[];
  budget: number;
}
export interface MirrorQueueDecision {
  operationIds: string[];
  hasMore: boolean;
}
const fields = ["operationId", "conflicted", "editorOwned", "recoveryBlocked", "permitted"];
export function validateMirrorQueueObservation(value: unknown): MirrorQueueObservation {
  const invalid = () => { throw Error("Invalid mirror queue observation"); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const v = value as Record<string, unknown>;
  if (Object.keys(v).length !== 2 || !Object.hasOwn(v, "candidates") || !Object.hasOwn(v, "budget") ||
      !Number.isInteger(v.budget) || (v.budget as number) < 0 || (v.budget as number) > 512 ||
      !Array.isArray(v.candidates) || v.candidates.length > 40_000) return invalid();
  const ids = new Set<string>();
  const candidates = v.candidates.map((raw: unknown): MirrorQueueCandidate => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid();
    const c = raw as Record<string, unknown>;
    if (Object.keys(c).length !== fields.length || fields.some(key => !Object.hasOwn(c, key)) ||
        typeof c.operationId !== "string" || !c.operationId || c.operationId.length > 128 || /[\x00-\x1f\x7f]/.test(c.operationId) ||
        fields.slice(1).some(key => typeof c[key] !== "boolean") || ids.has(c.operationId)) return invalid();
    ids.add(c.operationId);
    return { operationId: c.operationId, conflicted: c.conflicted as boolean, editorOwned: c.editorOwned as boolean,
      recoveryBlocked: c.recoveryBlocked as boolean, permitted: c.permitted as boolean };
  });
  return { candidates, budget: v.budget as number };
}
export function mirrorQueue(input: MirrorQueueObservation): MirrorQueueDecision {
  const { candidates, budget } = validateMirrorQueueObservation(input);
  const eligible = candidates.filter(c => !c.conflicted && !c.editorOwned && !c.recoveryBlocked && c.permitted);
  return { operationIds: eligible.slice(0, budget).map(c => c.operationId), hasMore: eligible.length > budget };
}
