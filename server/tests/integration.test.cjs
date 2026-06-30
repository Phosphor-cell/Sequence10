// DB integration test. Requires DATABASE_URL env + schema applied.
// Run: DATABASE_URL=... node tests/integration.test.cjs
const { execSync } = require('child_process');
const assert = require('assert');
execSync('npx tsc --target ES2020 --module commonjs --esModuleInterop --moduleResolution node --outDir tests/_dist api/_db.ts api/_progression.ts api/player.ts api/idle.ts api/levelup.ts api/ascend.ts', { stdio: 'inherit' });

const player = require('./_dist/player.js').default;
const idle   = require('./_dist/idle.js').default;
const levelup= require('./_dist/levelup.js').default;
const ascend = require('./_dist/ascend.js').default;
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function mock(body){let s=0,d=null;return{req:{method:'POST',body},res:{setHeader(){},status(c){s=c;return this;},json(x){d=x;return this;},end(){return this;}},get:()=>({s,d})};}
async function call(h,b){const m=mock(b);await h(m.req,m.res);return m.get();}
let pass=0,fail=0; const checks=[];
async function check(n,fn){try{await fn();console.log(`  ✓ ${n}`);pass++;}catch(e){console.log(`  ✗ ${n}: ${e.message}`);fail++;}}

(async()=>{
  console.log("integration.test:");
  const deviceId = "ci-"+Math.floor(Math.random()*1e9);
  let r = await call(player,{action:"init",username:"CI",deviceId});
  const pid = r.d.playerId;

  await check("init creates a DB-backed player", async()=>{ assert(r.s===200 && pid, "no player"); });
  await check("same device returns same player", async()=>{
    const r2 = await call(player,{action:"init",deviceId});
    assert(r2.d.playerId===pid && r2.d.returning===true);
  });
  await check("idle claim works on player-created account (no 404)", async()=>{
    await pool.query(`UPDATE idle_state SET last_idle_sync=CURRENT_TIMESTAMP - INTERVAL '3 hours' WHERE player_id=$1`,[pid]);
    const ic = await call(idle,{playerId:pid,action:"claim"});
    assert(ic.s===200 && BigInt(ic.d.goldGained)>0n, `status ${ic.s}`);
  });
  await check("idle double-claim blocked (concurrent)", async()=>{
    await pool.query(`UPDATE idle_state SET last_idle_sync=CURRENT_TIMESTAMP - INTERVAL '5 hours' WHERE player_id=$1`,[pid]);
    const results = await Promise.all([1,2,3,4,5].map(()=>call(idle,{playerId:pid,action:"claim"})));
    const big = results.filter(x=>BigInt(x.d.goldGained||0)>1000n).length;
    assert(big===1, `expected 1 winner, got ${big}`);
  });
  await check("clock cheat (future sync) gives 0", async()=>{
    await pool.query(`UPDATE idle_state SET last_idle_sync=CURRENT_TIMESTAMP + INTERVAL '5 hours' WHERE player_id=$1`,[pid]);
    const ic = await call(idle,{playerId:pid,action:"claim"});
    assert(BigInt(ic.d.goldGained)===0n, `got ${ic.d.goldGained}`);
  });
  await check("levelup persists", async()=>{
    const lu = await call(levelup,{playerId:pid,addExp:"8000"});
    assert(lu.s===200 && lu.d.level>1);
  });
  await check("ascend gated then works at L100", async()=>{
    let a = await call(ascend,{playerId:pid,action:"ascend"});
    assert(!a.d.ascended, "should be blocked below L100");
    await pool.query(`UPDATE players SET level=100 WHERE id=$1`,[pid]);
    a = await call(ascend,{playerId:pid,action:"ascend"});
    assert(a.d.ascended && a.d.newAscensionLevel===1);
  });
  await check("getState reflects persisted changes", async()=>{
    const g = await call(player,{action:"getState",playerId:pid});
    assert(g.s===200 && g.d.stats.attack>=150, `attack ${g.d.stats.attack}`);
  });

  await pool.query(`DELETE FROM players WHERE id=$1`,[pid]);
  await pool.end();
  console.log(`\nintegration.test: ${pass} passed, ${fail} failed`);
  process.exit(fail>0?1:0);
})().catch(e=>{console.error("FATAL:",e.message);process.exit(1);});
