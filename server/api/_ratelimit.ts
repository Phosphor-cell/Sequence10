// api/_ratelimit.ts  (HELPER — underscore = not an endpoint)
//
// Serverless-safe rate limiting. In-memory limiters DON'T work on Vercel (each
// instance has its own memory), so we use the DB as shared state: a small
// rate_limit table with (key, window_start, count). One UPSERT per check.
//
// Usage in an endpoint:
//   const ok = await checkRateLimit(playerId, "idle", 30, 60); // 30/min
//   if (!ok) return res.status(429).json({ error: "rate limited" });
//
// The table is created on demand (idempotent) so it works even if the main
// schema migration hasn't added it yet.

import { getPool } from "./_db";

let ensured = false;
async function ensureTable() {
  if (ensured) return;
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rate_limit (
      key          TEXT PRIMARY KEY,
      window_start BIGINT NOT NULL,
      count        INT NOT NULL DEFAULT 0
    )`);
  ensured = true;
}

/**
 * Returns true if the action is ALLOWED, false if the caller is over the limit.
 * Fixed-window counter: `limit` actions per `windowSeconds`.
 * Fails OPEN (allows) on any DB error so rate limiting never takes the game down.
 */
export async function checkRateLimit(
  subject: string,
  action: string,
  limit: number,
  windowSeconds: number
): Promise<boolean> {
  try {
    await ensureTable();
    const pool = getPool();
    const now = Math.floor(Date.now() / 1000);
    const windowStart = now - (now % windowSeconds);
    const key = `${action}:${subject}`;

    // Atomic upsert: if same window, increment; if new window, reset to 1.
    const r = await pool.query(
      `INSERT INTO rate_limit (key, window_start, count)
       VALUES ($1, $2, 1)
       ON CONFLICT (key) DO UPDATE
         SET count = CASE WHEN rate_limit.window_start = $2
                          THEN rate_limit.count + 1
                          ELSE 1 END,
             window_start = $2
       RETURNING count`,
      [key, windowStart]
    );
    const count = r.rows[0]?.count ?? 1;
    return count <= limit;
  } catch {
    return true; // fail open
  }
}
