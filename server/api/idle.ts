// api/idle.ts
// Server-authoritative offline/AFK rewards. CLOCK-CHEAT PROOF:
//   - The client NEVER sends a timestamp.
//   - Elapsed time = (server NOW) - (last_idle_sync stored in DB), both from
//     Postgres CURRENT_TIMESTAMP. The player's device clock is irrelevant.
//   - Elapsed is clamped [0, 12h] so neither a backwards nor a far-forward
//     clock (even on the server) can produce abnormal rewards.
//
// POST { playerId }                 -> preview pending idle reward (no claim)
// POST { playerId, action:"claim" } -> grant reward, reset last_idle_sync to NOW
//
// The reset uses the DB's own clock in the same UPDATE, so there's no window
// where a client value is trusted.

import { VercelRequest, VercelResponse } from "@vercel/node";
import { getPool } from "./_db";
import { computeIdleReward } from "./_progression";
import { ascensionMultiplier } from "./_progression";
import { checkRateLimit } from "./_ratelimit";

const pool = getPool();

function cors(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async (req: VercelRequest, res: VercelResponse) => {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { playerId, action } = req.body || {};
  if (!playerId) return res.status(400).json({ error: "playerId required" });

  // Abuse guard: cap idle ops at 30/min per player (claims + previews).
  if (!(await checkRateLimit(playerId, "idle", 30, 60))) {
    return res.status(429).json({ error: "rate limited", retryAfterSeconds: 60 });
  }

  const client = await pool.connect();
  try {
    // Single query computes elapsed seconds using the DB clock ONLY.
    // EXTRACT(EPOCH FROM (now() - last_idle_sync)) = seconds since last sync.
    const stateQ = await client.query(
      `SELECT p.level, p.current_chapter,
              COALESCE(a.ascension_level, 0)        AS ascension_level,
              COALESCE(i.last_idle_sync, p.created_at) AS last_sync,
              EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - COALESCE(i.last_idle_sync, p.created_at)))::float8 AS elapsed_seconds
         FROM players p
         LEFT JOIN ascensions a ON a.player_id = p.id
         LEFT JOIN idle_state i ON i.player_id = p.id
        WHERE p.id = $1`,
      [playerId]
    );
    if (stateQ.rowCount === 0) return res.status(404).json({ error: "player not found" });

    const row = stateQ.rows[0];
    const reward = computeIdleReward(
      row.elapsed_seconds,
      Number(row.level),
      Number(row.current_chapter),
      Number(row.ascension_level)
    );

    if (action !== "claim") {
      // Preview only — do NOT reset the timer.
      return res.status(200).json({
        preview: true,
        elapsedSeconds: reward.elapsedSeconds,
        cappedSeconds: reward.cappedSeconds,
        cappedOut: reward.cappedOut,
        gold: reward.gold.toString(),
        exp: reward.exp.toString(),
        idleMultiplier: ascensionMultiplier(Number(row.ascension_level)),
      });
    }

    // CLAIM: atomically read-and-reset last_idle_sync in ONE statement so
    // concurrent claims can't both see the old timestamp (no double-claim).
    // We first ensure an idle_state row exists, then do an atomic UPDATE that
    // computes elapsed from the CURRENT row value and resets it in the same op.
    await client.query("BEGIN");

    // Ensure a row exists (seeded from created_at if missing), locked.
    await client.query(
      `INSERT INTO idle_state (player_id, last_idle_sync)
       SELECT $1, p.created_at FROM players p WHERE p.id = $1
       ON CONFLICT (player_id) DO NOTHING`,
      [playerId]
    );

    // Atomic: lock the row, compute elapsed against the OLD timestamp, then reset.
    // RETURNING sees the NEW value, so we capture the old value in a CTE first.
    const claimQ = await client.query(
      `WITH old AS (
         SELECT last_idle_sync AS prev
           FROM idle_state
          WHERE player_id = $1
          FOR UPDATE
       )
       UPDATE idle_state i
          SET last_idle_sync = CURRENT_TIMESTAMP
         FROM old
        WHERE i.player_id = $1
        RETURNING EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - old.prev))::float8 AS elapsed_seconds`,
      [playerId]
    );
    const elapsedSeconds = claimQ.rows[0]?.elapsed_seconds ?? 0;

    // Recompute reward from the ATOMIC elapsed value (not the earlier preview).
    const claimReward = computeIdleReward(
      elapsedSeconds,
      Number(row.level),
      Number(row.current_chapter),
      Number(row.ascension_level)
    );

    await client.query(
      `UPDATE players
          SET gold = gold + $2,
              exp  = exp  + $3,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [playerId, claimReward.gold.toString(), claimReward.exp.toString()]
    );
    await client.query(
      `UPDATE idle_state
          SET gold_earned_idle = gold_earned_idle + $2,
              exp_earned_idle  = exp_earned_idle  + $3
        WHERE player_id = $1`,
      [playerId, claimReward.gold.toString(), claimReward.exp.toString()]
    );
    await client.query("COMMIT");

    return res.status(200).json({
      claimed: true,
      elapsedSeconds: claimReward.elapsedSeconds,
      cappedSeconds: claimReward.cappedSeconds,
      cappedOut: claimReward.cappedOut,
      goldGained: claimReward.gold.toString(),
      expGained: claimReward.exp.toString(),
    });
  } catch (e: any) {
    try { await client.query("ROLLBACK"); } catch {}
    return res.status(500).json({ error: "idle failed", detail: String(e?.message || e) });
  } finally {
    client.release();
  }
};
