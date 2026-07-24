import { authenticatePrivyRequest } from "@/lib/import/substack-export-auth";
import { loadAnalyticsConfig, parseAnalyticsDateRange } from "@/lib/analytics/config";
import { analyticsErrorResponse } from "@/lib/analytics/errors";
import { createAnalyticsService } from "@/lib/analytics/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const creatorId = await authenticatePrivyRequest(request);
    const config = loadAnalyticsConfig();
    const range = parseAnalyticsDateRange(new URL(request.url).searchParams, config);
    const body = await createAnalyticsService(config).overview(creatorId, range);
    return Response.json(body, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return analyticsErrorResponse(error);
  }
}
