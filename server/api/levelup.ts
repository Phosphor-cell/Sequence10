// api/levelup.ts
// Server-authoritative level processing. The client never decides levels or
// stats — it sends exp earned (from a validated battle) and the server applies
// the curve, grants levels, and scales stat gains by ascension multiplier.
//
// POST { playerId, addExp }   (addExp optional; 0 just recomputes/repairs)
//   -> new level, exp, expToNext, levelsGained, stat deltas
//
// Idempotency note: this mutates by ADDING exp. Battles should call this once
// per resolved battle (server-side) rather than the client calling it freely.

import { VercelRequest, VercelResponse } from "@vercel/node";
import { getPool } from "./_db";
import { applyExp, statGainForLevel } from "./_progression";
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

  const { playerId } = req.body || {};
  if (!playerId) return res.status(400).json({ error: "playerId required" });

  // Abuse guard: cap levelups at 60/min per player.
  if (!(await checkRateLimit(playerId, "levelup", 60, 60))) {
    return res.status(429).json({ error: "rate limited", retryAfterSeconds: 60 });
  }
  let addExp = 0n;
  try { addExp = BigInt(String(req.body.addExp ?? "0")); } catch { addExp = 0n; }
  if (addExp < 0n) addExp = 0n;                    // never allow negative exp

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Lock the players row only (FOR UPDATE OF p) — can't lock the nullable
    // ascensions side of a LEFT JOIN.
    const q = await client.query(
      `SELECT p.level, p.exp, p.max_health, p.attack, p.defense,
              COALESCE(a.ascension_level,0) AS asc
         FROM players p
         LEFT JOIN ascensions a ON a.player_id = p.id
        WHERE p.id = $1 FOR UPDATE OF p`,
      [playerId]
    );
    if (q.rowCount === 0) { await client.query("ROLLBACK"); return res.status(404).json({ error: "player not found" }); }
    const row = q.rows[0];

    const before = { level: Number(row.level), exp: BigInt(row.exp) };
    const result = applyExp(before.level, before.exp, addExp);

    // ascension scales stat gains from levels gained
    const mult = ascensionMultiplier(Number(row.asc));
    const dHealth  = Math.floor(result.statGain.maxHealth * mult);
    const dAttack  = Math.floor(result.statGain.attack    * mult);
    const dDefense = Math.floor(result.statGain.defense   * mult);

    // stats are display ints (int32); clamp so we never overflow the column
    const I32 = 2147483647;
    const clamp = (v: number) => Math.min(I32, Math.max(0, v));
    const newMaxHealth = clamp(Number(row.max_health) + dHealth);
    const newAttack    = clamp(Number(row.attack)     + dAttack);
    const newDefense   = clamp(Number(row.defense)    + dDefense);

    await client.query(
      `UPDATE players
          SET level = $2, exp = $3, exp_to_next_level = $4,
              max_health = $5, health = $5, attack = $6, defense = $7,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [playerId, result.level, result.exp.toString(), result.expToNext.toString(),
       newMaxHealth, newAttack, newDefense]
    );
    await client.query("COMMIT");

    return res.status(200).json({
      level: result.level,
      exp: result.exp.toString(),
      expToNext: result.expToNext.toString(),
      levelsGained: result.levelsGained,
      statDelta: { maxHealth: dHealth, attack: dAttack, defense: dDefense },
      stats: { maxHealth: newMaxHealth, attack: newAttack, defense: newDefense },
      ascensionMultiplier: mult,
    });
  } catch (e: any) {
    try { await client.query("ROLLBACK"); } catch {}
    return res.status(500).json({ error: "levelup failed", detail: String(e?.message || e) });
  } finally {
    client.release();
  }
};
