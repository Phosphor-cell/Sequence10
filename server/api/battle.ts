// api/battle.ts
// Mock battle endpoint (no database). Returns a resolved battle result.
import { VercelRequest, VercelResponse } from "@vercel/node";

function capInt32(val: number): number {
  return Math.min(2147483647, Math.max(-2147483648, Math.floor(val)));
}

export default async (req: VercelRequest, res: VercelResponse) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { enemyLevel = 1 } = req.body || {};

  const playerDamage = 100 + enemyLevel * 10;
  const goldEarned = 100 + enemyLevel * 50;
  const expEarned = 50 + enemyLevel * 25;
  const victory = Math.random() > 0.3; // 70% win rate

  return res.status(200).json({
    victory,
    enemyName: `Enemy Lv ${enemyLevel}`,
    playerHealthAfter: 950,
    damageDealt: capInt32(playerDamage),
    goldEarned: capInt32(goldEarned),
    expEarned: capInt32(expEarned),
    levelUp: false,
  });
};