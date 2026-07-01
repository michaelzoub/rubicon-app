import JSZip from "jszip";
import { NextResponse } from "next/server";
import { authenticatePrivyRequest } from "@/lib/import/substack-export-auth";
import { isAllowedExportFile, MAX_ENTRY_BYTES, MAX_EXPORT_BYTES, parseSubstackExport, safeExportPath, type ExportFile } from "@/lib/import/substack-export";
import { ImportServerError, serviceClient } from "@/lib/rubicon/import-server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const creatorId = await authenticatePrivyRequest(request);
    const form = await request.formData();
    const uploads = form.getAll("files").filter((value): value is File => value instanceof File);
    if (!uploads.length) return error(400, "missing_files", "Choose a Substack export zip or folder.");
    const paths = parsePaths(form.get("paths"), uploads.length);
    let files: ExportFile[];
    let fileName: string;
    if (uploads.length === 1 && /\.zip$/i.test(uploads[0].name)) {
      fileName = uploads[0].name;
      if (uploads[0].size > MAX_EXPORT_BYTES) return error(413, "too_large", "The export must be 50 MB or smaller.");
      files = await readZip(uploads[0]);
    } else {
      fileName = paths[0]?.split("/")[0] || "Substack export folder";
      const total = uploads.reduce((sum, file) => sum + file.size, 0);
      if (total > MAX_EXPORT_BYTES) return error(413, "too_large", "The export must be 50 MB or smaller.");
      // A Substack export folder also carries images, JSON, and other assets we
      // don't need. Skip anything that isn't a CSV/HTML file (mirrors readZip)
      // rather than rejecting the whole upload — only posts.csv + the post HTML
      // matter. parseSubstackExport reports a clear error if posts.csv is absent.
      const collected = await Promise.all(uploads.map(async (file, index): Promise<ExportFile | null> => {
        const path = safeExportPath(paths[index] || file.name);
        if (!isAllowedExportFile(path) || /\.zip$/i.test(path)) return null;
        if (file.size > MAX_ENTRY_BYTES) throw new ImportServerError(413, "entry_too_large", `${file.name} is too large.`);
        return { path, content: Buffer.from(await file.arrayBuffer()) };
      }));
      files = collected.filter((file): file is ExportFile => file !== null);
    }
    const candidates = parseSubstackExport(files);
    const supabase = serviceClient();
    // The job + candidate rows have a NOT NULL FK to creators(id). A brand-new
    // writer who lands here straight from onboarding may not have a creators row
    // yet (the overview never calls ensureCreator), so the insert below would
    // fail with a foreign-key violation surfaced as "Could not save the import
    // preview." Verify the row exists and bail with a clear, actionable message.
    await requireCreator(supabase, creatorId);
    const jobId = `import_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const { error: jobError } = await supabase.from("creator_import_jobs").insert({
      id: jobId, creator_id: creatorId, source: "substack_export", status: "parsed", file_name: fileName,
      total_posts: candidates.length, published_posts: candidates.length, imported_posts: 0, updated_at: now,
    });
    if (jobError) throw new ImportServerError(500, "job_create_failed", `Could not save the import preview. ${jobError.message}`.trim());

    const rows = candidates.map((candidate) => ({
      id: `candidate_${crypto.randomUUID()}`, import_job_id: jobId, creator_id: creatorId,
      source_post_id: candidate.sourcePostId, title: candidate.title, subtitle: candidate.subtitle,
      published_at: candidate.publishedAt, audience: candidate.audience, type: candidate.type, is_published: true,
      word_count: candidate.wordCount, section_count: candidate.sections.length,
      original_html_private: candidate.originalHtml, sanitized_html_private: candidate.sanitizedHtml, plain_text_private: candidate.plainText,
      sections_json_private: candidate.sections, public_index_json: candidate.publicIndex,
      recommended_price_per_word_cents: candidate.recommendedPricePerWordCents,
      selected_price_per_word_cents: candidate.recommendedPricePerWordCents,
      estimated_max_price_cents: candidate.estimatedMaxPriceCents, status: "preview", warning: candidate.warning,
      updated_at: now,
    }));
    if (rows.length) {
      const { error: candidateError } = await supabase.from("creator_import_candidates").insert(rows);
      if (candidateError) throw new ImportServerError(500, "candidate_create_failed", `Could not save the import preview. ${candidateError.message}`.trim());
    }
    return NextResponse.json({ jobId, candidates: rows.map((row, index) => ({
      id: row.id, title: row.title, subtitle: row.subtitle, publishedAt: row.published_at, audience: row.audience,
      wordCount: row.word_count, sectionCount: row.section_count,
      recommendedPricePerWordCents: row.recommended_price_per_word_cents,
      estimatedMaxPriceCents: row.estimated_max_price_cents, warning: row.warning,
      importable: candidates[index].importable,
    })) });
  } catch (cause) {
    if (cause instanceof ImportServerError) return error(cause.status, cause.code, cause.message);
    const message = cause instanceof Error ? cause.message : "Could not read this export.";
    return error(400, "invalid_export", message);
  }
}

/** Confirm the authenticated creator has a row, so the import FKs resolve. */
async function requireCreator(supabase: ReturnType<typeof serviceClient>, creatorId: string): Promise<void> {
  const { data, error: lookupError } = await supabase.from("creators").select("id").eq("id", creatorId).maybeSingle<{ id: string }>();
  if (lookupError) throw new ImportServerError(500, "creator_lookup_failed", "Could not verify your creator account.");
  if (!data) throw new ImportServerError(404, "creator_not_found", "Open the Rubicon dashboard once to finish setting up your account, then try the import again.");
}

async function readZip(file: File): Promise<ExportFile[]> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  const files: ExportFile[] = [];
  let total = 0;
  for (const entry of entries) {
    const path = safeExportPath(entry.name);
    if (!isAllowedExportFile(path) || /\.zip$/i.test(path)) continue;
    const content = Buffer.from(await entry.async("uint8array"));
    total += content.length;
    if (content.length > MAX_ENTRY_BYTES || total > MAX_EXPORT_BYTES) throw new ImportServerError(413, "too_large", "The uncompressed export is too large.");
    files.push({ path, content });
  }
  return files;
}

function parsePaths(value: FormDataEntryValue | null, count: number): string[] {
  if (typeof value !== "string") return Array(count).fill("");
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String) : Array(count).fill(""); } catch { return Array(count).fill(""); }
}
function error(status: number, code: string, message: string) { return NextResponse.json({ error: { code, message } }, { status }); }
