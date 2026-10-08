import { encode } from "@auth/core/jwt";
import { describe, expect, it, vi } from "vitest";
import { completeOAuthAccountLink } from "../oauth-account-link";
import { mintLinkIntent } from "../link-intent";
const secret = "account-link-regression-secret";
const name = "__Secure-authjs.session-token";
async function cookie(userId = "original") { return `${name}=${await encode({ secret, salt:name, token:{userId,sub:"original-apple",email:"original@example.test"} })}`; }
describe("OAuth linking uses surviving encrypted session, not fresh callback token", () => {
  it("preserves original identity when OAuth callback token contains only new provider fields", async () => {
    const freshCallbackToken = {sub:"google-new",email:"new@example.test",name:"New"};
    expect(freshCallbackToken).not.toHaveProperty("userId");
    const link = vi.fn().mockResolvedValue("linked");
    const result = await completeOAuthAccountLink({ intent:mintLinkIntent("original",secret),secret,cookieHeader:await cookie(),secure:true,subject:"google:new",link });
    expect(result.sub).toBe("original-apple");expect(result.userId).toBe("original");expect(result.email).toBe("original@example.test");
    expect(link).toHaveBeenCalledWith("original","google:new");
  });
  it.each(["missing", "missing-intent", "mismatched", "tampered", "expired"])("fails closed for %s binding before linking",async mode=>{
    const link=vi.fn();
    await expect(completeOAuthAccountLink({intent: mode==="missing-intent"?"":mode==="expired"?mintLinkIntent("original",secret,0):mintLinkIntent("original",secret),secret,
      cookieHeader:mode==="missing"?"":mode==="tampered"?`${name}=fake`:await cookie(mode==="mismatched"?"other":"original"),secure:true,subject:"google:new",link})).rejects.toThrow();
    expect(link).not.toHaveBeenCalled();
  });
  it("rejects taken identities and propagates storage errors instead of producing a new session",async()=>{
    for(const link of [vi.fn().mockResolvedValue("taken"),vi.fn().mockRejectedValue(new Error("storage unavailable"))]) {
      await expect(completeOAuthAccountLink({intent:mintLinkIntent("original",secret),secret,cookieHeader:await cookie(),secure:true,subject:"google:new",link})).rejects.toThrow();
    }
  });
  it("supports chunked Auth.js session cookies",async()=>{
    const value=(await cookie()).slice(name.length+1);const half=Math.floor(value.length/2);
    const result=await completeOAuthAccountLink({intent:mintLinkIntent("original",secret),secret,cookieHeader:`${name}.0=${value.slice(0,half)}; ${name}.1=${value.slice(half)}`,secure:true,subject:"google:new",link:vi.fn().mockResolvedValue("already-yours")});
    expect(result.userId).toBe("original");
  });
});
