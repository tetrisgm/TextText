import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const m=vi.hoisted(()=>({user:vi.fn(),id:vi.fn(),profile:vi.fn(),redirect:vi.fn((s:string)=>{throw new Error(s)}),notFound:vi.fn(()=>{throw new Error("not found")})}));
vi.mock("next/navigation",()=>({redirect:m.redirect,notFound:m.notFound}));
vi.mock("@/lib/session",()=>({getCurrentUser:m.user}));
vi.mock("@/lib/store",()=>({getUserIdBySub:m.id,getVaultAccountProfile:m.profile}));
vi.mock("@/auth",()=>({hasAppleProvider:true,hasGoogleProvider:true,hasGithubProvider:false}));
vi.mock("@/app/editor/connect-provider-actions",()=>({connectAccountApple:vi.fn(),connectAccountGoogle:vi.fn(),connectAccountGithub:vi.fn()}));
import Page from "./page";
const account="a1123456-1234-1234-1234-123456789abc";
const props={searchParams:Promise.resolve({account})};
beforeEach(()=>{vi.clearAllMocks();m.user.mockResolvedValue({sub:"owner"});m.id.mockResolvedValue(account);m.profile.mockResolvedValue({email:"owner@example.test",name:null,identities:["apple"]});});
it("shows only configured actions and actual connected identity",async()=>{
 const html=renderToStaticMarkup(await Page(props));expect(html).toContain("owner@example.test");expect(html).toContain("Apple · Connected");expect(html).toContain("Connect Google");expect(html).not.toContain("GitHub");expect(html).not.toContain("Log out");
});
it("requires sign in with an exact fixed return path",async()=>{
 m.user.mockResolvedValue(null);await expect(Page(props)).rejects.toThrow("/signin?callbackUrl=");expect(m.profile).not.toHaveBeenCalled();
});
it("does not expose or change another account when browser identity differs",async()=>{
 m.id.mockResolvedValue("other");const html=renderToStaticMarkup(await Page(props));expect(html).toContain("Different account");expect(html).not.toContain("Connect Google");expect(m.profile).not.toHaveBeenCalled();
});
it("rejects missing or malformed expected account",async()=>{await expect(Page({searchParams:Promise.resolve({account:"https://evil.test"})})).rejects.toThrow("not found");expect(m.user).not.toHaveBeenCalled();});
