// api/health.ts
// Lightweight health/status endpoint for uptime monitoring (UptimeRobot,
// Better Uptime, Vercel checks, etc.) and quick manual diagnosis.
//
// GET /api/health        -> { ok, time, db: "up"|"down", ... }
//
// Checks DB connectivity with a 2s budget so a hung DB doesn't hang the probe.
// Returns 200 when healthy, 503 when the DB is unreachable, so monitors can
// alert correctly.

import { VercelRequest, VercelResponse } from "@vercel/node";
import { getPool } from "./_db";

export default async (req: VercelRequest, res: VercelResponse) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  const started = Date.now();
  let dbStatus: "up" | "down" | "not_configured" = "not_configured";
  let dbLatencyMs: number | null = null;
  let dbError: string | undefined;

  if (process.env.DATABASE_URL) {
    try {
      const pool = getPool();
      const t0 = Date.now();
      // race the query against a 2s timeout
      await Promise.race([
        pool.query("SELECT 1"),
        new Promise((_, rej) => setTimeout(() => rej(new Error("db timeout")), 2000)),
      ]);
      dbLatencyMs = Date.now() - t0;
      dbStatus = "up";
    } catch (e: any) {
      dbStatus = "down";
      dbError = String(e?.message || e);
    }
  }

  const healthy = dbStatus !== "down";
  return res.status(healthy ? 200 : 503).json({
    ok: healthy,
    service: "sequence10-api",
    time: new Date().toISOString(),
    uptimeProbeMs: Date.now() - started,
    db: dbStatus,
    dbLatencyMs,
    ...(dbError ? { dbError } : {}),
  });
};
