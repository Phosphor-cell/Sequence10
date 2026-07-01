// api/heroes.ts
// Server-authoritative hero roster + active party management.
//
// This is the endpoint the client already calls (it expected `heroes` and
// `team` to exist). It consolidates BOTH into one surface so there is a single
// source of truth for the roster and the active party.
//
// Everything that costs resources or affects fairness is decided HERE, never on
// the client:
//   - gems are checked and deducted server-side (summon cost),
//   - pity is read/advanced from the players row (can't be reset by reinstalling),
//   - hero stats are generated server-side from a stored seed (reproducible),
//   - party membership lives in summoned_heroes.in_party / party_slot, which the
//     battle resolver can read directly.
//
// POST { playerId, action, ... }
//   action "list"                          -> { heroes: [...] }
//   action "summon"   { count }            -> { summoned: [...], gemsRemaining, pity }
//   action "equip"    { heroId, slot }     -> { ok, party: [...] }
//   action "unequip"  { heroId | slot }    -> { ok, party: [...] }
//   action "setParty" { slots:[id|null*5] }-> { ok, party: [...] }
//
// Big numbers (gems) are returned as STRINGS to match the rest of the API.

import { VercelRequest, VercelResponse } from "@vercel/node";
import { getPool } from "./_db";
import { checkRateLimit } from "./_ratelimit";
import { resolvePull, PityState, Rarity } from "./_summon_rates";
import {
  generateHero, gemCostFor, mulberry32, PARTY_SIZE,
  shardsForDupe, starUpCost, applyStarBonus, MAX_STAR_LEVEL,
  heroStatGainForLevel, HERO_MAX_LEVEL, unlockedAbilitySlots,
} from "./_herogen";
import { expToNext } from "./_progression";

const pool = getPool();

function cors(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
function heroRowToJson(r: any) {
  const starLevel = Number(r.star_level) || 1;
  // health/attack/defense are stored as BASE (star-1) stats; star bonus is
  // applied on read so star-ups never touch the stored numbers directly.
  const eff = applyStarBonus(
    { health: Number(r.health), attack: Number(r.attack), defense: Number(r.defense) },
    starLevel
  );
  return {
    id: r.id,
    class_name: r.class_name,
    tier: r.tier,
    theme: r.theme,
    rarity: r.rarity,
    alignment: r.alignment,
    element: r.element,
    level: Number(r.level),
    exp: r.exp === undefined || r.exp === null ? "0" : String(r.exp),
    exp_to_next: expToNext(Number(r.level)).toString(),
    star_level: starLevel,
    unlocked_ability_slots: unlockedAbilitySlots(Number(r.level)),
    health: eff.health,
    attack: eff.attack,
    defense: eff.defense,
    base_health: Number(r.health),
    base_attack: Number(r.attack),
    base_defense: Number(r.defense),
    in_party: !!r.in_party,
    party_slot: r.party_slot === null || r.party_slot === undefined ? null : Number(r.party_slot),
  };
}

async function listHeroes(playerId: string) {
  const q = await pool.query(
    `SELECT id, class_name, tier, theme, rarity, alignment, element,
            level, exp, health, attack, defense, in_party, party_slot, star_level
       FROM summoned_heroes
      WHERE player_id = $1
      ORDER BY in_party DESC, party_slot ASC NULLS LAST, obtained_at DESC`,
    [playerId]
  );
  return q.rows.map(heroRowToJson);
}

// The current party as a 5-length array (index = slot, null = empty).
async function partyArray(playerId: string) {
  const q = await pool.query(
    `SELECT id, class_name, tier, theme, rarity, alignment, element,
            level, exp, health, attack, defense, in_party, party_slot, star_level
       FROM summoned_heroes
      WHERE player_id = $1 AND in_party = TRUE
      ORDER BY party_slot ASC`,
    [playerId]
  );
  const slots: (ReturnType<typeof heroRowToJson> | null)[] = [null, null, null, null, null];
  for (const row of q.rows) {
    const s = Number(row.party_slot);
    if (s >= 0 && s < PARTY_SIZE) slots[s] = heroRowToJson(row);
  }
  return slots;
}

// ── Handler ──────────────────────────────────────────────────────────────────
export default async (req: VercelRequest, res: VercelResponse) => {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = req.body || {};
  const playerId = body.playerId;
  const action = body.action;
  if (!playerId) return res.status(400).json({ error: "playerId required" });

  try {
    // ---- LIST ----------------------------------------------------------------
    if (action === "list") {
      const heroes = await listHeroes(playerId);
      return res.status(200).json({ heroes });
    }

    // ---- SUMMON --------------------------------------------------------------
    if (action === "summon") {
      const count = Math.max(1, Math.min(10, Number(body.count ?? 1)));

      // Abuse guard: cap summon ops at 20/min per player.
      if (!(await checkRateLimit(playerId, "summon", 20, 60))) {
        return res.status(429).json({ error: "rate limited", retryAfterSeconds: 60 });
      }

      const cost = gemCostFor(count);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Lock the player row so gems + pity update atomically.
        const pl = await client.query(
          `SELECT gems, pity_since_legendary, pity_since_epic, total_summons
             FROM players WHERE id = $1 FOR UPDATE`,
          [playerId]
        );
        if (pl.rowCount === 0) {
          await client.query("ROLLBACK");
          return res.status(404).json({ error: "player not found" });
        }

        const gems = BigInt(pl.rows[0].gems);
        if (gems < BigInt(cost)) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            error: "insufficient gems",
            need: cost,
            have: gems.toString(),
          });
        }

        // Carry pity across the whole batch (each pull advances it).
        let pity: PityState = {
          sinceLegendary: Number(pl.rows[0].pity_since_legendary) || 0,
          sinceEpic: Number(pl.rows[0].pity_since_epic) || 0,
        };

        // One rng stream per request drives the pull rarities; each hero also
        // gets its own seed (from the same stream) for reproducible stats/name.
        const rng = mulberry32(
          ((Date.now() & 0xffffffff) ^ (Math.floor(Math.random() * 0xffffffff))) >>> 0
        );

        const summoned: any[] = [];
        const shardsGained: Record<string, number> = {}; // className -> shards this batch
        for (let i = 0; i < count; i++) {
          const pull = resolvePull(rng, pity);
          pity = pull.pity;
          const rarity = pull.result.rarity;

          // Generate the hero first (its class is derived from the seed), THEN
          // decide whether the player already owns that class. Owning it turns
          // this pull into shards instead of a duplicate roster entry -- no
          // pull is ever wasted, and dupes of rarer heroes are worth more.
          let resolved = false;
          for (let attempt = 0; attempt < 4 && !resolved; attempt++) {
            const seed = Math.floor(rng() * 2_000_000_000) + attempt;
            const g = generateHero(seed, rarity);

            const owns = await client.query(
              `SELECT 1 FROM summoned_heroes WHERE player_id = $1 AND class_name = $2 LIMIT 1`,
              [playerId, g.className]
            );

            if (owns.rowCount && owns.rowCount > 0) {
              // Dupe -> shards. No INSERT, so no seed-collision risk; always
              // resolves on the first attempt.
              const shards = shardsForDupe(rarity);
              shardsGained[g.className] = (shardsGained[g.className] || 0) + shards;
              await client.query(
                `INSERT INTO hero_shards (player_id, class_name, shards)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (player_id, class_name)
                   DO UPDATE SET shards = hero_shards.shards + EXCLUDED.shards,
                                 updated_at = CURRENT_TIMESTAMP`,
                [playerId, g.className, shards]
              );
              summoned.push({
                dupe: true,
                class_name: g.className,
                rarity,
                shards_gained: shards,
              });
              resolved = true;
              break;
            }

            const ins = await client.query(
              `INSERT INTO summoned_heroes
                 (player_id, class_name, tier, theme, seed, rarity, alignment, element,
                  level, exp, health, attack, defense, in_party, party_slot)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8, 1, 0, $9,$10,$11, FALSE, NULL)
               ON CONFLICT (player_id, seed) DO NOTHING
               RETURNING id, class_name, tier, theme, rarity, alignment, element,
                         level, exp, health, attack, defense, in_party, party_slot, star_level`,
              [playerId, g.className, g.tier, g.theme, seed, rarity,
               g.alignment, g.element, g.health, g.attack, g.defense]
            );
            if (ins.rowCount && ins.rowCount > 0) {
              summoned.push(heroRowToJson(ins.rows[0]));
              resolved = true;
            }
          }
        }

        const remaining = gems - BigInt(cost);
        await client.query(
          `UPDATE players
              SET gems = $2,
                  pity_since_legendary = $3,
                  pity_since_epic = $4,
                  total_summons = total_summons + $5,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = $1`,
          [playerId, remaining.toString(), pity.sinceLegendary, pity.sinceEpic, count]
        );

        await client.query("COMMIT");
        return res.status(200).json({
          summoned,
          count: summoned.length,
          shardsGained,
          gemsSpent: cost,
          gemsRemaining: remaining.toString(),
          pity: { sinceLegendary: pity.sinceLegendary, sinceEpic: pity.sinceEpic },
        });
      } catch (e: any) {
        try { await client.query("ROLLBACK"); } catch {}
        return res.status(500).json({ error: "summon failed", detail: String(e?.message || e) });
      } finally {
        client.release();
      }
    }

    // ---- EQUIP (place one hero into a slot) ----------------------------------
    if (action === "equip") {
      const heroId = body.heroId;
      const slot = Number(body.slot);
      if (!heroId || !Number.isInteger(slot) || slot < 0 || slot >= PARTY_SIZE) {
        return res.status(400).json({ error: "heroId and slot (0..4) required" });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Ownership check (also locks the row).
        const own = await client.query(
          `SELECT id FROM summoned_heroes WHERE id = $1 AND player_id = $2 FOR UPDATE`,
          [heroId, playerId]
        );
        if (own.rowCount === 0) {
          await client.query("ROLLBACK");
          return res.status(404).json({ error: "hero not found for this player" });
        }

        // Vacate whoever currently holds the target slot (could be this hero).
        await client.query(
          `UPDATE summoned_heroes
              SET in_party = FALSE, party_slot = NULL
            WHERE player_id = $1 AND party_slot = $2`,
          [playerId, slot]
        );

        // Place this hero (overwrites its previous slot, if any).
        await client.query(
          `UPDATE summoned_heroes
              SET in_party = TRUE, party_slot = $3
            WHERE player_id = $1 AND id = $2`,
          [playerId, heroId, slot]
        );

        await client.query("COMMIT");
        return res.status(200).json({ ok: true, party: await partyArray(playerId) });
      } catch (e: any) {
        try { await client.query("ROLLBACK"); } catch {}
        return res.status(500).json({ error: "equip failed", detail: String(e?.message || e) });
      } finally {
        client.release();
      }
    }

    // ---- UNEQUIP (bench by heroId or by slot) --------------------------------
    if (action === "unequip") {
      const heroId = body.heroId;
      const hasSlot = body.slot !== undefined && body.slot !== null;
      const slot = hasSlot ? Number(body.slot) : -1;
      if (!heroId && !hasSlot) {
        return res.status(400).json({ error: "heroId or slot required" });
      }

      if (heroId) {
        await pool.query(
          `UPDATE summoned_heroes
              SET in_party = FALSE, party_slot = NULL
            WHERE player_id = $1 AND id = $2`,
          [playerId, heroId]
        );
      } else {
        await pool.query(
          `UPDATE summoned_heroes
              SET in_party = FALSE, party_slot = NULL
            WHERE player_id = $1 AND party_slot = $2`,
          [playerId, slot]
        );
      }
      return res.status(200).json({ ok: true, party: await partyArray(playerId) });
    }

    // ---- SET PARTY (replace the whole party in one shot) ---------------------
    if (action === "setParty") {
      const slots: (string | null)[] = Array.isArray(body.slots) ? body.slots : [];
      // normalize to exactly PARTY_SIZE entries
      const norm: (string | null)[] = [];
      for (let i = 0; i < PARTY_SIZE; i++) {
        const v = slots[i];
        norm.push(typeof v === "string" && v.length > 0 ? v : null);
      }
      // reject duplicate hero ids across slots
      const seen = new Set<string>();
      for (const id of norm) {
        if (id) {
          if (seen.has(id)) return res.status(400).json({ error: "duplicate hero in party" });
          seen.add(id);
        }
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Validate every provided hero belongs to the player.
        if (seen.size > 0) {
          const ids = Array.from(seen);
          const chk = await client.query(
            `SELECT id FROM summoned_heroes WHERE player_id = $1 AND id = ANY($2::uuid[])`,
            [playerId, ids]
          );
          if (chk.rowCount !== ids.length) {
            await client.query("ROLLBACK");
            return res.status(400).json({ error: "one or more heroes not owned by player" });
          }
        }

        // Bench everyone first so slot reassignments can't trip the unique index.
        await client.query(
          `UPDATE summoned_heroes
              SET in_party = FALSE, party_slot = NULL
            WHERE player_id = $1 AND in_party = TRUE`,
          [playerId]
        );

        // Assign each non-empty slot.
        for (let i = 0; i < PARTY_SIZE; i++) {
          const id = norm[i];
          if (!id) continue;
          await client.query(
            `UPDATE summoned_heroes
                SET in_party = TRUE, party_slot = $3
              WHERE player_id = $1 AND id = $2`,
            [playerId, id, i]
          );
        }

        await client.query("COMMIT");
        return res.status(200).json({ ok: true, party: await partyArray(playerId) });
      } catch (e: any) {
        try { await client.query("ROLLBACK"); } catch {}
        return res.status(500).json({ error: "setParty failed", detail: String(e?.message || e) });
      } finally {
        client.release();
      }
    }

    // ---- STAR UP (spend shards to raise one hero's star_level by 1) ----------
    if (action === "starUp") {
      const heroId = body.heroId;
      if (!heroId) return res.status(400).json({ error: "heroId required" });

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Lock the hero row (ownership check + read current star/class).
        const hero = await client.query(
          `SELECT id, class_name, star_level FROM summoned_heroes
            WHERE id = $1 AND player_id = $2 FOR UPDATE`,
          [heroId, playerId]
        );
        if (hero.rowCount === 0) {
          await client.query("ROLLBACK");
          return res.status(404).json({ error: "hero not found for this player" });
        }
        const className = hero.rows[0].class_name as string;
        const currentStar = Number(hero.rows[0].star_level) || 1;

        const cost = starUpCost(currentStar);
        if (cost === null) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "hero already at max star level", maxStar: MAX_STAR_LEVEL });
        }

        // Lock the player's shard balance for this class.
        const shardRow = await client.query(
          `SELECT shards FROM hero_shards WHERE player_id = $1 AND class_name = $2 FOR UPDATE`,
          [playerId, className]
        );
        const have = shardRow.rowCount ? Number(shardRow.rows[0].shards) : 0;
        if (have < cost) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "insufficient shards", need: cost, have });
        }

        await client.query(
          `UPDATE hero_shards SET shards = shards - $3, updated_at = CURRENT_TIMESTAMP
            WHERE player_id = $1 AND class_name = $2`,
          [playerId, className, cost]
        );
        const upd = await client.query(
          `UPDATE summoned_heroes SET star_level = star_level + 1
            WHERE id = $1 AND player_id = $2
          RETURNING id, class_name, tier, theme, rarity, alignment, element,
                    level, exp, health, attack, defense, in_party, party_slot, star_level`,
          [heroId, playerId]
        );

        await client.query("COMMIT");
        return res.status(200).json({
          ok: true,
          hero: heroRowToJson(upd.rows[0]),
          shardsSpent: cost,
          shardsRemaining: have - cost,
        });
      } catch (e: any) {
        try { await client.query("ROLLBACK"); } catch {}
        return res.status(500).json({ error: "starUp failed", detail: String(e?.message || e) });
      } finally {
        client.release();
      }
    }

    // ---- LEVEL UP (apply exp to one hero; server-authoritative curve) --------
    if (action === "levelUp") {
      const heroId = body.heroId;
      if (!heroId) return res.status(400).json({ error: "heroId required" });
      let addExp = 0n;
      try { addExp = BigInt(String(body.addExp ?? "0")); } catch { addExp = 0n; }
      if (addExp < 0n) addExp = 0n;

      // Abuse guard: cap hero levelups per player.
      if (!(await checkRateLimit(playerId, "hero_levelup", 120, 60))) {
        return res.status(429).json({ error: "rate limited", retryAfterSeconds: 60 });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const hero = await client.query(
          `SELECT id, rarity, level, exp, health, attack, defense
             FROM summoned_heroes WHERE id = $1 AND player_id = $2 FOR UPDATE`,
          [heroId, playerId]
        );
        if (hero.rowCount === 0) {
          await client.query("ROLLBACK");
          return res.status(404).json({ error: "hero not found for this player" });
        }
        const row = hero.rows[0];
        const rarity = row.rarity as Rarity;
        let level = Number(row.level) || 1;
        let exp = BigInt(row.exp || 0);

        // Apply exp via the shared player curve (expToNext), but accumulate
        // rarity-scaled hero stat gains. Capped at HERO_MAX_LEVEL.
        let levelsGained = 0;
        let dH = 0, dA = 0, dD = 0;
        let guard = 0;
        exp += addExp;
        while (level < HERO_MAX_LEVEL && guard < 100000) {
          const need = expToNext(level);
          if (exp < need) break;
          exp -= need;
          level += 1;
          const g = heroStatGainForLevel(level, rarity);
          dH += g.health; dA += g.attack; dD += g.defense;
          levelsGained += 1;
          guard++;
        }
        // At max level, exp stops accumulating (no overflow hoarding).
        if (level >= HERO_MAX_LEVEL) exp = 0n;

        const upd = await client.query(
          `UPDATE summoned_heroes
              SET level = $3, exp = $4,
                  health = health + $5, attack = attack + $6, defense = defense + $7
            WHERE id = $1 AND player_id = $2
          RETURNING id, class_name, tier, theme, rarity, alignment, element,
                    level, exp, health, attack, defense, in_party, party_slot, star_level`,
          [heroId, playerId, level, exp.toString(), dH, dA, dD]
        );

        await client.query("COMMIT");
        const heroJson = heroRowToJson(upd.rows[0]);
        return res.status(200).json({
          ok: true,
          hero: heroJson,
          levelsGained,
          atMaxLevel: level >= HERO_MAX_LEVEL,
          // surface whether this level-up opened a new ability slot
          unlockedAbilitySlots: heroJson.unlocked_ability_slots,
        });
      } catch (e: any) {
        try { await client.query("ROLLBACK"); } catch {}
        return res.status(500).json({ error: "levelUp failed", detail: String(e?.message || e) });
      } finally {
        client.release();
      }
    }

    // ---- SHARDS (list the player's hero-shard balances) -----------------------
    if (action === "shards") {
      const q = await pool.query(
        `SELECT class_name, shards FROM hero_shards WHERE player_id = $1 AND shards > 0 ORDER BY class_name`,
        [playerId]
      );
      return res.status(200).json({
        shards: q.rows.map(r => ({ class_name: r.class_name, shards: Number(r.shards) })),
      });
    }

    return res.status(400).json({ error: "unknown action", action });
  } catch (e: any) {
    return res.status(500).json({ error: "heroes endpoint failed", detail: String(e?.message || e) });
  }
};