import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { issueVaultPresenceSession, verifyVaultPresenceSession, VAULT_PRESENCE_SESSION_MS } from "./presence-session.server";

describe("file vault presence credentials", () => {
  beforeEach(() => vi.stubEnv("AUTH_SECRET", "test-only-vault-presence-key"));
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  it("binds a session to the authenticated account, workspace, item, epoch and awareness client", () => {
    const issued = issueVaultPresenceSession("account:person-1", "workspace-1", "item-1", 2, 42);
    const valid = verifyVaultPresenceSession(issued.sessionCredential, "account:person-1", "workspace-1", "item-1", issued.clientId);
    expect(valid).toMatchObject({ principal: "account:person-1", workspaceId: "workspace-1", itemId: "item-1", epoch: 2, awarenessClientId: 42 });
    expect(verifyVaultPresenceSession(issued.sessionCredential, "account:other", "workspace-1", "item-1", issued.clientId)).toBeNull();
    expect(verifyVaultPresenceSession(issued.sessionCredential, "account:person-1", "workspace-2", "item-1", issued.clientId)).toBeNull();
    expect(verifyVaultPresenceSession(issued.sessionCredential, "account:person-1", "workspace-1", "item-2", issued.clientId)).toBeNull();
    expect(verifyVaultPresenceSession(issued.sessionCredential, "account:person-1", "workspace-1", "item-1", "p-forged")).toBeNull();
  });
  it("expires the credential and rejects malformed awareness client identifiers", () => {
    const now = Date.now();
    const issued = issueVaultPresenceSession("account:person-1", "workspace-1", "item-1", 1, 0xffffffff);
    vi.spyOn(Date, "now").mockReturnValue(now + VAULT_PRESENCE_SESSION_MS + 1);
    expect(verifyVaultPresenceSession(issued.sessionCredential, "account:person-1", "workspace-1", "item-1", issued.clientId)).toBeNull();
    expect(() => issueVaultPresenceSession("account:person-1", "workspace-1", "item-1", 1, 0x100000000)).toThrow();
  });
});
