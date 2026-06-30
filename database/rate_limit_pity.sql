-- Migration 001: rate_limit table, summon pity tracking, ally alignment.
-- Additive and idempotent — safe to run on an existing database.
-- Apply: psql "$DATABASE_URL" -f database/migrations/001_rate_limit_pity_alignment.sql

-- 1) rate_limit: backs the serverless rate limiter (_ratelimit.ts auto-creates
--    this, but defining it here makes it explicit and lets you index/inspect it).
CREATE TABLE IF NOT EXISTS rate_limit (
  key          TEXT PRIMARY KEY,
  window_start BIGINT NOT NULL,
  count        INT NOT NULL DEFAULT 0
);

-- 2) Summon pity counters on the player. The summon system guarantees a
--    Legendary by pull 80 (hard pity) and an Epic+ every 10 pulls; these
--    columns persist the progress so it can't be reset by reinstalling.
ALTER TABLE players ADD COLUMN IF NOT EXISTS pity_since_legendary INT NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS pity_since_epic      INT NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS total_summons        BIGINT NOT NULL DEFAULT 0;

-- 3) Ally alignment on summoned heroes. The affinity system (armor element x
--    ally alignment) needs this to compute damage/heal multipliers.
--    Values: neutral / demonic / angelic / void / celestial / abyssal / resonant
ALTER TABLE summoned_heroes ADD COLUMN IF NOT EXISTS alignment VARCHAR(32) NOT NULL DEFAULT 'neutral';
ALTER TABLE summoned_heroes ADD COLUMN IF NOT EXISTS element   VARCHAR(32) NOT NULL DEFAULT 'neutral';

-- index to fetch a player's roster quickly (for party/affinity screens)
CREATE INDEX IF NOT EXISTS idx_heroes_player ON summoned_heroes(player_id);

SELECT 'migration 001 applied' AS status;