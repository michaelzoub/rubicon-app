import { NextResponse } from "next/server";
import { authenticatePrivyRequest } from "@/lib/import/substack-export-auth";
import { ImportServerError, serviceClient } from "@/lib/rubicon/import-server";
import { syncArticleEmbeddings } from "@/lib/rubicon/embeddings";

export const runtime = "nodejs";

interface SyncBody {
  articleId?: string;
}

/**
 * Reconcile the semantic-search index for one article after a lifecycle change.
 *
 * The dashboard mutates articles from the browser (anon key, under RLS), but
 * embedding writes need the service role and `OPENAI_API_KEY`, so the client
 * fires this route best-effort after publish / revision bump / section edit /
 * pause / archive. The route re-reads authoritative state from the DB and
 * defers all logic to `syncArticleEmbeddings`, so it is idempotent and safe to
 * call redundantly. The gateway tolerates lag, so a failure here never blocks
 * the underlying mutation — the caller ignores errors.
 *
 * Hard deletes need no call: the FK's `on delete cascade` clears the rows.
 */
export async function POST(request: Request) {
  try {
    const creatorId = await authenticatePrivyRequest(request);
    const body = (await request.json().catch(() => ({}))) as SyncBody;
    const articleId = typeof body.articleId === "string" ? body.articleId : "";
    if (!articleId) {
      return responseError(400, "invalid_article", "An articleId is required.");
    }

    const supabase = serviceClient();

    // Only the owning creator may trigger a sync — the article carries public
    // content once live, but this gates OpenAI spend to the row's owner.
    const { data: article, error } = await supabase
      .from("articles")
      .select("creator_id")
      .eq("id", articleId)
      .maybeSingle<{ creator_id: string }>();
    if (error) {
      throw new ImportServerError(500, "article_lookup_failed", "Could not load the article.");
    }
    if (!article || article.creator_id !== creatorId) {
      return responseError(404, "article_not_found", "Article not found.");
    }

    const result = await syncArticleEmbeddings(supabase, articleId);
    return NextResponse.json(result);
  } catch (cause) {
    if (cause instanceof ImportServerError) return responseError(cause.status, cause.code, cause.message);
    return responseError(500, "embedding_sync_failed", "Could not update the search index.");
  }
}

function responseError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}
