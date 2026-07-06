import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { resetXAuthCache } from "@/lib/import/x-internal-auth";

describe("X typeahead search route", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    resetXAuthCache();
  });

  it("normalizes users, upsizes avatars, and drops invalid rows", async () => {
    vi.stubEnv("X_COOKIE", "auth_token=test; ct0=csrf");
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("guest/activate")) return Response.json({ guest_token: "gt" });
      if (url.includes("typeahead")) {
        return Response.json({
          users: [
            { id_str: "123", screen_name: "gemwriter", name: "Gem", profile_image_url_https: "https://pbs.twimg.com/pic_normal.jpg" },
            { id_str: "not-a-number", screen_name: "bad" }, // non-numeric id → skipped
            { screen_name: "nouserid" }, // missing id → skipped
          ],
        });
      }
      return Response.json({});
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://localhost/api/x/search?query=gem"));
    const body = await response.json() as { suggestions: Array<{ handle: string; userId: string; name: string; avatarUrl: string | null }> };

    expect(body.suggestions).toHaveLength(1);
    expect(body.suggestions[0]).toMatchObject({ handle: "gemwriter", userId: "123", name: "Gem" });
    expect(body.suggestions[0].avatarUrl).toBe("https://pbs.twimg.com/pic_400x400.jpg");
  });

  it("resolves an exact handle without an X session", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe("https://api.fxtwitter.com/gemwriter");
      return Response.json({
        code: 200,
        user: { id: "123", screen_name: "gemwriter", name: "Gem", avatar_url: "https://pbs.twimg.com/pic_normal.jpg" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://localhost/api/x/search?query=%40gemwriter"));
    const body = await response.json() as { suggestions: Suggestion[] };

    expect(body.suggestions).toEqual([{ handle: "gemwriter", userId: "123", name: "Gem", avatarUrl: "https://pbs.twimg.com/pic_400x400.jpg" }]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("returns [] when X rejects the request", async () => {
    vi.stubEnv("X_COOKIE", "auth_token=test; ct0=csrf");
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("guest/activate")) return Response.json({ guest_token: "gt" });
      return new Response("nope", { status: 401 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://localhost/api/x/search?query=failing"));
    const body = await response.json() as { suggestions: unknown[] };
    expect(body.suggestions).toEqual([]);
  });

  it("skips the network for too-short queries", async () => {
    const fetchMock = vi.fn(async () => Response.json({}));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://localhost/api/x/search?query=a"));
    const body = await response.json() as { suggestions: unknown[] };
    expect(body.suggestions).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

interface Suggestion {
  handle: string;
  userId: string;
  name: string;
  avatarUrl: string | null;
}
