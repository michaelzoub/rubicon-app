import { describe, expect, it } from "vitest";
import { parseSubstackSubdomain, sanitizeSubstackSubdomain } from "./substack-subdomain";

describe("parseSubstackSubdomain", () => {
  it("accepts every supported input shape", () => {
    expect(parseSubstackSubdomain("wenkafka")).toBe("wenkafka");
    expect(parseSubstackSubdomain("wenkafka.substack.com")).toBe("wenkafka");
    expect(parseSubstackSubdomain("https://wenkafka.substack.com")).toBe("wenkafka");
    expect(parseSubstackSubdomain("https://wenkafka.substack.com/p/some-post-slug")).toBe("wenkafka");
    expect(parseSubstackSubdomain("@wenkafka")).toBe("wenkafka");
    expect(parseSubstackSubdomain("  https://www.wenkafka.substack.com/  ")).toBe("wenkafka");
  });

  it("tolerates trailing slashes, query strings, and uppercase", () => {
    expect(parseSubstackSubdomain("wenkafka.substack.com/")).toBe("wenkafka");
    expect(parseSubstackSubdomain("https://wenkafka.substack.com/p/post?utm_source=x")).toBe("wenkafka");
    expect(parseSubstackSubdomain("WenKafka")).toBe("wenkafka");
    expect(parseSubstackSubdomain("http://wenkafka.substack.com")).toBe("wenkafka");
  });

  it("returns null while there is no plausible candidate", () => {
    expect(parseSubstackSubdomain("")).toBeNull();
    expect(parseSubstackSubdomain("   ")).toBeNull();
    expect(parseSubstackSubdomain("wenkafka.")).toBeNull(); // mid-keystroke
    expect(parseSubstackSubdomain("https://")).toBeNull();
    expect(parseSubstackSubdomain("wenkafka.com")).toBeNull(); // custom domain
    expect(parseSubstackSubdomain("not a subdomain")).toBeNull();
  });
});

describe("sanitizeSubstackSubdomain", () => {
  it("allows only lowercase [a-z0-9-]", () => {
    expect(sanitizeSubstackSubdomain("wen-kafka9")).toBe("wen-kafka9");
    expect(sanitizeSubstackSubdomain("WenKafka")).toBe("wenkafka");
    expect(sanitizeSubstackSubdomain("wen.kafka")).toBeNull();
    expect(sanitizeSubstackSubdomain("wen_kafka")).toBeNull();
    expect(sanitizeSubstackSubdomain("wenkafka/../etc")).toBeNull();
    expect(sanitizeSubstackSubdomain("a".repeat(64))).toBeNull();
    expect(sanitizeSubstackSubdomain("")).toBeNull();
  });
});
