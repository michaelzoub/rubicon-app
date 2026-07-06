import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { resetXAuthCache } from "@/lib/import/x-internal-auth";
import { resetXQueryIdCache } from "@/lib/import/x-query-id";

describe("X UserArticlesTweets route", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    resetXAuthCache();
    resetXQueryIdCache();
  });

  it("flattens the timeline, unwraps visibility envelopes, and skips non-articles", async () => {
    vi.stubEnv("X_COOKIE", "auth_token=test; ct0=csrf");
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("guest/activate")) return Response.json({ guest_token: "gt" });
      if (url.includes("UserArticlesTweets")) return Response.json(timelineFixture());
      return Response.json({});
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://localhost/api/x/articles?userId=123&handle=gemwriter"));
    const body = await response.json() as { articles: Array<{ statusId: string; title: string; url: string; wordCount: number }> };

    expect(body.articles.map((a) => a.statusId)).toEqual(["111", "222"]);
    expect(body.articles[0].url).toBe("https://x.com/gemwriter/status/111");
    expect(body.articles[0].title).toBe("First article");
    expect(body.articles[0].wordCount).toBeGreaterThan(0);
  });

  it("rejects an invalid user id", async () => {
    const response = await GET(new Request("http://localhost/api/x/articles?userId=abc&handle=gemwriter"));
    expect(response.status).toBe(400);
  });

  it("discovers a fresh query ID and retries when X rotates the operation", async () => {
    vi.stubEnv("X_COOKIE", "auth_token=test; ct0=csrf");
    let articleRequests = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("guest/activate")) return Response.json({ guest_token: "gt" });
      if (url.startsWith("https://x.com/home") || url.startsWith("https://x.com/explore")) {
        return new Response('<script src="https://abs.twimg.com/responsive-web/client-web/main.fresh.js"></script>');
      }
      if (url.includes("abs.twimg.com")) return new Response('"freshQueryId_123456789/UserArticlesTweets"');
      if (url.includes("UserArticlesTweets")) {
        articleRequests += 1;
        return articleRequests === 1 ? new Response("stale", { status: 404 }) : Response.json(timelineFixture());
      }
      return Response.json({});
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://localhost/api/x/articles?userId=456&handle=gemwriter"));
    const body = await response.json() as { articles: Array<{ statusId: string }> };

    expect(response.status).toBe(200);
    expect(articleRequests).toBe(2);
    expect(body.articles).toHaveLength(2);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("freshQueryId_123456789/UserArticlesTweets"))).toBe(true);
  });

  it("explains that profile-wide listing needs an X session", async () => {
    const response = await GET(new Request("http://localhost/api/x/articles?userId=789&handle=gemwriter"));
    const body = await response.json() as { error: { message: string } };

    expect(response.status).toBe(503);
    expect(body.error.message).toContain("requires an X session");
  });

});

function tweetEntry(restId: string, title: string, wrapped = false) {
  const tweet = {
    rest_id: restId,
    legacy: { created_at: "Wed Oct 10 20:19:24 +0000 2018" },
    article: { article_results: { result: { title, preview_text: "some preview words here" } } },
  };
  return {
    content: {
      itemContent: {
        tweet_results: {
          result: wrapped ? { __typename: "TweetWithVisibilityResults", tweet } : tweet,
        },
      },
    },
  };
}

function timelineFixture() {
  return {
    data: {
      user: {
        result: {
          timeline: {
            timeline: {
              instructions: [
                {
                  type: "TimelineAddEntries",
                  entries: [
                    tweetEntry("111", "First article"),
                    tweetEntry("222", "Second article", true),
                    // A plain tweet with no article — must be skipped.
                    { content: { itemContent: { tweet_results: { result: { rest_id: "333", legacy: {} } } } } },
                  ],
                },
              ],
            },
          },
        },
      },
    },
  };
}
