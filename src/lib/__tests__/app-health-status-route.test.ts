import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadAppHealthReleaseEvaluation: vi.fn(),
}));

vi.mock("@/lib/app-health-server", () => ({
  loadAppHealthReleaseEvaluation: mocks.loadAppHealthReleaseEvaluation,
}));

import { GET } from "@/app/api/app/health/status/route";

const originalReviewToken = process.env.APP_HEALTH_REVIEW_TOKEN;
const reviewToken = "r".repeat(48);
const target = {
  appIdentifier: "net.writeapp.write.mac",
  appVersion: "0.71",
  buildNumber: "76",
};

function request(query = "version=0.71&build=76", token = reviewToken) {
  return new Request(`https://write.example/api/app/health/status?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

function evaluation(releaseReady: boolean) {
  return {
    schemaVersion: 1,
    evaluatedAt: "2026-07-14T12:00:00.000Z",
    target,
    status: releaseReady ? "pass" : "fail",
    releaseReady,
    reportCount: 0,
    policy: {},
    summaries: [],
    alerts: releaseReady
      ? []
      : [
          {
            code: "exact_release_missing",
            severity: "blocking",
            appVersion: target.appVersion,
            buildNumber: target.buildNumber,
          },
        ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.APP_HEALTH_REVIEW_TOKEN = reviewToken;
  mocks.loadAppHealthReleaseEvaluation.mockResolvedValue(evaluation(true));
});

afterAll(() => {
  if (originalReviewToken === undefined) {
    delete process.env.APP_HEALTH_REVIEW_TOKEN;
  } else {
    process.env.APP_HEALTH_REVIEW_TOKEN = originalReviewToken;
  }
});

describe("app health status route", () => {
  it("fails closed when review authentication is unconfigured", async () => {
    delete process.env.APP_HEALTH_REVIEW_TOKEN;
    const response = await GET(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      available: false,
      releaseReady: false,
      code: "review_auth_unconfigured",
    });
    expect(mocks.loadAppHealthReleaseEvaluation).not.toHaveBeenCalled();
  });

  it("rejects unauthorized and malformed release queries", async () => {
    const unauthorized = await GET(request(undefined, "wrong"));
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("www-authenticate")).toBe("Bearer");

    const malformed = await GET(request("version=0.71&build=private/path"));
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toMatchObject({
      code: "release_target_invalid",
      releaseReady: false,
    });

    const duplicate = await GET(
      request("version=0.71&version=0.70&build=76"),
    );
    expect(duplicate.status).toBe(400);

    const unknown = await GET(request("version=0.71&build=76&path=private"));
    expect(unknown.status).toBe(400);
  });

  it("returns a machine-readable exact-release evaluation", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(evaluation(true));
    expect(mocks.loadAppHealthReleaseEvaluation).toHaveBeenCalledWith({
      appVersion: "0.71",
      buildNumber: "76",
    });
  });

  it("uses an unsuccessful HTTP status for blocking alerts", async () => {
    mocks.loadAppHealthReleaseEvaluation.mockResolvedValue(evaluation(false));
    const response = await GET(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: "fail",
      releaseReady: false,
      alerts: [{ code: "exact_release_missing" }],
    });
  });

  it("does not expose database failures", async () => {
    mocks.loadAppHealthReleaseEvaluation.mockRejectedValue(
      new Error("postgres://private.example/path"),
    );
    const response = await GET(request());

    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toContain("health_data_unavailable");
    expect(body).not.toContain("private.example");
  });
});
