import { describe, expect, it } from "vitest";

import { parseAppHealthReport } from "@/lib/app-health";

const valid = {
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

describe("parseAppHealthReport", () => {
  it("accepts the content-blind wire schema", () => {
    expect(parseAppHealthReport(valid)).toEqual(valid);
  });

  it("rejects arbitrary strings, paths, and extra payload fields", () => {
    expect(
      parseAppHealthReport({
        ...valid,
        checks: [
          {
            ...valid.checks[0],
            message: "The title of a private note",
          },
        ],
      }),
    ).toBeNull();
    expect(
      parseAppHealthReport({
        ...valid,
        checks: [
          {
            ...valid.checks[0],
            metrics: { "/Users/private/file.md": 1 },
          },
        ],
      }),
    ).toBeNull();
  });

  it("rejects oversized and non-finite metrics", () => {
    expect(
      parseAppHealthReport({
        ...valid,
        checks: [{ ...valid.checks[0], metrics: { value: Infinity } }],
      }),
    ).toBeNull();
    expect(
      parseAppHealthReport({
        ...valid,
        checks: Array.from({ length: 101 }, () => valid.checks[0]),
      }),
    ).toBeNull();
    expect(
      parseAppHealthReport({
        ...valid,
        checks: [
          {
            ...valid.checks[0],
            metrics: Object.fromEntries(
              Array.from({ length: 33 }, (_, index) => [`metric_${index}`, index]),
            ),
          },
        ],
      }),
    ).toBeNull();
    expect(
      parseAppHealthReport({
        ...valid,
        checks: [
          {
            ...valid.checks[0],
            metrics: { value: 1_000_000_000_001 },
          },
        ],
      }),
    ).toBeNull();
  });
});
