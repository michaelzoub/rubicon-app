import { describe, expect, it } from "vitest";
import { RubiconError, toUserFacingRubiconError } from "./client";

describe("toUserFacingRubiconError", () => {
  it("maps browser fetch failures to a readable network error", () => {
    const error = toUserFacingRubiconError(new TypeError("Load failed"));

    expect(error).toBeInstanceOf(RubiconError);
    expect(error.kind).toBe("network");
    expect(error.code).toBe("network_error");
    expect(error.message).toBe("Network request failed. Check your connection and try again.");
  });
});
