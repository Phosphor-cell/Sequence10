// api/_bloodline_roll.ts  (HELPER — underscore = not an HTTP endpoint)
//
// The GAMBLE math for bloodline rolls. Pure, deterministic given a seed, fully
// simulatable. This module answers one question: given N Blood Stones opened AT
// ONCE, what bloodline tier comes out?
//
// ── Design goals (grounded in gacha psychology) ─────────────────────────────
//   1. Batching matters: opening 100 stones together produces a BETTER single
//      result than opening 100 stones one at a time. (Confirmed design intent.)
//      Mechanism: the batch raises the FLOOR tier and shifts the whole
//      distribution's mass upward — you can never "waste" a big batch on T1.
//   2. Never-zero reach, but a lottery at the top: T12 stays astronomically
//      unlikely even at large batches, but the curve is logarithmic so each
//      bigger batch is a VISIBLE leap (1 → 10 → 100 each feel dramatically
//      better). This is the "bounded pain / visible progress" that makes
//      Genshin-style pulls feel fair instead of like screaming into a void.
//   3. Soft pity: catastrophic luck is impossible. Lifetime stones opened
//      raises a guaranteed floor at milestones, so investment always pays out.
//
// TIERS: bloodlines are T1..T12. T12 is the mythical "veins of nihility" tier.
// The tier here selects which CAP BAND the generator (later) rolls stats within;
// _power.ts already hard-caps the actual values, so a T12 is powerful but walled.

export const MAX_BLOODLINE_TIER = 12;
export const MIN_BLOODLINE_TIER = 1;

// A mulberry32 PRNG so a given (seed) is reproducible/testable and the server
// stays authoritative over the roll (client can't reroll for a better result).
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// ── Floor tier from batch size ──────────────────────────────────────────────
// The batch's FLOOR (minimum possible tier) rises with log(batch). This is the
// anti-frustration guarantee: a big batch can't dump you at T1.
//   1 stone   → floor 1
//   10 stones → floor ~2
//   100       → floor ~4
//   1000      → floor ~5-6
export function floorTierForBatch(batch: number): number {
  const n = Math.max(1, Math.floor(batch));
  // log10 scaled: each 10x adds ~1.5 to the floor, capped so floor never
  // trivializes the top tiers (you still have to gamble for T7+).
  const floor = 1 + Math.floor(Math.log10(n) * 1.5);
  return clamp(floor, MIN_BLOODLINE_TIER, 6);
}

// ── Center (expected tier) from batch size ──────────────────────────────────
// The distribution's CENTER of mass also climbs with the batch, faster than the
// floor, so bigger batches don't just raise the minimum — they make good tiers
// genuinely likely, not just possible.
function centerTierForBatch(batch: number): number {
  const n = Math.max(1, Math.floor(batch));
  // log-scaled center: 1→~1.5, 10→~3.3, 100→~5.1, 1000→~6.9, 10000→~8.7
  const center = 1.5 + Math.log10(n) * 1.8;
  return clamp(center, 1, MAX_BLOODLINE_TIER);
}

// ── Soft-pity floor from lifetime stones opened ─────────────────────────────
// Milestone guarantees so grinding always pays out. Returns a floor tier that
// rises at thresholds. Combined with the batch floor via max().
export function pityFloor(lifetimeStonesOpened: number): number {
  const s = Math.max(0, Math.floor(lifetimeStonesOpened));
  if (s >= 50000) return 7;
  if (s >= 20000) return 6;
  if (s >= 8000)  return 5;
  if (s >= 3000)  return 4;
  if (s >= 1000)  return 3;
  if (s >= 250)   return 2;
  return 1;
}

// ── The roll ────────────────────────────────────────────────────────────────
// Rolls a bloodline tier for a batch open. Deterministic given (seed). Uses a
// skewed distribution centered on centerTierForBatch, floored at
// max(batchFloor, pityFloor), with a long thin tail toward T12 (the lottery).
export function rollBloodlineTier(
  batch: number,
  lifetimeStonesOpened: number,
  seed: number
): number {
  const rng = mulberry32(seed);
  const floor = Math.max(floorTierForBatch(batch), pityFloor(lifetimeStonesOpened));
  const center = Math.max(centerTierForBatch(batch), floor);

  // Draw a roughly-normal value around `center` using the sum of a few uniforms
  // (central limit), then bias the spread so the UP direction (toward T12) has a
  // thin reachable tail while the DOWN direction is bounded by `floor`.
  const u = (rng() + rng() + rng()) / 3; // ~normal-ish in [0,1], mean 0.5
  const spread = 3.2;                     // how wide the bell is (in tiers)
  let tier = center + (u - 0.5) * 2 * spread;

  // Rare "surge": a small chance to leap upward, keeping T10-12 reachable even
  // from modest batches (the never-zero lottery). Probability scales gently with
  // batch so bigger opens see surges a little more often.
  const surgeChance = clamp(0.002 + Math.log10(Math.max(1, batch)) * 0.004, 0.002, 0.03);
  if (rng() < surgeChance) {
    tier += 2 + rng() * 4; // +2..+6 tiers on a surge
  }

  return clamp(Math.round(tier), floor, MAX_BLOODLINE_TIER);
}

// Convenience for simulation/telemetry: roll many independent single-stone opens
// vs one combined batch, to demonstrate batching superiority.
export function expectedTierOverTrials(
  batch: number,
  lifetimeStonesOpened: number,
  trials: number,
  baseSeed: number
): number {
  let sum = 0;
  for (let i = 0; i < trials; i++) {
    sum += rollBloodlineTier(batch, lifetimeStonesOpened, baseSeed + i * 2654435761);
  }
  return sum / trials;
}