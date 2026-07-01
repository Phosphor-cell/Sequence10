// api/_synergy.ts  (HELPER — underscore = not an HTTP endpoint)
//
// The "governor" half of the content engine. Abilities — hand-authored now,
// LLM-generated later — are TYPED modifiers over a FIXED vocabulary of axes.
// This module is the single place that:
//   1) defines the legal axes an ability may touch,
//   2) clamps any one ability's value into a per-axis legal range
//      (generation-time safety: a generated ability can never be absurd),
//   3) accumulates a party's active abilities by axis, SUMS same-axis values
//      (the "-5% then -7% = -12%" stacking the design calls for), and CLAMPS
//      each TOTAL to a cap (combination-time safety: no stack of abilities can
//      break the damage math, and a wall always remains so "max damage" is hard).
//
// Because every ability is a bounded typed object, an open-ended generator can
// pour content in without ever threatening balance — the walls live HERE, not
// in the generator. Pure: no DB, no clock, no randomness; fully unit-testable.

import { ELEMENTS, Element } from "./_herogen";

export type AbilityAxis =
  | "attack_mult"   // additive % to attack; total applied as (1 + sum)
  | "armor_pen"     // additive fraction of ALL elements' defense bypassed
  | "element_pen"   // additive fraction of ONE element's defense bypassed
  | "crit_chance"   // additive to crit chance (may exceed 1.0 = red-crit tiers)
  | "crit_mult";    // additive to crit damage multiplier

export interface AbilityMod {
  axis: AbilityAxis;
  element?: Element;   // REQUIRED iff axis === "element_pen", forbidden otherwise
  value: number;       // the delta this ability contributes on its axis
}

// Per-axis bounds.
//   single{Min,Max} = legal range for ONE ability's value (generation clamp)
//   totalCap        = max for the SUMMED total across the whole party (stack clamp)
interface AxisSpec { singleMin: number; singleMax: number; totalCap: number; }

export const AXIS_SPEC: Record<AbilityAxis, AxisSpec> = {
  attack_mult: { singleMin: 0, singleMax: 0.50, totalCap: 3.00 }, // up to +300% atk from abilities
  armor_pen:   { singleMin: 0, singleMax: 0.20, totalCap: 0.90 },
  element_pen: { singleMin: 0, singleMax: 0.20, totalCap: 0.90 }, // per element
  crit_chance: { singleMin: 0, singleMax: 0.25, totalCap: 2.00 }, // allows red-crit tiers via stacking
  crit_mult:   { singleMin: 0, singleMax: 1.00, totalCap: 4.00 },
};

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// Generation-time guard: force a single ability's value into its axis's legal
// single-ability range. Called when an ability is authored OR generated, and
// again at resolution as defense-in-depth.
export function clampAbilityValue(axis: AbilityAxis, value: number): number {
  const spec = AXIS_SPEC[axis];
  if (!spec) return 0;
  if (!Number.isFinite(value)) return spec.singleMin;
  return clamp(value, spec.singleMin, spec.singleMax);
}

// Validate the SHAPE of an ability mod: axis known, and element present iff the
// axis is element_pen. Malformed mods are dropped by the resolver.
export function isValidAbility(m: AbilityMod): boolean {
  if (!m || !(m.axis in AXIS_SPEC)) return false;
  if (m.axis === "element_pen") return !!m.element && (ELEMENTS as readonly string[]).includes(m.element);
  return m.element === undefined;
}

export interface ResolvedSynergy {
  attackMultPct: number;                 // summed, clamped; apply as (1 + this)
  armorPen: number;                      // 0..cap
  elementPen: Record<Element, number>;   // per element, each 0..cap
  critChance: number;                    // ability contribution (added to base)
  critMult: number;                      // ability contribution (added to base)
}

function zeroElementPen(): Record<Element, number> {
  const r = {} as Record<Element, number>;
  for (const e of ELEMENTS) r[e] = 0;
  return r;
}

// THE GOVERNOR. Take a party's active ability mods, drop invalid ones, clamp
// each single value, sum by axis (element_pen summed per element), then clamp
// every total to its cap. Deterministic and order-independent.
export function resolveAbilities(mods: AbilityMod[]): ResolvedSynergy {
  const out: ResolvedSynergy = {
    attackMultPct: 0,
    armorPen: 0,
    elementPen: zeroElementPen(),
    critChance: 0,
    critMult: 0,
  };
  for (const raw of (mods || [])) {
    if (!isValidAbility(raw)) continue;
    const v = clampAbilityValue(raw.axis, raw.value);
    switch (raw.axis) {
      case "attack_mult": out.attackMultPct += v; break;
      case "armor_pen":   out.armorPen += v; break;
      case "crit_chance": out.critChance += v; break;
      case "crit_mult":   out.critMult += v; break;
      case "element_pen": out.elementPen[raw.element as Element] += v; break;
    }
  }
  // Clamp every accumulated total to its cap.
  out.attackMultPct = clamp(out.attackMultPct, 0, AXIS_SPEC.attack_mult.totalCap);
  out.armorPen      = clamp(out.armorPen,      0, AXIS_SPEC.armor_pen.totalCap);
  out.critChance    = clamp(out.critChance,    0, AXIS_SPEC.crit_chance.totalCap);
  out.critMult      = clamp(out.critMult,      0, AXIS_SPEC.crit_mult.totalCap);
  for (const e of ELEMENTS) out.elementPen[e] = clamp(out.elementPen[e], 0, AXIS_SPEC.element_pen.totalCap);
  return out;
}

// Effective defense penetration vs a specific element = global armor pen plus
// that element's pen, clamped so total bypass NEVER reaches 100% — a wall must
// always remain. This single cap is a big part of why max damage stays hard.
export const MAX_TOTAL_PEN = 0.95;
export function effectivePenForElement(r: ResolvedSynergy, element: Element): number {
  return clamp(r.armorPen + (r.elementPen[element] ?? 0), 0, MAX_TOTAL_PEN);
}