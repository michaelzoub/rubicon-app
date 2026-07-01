import { NextResponse } from "next/server";
import { authenticatePrivyRequest } from "@/lib/import/substack-export-auth";
import { sanitizeSubstackSubdomain } from "@/lib/import/substack-subdomain";
import { ImportServerError, serviceClient } from "@/lib/rubicon/import-server";

export const runtime = "nodejs";

/** Saves the validated publication to the creator's account (onboarding step 1). */
export async function POST(request: Request) {
  try {
    const creatorId = await authenticatePrivyRequest(request);
    const body = await request.json() as { subdomain?: string; name?: string; logoUrl?: string };
    const subdomain = sanitizeSubstackSubdomain(String(body.subdomain ?? ""));
    if (!subdomain) return error(400, "invalid_subdomain", "That doesn’t look like a Substack subdomain.");

    // TODO: ownership verification before mainnet — any signed-in writer can
    // currently claim any Substack publication.
    const supabase = serviceClient();
    const { data, error: updateError } = await supabase
      .from("creators")
      .update({
        substack_subdomain: subdomain,
        substack_publication_name: typeof body.name === "string" ? body.name.slice(0, 200) : null,
        substack_logo_url: typeof body.logoUrl === "string" && /^https:\/\//.test(body.logoUrl) ? body.logoUrl : null,
      })
      .eq("id", creatorId)
      .select("id")
      .maybeSingle<{ id: string }>();
    if (updateError) throw new ImportServerError(500, "connect_failed", "Could not save your publication.");
    if (!data) throw new ImportServerError(404, "creator_not_found", "Open the Rubicon dashboard once to finish setting up your account, then try again.");

    return NextResponse.json({ subdomain });
  } catch (cause) {
    if (cause instanceof ImportServerError) return error(cause.status, cause.code, cause.message);
    return error(500, "connect_failed", "Could not save your publication.");
  }
}

function error(status: number, code: string, message: string) { return NextResponse.json({ error: { code, message } }, { status }); }
