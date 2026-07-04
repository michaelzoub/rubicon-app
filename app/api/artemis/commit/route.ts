import { NextResponse } from "next/server";
import { authenticatePrivyRequest } from "@/lib/import/substack-export-auth";
import { importFromUrl } from "@/lib/import";
import { isValidOnboardingPrice } from "@/lib/import/onboarding-pricing";
import { ImportServerError, serviceClient } from "@/lib/rubicon/import-server";
import { parseSections } from "@/lib/rubicon/sections";

export const runtime = "nodejs";

interface Selection {
  id?: string;
  pricePerWordCents?: number;
}

interface CommitBody {
  handle?: string;
  authorName?: string;
  selections?: Selection[];
  globalPricePerWordCents?: number;
  accessMode?: "free" | "paid";
}

/**
 * Bulk-publish a selected Artemis profile through the same pricing handoff as
 * Substack onboarding. Article URLs are rebuilt from the validated handle and
 * ids instead of trusting client-provided URLs.
 */
export async function POST(request: Request) {
  try {
    const creatorId = await authenticatePrivyRequest(request);
    const body = await request.json() as CommitBody;
    const handle = body.handle?.trim() ?? "";
    const selections = Array.isArray(body.selections)
      ? body.selections.filter(
          (item): item is Required<Selection> =>
            typeof item.id === "string"
            && /^\d+$/.test(item.id)
            && isValidOnboardingPrice(item.pricePerWordCents),
        )
      : [];

    if (!/^[\w.-]{1,100}$/.test(handle) || selections.length === 0) {
      return responseError(400, "invalid_selection", "Select at least one Artemis article.");
    }
    if (new Set(selections.map((item) => item.id)).size !== selections.length) {
      return responseError(400, "invalid_selection", "Each Artemis article can only be selected once.");
    }

    const accessMode = body.accessMode === "free" ? "free" : "paid";
    const imported = await mapWithConcurrency(selections, 4, async (selection) => {
      const sourceUrl = `https://www.artemis.ai/${handle}/article/${selection.id}`;
      const result = await importFromUrl(sourceUrl);
      if (!result.body) {
        throw new ImportServerError(502, "article_parse_failed", `Could not read “${result.title || selection.id}” from Artemis.`);
      }
      const parsed = parseSections(result.body);
      const totalWords = parsed.reduce((sum, section) => sum + section.wordCount, 0);
      return { selection, result, parsed, totalWords };
    });

    const supabase = serviceClient();
    const now = new Date().toISOString();
    const articleRows = imported.map((item) => {
      const articleId = `article_${crypto.randomUUID()}`;
      const cents = accessMode === "free" ? 0 : item.selection.pricePerWordCents;
      return {
        articleId,
        item,
        row: {
          id: articleId,
          creator_id: creatorId,
          title: item.result.title || "Untitled article",
          author: item.result.authorName || body.authorName?.trim() || `@${handle}`,
          state: "live",
          access_mode: accessMode,
          price_per_word_atomic: String(Math.round(cents * 10_000)),
          max_article_price_atomic: String(Math.round(cents * item.totalWords * 10_000)),
          total_words: item.totalWords,
          revision: 1,
          seller_agent_config: null,
          body: item.result.body,
          is_imported: true,
          source_platform: "artemis",
          source_url: item.result.canonicalUrl,
          source_author_name: item.result.authorName,
          source_author_handle: item.result.authorHandle || handle,
          source_published_at: item.result.publishedAt,
          imported_at: now,
          import_warnings: item.result.warnings,
          is_partial_import: item.result.isPartial,
          updated_at: now,
        },
      };
    });

    let { error: articleError } = await supabase.from("articles").insert(articleRows.map((item) => item.row));
    if (articleError) {
      console.error("Artemis article insert failed", {
        code: articleError.code,
        details: articleError.details,
        hint: articleError.hint,
        message: articleError.message,
      });
      if (articleError.code === "23514" && articleError.message.includes("articles_source_platform_check")) {
        // The old constraint rejects the whole multi-row statement atomically,
        // so it is safe to retry without only the constrained marker. Keep all
        // other provenance (source URL, author, date, imported_at) intact. New
        // deployments use the migration and never take this compatibility path.
        const legacyRows = articleRows.map(({ row }) => {
          const { source_platform: _sourcePlatform, ...legacyRow } = row;
          return legacyRow;
        });
        const retry = await supabase.from("articles").insert(legacyRows);
        articleError = retry.error;
        if (!articleError) {
          console.warn("Published Artemis articles against the legacy source-platform constraint; apply the latest Supabase migration.");
        }
      }
      if (articleError) {
        throw new ImportServerError(500, "article_create_failed", "Could not publish the Artemis articles.");
      }
    }

    const sectionRows = articleRows.flatMap(({ articleId, item }) => {
      let wordStart = 0;
      return item.parsed.map((section, index) => {
        const row = {
          id: `section_${crypto.randomUUID()}`,
          article_id: articleId,
          section_id: `section-${index + 1}`,
          heading: section.title,
          level: 1,
          word_start: wordStart,
          word_count: section.wordCount,
          ordinal: index,
        };
        wordStart += section.wordCount;
        return row;
      });
    });
    if (sectionRows.length > 0) {
      const { error } = await supabase.from("article_sections").insert(sectionRows);
      if (error) throw new ImportServerError(500, "section_create_failed", "Could not save the Artemis article sections.");
    }

    const { error: revisionError } = await supabase.from("article_revisions").insert(
      articleRows.map(({ articleId, item }) => ({
        id: `revision_${crypto.randomUUID()}`,
        article_id: articleId,
        revision: 1,
        body: item.result.body,
      })),
    );
    if (revisionError) throw new ImportServerError(500, "revision_create_failed", "Could not save the Artemis article revisions.");

    if (isValidOnboardingPrice(body.globalPricePerWordCents) && body.globalPricePerWordCents > 0) {
      await supabase
        .from("creators")
        .update({ default_price_per_word_atomic: String(Math.round(body.globalPricePerWordCents * 10_000)) })
        .eq("id", creatorId);
    }

    return NextResponse.json({ imported: articleRows.length, articleIds: articleRows.map((item) => item.articleId) });
  } catch (cause) {
    if (cause instanceof ImportServerError) return responseError(cause.status, cause.code, cause.message);
    return responseError(500, "import_failed", "Could not publish the Artemis articles.");
  }
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (next < values.length) {
      const index = next++;
      results[index] = await worker(values[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

function responseError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}
