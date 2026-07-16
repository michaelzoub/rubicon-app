import "server-only";

export interface ClickHouseQueries {
  totals: string;
  distinctTotals: string;
  daily: string;
  topArticles: string;
  articleTotals: string;
  articleDaily: string;
  articleDistinct: string;
  recentReads: string;
  freshness: string;
  sections: string;
}

/**
 * Queries the backend-owned v1 analytical model. The only interpolation is the
 * validated database identifier; every request value is a ClickHouse query
 * parameter and every result set has a server-owned bound.
 */
export function clickHouseQueries(database: string): ClickHouseQueries {
  const table = (name: string) => `\`${database}\`.\`${name}\``;
  const dateFilter = "day >= {fromDate:Date} AND day <= {toDate:Date}";
  const eventDateFilter = "occurred_at >= toDateTime64({fromTimestamp:String}, 3, 'UTC') AND occurred_at < toDateTime64({toExclusiveTimestamp:String}, 3, 'UTC')";

  return {
    totals: `
      SELECT
        toString(sum(delivered_words)) AS words_read,
        toString(sum(paid_words)) AS paid_words,
        toString(sum(gross_amount_atomic)) AS gross_amount_atomic,
        toString(sum(creator_earnings_atomic)) AS creator_amount_atomic,
        toString(sum(settled_creator_earnings_atomic)) AS settled_creator_amount_atomic
      FROM ${table("creator_daily_metrics")}
      WHERE creator_id = {creatorId:String} AND ${dateFilter}`,

    distinctTotals: `
      SELECT
        toString(uniqExact(session_id)) AS agent_reads,
        toString(uniqExactIf(buyer_agent_hash, buyer_agent_hash != '')) AS unique_agents
      FROM ${table("analytics_events")} FINAL
      WHERE event_version = 1
        AND event_type = 'read_bundle_committed'
        AND creator_id = {creatorId:String}
        AND ${eventDateFilter}`,

    daily: `
      SELECT
        toString(day) AS date,
        toString(delivered_words) AS words_read,
        toString(paid_words) AS paid_words,
        toString(agent_reads) AS agent_reads,
        toString(unique_agents) AS unique_agents,
        toString(gross_amount_atomic) AS gross_amount_atomic,
        toString(creator_earnings_atomic) AS creator_amount_atomic,
        toString(settled_creator_earnings_atomic) AS settled_creator_amount_atomic
      FROM ${table("creator_daily_metrics")}
      WHERE creator_id = {creatorId:String} AND ${dateFilter}
      ORDER BY day ASC
      LIMIT {dailyLimit:UInt32}`,

    topArticles: `
      SELECT
        article_id,
        toString(sum(delivered_words)) AS words_read,
        toString(sum(paid_words)) AS paid_words,
        toString(sum(creator_earnings_atomic)) AS creator_amount_atomic,
        toString(sum(settled_creator_earnings_atomic)) AS settled_creator_amount_atomic
      FROM ${table("article_daily_metrics")}
      WHERE creator_id = {creatorId:String} AND ${dateFilter}
      GROUP BY article_id
      ORDER BY sum(settled_creator_earnings_atomic) DESC, article_id ASC
      LIMIT {topArticleLimit:UInt32}`,

    articleTotals: `
      SELECT
        toString(sum(delivered_words)) AS words_read,
        toString(sum(paid_words)) AS paid_words,
        toString(sum(creator_earnings_atomic)) AS creator_amount_atomic,
        toString(sum(settled_creator_earnings_atomic)) AS settled_creator_amount_atomic
      FROM ${table("article_daily_metrics")}
      WHERE creator_id = {creatorId:String}
        AND article_id = {articleId:String}
        AND ${dateFilter}`,

    articleDaily: `
      SELECT
        toString(day) AS date,
        toString(delivered_words) AS words_read,
        toString(paid_words) AS paid_words,
        toString(agent_reads) AS agent_reads,
        toString(unique_agents) AS unique_agents,
        toString(gross_amount_atomic) AS gross_amount_atomic,
        toString(creator_earnings_atomic) AS creator_amount_atomic,
        toString(settled_creator_earnings_atomic) AS settled_creator_amount_atomic
      FROM ${table("article_daily_metrics")}
      WHERE creator_id = {creatorId:String}
        AND article_id = {articleId:String}
        AND ${dateFilter}
      ORDER BY day ASC
      LIMIT {dailyLimit:UInt32}`,

    articleDistinct: `
      SELECT
        article_id,
        toString(uniqExact(session_id)) AS agent_reads,
        toString(uniqExactIf(buyer_agent_hash, buyer_agent_hash != '')) AS unique_agents,
        formatDateTime(max(occurred_at), '%Y-%m-%dT%H:%i:%S.%fZ', 'UTC') AS last_read_at
      FROM ${table("analytics_events")} FINAL
      WHERE event_version = 1
        AND event_type = 'read_bundle_committed'
        AND creator_id = {creatorId:String}
        AND article_id IN {articleIds:Array(String)}
        AND ${eventDateFilter}
      GROUP BY article_id
      LIMIT {articleMetricLimit:UInt32}`,

    recentReads: `
      WITH settlement_by_bundle AS (
        SELECT bundle_id, argMax(settlement_status, occurred_at) AS settlement_status
        FROM (
          SELECT arrayJoin(bundle_ids) AS bundle_id, settlement_status, occurred_at
          FROM ${table("analytics_events")} FINAL
          WHERE event_version = 1
            AND event_type = 'settlement_changed'
            AND creator_id = {creatorId:String}
        )
        GROUP BY bundle_id
      )
      SELECT
        reads.bundle_id,
        reads.session_id,
        reads.article_id,
        formatDateTime(reads.occurred_at, '%Y-%m-%dT%H:%i:%S.%fZ', 'UTC') AS occurred_at,
        reads.access_mode,
        toString(reads.words_count) AS words_read,
        toString(reads.creator_amount_atomic) AS creator_amount_atomic,
        if(settlement.settlement_status IN ('confirmed', 'completed'), toString(reads.creator_amount_atomic), '0') AS settled_creator_amount_atomic,
        if(reads.access_mode = 'free', 'not_applicable', ifNull(nullIf(settlement.settlement_status, ''), 'pending')) AS settlement_status
      FROM ${table("analytics_events")} AS reads FINAL
      LEFT JOIN settlement_by_bundle AS settlement USING (bundle_id)
      WHERE reads.event_version = 1
        AND reads.event_type = 'read_bundle_committed'
        AND reads.creator_id = {creatorId:String}
        AND reads.occurred_at >= toDateTime64({fromTimestamp:String}, 3, 'UTC')
        AND reads.occurred_at < toDateTime64({toExclusiveTimestamp:String}, 3, 'UTC')
        AND ({articleId:String} = '' OR reads.article_id = {articleId:String})
      ORDER BY reads.occurred_at DESC, reads.bundle_id ASC
      LIMIT {recentReadLimit:UInt32}`,

    freshness: `
      SELECT
        if(count() = 0, NULL, formatDateTime(max(ingested_at), '%Y-%m-%dT%H:%i:%S.%fZ', 'UTC')) AS latest_event_at
      FROM ${table("analytics_events")} FINAL
      WHERE event_version = 1
        AND creator_id = {creatorId:String}
        AND ({articleId:String} = '' OR article_id = {articleId:String})`,

    sections: `
      SELECT
        section_id,
        toString(sum(words_count)) AS words_read,
        toString(uniqExact(session_id)) AS agent_reads
      FROM ${table("analytics_events")} FINAL
      WHERE event_version = 1
        AND event_type = 'read_bundle_committed'
        AND creator_id = {creatorId:String}
        AND article_id = {articleId:String}
        AND section_id != ''
        AND ${eventDateFilter}
      GROUP BY section_id
      ORDER BY sum(words_count) DESC, section_id ASC
      LIMIT {sectionLimit:UInt32}`,
  };
}

export const postgresQueries = {
  totals: `
    SELECT
      COALESCE(SUM(words_count), 0)::text AS words_read,
      COALESCE(SUM(words_count) FILTER (WHERE access_mode = 'paid'), 0)::text AS paid_words,
      COUNT(DISTINCT session_id)::text AS agent_reads,
      COUNT(DISTINCT buyer_wallet_address) FILTER (WHERE buyer_wallet_address IS NOT NULL)::text AS unique_agents,
      COALESCE(SUM(gross_amount_atomic), 0)::text AS gross_amount_atomic,
      COALESCE(SUM(creator_amount_atomic), 0)::text AS creator_amount_atomic,
      COALESCE(SUM(creator_amount_atomic) FILTER (WHERE payment_status = 'completed'), 0)::text AS settled_creator_amount_atomic
    FROM read_bundles
    WHERE creator_id = $1 AND created_at >= $2::date AND created_at < $3::date`,
  daily: `
    SELECT
      (created_at AT TIME ZONE 'UTC')::date::text AS date,
      SUM(words_count)::text AS words_read,
      SUM(words_count) FILTER (WHERE access_mode = 'paid')::text AS paid_words,
      COUNT(DISTINCT session_id)::text AS agent_reads,
      COUNT(DISTINCT buyer_wallet_address) FILTER (WHERE buyer_wallet_address IS NOT NULL)::text AS unique_agents,
      SUM(gross_amount_atomic)::text AS gross_amount_atomic,
      SUM(creator_amount_atomic)::text AS creator_amount_atomic,
      COALESCE(SUM(creator_amount_atomic) FILTER (WHERE payment_status = 'completed'), 0)::text AS settled_creator_amount_atomic
    FROM read_bundles
    WHERE creator_id = $1 AND created_at >= $2::date AND created_at < $3::date
    GROUP BY (created_at AT TIME ZONE 'UTC')::date
    ORDER BY (created_at AT TIME ZONE 'UTC')::date ASC
    LIMIT $4`,
  topArticles: `
    SELECT
      article_id,
      SUM(words_count)::text AS words_read,
      SUM(words_count) FILTER (WHERE access_mode = 'paid')::text AS paid_words,
      COUNT(DISTINCT session_id)::text AS agent_reads,
      COUNT(DISTINCT buyer_wallet_address) FILTER (WHERE buyer_wallet_address IS NOT NULL)::text AS unique_agents,
      SUM(creator_amount_atomic)::text AS creator_amount_atomic,
      COALESCE(SUM(creator_amount_atomic) FILTER (WHERE payment_status = 'completed'), 0)::text AS settled_creator_amount_atomic,
      MAX(created_at)::text AS last_read_at
    FROM read_bundles
    WHERE creator_id = $1 AND created_at >= $2::date AND created_at < $3::date
    GROUP BY article_id
    ORDER BY COALESCE(SUM(creator_amount_atomic) FILTER (WHERE payment_status = 'completed'), 0) DESC, article_id ASC
    LIMIT $4`,
  articleTotals: `
    SELECT
      COALESCE(SUM(words_count), 0)::text AS words_read,
      COALESCE(SUM(words_count) FILTER (WHERE access_mode = 'paid'), 0)::text AS paid_words,
      COUNT(DISTINCT session_id)::text AS agent_reads,
      COUNT(DISTINCT buyer_wallet_address) FILTER (WHERE buyer_wallet_address IS NOT NULL)::text AS unique_agents,
      COALESCE(SUM(creator_amount_atomic), 0)::text AS creator_amount_atomic,
      COALESCE(SUM(creator_amount_atomic) FILTER (WHERE payment_status = 'completed'), 0)::text AS settled_creator_amount_atomic
    FROM read_bundles
    WHERE creator_id = $1 AND article_id = $2 AND created_at >= $3::date AND created_at < $4::date`,
  articleDaily: `
    SELECT
      (created_at AT TIME ZONE 'UTC')::date::text AS date,
      SUM(words_count)::text AS words_read,
      SUM(words_count) FILTER (WHERE access_mode = 'paid')::text AS paid_words,
      COUNT(DISTINCT session_id)::text AS agent_reads,
      COUNT(DISTINCT buyer_wallet_address) FILTER (WHERE buyer_wallet_address IS NOT NULL)::text AS unique_agents,
      SUM(gross_amount_atomic)::text AS gross_amount_atomic,
      SUM(creator_amount_atomic)::text AS creator_amount_atomic,
      COALESCE(SUM(creator_amount_atomic) FILTER (WHERE payment_status = 'completed'), 0)::text AS settled_creator_amount_atomic
    FROM read_bundles
    WHERE creator_id = $1 AND article_id = $2 AND created_at >= $3::date AND created_at < $4::date
    GROUP BY (created_at AT TIME ZONE 'UTC')::date
    ORDER BY (created_at AT TIME ZONE 'UTC')::date ASC
    LIMIT $5`,
  recentReads: `
    SELECT
      bundle_id,
      session_id,
      article_id,
      created_at::text AS occurred_at,
      access_mode,
      words_count::text AS words_read,
      creator_amount_atomic::text AS creator_amount_atomic,
      CASE WHEN payment_status = 'completed' THEN creator_amount_atomic ELSE 0 END::text AS settled_creator_amount_atomic,
      CASE WHEN access_mode = 'free' THEN 'not_applicable'
           WHEN payment_status = 'authorized' THEN 'pending'
           ELSE payment_status END AS settlement_status
    FROM read_bundles
    WHERE creator_id = $1
      AND created_at >= $2::date AND created_at < $3::date
      AND ($4::text = '' OR article_id = $4)
    ORDER BY created_at DESC, bundle_id ASC
    LIMIT $5`,
  freshness: `
    SELECT MAX(GREATEST(created_at, updated_at))::text AS latest_event_at
    FROM read_bundles
    WHERE creator_id = $1 AND ($2::text = '' OR article_id = $2)`,
  sections: `
    SELECT section_id, SUM(words_count)::text AS words_read, COUNT(DISTINCT session_id)::text AS agent_reads
    FROM read_bundles
    WHERE creator_id = $1 AND article_id = $2 AND section_id IS NOT NULL
      AND created_at >= $3::date AND created_at < $4::date
    GROUP BY section_id
    ORDER BY SUM(words_count) DESC, section_id ASC
    LIMIT $5`,
} as const;
