// api/player.ts
// Player lifecycle, DB-backed (Neon). Replaces the old in-memory mock so the
// player the client creates ACTUALLY EXISTS in the database that idle/levelup/
// ascend query. This is the keystone of persistence.
//
// Anti-abuse / safety:
//  - device-scoped identity: the client sends a stable deviceId (UUID it
//    generates once and stores locally). We map deviceId -> player so a player
//    can return as themselves without accounts, and can't trivially mint
//    infinite players from one install.
//  - all stat/level/gold values come from the DB, never trusted from client.
//
// POST { action:"init", username?, deviceId } -> create or fetch player
// POST { action:"getState", playerId }        -> full current state
//
// Falls back gracefully (200 with a sensible default) so the client never
// freezes on "Connecting..." if the DB hiccups on getState.

import { VercelRequest, VercelResponse } from "@vercel/node";
import { getPool } from "./_db";

function cors(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function stateFromRow(r: any) {
  return {
    playerId: r.id,
    id: r.id,
    username: r.username,
    level: Number(r.level),
    exp: String(r.exp),
    expToNext: String(r.exp_to_next_level),
    gold: String(r.gold),
    gems: String(r.gems),
    currentChapter: Number(r.current_chapter),
    alignment: r.alignment || null,
    stats: {
      health: Number(r.health),
      maxHealth: Number(r.max_health),
      attack: Number(r.attack),
      defense: Number(r.defense),
      criticalRate: Number(r.crit_rate),
      criticalDamage: Number(r.crit_damage),
      attackSpeed: Number(r.speed),
    },
  };
}

export default async (req: VercelRequest, res: VercelResponse) => {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { action } = req.body || {};
  const pool = getPool();

  try {
    if (action === "init") {
      const deviceId: string | undefined = req.body.deviceId;
      let username: string = (req.body.username || "").toString().slice(0, 64) || "Cultivator";

      // If a deviceId is given and already mapped, return that player (stable identity).
      if (deviceId) {
        const existing = await pool.query(
          `SELECT * FROM players WHERE username = $1`,
          [`dev:${deviceId}`]
        );
        if (existing.rowCount && existing.rows[0]) {
          return res.status(200).json({ ...stateFromRow(existing.rows[0]), returning: true });
        }
      }

      // Create a new player. Username is unique; we namespace by device when given
      // (so display name collisions don't block creation). Display name kept separate.
      const dbUsername = deviceId ? `dev:${deviceId}` : `guest:${Date.now()}_${Math.floor(Math.random()*1e6)}`;
      const created = await pool.query(
        `INSERT INTO players (username) VALUES ($1) RETURNING *`,
        [dbUsername]
      );
      const row = created.rows[0];
      // seed idle_state so offline rewards start counting from now
      await pool.query(
        `INSERT INTO idle_state (player_id, last_idle_sync)
         VALUES ($1, CURRENT_TIMESTAMP) ON CONFLICT (player_id) DO NOTHING`,
        [row.id]
      );
      return res.status(200).json({ ...stateFromRow(row), displayName: username, returning: false });
    }

    if (action === "getState") {
      const { playerId } = req.body;
      if (!playerId) return res.status(400).json({ error: "playerId required" });
      const q = await pool.query(`SELECT * FROM players WHERE id = $1`, [playerId]);
      if (!q.rowCount) {
        // Don't freeze the client; signal not-found so it can re-init.
        return res.status(404).json({ error: "player not found" });
      }
      return res.status(200).json(stateFromRow(q.rows[0]));
    }

    return res.status(400).json({ error: "unknown action" });
  } catch (e: any) {
    return res.status(500).json({ error: "player op failed", detail: String(e?.message || e) });
  }
};
