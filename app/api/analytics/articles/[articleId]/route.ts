import { authenticatePrivyRequest } from "@/lib/import/substack-export-auth";
import { loadAnalyticsConfig, parseAnalyticsDateRange } from "@/lib/analytics/config";
import { AnalyticsError, analyticsErrorResponse } from "@/lib/analytics/errors";
import { createAnalyticsService } from "@/lib/analytics/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ articleId: string }> },
): Promise<Response> {
  try {
    const creatorId = await authenticatePrivyRequest(request);
    const { articleId } = await context.params;
    if (!articleId || articleId.length > 200) {
      throw new AnalyticsError(400, "invalid_article_id", "Article id is invalid.");
    }
    const config = loadAnalyticsConfig();
    const range = parseAnalyticsDateRange(new URL(request.url).searchParams, config);
    const body = await createAnalyticsService(config).article(creatorId, articleId, range);
    return Response.json(body, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return analyticsErrorResponse(error);
  }
}
