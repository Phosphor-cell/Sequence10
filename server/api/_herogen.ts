// api/_herogen.ts  (HELPER — underscore = not an HTTP endpoint)
//
// Pure, deterministic hero generation + summon economy. No DB, no clock, no
// side effects. Same seed -> same hero, always (matches _namegen's philosophy),
// so a hero's stored `seed` reproduces its class/stats anywhere.
//
// Kept separate from heroes.ts so it can be unit-tested in isolation.

import { Rarity } from "./_summon_rates";

// ── Summon economy ──────────────────────────────────────────────────────────
export const GEM_COST_SINGLE = 100;   // one pull
export const GEM_COST_TEN     = 900;  // ten pulls (10% bulk discount)
export const PARTY_SIZE       = 5;

export function gemCostFor(count: number): number {
  if (count >= 10) return GEM_COST_TEN;
  return GEM_COST_SINGLE * Math.max(1, count);
}

// ── PRNG (mulberry32 — same family the client + _namegen use) ────────────────
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(r: () => number, arr: readonly T[]): T => arr[Math.floor(r() * arr.length)];

// ── Theme (UI/setting axis) ─────────────────────────────────────────────────
export const THEMES = [
  "medieval", "xianxia_normal", "xianxia_horror", "victorian_normal", "victorian_horror",
];

// Actual image filenames per tier (client-side assets at client/assets/heros/tierN/*.jpg).
// These are discovered from the filesystem during this session; in production they'd be
// read from disk at deploy-time. For now, hardcoded from what actually exists.
const HERO_FILES_BY_TIER: Record<string, string[]> = {
  // Tier 1 (medieval) — Common/Uncommon
  tier1: ["Spearman", "Swordsman", "Archer", "Scout", "Mercenary", "Trapper"],
  // Tier 2 (xianxia_normal) — Rare
  tier2: ["Herbalist", "Mage", "Sage"],
  // Tier 3 (xianxia_horror) — Rare (edge case: 3 heroes for one tier)
  tier3: ["Assassin", "Beast-Master", "Shadow-Dancer"],
  // Tier 4 (victorian_normal) — Epic
  tier4: ["Paladin", "Spellblade", "Virtue"],
  // Tier 5 (victorian_horror) — Legendary
  tier5: ["Archangel", "Dominion", "Fallen", "Hellion", "Life-Bringer", "Reality_Weaver", "Sandman", "Seraph", "Time-Weaver", "Void-God"],
};

// Map rarity to tier folder for image lookup (separate from power tier).
const TIER_FOLDER_BY_RARITY: Record<Rarity, string> = {
  Common:    "tier1",
  Uncommon:  "tier1",
  Rare:      "tier2",
  Epic:      "tier4",
  Legendary: "tier5",
};

const ALIGNMENTS = ["neutral", "demonic", "angelic", "void", "celestial", "abyssal", "resonant"] as const;
// ELEMENTS is the canonical combat element vocabulary, shared with _synergy.ts
// (the ability governor) and battle_v2.ts (per-element boss defense).
export const ELEMENTS = ["neutral", "ember", "frost", "storm", "umbral", "radiant", "gale"] as const;
export type Element = (typeof ELEMENTS)[number];

// Power band + stat multiplier per rarity. `tier` matches the schema's existing
// CHECK (mortal/heroic/angelic/divine); theme (above) is the separate UI axis.
export const TIER_BY_RARITY: Record<Rarity, { tier: string; mult: number }> = {
  Common:    { tier: "mortal",  mult: 1.00 },
  Uncommon:  { tier: "mortal",  mult: 1.30 },
  Rare:      { tier: "heroic",  mult: 1.85 },
  Epic:      { tier: "angelic", mult: 2.70 },
  Legendary: { tier: "divine",  mult: 4.20 },
};

export interface GenHero {
  className: string; fileName: string; alignment: string; element: string;
  tier: string; health: number; attack: number; defense: number;
}

export function generateHero(seed: number, rarity: Rarity): GenHero {
  const r = mulberry32(seed);
  
  // Map rarity to tier folder. Tier folder determines which image filenames are available.
  const tierFolder = TIER_FOLDER_BY_RARITY[rarity];
  const availableFiles = HERO_FILES_BY_TIER[tierFolder];
  const fileName = pick(r, availableFiles);  // pick actual image filename
  const className = fileName;                 // display name = filename (no .jpg extension)
  
  const alignment = pick(r, ALIGNMENTS);
  const element = pick(r, ELEMENTS);
  const band = TIER_BY_RARITY[rarity];

  const roll = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const variance = 0.85 + r() * 0.30; // ±15%
  const health  = Math.max(1, Math.round(roll(800, 1200) * band.mult * variance));
  const attack  = Math.max(1, Math.round(roll(80, 140)   * band.mult * variance));
  const defense = Math.max(0, Math.round(roll(30, 70)    * band.mult * variance));

  return { className, fileName, alignment, element, tier: band.tier, health, attack, defense };
}

// ── Star-up / fusion economy ────────────────────────────────────────────────
// Pulling a hero CLASS you already own converts that pull into shards instead
// of adding a duplicate roster entry (see heroes.ts). Shards buy star levels.
// A higher star level is a flat compounding bonus to the hero's own base
// stats, so it stays meaningful at every rarity without flattening the
// Common -> Legendary gap from TIER_BY_RARITY above (+15% to +420%).
export const MAX_STAR_LEVEL = 6;
export const STAR_BONUS_PER_LEVEL = 0.12; // +12% to atk/def/hp per star above 1

// Shards awarded when a pull resolves to a class the player already owns.
// Scales with rarity so a dupe Legendary feels far more valuable than a
// dupe Common, matching how much rarer it is to pull.
export const DUPE_SHARDS_BY_RARITY: Record<Rarity, number> = {
  Common: 3, Uncommon: 5, Rare: 8, Epic: 15, Legendary: 30,
};

// Shard cost to go FROM the given star level TO the next one.
// Index 1 = cost of 1->2, ... index 5 = cost of 5->6. Index 6 is unused
// (already maxed). Costs ramp up so the early stars come fast and the last
// star is a real, satisfying grind -- the standard gacha shape.
export const STAR_UP_COST: Record<number, number> = {
  1: 5, 2: 10, 3: 20, 4: 40, 5: 80,
};

export function shardsForDupe(rarity: Rarity): number {
  return DUPE_SHARDS_BY_RARITY[rarity] ?? 3;
}

export function starUpCost(currentStar: number): number | null {
  if (currentStar < 1 || currentStar >= MAX_STAR_LEVEL) return null;
  return STAR_UP_COST[currentStar] ?? null;
}

// Multiplier to apply to a hero's BASE (star-1) stats at a given star level.
// star 1 -> 1.00x, star 2 -> 1.12x, ... star 6 -> 1.60x.
export function starMultiplier(starLevel: number): number {
  const s = Math.max(1, Math.min(MAX_STAR_LEVEL, starLevel));
  return 1 + (s - 1) * STAR_BONUS_PER_LEVEL;
}

// Apply the star multiplier to a hero's stored BASE stats to get the
// effective (displayed/battle) stats. Rounded, never below 1 for hp/atk.
export function applyStarBonus(base: { health: number; attack: number; defense: number }, starLevel: number) {
  const mult = starMultiplier(starLevel);
  return {
    health: Math.max(1, Math.round(base.health * mult)),
    attack: Math.max(1, Math.round(base.attack * mult)),
    defense: Math.max(0, Math.round(base.defense * mult)),
  };
}

// ── Hero leveling ────────────────────────────────────────────────────────────
// Heroes share the PLAYER exp curve (expToNext in _progression.ts) so there's
// one tested curve, but their per-level stat GAINS scale with rarity band so a
// Legendary's levels outscale a Common's -- leveling must not flatten the
// rarity gap (that would undercut "max damage should be hard to reach").
//
// Ability slots gate on these hero levels: slot unlocks at 1/10/20/30/40/50.
export const HERO_MAX_LEVEL = 60;
export const ABILITY_UNLOCK_LEVELS = [1, 10, 20, 30, 40, 50]; // index = ability slot 0..5

// Base per-level stat gain (a Common). Multiplied by the rarity band below.
function heroBaseStatGain(level: number) {
  return {
    health:  40 + level * 8,
    attack:  6  + Math.floor(level * 1.8),
    defense: 3  + Math.floor(level * 0.9),
  };
}

// Per-level gain scaled by the hero's rarity band (same mults as base stats).
export function heroStatGainForLevel(level: number, rarity: Rarity) {
  const mult = TIER_BY_RARITY[rarity]?.mult ?? 1.0;
  const g = heroBaseStatGain(level);
  return {
    health:  Math.round(g.health  * mult),
    attack:  Math.round(g.attack  * mult),
    defense: Math.round(g.defense * mult),
  };
}

// How many ability SLOTS are unlocked at a given hero level (0..6).
export function unlockedAbilitySlots(level: number): number {
  let n = 0;
  for (const lv of ABILITY_UNLOCK_LEVELS) if (level >= lv) n++;
  return n;
}