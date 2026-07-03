import { describe, expect, it } from "vitest";
import { isValidOnboardingPrice } from "./onboarding-pricing";

describe("isValidOnboardingPrice", () => {
  it("accepts free, slider, and custom prices", () => {
    expect(isValidOnboardingPrice(0)).toBe(true);
    expect(isValidOnboardingPrice(100)).toBe(true);
    expect(isValidOnboardingPrice(125)).toBe(true);
  });

  it("rejects missing, negative, and non-finite prices", () => {
    expect(isValidOnboardingPrice(undefined)).toBe(false);
    expect(isValidOnboardingPrice(-0.01)).toBe(false);
    expect(isValidOnboardingPrice(Number.NaN)).toBe(false);
  });
});
