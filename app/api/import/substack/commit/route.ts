import { NextResponse } from "next/server";
import { authenticatePrivyRequest } from "@/lib/import/substack-export-auth";
import { ImportServerError, serviceClient } from "@/lib/rubicon/import-server";

export const runtime = "nodejs";

interface Selection { id: string; pricePerWordCents: number }

export async function POST(request: Request) {
  try {
    const creatorId = await authenticatePrivyRequest(request);
    const body = await request.json() as { jobId?: string; selections?: Selection[]; substackUsername?: string };
    const selections = Array.isArray(body.selections) ? body.selections.filter((item) => item?.id && Number(item.pricePerWordCents) > 0) : [];
    if (!body.jobId || !selections.length) return responseError(400, "invalid_selection", "Select at least one importable post.");
    const supabase = serviceClient();
    const ids = selections.map((item) => item.id);
    const { data, error } = await supabase.from("creator_import_candidates")
      .select("id,source_post_id,title,subtitle,published_at,audience,word_count,plain_text_private,sections_json_private,warning,status")
      .eq("creator_id", creatorId).eq("import_job_id", body.jobId).in("id", ids).eq("status", "preview");
    if (error) throw new ImportServerError(500, "candidate_lookup_failed", "Could not load the selected posts.");
    const candidates = data ?? [];
    const priceById = new Map(selections.map((item) => [item.id, item.pricePerWordCents]));
    const now = new Date().toISOString();
    const articleRows = candidates.filter((candidate) => !candidate.warning).map((candidate) => {
      const cents = priceById.get(candidate.id)!;
      const articleId = `article_${crypto.randomUUID()}`;
      const sections = Array.isArray(candidate.sections_json_private) ? candidate.sections_json_private as Array<{ heading?: string | null; text?: string }> : [];
      const bodyText = sections.map((section) => `${section.heading ? `## ${section.heading}\n\n` : ""}${section.text ?? ""}`).join("\n\n").trim() || candidate.plain_text_private;
      return { articleId, candidate, bodyText, sections, row: {
        id: articleId, creator_id: creatorId, title: candidate.title, author: body.substackUsername?.trim() || "Substack creator",
        state: "draft", price_per_word_atomic: String(Math.round(cents * 10_000)),
        max_article_price_atomic: String(Math.round(cents * Number(candidate.word_count) * 10_000)),
        total_words: candidate.word_count, revision: 1, seller_agent_config: null, body: bodyText,
        is_imported: true, source_platform: "substack", source_url: body.substackUsername ? `https://${body.substackUsername}.substack.com` : null,
        source_author_handle: body.substackUsername || null, source_published_at: candidate.published_at,
        imported_at: now, import_warnings: [], is_partial_import: false, updated_at: now,
      }};
    });
    if (articleRows.length) {
      const { error: articleError } = await supabase.from("articles").insert(articleRows.map((item) => item.row));
      if (articleError) throw new ImportServerError(500, "draft_create_failed", "Could not create the article drafts.");
      const sectionRows = articleRows.flatMap((item) => {
        let start = 0;
        return item.sections.map((section, index) => {
          const wordCount = String(section.text ?? "").trim().split(/\s+/).filter(Boolean).length;
          const row = { id: `section_${crypto.randomUUID()}`, article_id: item.articleId, section_id: `section-${index + 1}`, heading: section.heading || `Section ${index + 1}`, level: 1, word_start: start, word_count: wordCount, ordinal: index };
          start += wordCount; return row;
        });
      });
      if (sectionRows.length) await supabase.from("article_sections").insert(sectionRows);
      await supabase.from("article_revisions").insert(articleRows.map((item) => ({ id: `revision_${crypto.randomUUID()}`, article_id: item.articleId, revision: 1, body: item.bodyText })));
      await Promise.all(articleRows.map((item) => supabase.from("creator_import_candidates").update({ status: "imported", selected_price_per_word_cents: priceById.get(item.candidate.id), updated_at: now }).eq("id", item.candidate.id)));
    }
    await supabase.from("creator_import_jobs").update({ status: "imported", imported_posts: articleRows.length, updated_at: now }).eq("id", body.jobId).eq("creator_id", creatorId);
    return NextResponse.json({ imported: articleRows.length, articleIds: articleRows.map((item) => item.articleId) });
  } catch (cause) {
    if (cause instanceof ImportServerError) return responseError(cause.status, cause.code, cause.message);
    return responseError(500, "import_failed", "Could not create the article drafts.");
  }
}
function responseError(status: number, code: string, message: string) { return NextResponse.json({ error: { code, message } }, { status }); }
