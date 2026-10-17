import { describe, expect, it } from "vitest";
import { createMirrorPolicyHost } from "./mirror-policy-host";
import { mirrorDisposition, validateMirrorObservation } from "../sync/engine/mirror-policy";
import vectors from "../../sync/fixtures/mirror-policy.json";

import schedules from "../../sync/fixtures/mirror-schedule.json";

const digest = "f".repeat(64), pageId = "page-a";
const scope = { accountId: "account-a", workspaceId: "workspace", lifecycle: "connection-a" };
const observed = { localHash: "a".repeat(64), baselineHash: "a".repeat(64), remoteRevision: "remote-a", baselineRevision: "remote-a", refresh: false };
const request = { version: 1, digest, pageId, generation: 1, scope, requestId: "request-a", observed };
describe("portable mirror policy host", () => {
  it("covers all local/remote/refresh combinations, retaining upload CAS on concurrent edits", () => {
    for (const vector of vectors) expect(mirrorDisposition(validateMirrorObservation(vector.observed)), vector.name).toBe(vector.disposition);
  });
  it("runs scheduler vectors under the same scope, request and page fences", () => {
    const host = createMirrorPolicyHost(digest, pageId); host.bind({scope, generation: 0});
    for (const [index, vector] of schedules.entries()) {
      const input = {...request, requestId: "schedule-" + index, observed: vector.observed};
      expect(host.schedule(input)).toEqual({...input, decision: vector.decision});
      expect(() => host.schedule({...input, generation: 0})).toThrow("Stale");
      expect(() => host.schedule({...input, observed: {...vector.observed, operationId: "existing"}})).toThrow();
    }
    host.retire();
    expect(() => host.schedule({...request, observed: schedules[0].observed})).toThrow("Stale");
  });
  it("requires an exact build, page and bound identity and echoes immutable observations", () => {
    const host = createMirrorPolicyHost(digest, pageId);
    expect(host.handshake()).toEqual({ version: 1, digest, pageId, generation: 0 });
    expect(() => host.evaluate(request)).toThrow();
    host.bind({scope, generation: 0});
    const reply = host.evaluate(request);
    expect(reply).toEqual({ ...request, disposition: "idle" });
    expect(reply.observed).not.toBe(observed);
    expect(reply.scope).not.toBe(scope);
    for (const invalid of [{ ...request, digest: "0".repeat(64) }, { ...request, version: 2 },
      { ...request, pageId: "old-page" }, { ...request, scope: { ...scope, accountId: "account-b" } },
      { ...request, scope: { ...scope, workspaceId: "other" } }, { ...request, scope: { ...scope, lifecycle: "old" } }]) {
      expect(() => host.evaluate(invalid)).toThrow("Stale mirror policy request");
    }
  });
  it("fences replaced connections and permits a deliberate workspace change without reloading", () => {
    const host = createMirrorPolicyHost(digest, pageId);
    host.bind({scope, generation: 0}); host.bind({scope, generation: 1});
    expect(() => host.bind({scope: { ...scope, lifecycle: "new" }, generation: 0})).toThrow();
    const next = {...scope, workspaceId: "other", lifecycle: "new"};
    expect(host.bind({scope: next, generation: 1}).generation).toBe(2);
    expect(() => host.evaluate(request)).toThrow();
    expect(() => host.bind({scope, generation: 1})).toThrow();
    expect(host.evaluate({...request, scope: next, generation: 2}).disposition).toBe("idle");
    host.retire();
    expect(() => host.evaluate(request)).toThrow();
    expect(() => host.bind({scope, generation: 2})).toThrow();
    const replacement = createMirrorPolicyHost(digest, "page-b"); replacement.bind({scope, generation: 0});
    expect(() => replacement.evaluate(request)).toThrow();
  });
  it("rejects malformed observations and unknown fields rather than guessing", () => {
    expect(() => createMirrorPolicyHost(digest + "\n", pageId)).toThrow();
    for (const invalid of [null, [], {}, { ...observed, localHash: "bad" }, { ...observed, refresh: 0 },
      { ...observed, remoteRevision: "" }, { ...observed, baselineRevision: "x\n" }, { ...observed, localHash: observed.localHash + "\n" }, { ...observed, path: "/private/file" }]) {
      expect(() => validateMirrorObservation(invalid)).toThrow();
    }
    const host = createMirrorPolicyHost(digest, pageId); host.bind({scope, generation: 0});
    expect(() => host.evaluate({ ...request, requestId: "" })).toThrow();
    expect(() => host.evaluate({ ...request, token: "unexpected" })).toThrow();
    expect(() => host.bind({scope: { ...scope, token: "unexpected" }, generation: 1})).toThrow();
  });
});
