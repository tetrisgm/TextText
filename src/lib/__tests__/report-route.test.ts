// The report endpoint is the one mutation anyone on the internet can perform,
// so its edges are the product: a report must file without an account, junk
// must not become rows, and the honeypot must swallow bots without teaching
// them anything.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fileContentReport: vi.fn(),
  sendContentReportEmail: vi.fn(),
}));

vi.mock("@/lib/store", () => ({
  fileContentReport: mocks.fileContentReport,
}));
vi.mock("@/lib/moderation-email", () => ({
  sendContentReportEmail: mocks.sendContentReportEmail,
}));

const { POST } = await import("@/app/api/report/route");

function post(body: unknown): Request {
  return new Request("http://localhost/api/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.fileContentReport.mockReset().mockResolvedValue({ id: "report-1" });
  mocks.sendContentReportEmail.mockReset().mockResolvedValue(true);
});

describe("POST /api/report", () => {
  it("files a report with no session and notifies", async () => {
    const response = await POST(
      post({ path: "/blog/research/some-page", reason: "This page hosts my leaked address." }),
    );
    expect(response.status).toBe(200);
    expect(mocks.fileContentReport).toHaveBeenCalledWith({
      path: "/blog/research/some-page",
      postId: undefined,
      reason: "This page hosts my leaked address.",
      reporterEmail: undefined,
    });
    expect(mocks.sendContentReportEmail).toHaveBeenCalled();
  });

  it("keeps the optional email and document id", async () => {
    await POST(
      post({
        path: "/blog/research/some-page",
        doc: "74341338-11a9-4ca4-b205-041dc0ce3bb3",
        reason: "Reason long enough to count.",
        email: "reader@example.com",
      }),
    );
    expect(mocks.fileContentReport).toHaveBeenCalledWith(
      expect.objectContaining({
        postId: "74341338-11a9-4ca4-b205-041dc0ce3bb3",
        reporterEmail: "reader@example.com",
      }),
    );
  });

  it("swallows honeypot submissions without filing", async () => {
    const response = await POST(
      post({ path: "/blog/research/x", reason: "long enough reason", website: "http://spam" }),
    );
    // Answers success so the bot does not learn it was caught.
    expect(response.status).toBe(200);
    expect(mocks.fileContentReport).not.toHaveBeenCalled();
  });

  it("rejects a non-site path", async () => {
    for (const path of ["https://evil.example/x", "//evil.example/x", "not-a-path", ""]) {
      const response = await POST(post({ path, reason: "long enough reason" }));
      expect(response.status).toBe(400);
    }
    expect(mocks.fileContentReport).not.toHaveBeenCalled();
  });

  it("rejects a reason that says nothing", async () => {
    const response = await POST(post({ path: "/blog/research/x", reason: "bad" }));
    expect(response.status).toBe(400);
    expect(mocks.fileContentReport).not.toHaveBeenCalled();
  });

  it("says unavailable when there is no database, not ok", async () => {
    mocks.fileContentReport.mockResolvedValue(null);
    const response = await POST(
      post({ path: "/blog/research/x", reason: "long enough reason" }),
    );
    expect(response.status).toBe(503);
  });

  it("does not fail the report when only the email fails", async () => {
    mocks.sendContentReportEmail.mockResolvedValue(false);
    const response = await POST(
      post({ path: "/blog/research/x", reason: "long enough reason" }),
    );
    expect(response.status).toBe(200);
  });
});
