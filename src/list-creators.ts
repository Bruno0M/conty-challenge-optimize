import type { DatabaseSync } from "node:sqlite";
import { deliveriesSince } from "./clock.ts";
import { all, get } from "./db.ts";

export type CreatorMatch = {
  id: string;
  name: string;
  niche_score: number;
  latest_reach: number;
  deliveries_90d: number;
};

export type CreatorPage = {
  campaign_id: string;
  total: number;
  creators: CreatorMatch[];
};

type CampaignRow = { niches_json: string };
type CountRow = { n: number };
type PageRow = CreatorMatch & { total: number };

// Conta pares iguais, como o laço duplo original: nicho repetido em um dos lados soma mais de uma vez.
const MATCHED = `
  matched AS (
    SELECT c.id, c.name, COUNT(*) AS niche_score
    FROM creators c, json_each(c.niches_json) AS creator_niche, json_each(?) AS campaign_niche
    WHERE creator_niche.value = campaign_niche.value
    GROUP BY c.id
  )`;

const PAGE_SQL = `
  WITH ${MATCHED},
  reach AS (
    SELECT a.creator_id, SUM((
      SELECT m.views FROM metrics m
      WHERE m.account_id = a.id
      ORDER BY m.captured_at DESC, m.id DESC
      LIMIT 1
    )) AS latest_reach
    FROM matched
    JOIN social_accounts a ON a.creator_id = matched.id
    GROUP BY a.creator_id
  ),
  recent AS (
    SELECT d.creator_id, COUNT(*) AS n
    FROM matched
    JOIN deliveries d ON d.creator_id = matched.id
    WHERE d.delivered_at >= ?
    GROUP BY d.creator_id
  )
  SELECT matched.id, matched.name, matched.niche_score,
    COALESCE(reach.latest_reach, 0) AS latest_reach,
    COALESCE(recent.n, 0) AS deliveries_90d,
    COUNT(*) OVER () AS total
  FROM matched
  LEFT JOIN reach ON reach.creator_id = matched.id
  LEFT JOIN recent ON recent.creator_id = matched.id
  ORDER BY matched.niche_score DESC, latest_reach DESC, matched.id ASC
  LIMIT ? OFFSET ?`;

const TOTAL_SQL = `WITH ${MATCHED} SELECT COUNT(*) AS n FROM matched`;

export async function listCreators(
  db: DatabaseSync,
  input: { campaignId: string; limit: number; offset: number },
): Promise<CreatorPage | null> {
  const campaign = await get<CampaignRow>(db, "SELECT niches_json FROM campaigns WHERE id = ?", input.campaignId);
  if (!campaign) return null;

  const rows = await all<PageRow>(
    db,
    PAGE_SQL,
    campaign.niches_json,
    deliveriesSince(),
    input.limit,
    input.offset,
  );
  // Página além do fim não traz linha de onde ler o total.
  const total = rows[0]?.total ?? (await get<CountRow>(db, TOTAL_SQL, campaign.niches_json))?.n ?? 0;

  return {
    campaign_id: input.campaignId,
    total: Number(total),
    creators: rows.map(({ total: _total, ...creator }) => creator),
  };
}
