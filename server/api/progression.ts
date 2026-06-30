// api/_progression.ts  (HELPER — underscore = not an HTTP endpoint)
//
// Shared, deterministic progression math for level-up, idle rewards, and
// ascension. Pure functions: no clock, no DB, no randomness. The CALLERS own
// time (always server CURRENT_TIMESTAMP) so the client can never spoof it.
//
// All currency/exp uses BigInt (uint64+ safe). Stats stay in number range
// (they're display values capped well under int32).

// ── LEVEL CURVE ──────────────────────────────────────────────────────────
// exp needed to go from level L -> L+1. Smooth geometric-ish growth so early
// levels are fast (frequent dopamine) and later levels slow (the wall).
//   L1->2 ~ 100, scales ~ *1.15/level, softened by a polynomial floor.
export function expToNext(level: number): bigint {
  const base = 100;
  const v = base * Math.pow(level, 1.5) * Math.pow(1.15, level - 1);
  // round to a clean bigint
  return BigInt(Math.max(100, Math.floor(v)));
}

// Per-level stat gains. Ascension multiplier is applied on top by the caller.
export function statGainForLevel(level: number) {
  return {
    maxHealth: 50 + level * 10,
    attack:    10 + Math.floor(level * 2.5),
    defense:   5  + Math.floor(level * 1.2),
  };
}

// Apply accumulated exp, leveling up as many times as the exp allows.
// Returns the new level/exp/expToNext plus the TOTAL stat gain from levels
// gained (so the caller can add it, multiplied by ascension bonus).
export interface LevelResult {
  level: number;
  exp: bigint;
  expToNext: bigint;
  levelsGained: number;
  statGain: { maxHealth: number; attack: number; defense: number };
}
export function applyExp(level: number, exp: bigint, addExp: bigint): LevelResult {
  let lvl = level;
  let cur = exp + (addExp > 0n ? addExp : 0n);
  let need = expToNext(lvl);
  let gained = 0;
  const stat = { maxHealth: 0, attack: 0, defense: 0 };

  // cap iterations so a giant exp dump can't hang the function
  let guard = 0;
  while (cur >= need && guard < 100000) {
    cur -= need;
    lvl += 1;
    gained += 1;
    const g = statGainForLevel(lvl);
    stat.maxHealth += g.maxHealth;
    stat.attack    += g.attack;
    stat.defense   += g.defense;
    need = expToNext(lvl);
    guard++;
  }
  return { level: lvl, exp: cur, expToNext: need, levelsGained: gained, statGain: stat };
}

// ── IDLE / OFFLINE REWARDS ───────────────────────────────────────────────
// Reward rate is derived from the player's power so it stays meaningful as
// they grow. Caller passes elapsedSeconds computed from SERVER timestamps.
//
// Anti-abuse:
//  - elapsed is clamped to [0, CAP] (no negative from clock skew, no infinite)
//  - rate scales with level + chapter but is bounded
const IDLE_CAP_SECONDS = 12 * 3600;      // 12h cap, like AFK Arena's chest
const GOLD_PER_SEC_BASE = 0.5;
const EXP_PER_SEC_BASE  = 0.25;

export interface IdleReward {
  elapsedSeconds: number;
  cappedSeconds: number;
  gold: bigint;
  exp: bigint;
  cappedOut: boolean;
}
export function computeIdleReward(
  elapsedSecondsRaw: number,
  level: number,
  chapter: number,
  ascensionLevel: number
): IdleReward {
  // clamp: never negative (clock skew), never beyond cap
  const elapsed = Math.max(0, Math.floor(elapsedSecondsRaw));
  const capped = Math.min(elapsed, IDLE_CAP_SECONDS);

  // rate scales with progress; ascension gives a gentle bonus
  const lvlFactor = 1 + level * 0.05;
  const chapFactor = 1 + (chapter - 1) * 0.25;
  const ascFactor = 1 + ascensionLevel * 0.5;

  const goldRate = GOLD_PER_SEC_BASE * lvlFactor * chapFactor * ascFactor;
  const expRate  = EXP_PER_SEC_BASE  * lvlFactor * chapFactor;

  const gold = BigInt(Math.floor(goldRate * capped));
  const exp  = BigInt(Math.floor(expRate  * capped));

  return {
    elapsedSeconds: elapsed,
    cappedSeconds: capped,
    gold,
    exp,
    cappedOut: elapsed > IDLE_CAP_SECONDS,
  };
}

// ── ASCENSION ────────────────────────────────────────────────────────────
// Permanent global multiplier from ascension level. This is what feeds the
// battle_v2 multipliers[] array, making the "perfect build" reachable.
export const ASCENSION_LEVEL_REQUIREMENT = 100;   // must hit this level to ascend
export function ascensionMultiplier(ascensionLevel: number): number {
  // each ascension = +50% permanent damage (1.5^n). Tune freely.
  return Math.pow(1.5, ascensionLevel);
}
export function canAscend(level: number): boolean {
  return level >= ASCENSION_LEVEL_REQUIREMENT;
}