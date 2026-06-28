// api/_battle.ts
// Battle resolution with uint64 background calc, int32 display

import { Pool } from "@neondatabase/serverless";
import { VercelRequest, VercelResponse } from "@vercel/node";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

interface BattleRequest {
  playerId: string;
  enemyLevel: number;
  difficulty: number;
}

interface BattleResponse {
  victory: boolean;
  playerHealthAfter: number;
  damageDealt: number;
  goldEarned: number;
  expEarned: number;
  levelUp?: boolean;
  newLevel?: number;
}

function capInt32(val: bigint): number {
  const MAX_INT32 = BigInt(2147483647);
  const MIN_INT32 = BigInt(-2147483648);
  if (val > MAX_INT32) return Number(MAX_INT32);
  if (val < MIN_INT32) return Number(MIN_INT32);
  return Number(val);
}

async function getPlayerStats(playerId: string) {
  const res = await pool.query(
    "SELECT * FROM character_stats WHERE player_id = $1",
    [playerId]
  );
  return res.rows[0];
}

async function generateEnemy(level: number, difficulty: number) {
  // Procedurally generate enemy using free AI (Cerebras/Groq)
  // For now, deterministic scaling
  const baseHealth = 500 + level * 150;
  const baseAttack = 80 + level * 20;
  const baseDefense = 30 + level * 5;

  const difficultyMultiplier = [0.8, 1.0, 1.5, 2.5][difficulty] || 1.0;

  return {
    name: `Enemy_L${level}`,
    level,
    health: Math.floor(baseHealth * difficultyMultiplier),
    attack: Math.floor(baseAttack * difficultyMultiplier),
    defense: Math.floor(baseDefense * difficultyMultiplier),
  };
}

async function resolveBattle(
  playerStats: any,
  enemy: any
): Promise<{ victory: boolean; damageDealt: bigint; goldEarned: bigint; expEarned: bigint }> {
  let playerHp = BigInt(playerStats._health_int64);
  let enemyHp = BigInt(enemy.health);
  let totalDamageDealt = BigInt(0);

  // Simplified turn-based: player attacks first
  for (let turn = 0; turn < 100; turn++) {
    // Player turn
    if (playerHp <= 0n) break;
    let playerDamage = BigInt(playerStats._attack_int64);
    const critRoll = Math.random() * 100 < playerStats.critical_rate;
    if (critRoll) {
      playerDamage = (playerDamage * BigInt(playerStats.critical_damage)) / 100n;
    }
    playerDamage = playerDamage - (BigInt(enemy.defense) / 2n);
    if (playerDamage <= 0n) playerDamage = 1n;
    enemyHp -= playerDamage;
    totalDamageDealt += playerDamage;

    if (enemyHp <= 0n) {
      return {
        victory: true,
        damageDealt: totalDamageDealt,
        goldEarned: BigInt(100 + enemy.level * 50),
        expEarned: BigInt(50 + enemy.level * 25),
      };
    }

    // Enemy turn
    let enemyDamage = BigInt(enemy.attack) - (BigInt(playerStats._defense_int64) / 2n);
    if (enemyDamage <= 0n) enemyDamage = 1n;
    playerHp -= enemyDamage;
  }

  return {
    victory: false,
    damageDealt: totalDamageDealt,
    goldEarned: 10n,
    expEarned: 5n,
  };
}

export default async (req: VercelRequest, res: VercelResponse) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { playerId, enemyLevel, difficulty }: BattleRequest = req.body;

  try {
    const playerStats = await getPlayerStats(playerId);
    if (!playerStats) {
      return res.status(404).json({ error: "Player not found" });
    }

    const enemy = await generateEnemy(enemyLevel, difficulty);
    const battleResult = await resolveBattle(playerStats, enemy);

    // Update player state
    let newExp = BigInt(playerStats.exp) + battleResult.expEarned;
    let newLevel = playerStats.level;
    let expToNext = BigInt(playerStats.exp_to_next_level);

    while (newExp >= expToNext) {
      newExp -= expToNext;
      newLevel += 1;
      expToNext = BigInt(1000 * (1.1 ** (newLevel - 1)));
    }

    let newGold = BigInt(playerStats.gold) + battleResult.goldEarned;
    let newHealth = BigInt(playerStats._health_int64) - BigInt(100); // Simplified damage
    if (newHealth < 0n) newHealth = 0n;

    // Write to DB
    await pool.query(
      `UPDATE character_stats 
       SET _health_int64 = $1, health = $2, updated_at = NOW() 
       WHERE player_id = $3`,
      [newHealth.toString(), capInt32(newHealth), playerId]
    );

    await pool.query(
      `UPDATE players 
       SET level = $1, exp = $2, gold = $3, last_sync = NOW() 
       WHERE id = $4`,
      [newLevel, newExp.toString(), newGold.toString(), playerId]
    );

    // Log battle
    await pool.query(
      `INSERT INTO battles (player_id, enemy_name, enemy_level, difficulty, player_health_before, player_health_after, enemy_health_before, damage_dealt, gold_earned, exp_earned, victory)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        playerId,
        enemy.name,
        enemy.level,
        difficulty,
        playerStats._health_int64,
        newHealth.toString(),
        enemy.health,
        battleResult.damageDealt.toString(),
        battleResult.goldEarned.toString(),
        battleResult.expEarned.toString(),
        battleResult.victory,
      ]
    );

    const response: BattleResponse = {
      victory: battleResult.victory,
      playerHealthAfter: capInt32(newHealth),
      damageDealt: capInt32(battleResult.damageDealt),
      goldEarned: capInt32(battleResult.goldEarned),
      expEarned: capInt32(battleResult.expEarned),
      levelUp: newLevel > playerStats.level,
      newLevel: newLevel > playerStats.level ? newLevel : undefined,
    };

    return res.status(200).json(response);
  } catch (error) {
    console.error("Battle error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};