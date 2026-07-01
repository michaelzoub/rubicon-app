/**
 * POST /api/import/extension
 *
 * Receives extracted page content from the "Send to Rubicon" browser extension
 * and creates a *draft* article (never published). Authenticated with a creator
 * extension token (Authorization: Bearer rbx_...). Validates and sanitizes the
 * payload server-side, then returns the draft id and a review URL.
 *
 * CORS: the extension calls this from a `chrome-extension://` origin. We allow
 * any origin because the request is authenticated by the bearer token, not by
 * the origin — there is no ambient cookie/session to protect against CSRF.
 */
import { NextResponse } from "next/server";
import { validateImportPayload } from "@/lib/rubicon/import";
import { importFromUrl } from "../../../../lib/import";
import { bearerFromHeader } from "@/lib/rubicon/extension-tokens";
import {
  authenticateExtensionToken,
  createImportDraft,
  ImportServerError,
  serviceClient,
} from "@/lib/rubicon/import-server";

export const runtime = "nodejs";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status, headers: CORS_HEADERS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

async function enrichNativeXArticle(raw: unknown): Promise<unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const payload = raw as Record<string, unknown>;
  if (payload.sourcePlatform !== "x" || typeof payload.sourceUrl !== "string") return raw;
  const body = typeof payload.body === "string" ? payload.body : "";
  if (body.replace(/https?:\/\/\S+/g, "").trim()) return raw;

  try {
    const imported = await importFromUrl(payload.sourceUrl);
    if (imported.isPartial || !imported.body) return raw;
    return {
      ...payload,
      title: imported.title ?? payload.title ?? null,
      subtitle: imported.subtitle ?? payload.subtitle ?? null,
      authorName: imported.authorName ?? payload.authorName ?? null,
      authorHandle: imported.authorHandle ?? payload.authorHandle ?? null,
      publishedAt: imported.publishedAt ?? payload.publishedAt ?? null,
      body: imported.body,
      sections: imported.sections,
      media: imported.media,
      rawExtractedText: imported.body,
      warnings: imported.warnings,
      isPartial: false,
    };
  } catch {
    return raw;
  }
}

function appUrl(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured;
  try {
    return new URL(request.url).origin;
  } catch {
    return "";
  }
}

export async function POST(request: Request) {
  const token = bearerFromHeader(request.headers.get("authorization"));
  if (!token) {
    return errorResponse(401, "missing_token", "Add your Rubicon extension token to the extension first.");
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return errorResponse(400, "invalid_json", "Request body must be valid JSON.");
  }

  raw = await enrichNativeXArticle(raw);
  const validation = validateImportPayload(raw);
  if (!validation.ok) {
    return errorResponse(400, validation.code, validation.message);
  }

  try {
    const supabase = serviceClient();
    const creatorId = await authenticateExtensionToken(supabase, token);
    const draft = await createImportDraft(supabase, creatorId, validation.value, appUrl(request));
    return NextResponse.json(draft, { status: 201, headers: CORS_HEADERS });
  } catch (err) {
    if (err instanceof ImportServerError) {
      return errorResponse(err.status, err.code, err.message);
    }
    console.error("extension import failed", err);
    return errorResponse(500, "import_failed", "Could not create the draft. Try again.");
  }
}
