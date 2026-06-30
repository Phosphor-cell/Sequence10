// api/ascend.ts
// Server-authoritative ascension (prestige). Requires level >= requirement.
// Resets level/exp to 1/0, bumps ascension_level, which raises the permanent
// damage multiplier (feeds battle_v2 multipliers[]). Gold/gems are kept;
// only level/exp/stats reset (classic prestige).
//
// POST { playerId }              -> preview (can you ascend? what's the gain?)
// POST { playerId, action:"ascend" } -> perform it

import { VercelRequest, VercelResponse } from "@vercel/node";
import { getPool } from "./_db";
import { canAscend, ascensionMultiplier, ASCENSION_LEVEL_REQUIREMENT } from "./_progression";

const pool = getPool();
function cors(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// base stats a freshly-ascended character resets to (before multiplier)
const BASE = { maxHealth: 1000, attack: 100, defense: 50 };

export default async (req: VercelRequest, res: VercelResponse) => {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { playerId, action } = req.body || {};
  if (!playerId) return res.status(400).json({ error: "playerId required" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const q = await client.query(
      `SELECT p.level, COALESCE(a.ascension_level,0) AS asc
         FROM players p
         LEFT JOIN ascensions a ON a.player_id = p.id
        WHERE p.id = $1 FOR UPDATE OF p`,
      [playerId]
    );
    if (q.rowCount === 0) { await client.query("ROLLBACK"); return res.status(404).json({ error: "player not found" }); }

    const level = Number(q.rows[0].level);
    const curAsc = Number(q.rows[0].asc);
    const eligible = canAscend(level);
    const nextAsc = curAsc + 1;

    if (action !== "ascend") {
      await client.query("ROLLBACK");
      return res.status(200).json({
        preview: true,
        canAscend: eligible,
        levelRequirement: ASCENSION_LEVEL_REQUIREMENT,
        currentLevel: level,
        currentAscension: curAsc,
        currentMultiplier: ascensionMultiplier(curAsc),
        nextAscension: nextAsc,
        nextMultiplier: ascensionMultiplier(nextAsc),
      });
    }

    if (!eligible) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "not eligible",
        canAscend: false,
        levelRequirement: ASCENSION_LEVEL_REQUIREMENT,
        currentLevel: level,
      });
    }

    // apply ascension: bump ascension row, reset level/exp/stats (keep gold/gems)
    await client.query(
      `INSERT INTO ascensions (player_id, ascension_level)
       VALUES ($1, 1)
       ON CONFLICT (player_id) DO UPDATE
         SET ascension_level = ascensions.ascension_level + 1,
             updated_at = CURRENT_TIMESTAMP`,
      [playerId]
    );
    const mult = ascensionMultiplier(nextAsc);
    const I32 = 2147483647;
    const clamp = (v: number) => Math.min(I32, Math.max(1, Math.floor(v)));
    const mh = clamp(BASE.maxHealth * mult);
    const at = clamp(BASE.attack * mult);
    const df = clamp(BASE.defense * mult);

    await client.query(
      `UPDATE players
          SET level = 1, exp = 0, exp_to_next_level = 100,
              max_health = $2, health = $2, attack = $3, defense = $4,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [playerId, mh, at, df]
    );
    await client.query("COMMIT");

    return res.status(200).json({
      ascended: true,
      newAscensionLevel: nextAsc,
      newMultiplier: mult,
      resetTo: { level: 1, exp: 0 },
      stats: { maxHealth: mh, attack: at, defense: df },
    });
  } catch (e: any) {
    try { await client.query("ROLLBACK"); } catch {}
    return res.status(500).json({ error: "ascend failed", detail: String(e?.message || e) });
  } finally {
    client.release();
  }
};
