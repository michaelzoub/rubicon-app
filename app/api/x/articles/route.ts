import { NextResponse } from "next/server";
import { getXHeaders } from "@/lib/import/x-internal-auth";
import { toIso } from "@/lib/import/html";
import { getXQueryId } from "@/lib/import/x-query-id";

export const runtime = "nodejs";

/**
 * X Articles published by a selected writer.
 *
 * Proxies X's internal `UserArticlesTweets` GraphQL endpoint (keyed on the
 * numeric `userId` from the typeahead search) and flattens the timeline into
 * the tiny shape the onboarding picker needs. Each article's tweet id becomes a
 * canonical `x.com/<handle>/status/<id>` URL, which the shared URL import
 * pipeline (`importX`) turns into a full draft at publish time. Word counts here
 * are best-effort from the preview text — X's timeline doesn't ship the full
 * body — and are recomputed exactly at commit.
 */

interface ArticleSummary {
  statusId: string;
  title: string;
  wordCount: number;
  publishedAt: string | null;
  /** Canonical x.com URL, ready for the URL import pipeline. */
  url: string;
}

// X rotates GraphQL query IDs as its web bundle changes. A stale ID presents as
// a misleading 404 that looks like an authentication failure.
const GRAPHQL_BASE_URL = "https://x.com/i/api/graphql";
const GRAPHQL_OPERATION = "UserArticlesTweets";
const FALLBACK_QUERY_ID = "tC8Mkunj-1cqFwXmw0DQRg";
const FETCH_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 60 * 1000; // Writers add articles; keep this fresh-ish.
const MAX_CACHE_ENTRIES = 500;
const PAGE_COUNT = 20;

// The exact feature flags X's web client sends with this query. Sent verbatim
// because the endpoint rejects requests whose feature set it doesn't recognize.
const FEATURES = {
  rweb_video_screen_enabled: false,
  rweb_cashtags_enabled: true,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_profile_redirect_enabled: false,
  rweb_tipjar_consumption_enabled: false,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: true,
  rweb_cashtags_composer_attachment_enabled: true,
  responsive_web_jetfuel_frame: true,
  responsive_web_grok_share_attachment_enabled: true,
  responsive_web_grok_annotations_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  rweb_conversational_replies_downvote_enabled: false,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  content_disclosure_indicator_enabled: true,
  content_disclosure_ai_generated_indicator_enabled: true,
  responsive_web_grok_show_grok_translated_post: true,
  responsive_web_grok_analysis_button_from_backend: true,
  post_ctas_fetch_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: false,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_grok_imagine_annotation_enabled: true,
  responsive_web_grok_community_note_auto_translation_is_enabled: true,
  responsive_web_enhance_cards_enabled: false,
};

const cache = new Map<string, { at: number; payload: { articles: ArticleSummary[] } }>();

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const userId = (params.get("userId") ?? "").trim();
  const handle = (params.get("handle") ?? "").trim();
  if (!/^\d+$/.test(userId)) {
    return NextResponse.json({ error: { message: "Invalid X user id." } }, { status: 400 });
  }
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) {
    return NextResponse.json({ error: { message: "Invalid X handle." } }, { status: 400 });
  }
  if (!process.env.X_COOKIE?.trim()) {
    return NextResponse.json(
      { error: { message: "Importing all X Articles requires an X session. Set X_COOKIE, or paste one article link." } },
      { status: 503 },
    );
  }
  const key = userId;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json(cached.payload);
  }

  try {
    const headers = await getXHeaders();
    let queryId = FALLBACK_QUERY_ID;
    let response = await fetchArticles(queryId, userId, headers);
    if (response.status === 404) {
      queryId = await getXQueryId(GRAPHQL_OPERATION, FALLBACK_QUERY_ID, true);
      if (queryId !== FALLBACK_QUERY_ID) response = await fetchArticles(queryId, userId, headers);
    }
    if (!response.ok) {
      console.warn(`X UserArticlesTweets upstream ${response.status} (query ${queryId})`);
      throw new Error(`${GRAPHQL_OPERATION} ${response.status}`);
    }
    const body = (await response.json()) as unknown;

    const articles = extractArticles(body, handle);
    const payload = { articles };
    if (cache.size >= MAX_CACHE_ENTRIES) cache.clear();
    cache.set(key, { at: Date.now(), payload });
    return NextResponse.json(payload);
  } catch (cause) {
    console.warn("X UserArticlesTweets request failed:", cause instanceof Error ? cause.message : cause);
    return NextResponse.json(
      { error: { message: "Couldn't load articles from X. Try again." } },
      { status: 502 },
    );
  }
}

async function fetchArticles(queryId: string, userId: string, headers: Record<string, string>): Promise<Response> {
  const url = new URL(`${GRAPHQL_BASE_URL}/${queryId}/${GRAPHQL_OPERATION}`);
  url.searchParams.set("variables", JSON.stringify({ userId, count: PAGE_COUNT, includePromotedContent: true, withVoice: true }));
  url.searchParams.set("features", JSON.stringify(FEATURES));
  url.searchParams.set("fieldToggles", JSON.stringify({ withArticlePlainText: true }));
  return fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers });
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Flatten the GraphQL timeline into article summaries, defensively. */
function extractArticles(payload: unknown, handle: string): ArticleSummary[] {
  const instructions =
    (payload as any)?.data?.user?.result?.timeline?.timeline?.instructions ??
    (payload as any)?.data?.user?.result?.timeline?.instructions;
  if (!Array.isArray(instructions)) return [];

  const entries = instructions
    .filter((instruction: any) => Array.isArray(instruction?.entries))
    .flatMap((instruction: any) => instruction.entries as any[]);

  const articles: ArticleSummary[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const result = unwrapTweet(entry?.content?.itemContent?.tweet_results?.result);
    if (!result) continue;

    const statusId = typeof result.rest_id === "string" ? result.rest_id : "";
    const article = result.article?.article_results?.result;
    if (!/^\d+$/.test(statusId) || !article || seen.has(statusId)) continue;
    seen.add(statusId);

    const title = String(article.title ?? "").trim() || "Untitled article";
    const preview = String(article.preview_text ?? article.plain_text ?? "").trim();
    const createdAt = result.legacy?.created_at;

    articles.push({
      statusId,
      title,
      wordCount: countWords(`${title} ${preview}`),
      publishedAt: typeof createdAt === "string" ? toIso(createdAt) : null,
      url: `https://x.com/${handle}/status/${statusId}`,
    });
  }
  return articles;
}

/** X wraps some tweets in a visibility envelope; return the underlying tweet. */
function unwrapTweet(result: any): any | null {
  if (!result || typeof result !== "object") return null;
  if (result.__typename === "TweetWithVisibilityResults") return result.tweet ?? null;
  return result;
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}
