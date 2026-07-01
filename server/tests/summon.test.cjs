// Pure-logic tests for the summon system + hero generation. No DB.
// Run: node tests/summon.test.cjs
// Compiles the TS helpers, then asserts pity guarantees and stat banding.
const { execSync } = require('child_process');
const assert = require('assert');

execSync(
  'npx tsc --target ES2020 --module commonjs --esModuleInterop --outDir /tmp/_t_summon api/_summon_rates.ts api/_herogen.ts',
  { stdio: 'inherit' }
);
const R = require('/tmp/_t_summon/_summon_rates.js');
const H = require('/tmp/_t_summon/_herogen.js');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}: ${e.message}`); fail++; }
}

console.log("summon.test:");

// Deterministic rng so the test is stable.
function rngFrom(seed) { return H.mulberry32(seed); }

check("hard pity: a Legendary is guaranteed by pull 80", () => {
  // Start from a fresh pity and pull 80 times with a fixed stream; the 80th
  // pull (sinceLegendary reaches 79->80) must force a Legendary even if rng
  // never rolls one naturally.
  let pity = { sinceLegendary: 0, sinceEpic: 0 };
  // rng that NEVER triggers the base legendary/epic chance on its own:
  const rng = () => 0.999999;
  let sawLegendaryByEighty = false;
  for (let i = 0; i < 80; i++) {
    const out = R.resolvePull(rng, pity);
    pity = out.pity;
    if (out.result.rarity === "Legendary") { sawLegendaryByEighty = true; break; }
  }
  assert(sawLegendaryByEighty, "no Legendary within 80 pulls (hard pity failed)");
});

check("epic pity: Epic+ at least every 10 pulls", () => {
  let pity = { sinceLegendary: 0, sinceEpic: 0 };
  const rng = () => 0.999999; // never rolls Epic+ naturally
  let gapSinceEpicPlus = 0;
  let worstGap = 0;
  for (let i = 0; i < 200; i++) {
    const out = R.resolvePull(rng, pity);
    pity = out.pity;
    if (out.result.tier >= 4) gapSinceEpicPlus = 0;
    else gapSinceEpicPlus++;
    worstGap = Math.max(worstGap, gapSinceEpicPlus);
  }
  assert(worstGap < 10, `went ${worstGap} pulls without an Epic+ (epic pity failed)`);
});

check("rates: Rare+ lands roughly a quarter of the time", () => {
  // Monte Carlo with real randomness; just a sanity band, not exact.
  let rarePlus = 0;
  const N = 20000;
  let pity = { sinceLegendary: 0, sinceEpic: 0 };
  for (let i = 0; i < N; i++) {
    const out = R.resolvePull(Math.random, pity);
    pity = out.pity;
    if (out.result.tier >= 3) rarePlus++;
  }
  const frac = rarePlus / N;
  assert(frac > 0.15 && frac < 0.45, `Rare+ fraction ${frac.toFixed(3)} outside sane band`);
});

check("generateHero is deterministic for a given seed", () => {
  const a = H.generateHero(12345, "Epic");
  const b = H.generateHero(12345, "Epic");
  assert.deepStrictEqual(a, b, "same seed produced different heroes");
});

check("generateHero scales stats with rarity band", () => {
  // Average many seeds so variance/theme rolls wash out; higher rarity should
  // have a strictly higher mean attack.
  const meanAtk = (rarity) => {
    let s = 0; const N = 400;
    for (let i = 1; i <= N; i++) s += H.generateHero(i * 7919, rarity).attack;
    return s / N;
  };
  const common = meanAtk("Common");
  const rare = meanAtk("Rare");
  const legendary = meanAtk("Legendary");
  assert(rare > common, `Rare mean ATK ${rare} not > Common ${common}`);
  assert(legendary > rare, `Legendary mean ATK ${legendary} not > Rare ${rare}`);
});

check("generateHero stats stay positive and tier matches band", () => {
  for (const rarity of ["Common", "Uncommon", "Rare", "Epic", "Legendary"]) {
    const h = H.generateHero(42, rarity);
    assert(h.health > 0 && h.attack > 0 && h.defense >= 0, `${rarity} produced non-positive stat`);
    assert(h.tier === H.TIER_BY_RARITY[rarity].tier, `${rarity} tier mismatch (${h.tier})`);
    assert(H.THEMES.includes(h.theme), `${rarity} produced unknown theme ${h.theme}`);
  }
});

check("gem cost: single vs bulk discount", () => {
  assert.strictEqual(H.gemCostFor(1), 100, "single pull should cost 100");
  assert.strictEqual(H.gemCostFor(10), 900, "ten-pull should cost 900 (discount)");
  assert.strictEqual(H.gemCostFor(5), 500, "five singles should cost 500");
});

// ── Star-up / fusion economy ─────────────────────────────────────────────────

check("starMultiplier: star 1 is a no-op, star 6 is +60%", () => {
  assert.strictEqual(H.starMultiplier(1), 1, "star 1 should be 1.0x (no bonus)");
  assert.ok(Math.abs(H.starMultiplier(6) - 1.6) < 1e-9, `star 6 should be 1.60x, got ${H.starMultiplier(6)}`);
  // Monotonic: each star strictly increases the multiplier.
  for (let s = 1; s < H.MAX_STAR_LEVEL; s++) {
    assert(H.starMultiplier(s + 1) > H.starMultiplier(s), `star ${s + 1} should beat star ${s}`);
  }
});

check("starMultiplier clamps out-of-range input instead of erroring", () => {
  assert.strictEqual(H.starMultiplier(0), H.starMultiplier(1), "below-range should clamp to star 1");
  assert.strictEqual(H.starMultiplier(99), H.starMultiplier(H.MAX_STAR_LEVEL), "above-range should clamp to max star");
});

check("applyStarBonus scales all three stats and never goes below floor", () => {
  const base = { health: 1000, attack: 100, defense: 50 };
  const eff1 = H.applyStarBonus(base, 1);
  assert.deepStrictEqual(eff1, base, "star 1 effective stats should equal base stats exactly");
  const eff6 = H.applyStarBonus(base, 6);
  assert.strictEqual(eff6.health, Math.round(1000 * 1.6));
  assert.strictEqual(eff6.attack, Math.round(100 * 1.6));
  assert.strictEqual(eff6.defense, Math.round(50 * 1.6));
  // Defense can legitimately be 0 at base; health/attack must stay >= 1.
  const zeroDef = H.applyStarBonus({ health: 1, attack: 1, defense: 0 }, 6);
  assert(zeroDef.health >= 1 && zeroDef.attack >= 1 && zeroDef.defense >= 0);
});

check("starUpCost: ramps up per star and is null once maxed", () => {
  assert.strictEqual(H.starUpCost(1), 5);
  assert.strictEqual(H.starUpCost(2), 10);
  assert.strictEqual(H.starUpCost(3), 20);
  assert.strictEqual(H.starUpCost(4), 40);
  assert.strictEqual(H.starUpCost(5), 80);
  assert.strictEqual(H.starUpCost(6), null, "star 6 (max) should have no further cost");
  assert.strictEqual(H.starUpCost(7), null, "above max should also be null, not throw");
  // Strictly increasing cost curve (grind gets harder, never easier).
  for (let s = 1; s < H.MAX_STAR_LEVEL - 1; s++) {
    assert(H.starUpCost(s + 1) > H.starUpCost(s), `cost at star ${s + 1} should exceed star ${s}`);
  }
});

check("shardsForDupe: rarer dupes are worth strictly more shards", () => {
  const order = ["Common", "Uncommon", "Rare", "Epic", "Legendary"];
  let last = 0;
  for (const r of order) {
    const v = H.shardsForDupe(r);
    assert(v > last, `${r} dupe shards (${v}) should exceed the previous rarity (${last})`);
    last = v;
  }
});

check("full star-up path 1->6 costs exactly 155 shards total", () => {
  let total = 0;
  for (let s = 1; s < H.MAX_STAR_LEVEL; s++) total += H.starUpCost(s);
  assert.strictEqual(total, 155, `expected 155 total shards 1->6, got ${total}`);
});

// ── Hero leveling ────────────────────────────────────────────────────────────

check("heroStatGainForLevel: rarer heroes gain strictly more per level", () => {
  const order = ["Common", "Uncommon", "Rare", "Epic", "Legendary"];
  let lastAtk = 0;
  for (const r of order) {
    const g = H.heroStatGainForLevel(20, r);
    assert(g.attack > lastAtk, `${r} lvl-20 attack gain (${g.attack}) should exceed previous (${lastAtk})`);
    assert(g.health > 0 && g.defense >= 0, `${r} produced non-positive gain`);
    lastAtk = g.attack;
  }
});

check("unlockedAbilitySlots matches the 1/10/20/30/40/50 schedule", () => {
  assert.strictEqual(H.unlockedAbilitySlots(1), 1, "level 1 -> 1 slot");
  assert.strictEqual(H.unlockedAbilitySlots(9), 1, "level 9 -> still 1 slot");
  assert.strictEqual(H.unlockedAbilitySlots(10), 2, "level 10 -> 2 slots");
  assert.strictEqual(H.unlockedAbilitySlots(25), 3, "level 25 -> 3 slots");
  assert.strictEqual(H.unlockedAbilitySlots(50), 6, "level 50 -> all 6 slots");
  assert.strictEqual(H.unlockedAbilitySlots(60), 6, "max level -> capped at 6 slots");
  // Monotonic non-decreasing across the whole range.
  let prev = 0;
  for (let lv = 1; lv <= H.HERO_MAX_LEVEL; lv++) {
    const n = H.unlockedAbilitySlots(lv);
    assert(n >= prev && n <= 6, `slot count must be monotonic and <=6 (lv ${lv} -> ${n})`);
    prev = n;
  }
});

check("ability unlock levels are sorted and 6 long (one per slot)", () => {
  assert.strictEqual(H.ABILITY_UNLOCK_LEVELS.length, 6, "should be 6 ability slots");
  for (let i = 1; i < H.ABILITY_UNLOCK_LEVELS.length; i++) {
    assert(H.ABILITY_UNLOCK_LEVELS[i] > H.ABILITY_UNLOCK_LEVELS[i - 1], "unlock levels must strictly increase");
  }
  assert(H.ABILITY_UNLOCK_LEVELS[5] < H.HERO_MAX_LEVEL, "last slot must unlock before max level");
});

console.log(`\nsummon.test: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
