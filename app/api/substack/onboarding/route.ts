import { NextResponse } from "next/server";
import { authenticatePrivyRequest } from "@/lib/import/substack-export-auth";
import { ImportServerError, serviceClient } from "@/lib/rubicon/import-server";

export const runtime = "nodejs";

/**
 * Where the signed-in creator is in Substack onboarding, so a closed tab or a
 * refresh resumes at the right step: the connected publication (step 1 done)
 * and the latest parsed-but-not-imported export (step 2 done, price pending).
 */
export async function GET(request: Request) {
  try {
    const creatorId = await authenticatePrivyRequest(request);
    const supabase = serviceClient();

    const { data: creator, error: creatorError } = await supabase
      .from("creators")
      .select("substack_subdomain, substack_publication_name, substack_logo_url")
      .eq("id", creatorId)
      .maybeSingle<{ substack_subdomain: string | null; substack_publication_name: string | null; substack_logo_url: string | null }>();
    if (creatorError) throw new ImportServerError(500, "state_lookup_failed", "Could not load your onboarding progress.");
    if (!creator?.substack_subdomain) return NextResponse.json({ subdomain: null, name: null, logoUrl: null, pendingArchive: null });

    const { data: job } = await supabase
      .from("creator_import_jobs")
      .select("id")
      .eq("creator_id", creatorId)
      .eq("source", "substack_export")
      .eq("status", "parsed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string }>();

    let pendingArchive: {
      jobId: string;
      postCount: number;
      totalWordCount: number;
      averageWordCount: number;
      recommendedPriceUsd: number;
      posts: Array<{ id: string; title: string; wordCount: number }>;
    } | null = null;
    if (job) {
      const { data: rows } = await supabase
        .from("creator_import_candidates")
        .select("id, title, word_count, warning, recommended_price_per_word_cents")
        .eq("import_job_id", job.id)
        .eq("status", "preview")
        .order("created_at", { ascending: true });
      const importable = (rows ?? []).filter((row) => !row.warning);
      if (importable.length) {
        const totalWordCount = importable.reduce((sum, row) => sum + Number(row.word_count || 0), 0);
        // Word-weighted mean of the per-post recommendations (cents → dollars).
        const weightedCents = importable.reduce(
          (sum, row) => sum + Number(row.recommended_price_per_word_cents || 0) * Number(row.word_count || 0),
          0,
        );
        pendingArchive = {
          jobId: job.id,
          postCount: importable.length,
          totalWordCount,
          averageWordCount: Math.round(totalWordCount / importable.length),
          recommendedPriceUsd: totalWordCount > 0 ? weightedCents / totalWordCount / 100 : 0,
          posts: importable.map((row) => ({ id: String(row.id), title: String(row.title ?? ""), wordCount: Number(row.word_count || 0) })),
        };
      }
    }

    return NextResponse.json({
      subdomain: creator.substack_subdomain,
      name: creator.substack_publication_name,
      logoUrl: creator.substack_logo_url,
      pendingArchive,
    });
  } catch (cause) {
    if (cause instanceof ImportServerError) return error(cause.status, cause.code, cause.message);
    return error(500, "state_lookup_failed", "Could not load your onboarding progress.");
  }
}

function error(status: number, code: string, message: string) { return NextResponse.json({ error: { code, message } }, { status }); }
