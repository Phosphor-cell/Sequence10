// api/battle_v2.ts
// Endgame-grade battle resolver with uint64/uint128 damage math.
//
// Design (validated by simulation):
//   - Damage is computed in BigInt (arbitrary precision -> uint128+ safe).
//   - The final boss at max rarity/difficulty has HP = uint64 max and is a WALL:
//     a perfect build wins ~0.3% of runs ("by some miracle"), anything less ~0%.
//   - Crit: critMult 3.0 = 300% = 3x base damage. Warframe-style red-crit tiers
//     stack (tier 2 = 5x, tier 3 = 7x) when critChance overflows past 100%.
//   - Boss defense is modeled via low evade/block (per spec: 1-10% range),
//     NOT a raw-armor wall, so a maxed build's damage stays meaningful.
//
// POST { playerId, chapterId, difficulty?, rarity? }
//
// NOTE: damage values can exceed JS Number precision, so all big numbers are
// returned as STRINGS. The client parses/formats them (it already uses uint64).

import { VercelRequest, VercelResponse } from "@vercel/node";
import { ELEMENTS, Element } from "./_herogen";
import { resolveAbilities, effectivePenForElement, AbilityMod, ResolvedSynergy } from "./_synergy";

const U64_MAX = (1n << 64n) - 1n;          // 18,446,744,073,709,551,615
const U32_MAX = (1n << 32n) - 1n;          // 4,294,967,295

interface Build {
  baseAttack: bigint;
  attackMultPct: number;   // additive % from abilities; applied as (1 + pct)
  attackerElement: Element; // which element this build's damage is typed as
  critChance: number;      // base + ability contribution; >=1.0 = red-crit tier
  critMult: number;        // 3.0 = 300% crit damage
  synergy: ResolvedSynergy; // resolved ability totals (pen per element, etc.)
}

interface BossDef {
  hp: bigint;
  defense: Record<Element, bigint>;  // per-element defense (weakness/resist profile)
  evade: number;           // 0..1, kept low (1-10%) per design
  block: number;           // 0..1, halves damage on proc
  afkWindow: number;       // attacks resolved per run (the tuning knob)
}

function mulBig(v: bigint, factor: number): bigint {
  // multiply a bigint by a float with 6-decimal precision
  return (v * BigInt(Math.round(factor * 1_000_000))) / 1_000_000n;
}

function computeHit(b: Build, boss: BossDef, isCrit: boolean): bigint {
  // Attack scaled by ability attack-mult (additive % -> single multiplier).
  let atk = mulBig(b.baseAttack, 1 + b.attackMultPct);

  // Effective defense = this element's boss defense, reduced by the build's
  // total penetration vs that element (global armor pen + element pen, capped).
  const pen = effectivePenForElement(b.synergy, b.attackerElement);
  const baseDef = boss.defense[b.attackerElement] ?? 0n;
  const effDef = mulBig(baseDef, 1 - pen);

  // Diminishing-armor formula: dmg = atk^2 / (atk + effDef)
  let dmg = (atk * atk) / (atk + effDef + 1n);

  if (isCrit) {
    const tier = Math.max(1, Math.floor(b.critChance));   // 1 normal, 2 red, 3 deep-red
    const effMult = 1 + (b.critMult - 1) * tier;
    dmg = mulBig(dmg, effMult);
  }
  return dmg;
}

// Deterministic-ish PRNG seeded per request so results are reproducible/testable.
function makeRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function resolveFight(b: Build, boss: BossDef, seed: number) {
  const rng = makeRng(seed);
  let hp = boss.hp;
  let totalDamage = 0n;
  let hits = 0, crits = 0, evaded = 0, blocked = 0;
  const critTier = Math.floor(b.critChance);
  const willCrit = b.critChance >= 1.0;

  for (let i = 0; i < boss.afkWindow && hp > 0n; i++) {
    hits++;
    if (rng() < boss.evade) { evaded++; continue; }
    const crit = willCrit || rng() < b.critChance;
    if (crit) crits++;
    let dmg = computeHit(b, boss, crit);
    if (rng() < boss.block) { dmg = dmg / 2n; blocked++; }
    hp -= dmg;
    totalDamage += dmg;
  }

  return {
    victory: hp <= 0n,
    bossHpRemaining: (hp < 0n ? 0n : hp),
    totalDamage,
    hits, crits, evaded, blocked,
    critTier,
  };
}

// Difficulty/rarity -> boss stats. The FINAL boss (max/max) is the uint64 wall.
// Defense is now PER-ELEMENT: bosses have a weakness (one element with reduced
// defense) and a resistance (one with raised defense), derived deterministically
// from (difficulty, rarity) so the same fight is reproducible/shareable.
function makeBoss(difficulty: number, rarity: number): BossDef {
  const isFinal = difficulty >= 10 && rarity >= 5;

  // Build a per-element defense record from a single base value.
  const buildDef = (base: bigint, allowProfile: boolean): Record<Element, bigint> => {
    const def = {} as Record<Element, bigint>;
    for (const e of ELEMENTS) def[e] = base;
    if (allowProfile) {
      // Deterministic weak/resist element indices (skip index 0 = neutral so
      // neutral stays a stable baseline).
      const span = ELEMENTS.length - 1;
      const weakIdx   = 1 + (((difficulty * 7) + (rarity * 3)) % span);
      const resistIdx = 1 + (((difficulty * 5) + (rarity * 11) + 3) % span);
      def[ELEMENTS[weakIdx]] = mulBig(base, 0.40);                 // weakness: -60% def
      if (resistIdx !== weakIdx) def[ELEMENTS[resistIdx]] = mulBig(base, 1.60); // resist: +60% def
    }
    return def;
  };

  if (isFinal) {
    // Calibrated: perfect build wins ~0.3% ("by some miracle"), anything less ~0%.
    // The wall has NO weakness — uniform max defense across every element.
    return { hp: U64_MAX, defense: buildDef(500_000_000n, false), evade: 0.07, block: 0.05, afkWindow: 1600 };
  }
  // Normal-chapter bosses, calibrated so appropriately-geared players win ~80%.
  const d = Math.max(1, difficulty);
  const hpFloat = 9600 * Math.pow(8.5, d - 1);
  let hp = BigInt(Math.min(Number.MAX_SAFE_INTEGER, Math.floor(hpFloat)));
  if (hp > U64_MAX) hp = U64_MAX;
  return {
    hp,
    defense: buildDef(1_000_000n * BigInt(d), true),
    evade: Math.min(0.10, 0.02 + difficulty * 0.005),
    block: Math.min(0.08, 0.01 + difficulty * 0.004),
    afkWindow: 1600,
  };
}

export default async (req: VercelRequest, res: VercelResponse) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = req.body || {};
  const difficulty = Number(body.difficulty ?? 1);
  const rarity = Number(body.rarity ?? 1);

  // Abilities come in as TYPED mods and are resolved through the governor
  // (_synergy.resolveAbilities), which sums same-axis values and clamps every
  // total. NOTE: today these are still accepted from the request; closing that
  // trust hole (deriving them server-side from the player's party) is the next
  // step. The governor's clamps mean even a malicious client can't exceed the
  // balance caps, but it could still under-report — full enforcement comes when
  // the party is read from Neon here.
  const abilities: AbilityMod[] = Array.isArray(body.abilities) ? body.abilities : [];
  const synergy = resolveAbilities(abilities);

  const reqElement = String(body.attackerElement ?? "neutral") as Element;
  const attackerElement: Element =
    (ELEMENTS as readonly string[]).includes(reqElement) ? reqElement : "neutral";

  const build: Build = {
    baseAttack: BigInt(body.baseAttack ?? 100),
    attackMultPct: synergy.attackMultPct,
    attackerElement,
    // base crit from request/gear PLUS the ability contribution from synergy
    critChance: Number(body.critChance ?? 0.15) + synergy.critChance,
    critMult: Number(body.critMult ?? 1.5) + synergy.critMult,
    synergy,
  };

  const boss = makeBoss(difficulty, rarity);
  const seed = (Date.now() ^ (difficulty * 2654435761) ^ (rarity * 40503)) >>> 0;
  const r = resolveFight(build, boss, seed);

  // Per-element defense profile (as strings — values can be large) so the
  // client can show the boss's weakness/resistance.
  const defenseProfile: Record<string, string> = {};
  for (const e of ELEMENTS) defenseProfile[e] = boss.defense[e].toString();

  return res.status(200).json({
    victory: r.victory,
    isFinalBoss: difficulty >= 10 && rarity >= 5,
    bossHp: boss.hp.toString(),
    bossHpRemaining: r.bossHpRemaining.toString(),
    totalDamage: r.totalDamage.toString(),
    hits: r.hits,
    crits: r.crits,
    critTier: r.critTier,
    evaded: r.evaded,
    blocked: r.blocked,
    bossEvade: boss.evade,
    bossBlock: boss.block,
    // ability/element transparency
    attackerElement,
    effectivePen: effectivePenForElement(synergy, attackerElement),
    appliedAttackMultPct: synergy.attackMultPct,
    bossDefenseProfile: defenseProfile,
  });
};