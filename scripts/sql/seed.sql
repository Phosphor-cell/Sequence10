-- seed.sql — create a known test player you can hit from api.sh.
-- Run: psql "$DATABASE_URL" -f scripts/sql/seed.sql
-- Prints the player id at the end.
INSERT INTO players (username) VALUES ('dev:seed-player')
  ON CONFLICT (username) DO NOTHING;

INSERT INTO idle_state (player_id, last_idle_sync)
  SELECT id, CURRENT_TIMESTAMP - INTERVAL '3 hours' FROM players WHERE username='dev:seed-player'
  ON CONFLICT (player_id) DO UPDATE SET last_idle_sync = CURRENT_TIMESTAMP - INTERVAL '3 hours';

-- show the seeded player so you can copy the id into api.sh calls
SELECT id AS seed_player_id, username, level, gold FROM players WHERE username='dev:seed-player';
