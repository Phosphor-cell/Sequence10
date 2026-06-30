// Pure-logic tests for progression math. No DB. Run: node tests/progression.test.cjs
// Compiles the TS helper, then asserts the curve/idle/ascension behave.
const { execSync } = require('child_process');
const assert = require('assert');
const path = require('path');

execSync('npx tsc --target ES2020 --module commonjs --esModuleInterop --outDir /tmp/_t_prog api/_progression.ts', { stdio: 'inherit' });
const P = require('/tmp/_t_prog/_progression.js');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}: ${e.message}`); fail++; }
}

console.log("progression.test:");

check("level curve increases monotonically", () => {
  let prev = 0n;
  for (let L = 1; L <= 50; L++) {
    const v = P.expToNext(L);
    assert(v > prev, `L${L} (${v}) should exceed L${L-1} (${prev})`);
    prev = v;
  }
});

check("level curve is fast early, slow late", () => {
  assert(P.expToNext(1) <= 200n, "L1 should be cheap");
  assert(P.expToNext(100) > 1_000_000_000n, "L100 should be expensive (>1B)");
});

check("applyExp grants correct levels", () => {
  const r = P.applyExp(1, 0n, 5000n);
  assert(r.level === 6, `expected L6, got L${r.level}`);
  assert(r.levelsGained === 5, `expected 5 levels, got ${r.levelsGained}`);
  assert(r.statGain.attack > 0, "should gain attack");
});

check("applyExp rejects negative exp (treated as 0)", () => {
  const r = P.applyExp(5, 100n, -99999n);
  assert(r.level === 5 && r.exp === 100n, "negative exp must not change state");
});

check("applyExp handles huge dumps without hanging", () => {
  const t0 = Date.now();
  const r = P.applyExp(1, 0n, 1_000_000_000n);
  assert(Date.now() - t0 < 1000, "must complete < 1s");
  assert(r.level > 1, "should gain levels");
});

check("idle: negative elapsed clamps to 0 (clock moved back)", () => {
  const r = P.computeIdleReward(-9999, 10, 2, 0);
  assert(r.gold === 0n && r.cappedSeconds === 0, "must give nothing");
});

check("idle: huge elapsed caps at 12h (clock cheat forward)", () => {
  const r = P.computeIdleReward(99999999, 10, 2, 0);
  assert(r.cappedSeconds === 12 * 3600, "must cap at 12h");
  assert(r.cappedOut === true, "must flag cappedOut");
});

check("idle: reward scales with progression", () => {
  const low = P.computeIdleReward(3600, 1, 1, 0).gold;
  const high = P.computeIdleReward(3600, 100, 5, 2).gold;
  assert(high > low, "higher level/chapter/ascension should earn more");
});

check("ascension multiplier stacks (1.5^n)", () => {
  assert(Math.abs(P.ascensionMultiplier(0) - 1.0) < 1e-9);
  assert(Math.abs(P.ascensionMultiplier(2) - 2.25) < 1e-9);
});

check("canAscend gated at requirement", () => {
  assert(P.canAscend(P.ASCENSION_LEVEL_REQUIREMENT) === true);
  assert(P.canAscend(P.ASCENSION_LEVEL_REQUIREMENT - 1) === false);
});

console.log(`\nprogression.test: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
