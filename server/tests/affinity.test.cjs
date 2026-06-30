const { execSync } = require('child_process');
const assert = require('assert');
execSync('npx tsc --target ES2020 --module commonjs --esModuleInterop --outDir /tmp/_t_aff api/affinity.ts', { stdio: 'inherit' });
const handler = require('/tmp/_t_aff/affinity.js').default;
function mock(body){let s=0,d=null;return{req:{method:'POST',body},res:{setHeader(){},status(c){s=c;return this;},json(x){d=x;return this;},end(){return this;}},get:()=>({s,d})};}
async function call(b){const m=mock(b);await handler(m.req,m.res);return m.get().d;}
let pass=0,fail=0;
function check(n,fn){return fn().then(()=>{console.log(`  ✓ ${n}`);pass++;}).catch(e=>{console.log(`  ✗ ${n}: ${e.message}`);fail++;});}
(async()=>{
  console.log("affinity.test:");
  await check("demonic armor + angelic ally = 3x dmg, 0.3x heal", async()=>{
    const d = await call({armorElement:"demonic", allyAlignment:"angelic"});
    assert(d.damageMult === 3.0, `dmg ${d.damageMult}`); assert(d.healMult === 0.3, `heal ${d.healMult}`);
  });
  await check("angelic + angelic = 1.5x dmg, 2x heal", async()=>{
    const d = await call({armorElement:"angelic", allyAlignment:"angelic"});
    assert(d.damageMult === 1.5 && d.healMult === 2.0);
  });
  await check("invalid inputs fall back to neutral 1.0/1.0", async()=>{
    const d = await call({armorElement:"garbage", allyAlignment:"nonsense"});
    assert(d.damageMult === 1.0 && d.healMult === 1.0);
  });
  await check("matrix mode returns 7 elements", async()=>{
    const d = await call({action:"matrix"});
    assert(d.elements.length === 7, `got ${d.elements.length}`);
  });
  console.log(`\naffinity.test: ${pass} passed, ${fail} failed`);
  process.exit(fail>0?1:0);
})();
