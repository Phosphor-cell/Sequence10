// api/player.ts
// Mock player endpoint (no database). Handles init + getState.
import { VercelRequest, VercelResponse } from "@vercel/node";

// NOTE: In-memory store. Resets whenever Vercel spins up a new instance.
// Good enough to prove the client<->server loop works. Swap to Neon later.
const players: Record<string, any> = {};

export default async (req: VercelRequest, res: VercelResponse) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { action, username, playerId } = req.body || {};

  if (action === "init") {
    const id = "player_" + Date.now();
    players[id] = {
      id,
      username: username || "TestPlayer",
      level: 1,
      exp: 0,
      gold: 1000,
      gems: 0,
      stats: {
        health: 1000,
        maxHealth: 1000,
        attack: 100,
        defense: 50,
        criticalRate: 15,
        criticalDamage: 150,
        attackSpeed: 100,
      },
    };
    return res.status(200).json({ playerId: id, username: players[id].username });
  }

  if (action === "getState") {
    const p = players[playerId];
    // If the instance recycled and lost the player, hand back a default so the
    // client still renders instead of freezing on "Connecting...".
    if (!p) {
      return res.status(200).json({
        id: playerId,
        username: "TestPlayer",
        level: 1,
        exp: 0,
        gold: 1000,
        gems: 0,
        stats: {
          health: 1000,
          maxHealth: 1000,
          attack: 100,
          defense: 50,
          criticalRate: 15,
          criticalDamage: 150,
          attackSpeed: 100,
        },
      });
    }
    return res.status(200).json(p);
  }

  return res.status(400).json({ error: "Unknown action" });
};