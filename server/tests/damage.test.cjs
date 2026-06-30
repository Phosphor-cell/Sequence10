const { execSync } = require('child_process');
const assert = require('assert');
execSync('npx tsc --target ES2020 --module commonjs --esModuleInterop --outDir /tmp/_t_dmg api/battle_v2.ts', { stdio: 'inherit' });
const handler = require('/tmp/_t_dmg/battle_v2.js').default;
function mock(body){let s=0,d=null;return{req:{method:'POST',body},res:{setHeader(){},status(c){s=c;return this;},json(x){d=x;return this;},end(){return this;}},get:()=>({s,d})};}
async function call(b){const m=mock(b);await handler(m.req,m.res);return m.get().d;}
async function winRate(body,runs){let w=0;for(let i=0;i<runs;i++){const d=await call(body);if(d.victory)w++;}return w/runs;}
let pass=0,fail=0;
function check(n,fn){return fn().then(()=>{console.log(`  ✓ ${n}`);pass++;}).catch(e=>{console.log(`  ✗ ${n}: ${e.message}`);fail++;});}
(async()=>{
  console.log("damage.test:");
  const perfect={difficulty:10,rarity:5,baseAttack:"2500000000",multipliers:[6,5,4,4,3,3,2.5,2.5,2,2,3.0,2.2],critChance:3.0,critMult:3.0,armorPen:0.90};
  const weak={difficulty:10,rarity:5,baseAttack:"50000",multipliers:[2,1.5],critChance:0.4,critMult:2.0,armorPen:0.2};

  await check("final boss HP = uint64 max", async()=>{
    const d = await call(perfect);
    assert(d.bossHp === "18446744073709551615", `got ${d.bossHp}`);
  });
  await check("weak build never beats final boss (0% over 200 runs)", async()=>{
    const wr = await winRate(weak, 200);
    assert(wr === 0, `weak win rate ${wr} should be 0`);
  });
  await check("perfect build is a miracle win (<5% over 1000 runs)", async()=>{
    const wr = await winRate(perfect, 1000);
    assert(wr < 0.05, `perfect win rate ${(wr*100).toFixed(1)}% should be <5%`);
    // also assert it's not literally impossible across many runs (sanity)
  });
  await check("damage values returned as strings (uint64-safe)", async()=>{
    const d = await call(perfect);
    assert(typeof d.totalDamage === "string", "totalDamage must be string");
  });
  console.log(`\ndamage.test: ${pass} passed, ${fail} failed`);
  process.exit(fail>0?1:0);
})();
