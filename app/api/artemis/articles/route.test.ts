import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

describe("Artemis profile articles route", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("follows total/offset pagination and counts nested block text", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/social/profile/paginated-writer")) {
        return Response.json({ id: 21531 });
      }
      const offset = Number(new URL(url).searchParams.get("offset"));
      const rows = offset === 0
        ? [article("1", "First", [
            { text: "two words" },
            { children: [{ text: "plus three words" }] },
          ]), article("2", "Second", [{ text: "one" }])]
        : [article("3", "Third", [{ text: "last page" }])];
      return Response.json({ data: rows, total: 3, limit: 20, offset });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://localhost/api/artemis/articles?handle=paginated-writer"));
    const body = await response.json() as { articles: Array<{ shortId: string; wordCount: number }> };

    expect(body.articles.map((item) => item.shortId)).toEqual(["1", "2", "3"]);
    expect(body.articles[0].wordCount).toBe(5);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toContain("offset=0");
    expect(fetchMock.mock.calls[2][0]).toContain("offset=2");
  });
});

function article(shortId: string, title: string, blocks: Array<Record<string, unknown>>) {
  return {
    short_id: shortId,
    title,
    published_at: "2026-01-01T00:00:00Z",
    body: { blocks },
  };
}
