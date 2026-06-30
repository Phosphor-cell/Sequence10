// api/_db.ts  (HELPER — underscore = not an HTTP endpoint)
//
// Shared Postgres pool, serverless-safe. On Vercel every cold start would
// otherwise call `new Pool()` and open fresh connections; under load that
// exhausts Neon's connection limit. We cache a SINGLE pool on the module/global
// scope (reused across warm invocations) and keep max connections small.
//
// Neon guidance: use a small pool and rely on Neon's own pooler. For heavy
// scale you'd switch DATABASE_URL to the Neon *pooled* endpoint (-pooler host).

import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __seq10_pool: Pool | undefined;
}

export function getPool(): Pool {
  if (!global.__seq10_pool) {
    global.__seq10_pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 3,                      // small: serverless fans out across instances
      idleTimeoutMillis: 10_000,   // release idle conns quickly
      connectionTimeoutMillis: 5_000,
    });
  }
  return global.__seq10_pool;
}
