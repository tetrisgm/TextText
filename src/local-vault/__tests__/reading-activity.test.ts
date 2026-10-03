import { describe, expect, it } from "vitest";
import { readingActivity } from "../reading-activity";

const day = (offset: number) => new Date(2026, 9, 3 - offset, 12).toISOString();

describe("reading activity", () => {
  it("counts distinct local calendar days and a streak through today", () => {
    expect(readingActivity([day(0), day(0), day(1), day(2), day(8)], new Date(2026, 9, 3, 18)))
      .toEqual({ daysThisWeek: 3, streak: 3 });
  });

  it("keeps yesterday's streak until today is over and ignores invalid or future reads", () => {
    expect(readingActivity([day(1), day(2), day(4), "not a date", day(-1)], new Date(2026, 9, 3, 18)))
      .toEqual({ daysThisWeek: 3, streak: 2 });
  });

  it("reports no streak when neither today nor yesterday has a completed read", () => {
    expect(readingActivity([day(2)], new Date(2026, 9, 3, 18)))
      .toEqual({ daysThisWeek: 1, streak: 0 });
  });
});
