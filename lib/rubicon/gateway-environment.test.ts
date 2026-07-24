import { describe, expect, it } from "vitest";
import { gatewayUrlForEnvironment } from "./gateway-environment";

describe("gatewayUrlForEnvironment", () => {
  it("uses the development URL by default", () => {
    expect(gatewayUrlForEnvironment({ RUBICON_GATEWAY_URL: "http://localhost:8787" })).toBe("http://localhost:8787");
  });

  it("selects the staging gateway only when APP_ENV is staging", () => {
    expect(gatewayUrlForEnvironment({
      APP_ENV: "staging",
      RUBICON_GATEWAY_URL: "https://production.example.com",
      STAGING_GATEWAY_BASE_URL: "https://staging.example.com",
    })).toBe("https://staging.example.com");
  });

  it("selects the production gateway only when APP_ENV is production", () => {
    expect(gatewayUrlForEnvironment({
      APP_ENV: "production",
      STAGING_GATEWAY_BASE_URL: "https://staging.example.com",
      PRODUCTION_GATEWAY_BASE_URL: "https://production.example.com",
    })).toBe("https://production.example.com");
  });
});
