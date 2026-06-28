// _loot.ts — Vercel serverless endpoint: generate + persist a loot drop.
// Mirrors the style of _battle.ts / _player.ts.
//
// POST body: { "player_id": "<uuid>" }   (optionally { "battle_count": <n> } to force a seed)
// Returns:   the generated loot row, or { dropped: false } if RNG says "no drop".
//
// Idempotent: inserts use ON CONFLICT (player_id, seed) DO NOTHING, so replaying
// the same battle never duplicates loot. The (player_id, seed) UNIQUE constraint
// in inventory_loot enforces this at the database level too.

import { Pool } from 'pg';
import { generateLoot, lootSeedFromBattle, type LootRow } from './loot_core';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Not every battle drops loot. Tune to taste. Deterministic per battle via the seed.
const DROP_CHANCE = 0.65;

interface LootRequest { player_id?: string; battle_count?: number; }

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body: LootRequest = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const playerId = body?.player_id;
  if (!playerId) {
    return res.status(400).json({ error: 'player_id is required' });
  }

  const client = await pool.connect();
  try {
    // 1. Read player level + a monotonically increasing battle count for the seed.
    const playerRes = await client.query(
      `SELECT level FROM players WHERE id = $1`,
      [playerId]
    );
    if (playerRes.rowCount === 0) {
      return res.status(404).json({ error: 'Player not found' });
    }
    const level: number = Number(playerRes.rows[0].level);

    // Battle count: how many battles this player has logged (drives the seed).
    const countRes = await client.query(
      `SELECT count(*)::int AS n FROM battle_log WHERE player_id = $1`,
      [playerId]
    );
    const battleCount: number = body.battle_count ?? countRes.rows[0].n;

    // 2. Deterministic seed for THIS battle.
    const seed = lootSeedFromBattle(playerId, battleCount);

    // 3. Drop check (deterministic: derived from the same seed, separate stream).
    //    Using a cheap hash of the seed so it's independent of the stat rolls.
    const dropRoll = ((Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0) / 4294967296);
    if (dropRoll > DROP_CHANCE) {
      return res.status(200).json({ dropped: false, seed });
    }

    // 4. Generate loot (pure, tested).
    const loot: LootRow = generateLoot(level, seed);

    // 5. Persist. Idempotent on (player_id, seed).
    const insert = await client.query(
      `INSERT INTO inventory_loot
         (player_id, armor_type, rarity, seed,
          health_bonus, attack_bonus, defense_bonus, crit_rate_bonus, crit_damage_bonus,
          item_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (player_id, seed) DO NOTHING
       RETURNING id`,
      [
        playerId, loot.armor_type, loot.rarity, loot.seed,
        loot.health_bonus, loot.attack_bonus, loot.defense_bonus,
        loot.crit_rate_bonus, loot.crit_damage_bonus, loot.item_name,
      ]
    );

    const alreadyHad = insert.rowCount === 0;
    return res.status(200).json({
      dropped: true,
      already_owned: alreadyHad,
      loot_id: alreadyHad ? null : insert.rows[0].id,
      loot,
    });
  } catch (err: any) {
    console.error('loot error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
}