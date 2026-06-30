// api/loot.ts
// Mock loot endpoint (no database). ~40% drop rate with random rarity.
import { VercelRequest, VercelResponse } from "@vercel/node";

const rarities = ["Common", "Uncommon", "Rare", "Epic", "Legendary"];
const armorTypes = ["weapon", "head", "body", "arms", "legs", "accessory"];

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Weighted rarity for LOOT drops (loot is frequent, so the top tier is rarer
// than in paid summons). Common 60 / Uncommon 25 / Rare 10 / Epic 4 / Legendary 1.
function weightedRarity(): string {
  const weights = [0.60, 0.25, 0.10, 0.04, 0.01];
  let roll = Math.random();
  for (let i = 0; i < weights.length; i++) {
    if (roll < weights[i]) return rarities[i];
    roll -= weights[i];
  }
  return rarities[0];
}

export default async (req: VercelRequest, res: VercelResponse) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (Math.random() < 0.6) {
    return res.status(200).json({ dropped: false });
  }

  const rarity = weightedRarity();
  const armorType = armorTypes[randomInt(0, 5)];

  return res.status(200).json({
    dropped: true,
    loot: {
      armor_type: armorType,
      rarity,
      seed: randomInt(0, 2_000_000_000),
      attack_bonus: randomInt(0, 50),
      defense_bonus: randomInt(0, 30),
      health_bonus: randomInt(0, 100),
      crit_rate_bonus: randomInt(0, 10),
      crit_damage_bonus: randomInt(0, 30),
      item_name: `${rarity} ${armorType.charAt(0).toUpperCase() + armorType.slice(1)}`,
    },
  });
};