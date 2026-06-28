'use strict';
const { generateLoot, RARITIES, ARMOR_KEYS } = require('../../loot.js');

let pass = 0, fail = 0;
function check(name, cond, detail='') {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}  ${detail}`); }
}

console.log('--- TEST 1: Determinism (same seed => identical loot) ---');
const a = generateLoot(50, 123456789);
const b = generateLoot(50, 123456789);
check('identical output for same seed', JSON.stringify(a) === JSON.stringify(b),
      `\n   a=${JSON.stringify(a)}\n   b=${JSON.stringify(b)}`);
const c = generateLoot(50, 987654321);
check('different seed => different loot', JSON.stringify(a) !== JSON.stringify(c));

console.log('\n--- TEST 2: Rarity distribution over 300k rolls (within tolerance) ---');
const N = 300000;
const counts = {};
for (const r of RARITIES) counts[r.name] = 0;
for (let i = 0; i < N; i++) {
  const loot = generateLoot(50, (i * 2654435761) >>> 0); // spread seeds
  counts[loot.rarity]++;
}
for (const r of RARITIES) {
  const actual = counts[r.name] / N;
  const expected = r.weight;
  const tol = Math.max(0.005, expected * 0.06); // 6% relative or 0.5pt absolute
  const ok = Math.abs(actual - expected) <= tol;
  check(`${r.name}: expected ${(expected*100).toFixed(1)}% got ${(actual*100).toFixed(2)}%`, ok,
        `diff ${(Math.abs(actual-expected)*100).toFixed(2)}pt > tol ${(tol*100).toFixed(2)}pt`);
}

console.log('\n--- TEST 3: Stat bounds (no negatives, all integers) ---');
let allValid = true, anyNegative = false, anyNonInt = false;
const STAT_COLS = ['health_bonus','attack_bonus','defense_bonus','crit_rate_bonus','crit_damage_bonus'];
for (let i = 0; i < 50000; i++) {
  const loot = generateLoot(1 + (i % 5000), (i * 40503) >>> 0);
  for (const col of STAT_COLS) {
    const v = loot[col];
    if (v < 0) { anyNegative = true; allValid = false; }
    if (!Number.isInteger(v)) { anyNonInt = true; allValid = false; }
    if (v > 2147483647) allValid = false;
  }
}
check('no negative stats', !anyNegative);
check('all stats are integers', !anyNonInt);
check('all stats within INT range', allValid);

console.log('\n--- TEST 4: Stats scale with level ---');
function avgPrimaryAtLevel(level, samples=2000) {
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    const loot = generateLoot(level, (i * 2246822519) >>> 0);
    sum += Math.max(loot.health_bonus, loot.attack_bonus, loot.defense_bonus, loot.crit_rate_bonus, loot.crit_damage_bonus);
  }
  return sum / samples;
}
const lvl10 = avgPrimaryAtLevel(10);
const lvl100 = avgPrimaryAtLevel(100);
const lvl1000 = avgPrimaryAtLevel(1000);
console.log(`   avg top stat: lvl10=${lvl10.toFixed(1)}  lvl100=${lvl100.toFixed(1)}  lvl1000=${lvl1000.toFixed(1)}`);
check('higher level => bigger stats (10<100<1000)', lvl10 < lvl100 && lvl100 < lvl1000);
check('roughly 10x scaling lvl10->lvl100', lvl100 / lvl10 > 7 && lvl100 / lvl10 < 13);

console.log('\n--- TEST 5: Every armor type can drop & maps to a primary stat ---');
const seenTypes = new Set();
for (let i = 0; i < 5000; i++) seenTypes.add(generateLoot(50, (i*2654435761)>>>0).armor_type);
check('all armor types appear', ARMOR_KEYS.every(t => seenTypes.has(t)),
      `seen: ${[...seenTypes].join(',')}`);

console.log('\n--- TEST 6: Schema column mapping ---');
const sample = generateLoot(50, 42);
const requiredCols = ['armor_type','rarity','seed','health_bonus','attack_bonus','defense_bonus','crit_rate_bonus','crit_damage_bonus','item_name'];
check('output has all inventory_loot columns', requiredCols.every(k => k in sample),
      `missing: ${requiredCols.filter(k => !(k in sample)).join(',')}`);
check('crit_rate_bonus never exceeds 100', (()=>{
  for (let i=0;i<20000;i++){ if (generateLoot(100000,(i*97)>>>0).crit_rate_bonus>100) return false; } return true;
})());

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
console.log('\nSample drops at level 50:');
for (let i = 0; i < 5; i++) {
  const l = generateLoot(50, (i*2654435761)>>>0);
  console.log(`  ${l.item_name.padEnd(22)} ATK+${l.attack_bonus} DEF+${l.defense_bonus} HP+${l.health_bonus} CR+${l.crit_rate_bonus} CD+${l.crit_damage_bonus}`);
}
process.exit(fail === 0 ? 0 : 1);

console.log('\n--- TEST 7: crit_rate is percentage-appropriate (not instantly maxed) ---');
(function(){
  let maxedCount = 0, total = 0, sumCrit = 0, maxSeen = 0;
  for (let i = 0; i < 30000; i++) {
    const loot = generateLoot(500, (i*2654435761)>>>0); // high level
    if (loot.crit_rate_bonus > 0) { total++; sumCrit += loot.crit_rate_bonus; maxSeen = Math.max(maxSeen, loot.crit_rate_bonus); if (loot.crit_rate_bonus >= 75) maxedCount++; }
  }
  const avg = total ? sumCrit/total : 0;
  console.log(`   crit drops: ${total}, avg crit_rate=${avg.toFixed(1)}%, max=${maxSeen}%, hit-cap=${maxedCount}`);
  // At level 500, crit_rate should NOT be averaging near the cap (proves it's rarity-based not level-based)
  if (avg < 30) { console.log('  PASS  crit_rate stays reasonable at high level'); }
  else { console.log('  FAIL  crit_rate too high at high level'); process.exitCode = 1; }
})();