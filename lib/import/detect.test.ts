import { describe, expect, it } from "vitest";
import {
  assertHostAllowed,
  detectImportSource,
  isPrivateIp,
  parseImportUrl,
} from "./detect";
import { ImportError } from "./types";

describe("detectImportSource", () => {
  it("detects Substack subdomain post URLs", () => {
    expect(detectImportSource("https://author.substack.com/p/my-post")).toBe("substack");
    expect(detectImportSource("https://www.author.substack.com/p/my-post?utm=1")).toBe("substack");
    expect(detectImportSource("https://substack.com/home/post/p-123")).toBe("substack");
  });

  it("detects custom-domain Substack posts by /p/ path", () => {
    expect(detectImportSource("https://news.example.com/p/some-slug")).toBe("substack");
  });

  it("detects X / Twitter status URLs", () => {
    expect(detectImportSource("https://x.com/jack/status/20")).toBe("x");
    expect(detectImportSource("https://twitter.com/jack/status/20")).toBe("x");
    expect(detectImportSource("https://www.x.com/jack/status/20?s=46")).toBe("x");
    expect(detectImportSource("https://mobile.twitter.com/jack/status/20")).toBe("x");
  });

  it("rejects unsupported and malformed URLs", () => {
    expect(detectImportSource("https://medium.com/@me/post-123")).toBe("unsupported");
    expect(detectImportSource("https://x.com/jack")).toBe("unsupported"); // profile, not a status
    expect(detectImportSource("not a url")).toBe("unsupported");
    expect(detectImportSource("ftp://example.com/p/x")).toBe("unsupported");
  });
});

describe("parseImportUrl", () => {
  it("accepts public http(s) URLs", () => {
    expect(parseImportUrl("https://author.substack.com/p/x").hostname).toBe("author.substack.com");
  });

  it("rejects empty and non-URL input", () => {
    expect(() => parseImportUrl("")).toThrow(ImportError);
    expect(() => parseImportUrl("   ")).toThrow(ImportError);
    expect(() => parseImportUrl("nonsense")).toThrow(ImportError);
  });

  it("rejects non-http(s) schemes (SSRF)", () => {
    for (const url of ["file:///etc/passwd", "ftp://example.com/x", "gopher://x", "data:text/html,x"]) {
      expect(() => parseImportUrl(url)).toThrow(/http/i);
    }
  });

  it("blocks localhost and private/link-local literal IPs (SSRF)", () => {
    const blocked = [
      "http://localhost/x",
      "http://app.localhost/x",
      "http://service.internal/x",
      "http://127.0.0.1/x",
      "http://10.0.0.5/x",
      "http://172.16.4.4/x",
      "http://192.168.1.1/x",
      "http://169.254.169.254/latest/meta-data", // cloud metadata
      "http://[::1]/x",
      "http://0.0.0.0/x",
    ];
    for (const url of blocked) {
      expect(() => parseImportUrl(url), url).toThrow(ImportError);
    }
  });

  it("allows ordinary public hosts", () => {
    expect(() => parseImportUrl("https://example.com/p/post")).not.toThrow();
    expect(() => parseImportUrl("https://8.8.8.8/x")).not.toThrow();
  });
});

describe("isPrivateIp", () => {
  it("classifies private and public addresses", () => {
    expect(isPrivateIp("127.0.0.1")).toBe(true);
    expect(isPrivateIp("10.255.255.255")).toBe(true);
    expect(isPrivateIp("172.31.0.1")).toBe(true);
    expect(isPrivateIp("192.168.0.1")).toBe(true);
    expect(isPrivateIp("169.254.169.254")).toBe(true);
    expect(isPrivateIp("100.64.0.1")).toBe(true);
    expect(isPrivateIp("::1")).toBe(true);
    expect(isPrivateIp("fc00::1")).toBe(true);
    expect(isPrivateIp("fe80::1")).toBe(true);
    expect(isPrivateIp("::ffff:127.0.0.1")).toBe(true);

    expect(isPrivateIp("8.8.8.8")).toBe(false);
    expect(isPrivateIp("172.32.0.1")).toBe(false);
    expect(isPrivateIp("1.1.1.1")).toBe(false);
  });
});

describe("assertHostAllowed", () => {
  it("throws for localhost-style names", () => {
    expect(() => assertHostAllowed("localhost")).toThrow(ImportError);
    expect(() => assertHostAllowed("db.internal")).toThrow(ImportError);
  });
  it("passes public hostnames (DNS checked later in the fetcher)", () => {
    expect(() => assertHostAllowed("example.com")).not.toThrow();
  });
});
