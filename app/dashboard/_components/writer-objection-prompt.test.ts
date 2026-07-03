// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hasSeenWriterObjectionPrompt,
  markWriterObjectionPromptSeen,
  OBJECTION_OPTIONS,
  writerHomeUrl,
} from "./writer-objection";

describe("writer objection prompt", () => {
  afterEach(() => {
    window.sessionStorage.clear();
    vi.unstubAllEnvs();
  });

  it("uses the established objection options", () => {
    expect(OBJECTION_OPTIONS.map(({ value }) => value)).toEqual([
      "trust_and_pricing",
      "wallet_and_setup",
      "content_risk",
      "not_ready",
    ]);
  });

  it("records and reads the session-scoped prompt guard", () => {
    expect(hasSeenWriterObjectionPrompt()).toBe(false);
    markWriterObjectionPromptSeen();
    expect(window.sessionStorage.getItem("rubicon_writer_objection_prompt_seen")).toBe("1");
    expect(hasSeenWriterObjectionPrompt()).toBe(true);
  });

  it("uses the configured home URL", () => {
    vi.stubEnv("NEXT_PUBLIC_RUBICON_HOME_URL", "https://home.example");
    expect(writerHomeUrl()).toBe("https://home.example");
  });

  it("falls back to localhost outside production", () => {
    vi.stubEnv("NEXT_PUBLIC_RUBICON_HOME_URL", undefined);
    vi.stubEnv("NODE_ENV", "development");
    expect(writerHomeUrl()).toBe("http://localhost:3000");
  });

  it("falls back to the Rubicon site in production", () => {
    vi.stubEnv("NEXT_PUBLIC_RUBICON_HOME_URL", undefined);
    vi.stubEnv("NODE_ENV", "production");
    expect(writerHomeUrl()).toBe("https://rubiconpay.xyz");
  });
});
