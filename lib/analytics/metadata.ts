import "server-only";

import { serviceClient } from "@/lib/rubicon/import-server";
import type { AnalyticsArticleMetadata, AnalyticsSectionMetadata } from "./types";
import type { ArticleState } from "@/lib/rubicon/types";
import { AnalyticsError } from "./errors";

export interface AnalyticsMetadataRepository {
  articles(creatorId: string, articleIds: string[]): Promise<Map<string, AnalyticsArticleMetadata>>;
  article(creatorId: string, articleId: string): Promise<AnalyticsArticleMetadata>;
  sections(creatorId: string, articleId: string, sectionIds: string[]): Promise<Map<string, AnalyticsSectionMetadata>>;
}

export function createAnalyticsMetadataRepository(): AnalyticsMetadataRepository {
  const supabase = serviceClient();
  return {
    async articles(creatorId, articleIds) {
      const ids = uniqueBoundedIds(articleIds, 200);
      if (ids.length === 0) return new Map();
      const { data, error } = await supabase
        .from("articles")
        .select("id, title, state, access_mode")
        .eq("creator_id", creatorId)
        .in("id", ids)
        .returns<Array<{ id: string; title: string; state: ArticleState; access_mode: "paid" | "free" | null }>>();
      if (error) throw new AnalyticsError(503, "metadata_unavailable", "Article metadata is temporarily unavailable.", { cause: error });
      return new Map((data ?? []).map((row) => [row.id, mapArticle(row)]));
    },

    async article(creatorId, articleId) {
      const { data, error } = await supabase
        .from("articles")
        .select("id, title, state, access_mode")
        .eq("creator_id", creatorId)
        .eq("id", articleId)
        .neq("state", "deleted")
        .maybeSingle<{ id: string; title: string; state: ArticleState; access_mode: "paid" | "free" | null }>();
      if (error) throw new AnalyticsError(503, "metadata_unavailable", "Article metadata is temporarily unavailable.", { cause: error });
      if (!data) throw new AnalyticsError(404, "article_not_found", "Article not found.");
      return mapArticle(data);
    },

    async sections(creatorId, articleId, sectionIds) {
      const ids = uniqueBoundedIds(sectionIds, 500);
      if (ids.length === 0) return new Map();

      // Re-verify ownership in the same server-only repository before reading
      // section metadata. The browser never supplies or controls creatorId.
      await this.article(creatorId, articleId);
      const { data, error } = await supabase
        .from("article_sections")
        .select("section_id, heading")
        .eq("article_id", articleId)
        .in("section_id", ids)
        .returns<Array<{ section_id: string; heading: string }>>();
      if (error) throw new AnalyticsError(503, "metadata_unavailable", "Section metadata is temporarily unavailable.", { cause: error });
      return new Map((data ?? []).map((row) => [row.section_id, { sectionId: row.section_id, heading: row.heading }]));
    },
  };
}

function mapArticle(row: { id: string; title: string; state: ArticleState; access_mode: "paid" | "free" | null }): AnalyticsArticleMetadata {
  return { id: row.id, title: row.title, state: row.state, accessMode: row.access_mode === "free" ? "free" : "paid" };
}

function uniqueBoundedIds(values: string[], limit: number): string[] {
  return [...new Set(values.filter(Boolean))].slice(0, limit);
}
