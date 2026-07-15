import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  onConflictDoNothing: vi.fn(),
  resolveApiToken: vi.fn(),
  values: vi.fn(),
}));

vi.mock("@/lib/api-tokens", () => ({
  resolveApiToken: mocks.resolveApiToken,
}));

vi.mock("@/lib/db/client", () => ({
  db: { insert: mocks.insert },
}));

import { POST } from "@/app/api/app/health/route";

const report = {
  schemaVersion: 1,
  id: "d5bf9dbc-5fdf-4a39-8982-f8d5a1f6c471",
  appIdentifier: "net.writeapp.write.mac",
  appVersion: "0.70",
  buildNumber: "75",
  installationId: "6a3ca65f-1645-4e54-b199-574cf09c99cb",
  operatingSystemVersion: "macOS 15.5",
  trigger: "versionLaunch",
  generatedAt: "2026-07-14T10:00:00Z",
  status: "pass",
  checks: [
    {
      id: "bundle.identity",
      status: "pass",
      durationMilliseconds: 2,
      metrics: { version_present: 1 },
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveApiToken.mockResolvedValue({
    userId: "f5c36f80-52a1-4ec9-8ef7-388f5cb4f16d",
    sub: "000596.non-uuid-provider-subject.0435",
    scopes: "sync",
  });
  mocks.insert.mockReturnValue({ values: mocks.values });
  mocks.values.mockReturnValue({
    onConflictDoNothing: mocks.onConflictDoNothing,
  });
  mocks.onConflictDoNothing.mockResolvedValue(undefined);
});

describe("app health route", () => {
  it("stores the internal user UUID instead of the external auth subject", async () => {
    const response = await POST(
      new Request("https://write.example/api/app/health", {
        method: "POST",
        headers: {
          Authorization: "Bearer wsk_test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(report),
      }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      persisted: true,
      rollupAvailable: true,
      release: {
        appIdentifier: report.appIdentifier,
        appVersion: report.appVersion,
        buildNumber: report.buildNumber,
      },
    });
    expect(mocks.values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "f5c36f80-52a1-4ec9-8ef7-388f5cb4f16d",
      }),
    );
    expect(mocks.values).not.toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "000596.non-uuid-provider-subject.0435",
      }),
    );
  });

  it("does not accept a report that cannot enter a rollup", async () => {
    mocks.onConflictDoNothing.mockRejectedValue(
      new Error("postgres://private.example/path"),
    );
    const response = await POST(
      new Request("https://write.example/api/app/health", {
        method: "POST",
        headers: {
          Authorization: "Bearer wsk_test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(report),
      }),
    );

    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toContain("health_storage_unavailable");
    expect(body).toContain('"accepted":false');
    expect(body).not.toContain("private.example");
  });

  it("does not expose token-store failures", async () => {
    mocks.resolveApiToken.mockRejectedValue(
      new Error("postgres://private.example/token"),
    );
    const response = await POST(
      new Request("https://write.example/api/app/health", {
        method: "POST",
        headers: { Authorization: "Bearer wsk_test" },
        body: JSON.stringify(report),
      }),
    );

    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private.example");
  });
});
