const { execSync } = require('child_process');
const assert = require('assert');
execSync('npx tsc --target ES2020 --module commonjs --esModuleInterop --outDir /tmp/_t_fmt api/_format.ts', { stdio: 'inherit' });
const { formatBig, formatBigCompact } = require('/tmp/_t_fmt/_format.js');
let pass=0,fail=0;
function check(n,fn){try{fn();console.log(`  ✓ ${n}`);pass++;}catch(e){console.log(`  ✗ ${n}: ${e.message}`);fail++;}}

console.log("format.test:");
check("sub-1000 stays plain", () => { assert.equal(formatBig("950"), "950"); assert.equal(formatBig("42"), "42"); });
check("thousands -> K", () => assert.equal(formatBig("1500"), "1.50K"));
check("billions -> B", () => assert.equal(formatBig("1753984960"), "1.75B"));
check("quadrillions -> Qa", () => assert.equal(formatBig("12473999653500000"), "12.47Qa"));
check("uint64 max -> 18.44Qi", () => assert.equal(formatBig("18446744073709551615"), "18.44Qi"));
check("compact trims trailing zeros", () => { assert.equal(formatBigCompact("1000"), "1K"); assert.equal(formatBigCompact("1500"), "1.5K"); });
check("compact preserves sub-1000 integers", () => assert.equal(formatBigCompact("950"), "950"));
check("negative handled", () => assert.equal(formatBig("-5000"), "-5.00K"));
console.log(`\nformat.test: ${pass} passed, ${fail} failed`);
process.exit(fail>0?1:0);
