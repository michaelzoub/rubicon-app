import "server-only";

export class AnalyticsError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "AnalyticsError";
  }
}

export function controlledAnalyticsError(error: unknown): AnalyticsError {
  if (error instanceof AnalyticsError) return error;
  const candidate = error as { status?: unknown; code?: unknown };
  if (candidate?.status === 401 || candidate?.code === "missing_token" || candidate?.code === "invalid_token") {
    return new AnalyticsError(401, "unauthorized", "Your session expired. Sign in again.");
  }
  return new AnalyticsError(503, "analytics_unavailable", "Analytics are temporarily unavailable.", { cause: error });
}

export function analyticsErrorResponse(error: unknown): Response {
  const controlled = controlledAnalyticsError(error);
  return Response.json(
    { error: { code: controlled.code, message: controlled.message } },
    { status: controlled.status, headers: { "cache-control": "private, no-store" } },
  );
}
