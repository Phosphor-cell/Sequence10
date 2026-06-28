// api/_player.ts
// Player init, state retrieval, and item equip.
//
// POST { action: "init",     username: string }
//   → creates player + character_stats row (idempotent on username conflict)
//   → returns { playerId, username, level, gold, gems, stats }
//
// POST { action: "getState", playerId: string }
//   → returns full player state including equipped item names
//
// POST { action: "equipItem", playerId: string, lootId: string, slot: string }
//   → moves a loot row's bonuses onto character_stats
//   → returns updated stats

import { Pool } from '@neondatabase/serverless';
import { VercelRequest, VercelResponse } from '@vercel/node';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ── Helpers ────────────────────────────────────────────────────────────

function capInt32(n: number): number {
  return Math.max(-2147483648, Math.min(2147483647, Math.floor(n)));
}

// Recalculate character_stats from base player stats + all equipped loot bonuses.
// Called after equip/unequip so the stats panel always reflects reality.
async function recalcStats(client: any, playerId: string): Promise<void> {
  // Sum all equipped loot bonuses
  const bonuses = await client.query(
    `SELECT
       COALESCE(SUM(attack_bonus),    0) AS atk,
       COALESCE(SUM(defense_bonus),   0) AS def,
       COALESCE(SUM(health_bonus),    0) AS hp,
       COALESCE(SUM(crit_rate_bonus), 0) AS cr,
       COALESCE(SUM(crit_damage_bonus),0) AS cd
     FROM inventory_loot
     WHERE player_id = $1 AND equipped = TRUE`,
    [playerId]
  );
  const b = bonuses.rows[0];

  // Base stats (level-scaled)
  const player = await client.query(
    `SELECT level FROM players WHERE id = $1`, [playerId]
  );
  const level = player.rows[0]?.level ?? 1;

  const baseHp     = 1000 + (level - 1) * 200;
  const baseAtk    = 100  + (level - 1) * 20;
  const baseDef    = 50   + (level - 1) * 10;
  const baseCR     = 15;
  const baseCD     = 150;
  const baseSpd    = 100;

  const finalHp    = capInt32(baseHp  + Number(b.hp));
  const finalAtk   = capInt32(baseAtk + Number(b.atk));
  const finalDef   = capInt32(baseDef + Number(b.def));
  const finalCR    = Math.min(100, capInt32(baseCR  + Number(b.cr)));
  const finalCD    = capInt32(baseCD  + Number(b.cd));

  await client.query(
    `UPDATE character_stats SET
       health          = $1,
       max_health      = $1,
       attack          = $2,
       defense         = $3,
       critical_rate   = $4,
       critical_damage = $5,
       attack_speed    = $6,
       _health_int64   = $1,
       _max_health_int64 = $1,
       _attack_int64   = $2,
       _defense_int64  = $3,
       updated_at      = NOW()
     WHERE player_id = $7`,
    [finalHp, finalAtk, finalDef, finalCR, finalCD, baseSpd, playerId]
  );
}

// Build the stats object returned to the client
async function getStats(client: any, playerId: string) {
  const res = await client.query(
    `SELECT health, max_health, attack, defense,
            critical_rate, critical_damage, attack_speed
     FROM character_stats WHERE player_id = $1`,
    [playerId]
  );
  if (!res.rows.length) return null;
  const s = res.rows[0];
  return {
    health:        s.health,
    maxHealth:     s.max_health,
    attack:        s.attack,
    defense:       s.defense,
    criticalRate:  s.critical_rate,
    criticalDamage:s.critical_damage,
    attackSpeed:   s.attack_speed,
  };
}

// ── Action: init ───────────────────────────────────────────────────────

async function handleInit(client: any, username: string) {
  // Create player (idempotent — same username just returns existing row)
  const playerRes = await client.query(
    `INSERT INTO players (username)
     VALUES ($1)
     ON CONFLICT (username) DO UPDATE SET last_sync = NOW()
     RETURNING id, username, level, exp, gold, gems`,
    [username]
  );
  const player = playerRes.rows[0];

  // Create character_stats row if it doesn't exist
  await client.query(
    `INSERT INTO character_stats (player_id)
     VALUES ($1)
     ON CONFLICT (player_id) DO NOTHING`,
    [player.id]
  );

  // Initialise equipment slots (6 slots, all empty)
  const slots = ['head', 'body', 'arms', 'legs', 'weapon', 'accessory'];
  for (const slot of slots) {
    await client.query(
      `INSERT INTO equipment_slots (player_id, slot_name)
       VALUES ($1, $2)
       ON CONFLICT (player_id, slot_name) DO NOTHING`,
      [player.id, slot]
    );
  }

  // Recalc stats so they reflect current level (important after a level-up sync)
  await recalcStats(client, player.id);
  const stats = await getStats(client, player.id);

  return {
    playerId: player.id,
    username: player.username,
    level:    player.level,
    exp:      Number(player.exp),
    gold:     Number(player.gold),
    gems:     Number(player.gems),
    stats,
  };
}

// ── Action: getState ───────────────────────────────────────────────────

async function handleGetState(client: any, playerId: string) {
  const playerRes = await client.query(
    `SELECT id, username, level, exp, gold, gems
     FROM players WHERE id = $1`,
    [playerId]
  );
  if (!playerRes.rows.length) return null;
  const player = playerRes.rows[0];

  const stats = await getStats(client, playerId);

  // Equipped item names per slot (for the UI equip panel)
  const equippedRes = await client.query(
    `SELECT il.armor_type, il.item_name
     FROM inventory_loot il
     WHERE il.player_id = $1 AND il.equipped = TRUE`,
    [playerId]
  );
  const equipped: Record<string, string> = {};
  for (const row of equippedRes.rows) {
    equipped[row.armor_type] = row.item_name;
  }

  return {
    playerId: player.id,
    username: player.username,
    level:    player.level,
    exp:      Number(player.exp),
    gold:     Number(player.gold),
    gems:     Number(player.gems),
    stats,
    equipped,
  };
}

// ── Action: equipItem ──────────────────────────────────────────────────

async function handleEquipItem(client: any, playerId: string,
                               lootId: string, slot: string) {
  // Unequip whatever is currently in this slot
  await client.query(
    `UPDATE inventory_loot
     SET equipped = FALSE
     WHERE player_id = $1 AND armor_type = $2`,
    [playerId, slot]
  );

  // Equip the new item
  const res = await client.query(
    `UPDATE inventory_loot
     SET equipped = TRUE
     WHERE id = $1 AND player_id = $2
     RETURNING item_name`,
    [lootId, playerId]
  );
  if (!res.rows.length) return null;

  await recalcStats(client, playerId);
  const stats = await getStats(client, playerId);
  return { success: true, itemName: res.rows[0].item_name, stats };
}

// ── Handler ────────────────────────────────────────────────────────────

export default async (req: VercelRequest, res: VercelResponse) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { action } = body;

  const client = await pool.connect();
  try {
    if (action === 'init') {
      const { username } = body;
      if (!username) return res.status(400).json({ error: 'username required' });
      const data = await handleInit(client, username);
      return res.status(200).json(data);
    }

    if (action === 'getState') {
      const { playerId } = body;
      if (!playerId) return res.status(400).json({ error: 'playerId required' });
      const data = await handleGetState(client, playerId);
      if (!data) return res.status(404).json({ error: 'Player not found' });
      return res.status(200).json(data);
    }

    if (action === 'equipItem') {
      const { playerId, lootId, slot } = body;
      if (!playerId || !lootId || !slot)
        return res.status(400).json({ error: 'playerId, lootId, slot required' });
      const data = await handleEquipItem(client, playerId, lootId, slot);
      if (!data) return res.status(404).json({ error: 'Loot item not found' });
      return res.status(200).json(data);
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err: any) {
    console.error('_player error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
};