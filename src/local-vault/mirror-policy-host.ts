import { mirrorSharedPath, validateMirrorSharedPathObservation } from "../sync/engine/mirror-shared-path";
import { mirrorQueue, validateMirrorQueueObservation } from "../sync/engine/mirror-queue";
import { mirrorLifecycle, validateMirrorLifecycleObservation } from "../sync/engine/mirror-lifecycle";
import { mirrorDisposition, validateMirrorObservation } from "../sync/engine/mirror-policy";

import { mirrorSchedule, validateMirrorScheduleObservation } from "../sync/engine/mirror-schedule";

export const MIRROR_POLICY_VERSION = 1;
export interface MirrorScope { accountId: string; workspaceId: string; lifecycle: string }

function scope(value: unknown): MirrorScope {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Invalid mirror scope");
  const v = value as Record<string, unknown>;
  if (Object.keys(v).length !== 3 || ![v.accountId, v.workspaceId, v.lifecycle].every(
    x => typeof x === "string" && x.length > 0 && x.length <= 512 && !/[\x00-\x1f]/.test(x),
  )) throw Error("Invalid mirror scope");
  return { accountId: v.accountId as string, workspaceId: v.workspaceId as string, lifecycle: v.lifecycle as string };
}
const sameScope = (a: MirrorScope, b: MirrorScope) => a.accountId === b.accountId && a.workspaceId === b.workspaceId && a.lifecycle === b.lifecycle;

/** Pure decisions in the existing page. Binding uses a compare-and-swap
 * generation so workspace changes need no page reload. Native adapters freeze
 * their acquired generation and reject replies from a replaced connection. */
export function createMirrorPolicyHost(digest: string, pageId: string) {
  if (digest.length !== 64 || !/^[a-f0-9]{64}$/.test(digest) || !pageId) throw Error("Invalid mirror policy identity");
  let owner: MirrorScope | undefined;
  let generation = 0;
  let retired = false;
  function validateRequest(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Invalid mirror request");
    const v = value as Record<string, unknown>, requestScope = scope(v.scope);
    if (retired || !owner || !sameScope(owner, requestScope) || v.version !== MIRROR_POLICY_VERSION ||
        v.digest !== digest || v.pageId !== pageId || v.generation !== generation) throw Error("Stale mirror policy request");
    if (Object.keys(v).length !== 7 || typeof v.requestId !== "string" || !v.requestId || v.requestId.length > 128) throw Error("Invalid mirror request");
    return {v, envelope: {version: MIRROR_POLICY_VERSION, digest, pageId, generation, scope: {...owner}, requestId: v.requestId}};
  }
  return Object.freeze({
    handshake() { return { version: MIRROR_POLICY_VERSION, digest, pageId, generation }; },
    bind(value: unknown) {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Invalid mirror binding");
      const v = value as Record<string, unknown>, next = scope(v.scope);
      if (Object.keys(v).length !== 2 || retired || v.generation !== generation) throw Error("Mirror policy owner changed");
      if (!owner || !sameScope(owner, next)) {
        if (generation === Number.MAX_SAFE_INTEGER) throw Error("Mirror policy generation exhausted");
        generation++;
      }
      owner = next;
      return { version: MIRROR_POLICY_VERSION, digest, pageId, generation, scope: { ...owner } };
    },
    evaluate(value: unknown) {
      const {v, envelope} = validateRequest(value);
      const observed = validateMirrorObservation(v.observed);
      return { ...envelope, observed, disposition: mirrorDisposition(observed) };
    },
    schedule(value: unknown) {
      const {v, envelope} = validateRequest(value);
      const observed = validateMirrorScheduleObservation(v.observed);
      return { ...envelope, observed, decision: mirrorSchedule(observed) };
    },
    lifecycle(value: unknown) {
      const {v, envelope} = validateRequest(value);
      const observed = validateMirrorLifecycleObservation(v.observed);
      return { ...envelope, observed, decision: mirrorLifecycle(observed) };
    },
    sharedPath(value: unknown) {
      const {v, envelope} = validateRequest(value);
      const observed = validateMirrorSharedPathObservation(v.observed);
      return { ...envelope, observed, decision: mirrorSharedPath(observed) };
    },
    queue(value: unknown) {
      const {v, envelope} = validateRequest(value);
      const observed = validateMirrorQueueObservation(v.observed);
      return { ...envelope, observed, decision: mirrorQueue(observed) };
    },
    retire() { retired = true; },
  });
}
