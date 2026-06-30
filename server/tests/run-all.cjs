// Runs all test suites. Pure-logic always; integration only if DATABASE_URL set.
const { execSync } = require('child_process');
const suites = ['progression.test.cjs', 'affinity.test.cjs', 'damage.test.cjs', 'format.test.cjs'];
if (process.env.DATABASE_URL) suites.push('integration.test.cjs');
else console.log('(DATABASE_URL not set — skipping integration.test)\n');

let failed = false;
for (const s of suites) {
  console.log(`\n=== ${s} ===`);
  try { execSync(`node tests/${s}`, { stdio: 'inherit', cwd: process.cwd() }); }
  catch { failed = true; }
}
if (failed) { console.log('\n❌ SOME TESTS FAILED'); process.exit(1); }
console.log('\n✅ ALL TESTS PASSED');
