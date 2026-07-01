import { NextResponse } from "next/server";
import { ImportError, importFromUrl } from "@/lib/import";

// Node runtime: the importer uses node:dns and streaming for SSRF defence.
export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_url", message: "Send a JSON body with a `url` field." } },
      { status: 400 },
    );
  }

  const url = (body as { url?: unknown })?.url;
  if (typeof url !== "string") {
    return NextResponse.json(
      { error: { code: "invalid_url", message: "A `url` string is required." } },
      { status: 400 },
    );
  }

  try {
    const result = await importFromUrl(url);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ImportError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: err.status },
      );
    }
    return NextResponse.json(
      { error: { code: "parse_failed", message: "Something went wrong importing that URL." } },
      { status: 500 },
    );
  }
}
