// Pure-logic tests for the bloodline/soul power governor (_power.ts). No DB.
// Run: node tests/power.test.cjs
const { execSync } = require('child_process');
const assert = require('assert');

execSync(
  'npx tsc --target ES2020 --module commonjs --esModuleInterop --outDir /tmp/_t_pow api/_summon_rates.ts api/_herogen.ts api/_power.ts',
  { stdio: 'inherit' }
);
const P = require('/tmp/_t_pow/_power.js');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}: ${e.message}`); fail++; }
}
const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

console.log("power.test:");

// ── Single-value generation clamp ────────────────────────────────────────────
check("a single absurd bloodline damage value is clamped to the bloodline singleMax", () => {
  // "veins of nihility: +1000% damage" — asking for 10.0 (1000%), single cap is 5.0
  const v = P.clampPowerValue(P.BLOODLINE_SPEC, "damage_pct", 10.0);
  assert(close(v, 5.0), `expected clamp to 5.0, got ${v}`);
});

check("souls clamp the same axis LOWER than bloodlines do", () => {
  const bl = P.clampPowerValue(P.BLOODLINE_SPEC, "damage_pct", 99);
  const sl = P.clampPowerValue(P.SOUL_SPEC, "damage_pct", 99);
  assert(bl > sl, `bloodline cap (${bl}) must exceed soul cap (${sl})`);
});

// ── Stacking within a source sums, then clamps to total cap ──────────────────
check("multiple damage mods on one bloodline SUM then clamp to totalCap", () => {
  const r = P.resolvePower([
    { axis: "damage_pct", value: 4 },
    { axis: "damage_pct", value: 4 },
    { axis: "damage_pct", value: 4 },   // 12 raw (each clamped to 5 first → 5+5+5=15), cap 10
  ], P.BLOODLINE_SPEC);
  assert(close(r.damagePct, 10.0), `expected total clamped to 10.0, got ${r.damagePct}`);
});

check("element_dmg_pct is tracked per element and doesn't bleed across elements", () => {
  const r = P.resolvePower([
    { axis: "element_dmg_pct", element: "umbral", value: 2 },
    { axis: "element_dmg_pct", element: "umbral", value: 2 },
  ], P.BLOODLINE_SPEC);
  assert(close(r.elementDmgPct.umbral, 4), `umbral should be 4, got ${r.elementDmgPct.umbral}`);
  assert(close(r.elementDmgPct.radiant, 0), "radiant should be untouched");
});

// ── Shape validation ─────────────────────────────────────────────────────────
check("element_dmg_pct without an element is rejected", () => {
  assert.strictEqual(P.isValidPowerMod({ axis: "element_dmg_pct", value: 1 }), false);
});
check("non-element axis WITH an element is rejected", () => {
  assert.strictEqual(P.isValidPowerMod({ axis: "damage_pct", element: "ember", value: 1 }), false);
});
check("invalid mods are dropped, not crashed on", () => {
  const r = P.resolvePower([
    { axis: "not_a_real_axis", value: 5 },
    { axis: "damage_pct", value: 1 },
    null,
    undefined,
  ], P.BLOODLINE_SPEC);
  assert(close(r.damagePct, 1), `only the valid mod should count, got ${r.damagePct}`);
});

// ── The critical property: combined ceiling is FINITE ────────────────────────
check("THE WALL: max bloodline × max soul damage still yields a FINITE, known factor", () => {
  const maxBlood = P.resolvePower(
    Array(5).fill({ axis: "damage_pct", value: 5 }), P.BLOODLINE_SPEC); // → capped 10.0
  const maxSoul = P.resolvePower(
    Array(5).fill({ axis: "damage_pct", value: 5 }), P.SOUL_SPEC);      // → capped 5.0
  const e = P.combineEnhancement(maxBlood, maxSoul, "none");
  // (1 + 10) × (1 + 5) = 11 × 6 = 66. Big, but FINITE and exactly predictable.
  assert(close(e.damageFactor, 66), `expected 66x ceiling, got ${e.damageFactor}`);
  assert(Number.isFinite(e.damageFactor), "damage factor must be finite");
});

check("combined crit chance is capped even if both sources max it", () => {
  const maxBlood = P.resolvePower(Array(3).fill({ axis: "crit_chance", value: 1 }), P.BLOODLINE_SPEC);
  const maxSoul = P.resolvePower(Array(3).fill({ axis: "crit_chance", value: 0.5 }), P.SOUL_SPEC);
  const e = P.combineEnhancement(maxBlood, maxSoul, "none");
  assert(e.critChance <= P.COMBINED_CRIT_CHANCE_CAP + 1e-9, `crit chance ${e.critChance} exceeds cap`);
  assert(close(e.critChance, P.COMBINED_CRIT_CHANCE_CAP), `should hit exactly the cap`);
});

check("damage reduction combines toward but never reaches 100%", () => {
  // Two 75% sources: 1 - (1-.75)(1-.75) = 1 - .0625 = .9375, but COMBINED_DR_CAP = .85
  const maxBlood = P.resolvePower(Array(3).fill({ axis: "damage_reduction", value: 0.4 }), P.BLOODLINE_SPEC);
  const maxSoul = P.resolvePower(Array(3).fill({ axis: "damage_reduction", value: 0.25 }), P.SOUL_SPEC);
  const e = P.combineEnhancement(maxBlood, maxSoul, "none");
  assert(e.damageReduction < 1.0, "DR must never reach 100% — a hero always takes some damage");
  assert(e.damageReduction <= P.COMBINED_DR_CAP + 1e-9, `DR ${e.damageReduction} exceeds hard cap`);
});

check("lifesteal combines toward but never reaches 100%", () => {
  const maxBlood = P.resolvePower(Array(2).fill({ axis: "lifesteal_pct", value: 0.5 }), P.BLOODLINE_SPEC);
  const maxSoul = P.resolvePower(Array(2).fill({ axis: "lifesteal_pct", value: 0.3 }), P.SOUL_SPEC);
  const e = P.combineEnhancement(maxBlood, maxSoul, "none");
  assert(e.lifestealPct < 1.0, "lifesteal must never reach 100%");
  assert(e.lifestealPct <= P.COMBINED_LIFESTEAL_CAP + 1e-9, "lifesteal within combined cap");
});

// ── Soul effect keyword handling ─────────────────────────────────────────────
check("a valid soul effect keyword is preserved", () => {
  const e = P.combineEnhancement(P.resolvePower([], P.BLOODLINE_SPEC), P.resolvePower([], P.SOUL_SPEC), "party_heal_on_field");
  assert.strictEqual(e.soulEffect, "party_heal_on_field");
});
check("an invalid soul effect keyword falls back to 'none'", () => {
  const e = P.combineEnhancement(P.resolvePower([], P.BLOODLINE_SPEC), P.resolvePower([], P.SOUL_SPEC), "instant_win_lol");
  assert.strictEqual(e.soulEffect, "none");
});

check("empty inputs yield an identity enhancement (1x everything, no effect)", () => {
  const e = P.combineEnhancement(P.resolvePower([], P.BLOODLINE_SPEC), P.resolvePower([], P.SOUL_SPEC), "none");
  assert(close(e.damageFactor, 1), "no bonuses → 1x damage");
  assert(close(e.defenseFactor, 1), "no bonuses → 1x defense");
  assert(close(e.maxHpFactor, 1), "no bonuses → 1x hp");
  assert(close(e.critChance, 0) && close(e.critMult, 0), "no crit contribution");
  assert(close(e.lifestealPct, 0) && close(e.damageReduction, 0), "no defensive fractions");
});

check("resolution is order-independent", () => {
  const a = P.resolvePower([
    { axis: "damage_pct", value: 2 },
    { axis: "crit_mult", value: 1 },
    { axis: "element_dmg_pct", element: "frost", value: 1 },
  ], P.BLOODLINE_SPEC);
  const b = P.resolvePower([
    { axis: "element_dmg_pct", element: "frost", value: 1 },
    { axis: "crit_mult", value: 1 },
    { axis: "damage_pct", value: 2 },
  ], P.BLOODLINE_SPEC);
  assert(close(a.damagePct, b.damagePct) && close(a.critMult, b.critMult) && close(a.elementDmgPct.frost, b.elementDmgPct.frost),
    "same mods in any order → same result");
});

console.log(`\npower.test: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
