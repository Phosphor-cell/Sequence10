// api/_power.ts  (HELPER — underscore = not an HTTP endpoint)
//
// The SECOND governor layer, sitting above _synergy.ts (abilities). Where
// _synergy governs what ABILITIES (loadout choices) can do, this governs the
// two PERMANENT enhancement systems attached to every hero:
//
//   • BLOODLINE — a hero is born with one. LLM-generated, can be "absurd" in
//     flavor and magnitude, but every axis is HARD-CAPPED here so no generated
//     bloodline can ever break the damage math. This is the "veins of nihility
//     gives 1000% damage" fantasy — allowed to be huge, but the cap is the wall.
//   • SOUL — a hero is bonded to one. Also generated, grants similar axes but at
//     STRICTLY LOWER caps than bloodlines (souls are the "cool ability + smaller
//     numbers" layer), plus unlocks a keyworded on-field effect (e.g. Soul of
//     Light → party heal). Souls trade raw magnitude for utility.
//
// ── The stacking model (matches Warframe's proven design) ───────────────────
//   ADDITIVE within a source category, MULTIPLICATIVE between categories.
//   So: total_damage_mult = (1 + ability_atk) × (1 + bloodline_dmg) × (1 + soul_dmg)
//   Each factor is independently capped, so the PRODUCT has a known ceiling —
//   there is a maximum achievable multiplier, which is exactly the "no infinite
//   damage, but perfect teams hit a high ceiling" property the design wants.
//
// Pure: no DB, no clock, no randomness. Fully unit-testable.

import { ELEMENTS, Element } from "./_herogen";

// ── Enhancement axes (shared vocabulary for bloodlines AND souls) ────────────
// These are deliberately a superset of what abilities touch — bloodlines/souls
// can grant raw damage %, crit, element damage %, defensive layers, and lifesteal
// (the vampiric-healer enabler) that loadout abilities cannot.
export type PowerAxis =
  | "damage_pct"        // additive % bonus to outgoing damage (the big one)
  | "crit_chance"       // additive crit chance
  | "crit_mult"         // additive crit damage multiplier
  | "element_dmg_pct"   // additive % bonus vs a SPECIFIC element target
  | "defense_pct"       // additive % bonus to this hero's effective defense
  | "max_hp_pct"        // additive % bonus to this hero's max HP
  | "lifesteal_pct"     // additive % of damage dealt returned as healing
  | "damage_reduction"; // additive fraction of incoming damage ignored (capped hard)

export interface PowerMod {
  axis: PowerAxis;
  element?: Element;    // REQUIRED iff axis === "element_dmg_pct", forbidden otherwise
  value: number;
}

interface PowerAxisSpec { singleMin: number; singleMax: number; totalCap: number; }

// BLOODLINE caps — deliberately high (the "absurd but walled" layer).
// Placeholder magnitudes tuned so a maxed single-axis bloodline is powerful but
// the between-category product stays finite. These are balance dials; the CAP
// existing at all is the invariant, the exact number is tunable later.
export const BLOODLINE_SPEC: Record<PowerAxis, PowerAxisSpec> = {
  damage_pct:       { singleMin: 0, singleMax: 5.00, totalCap: 10.00 }, // up to +1000% total
  crit_chance:      { singleMin: 0, singleMax: 1.00, totalCap: 3.00 },
  crit_mult:        { singleMin: 0, singleMax: 3.00, totalCap: 8.00 },
  element_dmg_pct:  { singleMin: 0, singleMax: 5.00, totalCap: 10.00 }, // per element
  defense_pct:      { singleMin: 0, singleMax: 3.00, totalCap: 6.00 },
  max_hp_pct:       { singleMin: 0, singleMax: 3.00, totalCap: 6.00 },
  lifesteal_pct:    { singleMin: 0, singleMax: 0.50, totalCap: 0.80 },  // 80% lifesteal wall
  damage_reduction: { singleMin: 0, singleMax: 0.40, totalCap: 0.75 },  // 75% DR wall (never immune)
};

// SOUL caps — strictly LOWER than bloodline on every raw axis (souls = utility,
// not raw magnitude). A soul maxing an axis is meaningfully weaker than a
// bloodline doing the same, which is the intended power relationship.
export const SOUL_SPEC: Record<PowerAxis, PowerAxisSpec> = {
  damage_pct:       { singleMin: 0, singleMax: 2.50, totalCap: 5.00 },  // up to +500% total (half of bloodline)
  crit_chance:      { singleMin: 0, singleMax: 0.50, totalCap: 1.50 },
  crit_mult:        { singleMin: 0, singleMax: 1.50, totalCap: 4.00 },
  element_dmg_pct:  { singleMin: 0, singleMax: 2.50, totalCap: 5.00 },
  defense_pct:      { singleMin: 0, singleMax: 1.50, totalCap: 3.00 },
  max_hp_pct:       { singleMin: 0, singleMax: 1.50, totalCap: 3.00 },
  lifesteal_pct:    { singleMin: 0, singleMax: 0.30, totalCap: 0.50 },
  damage_reduction: { singleMin: 0, singleMax: 0.25, totalCap: 0.50 },
};

// ── Keyworded on-field soul effects ─────────────────────────────────────────
// A soul may ALSO carry one keyworded battle effect beyond its stat mods. These
// are a FIXED enum (the generator picks from this list — it never invents raw
// mechanics, matching the _synergy philosophy that generation chooses over a
// governed vocabulary, never free-form). The battle resolver interprets these.
export const SOUL_EFFECT_KEYWORDS = [
  "none",
  "party_heal_on_field",   // heals whole party a % of their max HP each round
  "revive_once",           // first ally death per battle revives at % HP
  "shield_on_field",       // grants party a shield buffer at battle start
  "cleanse_on_field",      // strips one debuff from the party each round
  "thorns",                // reflects a % of damage taken back to attacker
] as const;
export type SoulEffectKeyword = (typeof SOUL_EFFECT_KEYWORDS)[number];

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// Generation-time guard for a single bloodline/soul axis value.
export function clampPowerValue(spec: Record<PowerAxis, PowerAxisSpec>, axis: PowerAxis, value: number): number {
  const s = spec[axis];
  if (!s) return 0;
  if (!Number.isFinite(value)) return s.singleMin;
  return clamp(value, s.singleMin, s.singleMax);
}

export function isValidPowerMod(m: PowerMod): boolean {
  if (!m || !(m.axis in BLOODLINE_SPEC)) return false;
  if (m.axis === "element_dmg_pct") return !!m.element && (ELEMENTS as readonly string[]).includes(m.element);
  return m.element === undefined;
}

export function isValidSoulEffect(k: string): k is SoulEffectKeyword {
  return (SOUL_EFFECT_KEYWORDS as readonly string[]).includes(k);
}

// The resolved contribution of ONE source (a bloodline OR a soul).
export interface ResolvedPower {
  damagePct: number;
  critChance: number;
  critMult: number;
  elementDmgPct: Record<Element, number>;
  defensePct: number;
  maxHpPct: number;
  lifestealPct: number;
  damageReduction: number;
}

function zeroElementMap(): Record<Element, number> {
  const r = {} as Record<Element, number>;
  for (const e of ELEMENTS) r[e] = 0;
  return r;
}

function zeroResolvedPower(): ResolvedPower {
  return {
    damagePct: 0, critChance: 0, critMult: 0,
    elementDmgPct: zeroElementMap(),
    defensePct: 0, maxHpPct: 0, lifestealPct: 0, damageReduction: 0,
  };
}

// Resolve one source's mods against the given spec (BLOODLINE_SPEC or SOUL_SPEC):
// drop invalid, clamp each single value, SUM by axis, clamp each total to cap.
// Identical shape to _synergy.resolveAbilities — same proven pattern.
export function resolvePower(mods: PowerMod[], spec: Record<PowerAxis, PowerAxisSpec>): ResolvedPower {
  const out = zeroResolvedPower();
  for (const raw of (mods || [])) {
    if (!isValidPowerMod(raw)) continue;
    const v = clampPowerValue(spec, raw.axis, raw.value);
    switch (raw.axis) {
      case "damage_pct":       out.damagePct += v; break;
      case "crit_chance":      out.critChance += v; break;
      case "crit_mult":        out.critMult += v; break;
      case "defense_pct":      out.defensePct += v; break;
      case "max_hp_pct":       out.maxHpPct += v; break;
      case "lifesteal_pct":    out.lifestealPct += v; break;
      case "damage_reduction": out.damageReduction += v; break;
      case "element_dmg_pct":  out.elementDmgPct[raw.element as Element] += v; break;
    }
  }
  out.damagePct       = clamp(out.damagePct,       0, spec.damage_pct.totalCap);
  out.critChance      = clamp(out.critChance,      0, spec.crit_chance.totalCap);
  out.critMult        = clamp(out.critMult,        0, spec.crit_mult.totalCap);
  out.defensePct      = clamp(out.defensePct,      0, spec.defense_pct.totalCap);
  out.maxHpPct        = clamp(out.maxHpPct,        0, spec.max_hp_pct.totalCap);
  out.lifestealPct    = clamp(out.lifestealPct,    0, spec.lifesteal_pct.totalCap);
  out.damageReduction = clamp(out.damageReduction, 0, spec.damage_reduction.totalCap);
  for (const e of ELEMENTS) out.elementDmgPct[e] = clamp(out.elementDmgPct[e], 0, spec.element_dmg_pct.totalCap);
  return out;
}

// ── Combining bloodline + soul into one hero's total enhancement ─────────────
// The KEY design decision: raw-damage-style axes combine MULTIPLICATIVELY
// between the two sources (Warframe's between-category rule), while defensive
// FRACTIONS (damage_reduction, lifesteal) combine so they approach but never
// reach 1.0. This is what makes the ceiling finite: the product of two capped
// factors is itself capped, at a known maximum.
export interface HeroEnhancement {
  // multiplicative damage factor: apply to base damage as base × damageFactor
  damageFactor: number;
  critChance: number;         // additive across sources, further capped
  critMult: number;           // additive across sources
  elementDmgFactor: Record<Element, number>;   // per-element multiplicative factor
  defenseFactor: number;      // multiplicative to effective defense
  maxHpFactor: number;        // multiplicative to max HP
  lifestealPct: number;       // combined, capped < 1
  damageReduction: number;    // combined, capped < 1
  soulEffect: SoulEffectKeyword;
}

// Global hard ceilings on the COMBINED result — the final wall. Even if both
// bloodline and soul max the same axis, the combined value cannot exceed these.
// This is the single most important balance guarantee: the maximum total damage
// multiplier a hero can reach is bounded, so "infinite damage" is impossible by
// construction while "perfect build hits a high ceiling" remains true.
export const COMBINED_CRIT_CHANCE_CAP = 3.00;   // 300% → red-crit tiers, but bounded
export const COMBINED_CRIT_MULT_CAP   = 10.00;
export const COMBINED_LIFESTEAL_CAP   = 0.90;
export const COMBINED_DR_CAP          = 0.85;   // 85% max DR — always take ≥15%

// Combine two fractional damage-reduction-style values so the result approaches
// but never reaches 1.0: combined = 1 - (1-a)(1-b). Two 50%s → 75%, not 100%.
function combineFraction(a: number, b: number, cap: number): number {
  const combined = 1 - (1 - a) * (1 - b);
  return clamp(combined, 0, cap);
}

export function combineEnhancement(
  bloodline: ResolvedPower,
  soul: ResolvedPower,
  soulEffect: SoulEffectKeyword
): HeroEnhancement {
  const elementDmgFactor = {} as Record<Element, number>;
  for (const e of ELEMENTS) {
    elementDmgFactor[e] = (1 + bloodline.elementDmgPct[e]) * (1 + soul.elementDmgPct[e]);
  }
  return {
    // multiplicative between sources — the core combo math
    damageFactor:  (1 + bloodline.damagePct) * (1 + soul.damagePct),
    critChance:    clamp(bloodline.critChance + soul.critChance, 0, COMBINED_CRIT_CHANCE_CAP),
    critMult:      clamp(bloodline.critMult + soul.critMult, 0, COMBINED_CRIT_MULT_CAP),
    elementDmgFactor,
    defenseFactor: (1 + bloodline.defensePct) * (1 + soul.defensePct),
    maxHpFactor:   (1 + bloodline.maxHpPct) * (1 + soul.maxHpPct),
    lifestealPct:  combineFraction(bloodline.lifestealPct, soul.lifestealPct, COMBINED_LIFESTEAL_CAP),
    damageReduction: combineFraction(bloodline.damageReduction, soul.damageReduction, COMBINED_DR_CAP),
    soulEffect: isValidSoulEffect(soulEffect) ? soulEffect : "none",
  };
}