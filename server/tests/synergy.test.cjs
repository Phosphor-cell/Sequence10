// Pure-logic tests for the ability synergy governor (_synergy.ts). No DB.
// Run: node tests/synergy.test.cjs
const { execSync } = require('child_process');
const assert = require('assert');

execSync(
  'npx tsc --target ES2020 --module commonjs --esModuleInterop --outDir /tmp/_t_syn api/_summon_rates.ts api/_herogen.ts api/_synergy.ts',
  { stdio: 'inherit' }
);
const S = require('/tmp/_t_syn/_synergy.js');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}: ${e.message}`); fail++; }
}

console.log("synergy.test:");

const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// ── The canonical design case ────────────────────────────────────────────────
check("CANONICAL: -5% then -7% ember defense pen stacks to -12%", () => {
  const r = S.resolveAbilities([
    { axis: "element_pen", element: "ember", value: 0.05 },
    { axis: "element_pen", element: "ember", value: 0.07 },
  ]);
  assert(close(r.elementPen.ember, 0.12), `expected 0.12 ember pen, got ${r.elementPen.ember}`);
  // other elements untouched
  assert(close(r.elementPen.frost, 0), "frost pen should stay 0");
});

check("element pens don't bleed across elements", () => {
  const r = S.resolveAbilities([
    { axis: "element_pen", element: "ember", value: 0.10 },
    { axis: "element_pen", element: "frost", value: 0.08 },
  ]);
  assert(close(r.elementPen.ember, 0.10) && close(r.elementPen.frost, 0.08),
    `ember=${r.elementPen.ember} frost=${r.elementPen.frost}`);
});

// ── Generation-time clamp (single ability can't be absurd) ───────────────────
check("a single over-spec ability value is clamped to the axis singleMax", () => {
  // singleMax for element_pen is 0.20; a 0.50 ability is clamped to 0.20.
  const r = S.resolveAbilities([{ axis: "element_pen", element: "ember", value: 0.50 }]);
  assert(close(r.elementPen.ember, 0.20), `expected clamp to 0.20, got ${r.elementPen.ember}`);
  // clampAbilityValue directly
  assert.strictEqual(S.clampAbilityValue("element_pen", 0.5), 0.20);
  assert.strictEqual(S.clampAbilityValue("element_pen", -1), 0.0);
  assert.strictEqual(S.clampAbilityValue("attack_mult", 99), 0.50);
});

// ── Combination-time clamp (no stack breaks the cap) ─────────────────────────
check("stacking past the total cap is clamped (no runaway)", () => {
  // 6 ember pens, each clamped to singleMax 0.20 -> sum 1.20, capped at 0.90.
  const mods = Array.from({ length: 6 }, () => ({ axis: "element_pen", element: "ember", value: 0.20 }));
  const r = S.resolveAbilities(mods);
  assert(close(r.elementPen.ember, 0.90), `expected total cap 0.90, got ${r.elementPen.ember}`);
});

check("effective pen vs an element never reaches 100% (a wall remains)", () => {
  // Max out both armor_pen (cap 0.90) and ember pen (cap 0.90); effective is
  // still clamped below 1.0 by MAX_TOTAL_PEN.
  const mods = [];
  for (let i = 0; i < 10; i++) mods.push({ axis: "armor_pen", value: 0.20 });
  for (let i = 0; i < 10; i++) mods.push({ axis: "element_pen", element: "ember", value: 0.20 });
  const r = S.resolveAbilities(mods);
  const eff = S.effectivePenForElement(r, "ember");
  assert(eff <= S.MAX_TOTAL_PEN, `effective pen ${eff} exceeded MAX_TOTAL_PEN ${S.MAX_TOTAL_PEN}`);
  assert(eff < 1.0, "effective pen must stay below 100% so a damage wall always remains");
});

// ── Validation: malformed mods are dropped ───────────────────────────────────
check("invalid ability mods are ignored, not crashed on", () => {
  const r = S.resolveAbilities([
    { axis: "element_pen", value: 0.10 },            // missing required element -> dropped
    { axis: "armor_pen", element: "ember", value: 0.1 }, // element on a non-element axis -> dropped
    { axis: "nonsense", value: 5 },                   // unknown axis -> dropped
    { axis: "attack_mult", value: 0.10 },             // valid
  ]);
  assert(close(r.attackMultPct, 0.10), `only the valid mod should count, got ${r.attackMultPct}`);
  assert(close(r.armorPen, 0) && close(r.elementPen.ember, 0), "dropped mods must contribute nothing");
});

// ── Order independence (deterministic regardless of input order) ─────────────
check("resolution is order-independent", () => {
  const a = [
    { axis: "attack_mult", value: 0.1 },
    { axis: "element_pen", element: "ember", value: 0.05 },
    { axis: "crit_chance", value: 0.2 },
    { axis: "element_pen", element: "ember", value: 0.07 },
  ];
  const b = [a[3], a[0], a[2], a[1]];
  const ra = S.resolveAbilities(a), rb = S.resolveAbilities(b);
  assert.deepStrictEqual(ra, rb, "shuffled inputs produced different resolved totals");
});

check("attack_mult and crit axes sum additively", () => {
  const r = S.resolveAbilities([
    { axis: "attack_mult", value: 0.10 },
    { axis: "attack_mult", value: 0.15 },
    { axis: "crit_chance", value: 0.20 },
    { axis: "crit_chance", value: 0.10 },
    { axis: "crit_mult", value: 0.50 },
  ]);
  assert(close(r.attackMultPct, 0.25), `attackMultPct ${r.attackMultPct}`);
  assert(close(r.critChance, 0.30), `critChance ${r.critChance}`);
  assert(close(r.critMult, 0.50), `critMult ${r.critMult}`);
});

check("empty / null input yields an all-zero resolution", () => {
  const r = S.resolveAbilities([]);
  assert(close(r.attackMultPct, 0) && close(r.armorPen, 0) && close(r.critChance, 0) && close(r.critMult, 0));
  for (const e of ["neutral", "ember", "frost", "storm", "umbral", "radiant", "gale"]) {
    assert(close(r.elementPen[e], 0), `${e} should be 0`);
  }
  // null-safe
  const r2 = S.resolveAbilities(null);
  assert(close(r2.attackMultPct, 0), "null input should not throw and should be zero");
});

console.log(`\nsynergy.test: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
