// api/_summon_rates.ts  (HELPER — underscore = not an HTTP endpoint)
//
// Balanced summon/gacha rates with pity. Pure functions, seed-stable.
// Design goal: "not too easy, not too hard."
//   - ~25% of pulls are Rare+ (something exciting roughly every 4th pull)
//   - Legendary ~1.5% base, but PITY guarantees one within 80 pulls
//   - Epic+ guaranteed every 10 pulls so a 10-pull always feels worthwhile
//
// Pity is tracked server-side (pity_counter on the player) so it can't be
// reset by reinstalling or clock tricks.

export type Rarity = "Common" | "Uncommon" | "Rare" | "Epic" | "Legendary";

export interface RarityDef { name: Rarity; tier: number; weight: number; }

// Base weights (sum = 1.0).
export const SUMMON_RATES: RarityDef[] = [
  { name: "Common",    tier: 1, weight: 0.450 },
  { name: "Uncommon",  tier: 2, weight: 0.300 },
  { name: "Rare",      tier: 3, weight: 0.165 },
  { name: "Epic",      tier: 4, weight: 0.070 },
  { name: "Legendary", tier: 5, weight: 0.015 },
];

export const HARD_PITY_LEGENDARY = 80;  // guaranteed Legendary by this pull
export const SOFT_PITY_START      = 60;  // Legendary odds ramp from here
export const SOFT_PITY_STEP       = 0.02; // +2% per pull past soft start
export const EPIC_PITY            = 10;   // guaranteed Epic+ at least this often

// Effective Legendary chance for a given pity count (soft pity ramp).
function legendaryChance(pitySinceLegendary: number): number {
  const base = 0.015;
  if (pitySinceLegendary + 1 >= HARD_PITY_LEGENDARY) return 1.0; // hard pity
  if (pitySinceLegendary + 1 > SOFT_PITY_START) {
    const over = (pitySinceLegendary + 1) - SOFT_PITY_START;
    return Math.min(1.0, base + over * SOFT_PITY_STEP);
  }
  return base;
}

export interface PullResult { rarity: Rarity; tier: number; }
export interface PityState { sinceLegendary: number; sinceEpic: number; }

// Resolve one pull. rng must return [0,1). Returns the rarity and the UPDATED
// pity counters (caller persists them).
export function resolvePull(rng: () => number, pity: PityState): { result: PullResult; pity: PityState } {
  const legCh = legendaryChance(pity.sinceLegendary);

  // 1) Legendary check (with soft/hard pity)
  if (rng() < legCh) {
    return { result: { rarity: "Legendary", tier: 5 }, pity: { sinceLegendary: 0, sinceEpic: 0 } };
  }

  // 2) Epic pity: if we're due an Epic+, force at least Epic
  const dueEpic = pity.sinceEpic + 1 >= EPIC_PITY;
  if (dueEpic) {
    return { result: { rarity: "Epic", tier: 4 }, pity: { sinceLegendary: pity.sinceLegendary + 1, sinceEpic: 0 } };
  }

  // 3) Normal weighted roll across the non-Legendary tiers (renormalized).
  const pool = SUMMON_RATES.filter(r => r.name !== "Legendary");
  const total = pool.reduce((s, r) => s + r.weight, 0);
  let roll = rng() * total;
  let chosen = pool[0];
  for (const r of pool) { if (roll < r.weight) { chosen = r; break; } roll -= r.weight; }

  const gotEpic = chosen.tier >= 4;
  return {
    result: { rarity: chosen.name, tier: chosen.tier },
    pity: {
      sinceLegendary: pity.sinceLegendary + 1,
      sinceEpic: gotEpic ? 0 : pity.sinceEpic + 1,
    },
  };
}