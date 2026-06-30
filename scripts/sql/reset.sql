-- reset.sql — wipe all gameplay state but KEEP the schema. Dev convenience.
-- Run: psql "$DATABASE_URL" -f scripts/sql/reset.sql
-- TRUNCATE ... CASCADE clears child rows via FKs. Order-independent.
TRUNCATE players CASCADE;
TRUNCATE rate_limit;
SELECT 'reset complete — all gameplay rows cleared' AS status;
