import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Post } from "@/lib/content";
const mocks = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock("nodemailer", () => ({ createTransport: () => ({ sendMail: mocks.sendMail }) }));
vi.mock("@/lib/store", () => ({ getBlog: async () => ({ handle: "demo" }) }));
import { sendShareInviteEmail } from "@/lib/share-email";
const input = { to: "reader@example.com", role: "commenter" as const, handle: "demo", inviterName: "Owner",
  post: { title: "Story", slug: "story" } as Post };
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("AUTH_EMAIL_SERVER", "smtp://localhost:2525"); });
afterEach(() => vi.unstubAllEnvs());
it("does not claim sent when mail is unconfigured", async () => {
  vi.stubEnv("AUTH_EMAIL_SERVER", "");
  await expect(sendShareInviteEmail(input)).resolves.toBe("not_sent");
  expect(mocks.sendMail).not.toHaveBeenCalled();
});
it("reports sent only when SMTP accepts the recipient, with accurate commenter wording", async () => {
  mocks.sendMail.mockResolvedValue({ accepted: [input.to] });
  await expect(sendShareInviteEmail(input)).resolves.toBe("sent");
  expect(mocks.sendMail).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('comment on "Story"') }));
});
it("does not claim sent for an SMTP rejection or a transport failure", async () => {
  mocks.sendMail.mockResolvedValue({ accepted: [], rejected: [input.to] });
  await expect(sendShareInviteEmail(input)).rejects.toThrow("not accepted");
  mocks.sendMail.mockRejectedValue(new Error("offline"));
  await expect(sendShareInviteEmail(input)).rejects.toThrow("offline");
});
