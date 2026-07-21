import { describe, expect, it } from "vitest";
import { parseAnalyticsDay } from "./date";

describe("parseAnalyticsDay", () => {
  it("preserves a daily bucket's calendar date instead of interpreting it as UTC midnight", () => {
    const date = parseAnalyticsDay("2026-07-20");

    expect(date).not.toBeNull();
    expect([date!.getFullYear(), date!.getMonth() + 1, date!.getDate()]).toEqual([2026, 7, 20]);
  });

  it("rejects malformed and impossible calendar dates", () => {
    expect(parseAnalyticsDay("2026-02-29")).toBeNull();
    expect(parseAnalyticsDay("July 20, 2026")).toBeNull();
  });
});
