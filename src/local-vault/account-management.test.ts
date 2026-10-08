import { expect, it } from "vitest";
import { accountManagementURL } from "./account-management";
it("pins management to the native server and account without copying URL credentials or state", () => {
  expect(accountManagementURL("https://texttext.app/vault/other?item=old#old", "my-account")).toBe("https://texttext.app/account/sign-in-methods?account=my-account");
  expect(accountManagementURL("http://localhost:3000/vault/test", "owner")).toBe("http://localhost:3000/account/sign-in-methods?account=owner");
});
it("rejects local app URLs, insecure remote sites, credentials and invalid account IDs", () => {
  for (const site of ["file:///app", "javascript:alert(1)", "http://remote.test", "https://user:password@texttext.app", "bad"]) expect(accountManagementURL(site,"owner")).toBeNull();
  for (const id of ["", "../other", "x&account=other", "x".repeat(129)]) expect(accountManagementURL("https://texttext.app",id)).toBeNull();
});
