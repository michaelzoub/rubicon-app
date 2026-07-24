import { describe, expect, it } from "vitest";
import { nextCelebrationKey, type CompletionOutcome } from "./success-celebration-state";

describe("success celebration trigger", () => {
  it("advances exactly once for each confirmed success", () => {
    expect(nextCelebrationKey(0, "success")).toBe(1);
    expect(nextCelebrationKey(1, "success")).toBe(2);
  });

  it.each<CompletionOutcome>(["pending", "failure", "cancelled"])(
    "does not advance for %s outcomes",
    (outcome) => expect(nextCelebrationKey(4, outcome)).toBe(4),
  );
});
