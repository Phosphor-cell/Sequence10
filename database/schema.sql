-- schema_pg14_neon.sql
-- PostgreSQL 14+ optimized schema for Neon
-- Modern features: CHECK constraints, WITH TIME ZONE, GENERATED columns, etc
-- Drop old schema first: DROP SCHEMA public CASCADE; CREATE SCHEMA public;

-- ============= EXTENSIONS =============

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============= CORE PLAYER =============

CREATE TABLE players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(128) NOT NULL UNIQUE,
  level BIGINT NOT NULL DEFAULT 1 CHECK (level > 0),
  exp BIGINT NOT NULL DEFAULT 0 CHECK (exp >= 0),
  exp_to_next_level BIGINT NOT NULL DEFAULT 10000 CHECK (exp_to_next_level > 0),
  gold BIGINT NOT NULL DEFAULT 1000 CHECK (gold >= 0),
  gems BIGINT NOT NULL DEFAULT 0 CHECK (gems >= 0),
  
  -- Narrative state
  current_chapter BIGINT NOT NULL DEFAULT 1 CHECK (current_chapter > 0),
  current_decision_id VARCHAR(128),
  chosen_path VARCHAR(128),
  alignment VARCHAR(64),
  
  -- Stats (uint32 display, int64 background)
  health INT NOT NULL DEFAULT 1000 CHECK (health >= 0),
  max_health INT NOT NULL DEFAULT 1000 CHECK (max_health > 0),
  attack INT NOT NULL DEFAULT 100 CHECK (attack > 0),
  defense INT NOT NULL DEFAULT 50 CHECK (defense >= 0),
  crit_rate INT NOT NULL DEFAULT 15 CHECK (crit_rate >= 0 AND crit_rate <= 100),
  crit_damage INT NOT NULL DEFAULT 150 CHECK (crit_damage > 0),
  speed INT NOT NULL DEFAULT 100 CHECK (speed > 0),
  
  -- Background int64 for overflow prevention
  _health_int64 BIGINT NOT NULL DEFAULT 1000 CHECK (_health_int64 >= 0),
  _attack_int64 BIGINT NOT NULL DEFAULT 100 CHECK (_attack_int64 > 0),
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  last_sync TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_players_username ON players(username);
CREATE INDEX IF NOT EXISTS idx_players_created ON players(created_at DESC);

-- ============= CHARACTER STATS =============

CREATE TABLE character_stats (
  player_id UUID PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  health INT NOT NULL DEFAULT 1000 CHECK (health >= 0),
  max_health INT NOT NULL DEFAULT 1000 CHECK (max_health > 0),
  attack INT NOT NULL DEFAULT 100 CHECK (attack > 0),
  defense INT NOT NULL DEFAULT 50 CHECK (defense >= 0),
  critical_rate INT NOT NULL DEFAULT 15 CHECK (critical_rate >= 0 AND critical_rate <= 100),
  critical_damage INT NOT NULL DEFAULT 150 CHECK (critical_damage > 0),
  attack_speed INT NOT NULL DEFAULT 100 CHECK (attack_speed > 0),
  
  -- Background calculations in int64
  _health_int64 BIGINT NOT NULL DEFAULT 1000 CHECK (_health_int64 >= 0),
  _max_health_int64 BIGINT NOT NULL DEFAULT 1000 CHECK (_max_health_int64 > 0),
  _attack_int64 BIGINT NOT NULL DEFAULT 100 CHECK (_attack_int64 > 0),
  _defense_int64 BIGINT NOT NULL DEFAULT 50 CHECK (_defense_int64 >= 0),
  
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============= EQUIPMENT SLOTS =============

CREATE TABLE equipment_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  slot_name VARCHAR(32) NOT NULL,
  item_id UUID,
  
  UNIQUE(player_id, slot_name),
  CHECK (slot_name IN ('head', 'body', 'arms', 'legs', 'weapon', 'accessory'))
);

CREATE INDEX IF NOT EXISTS idx_equipment_slots_player ON equipment_slots(player_id);

-- ============= ITEMS =============

CREATE TABLE items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(128) NOT NULL,
  description TEXT,
  rarity INT NOT NULL DEFAULT 1 CHECK (rarity >= 1 AND rarity <= 5),
  slot_name VARCHAR(32) NOT NULL CHECK (slot_name IN ('head', 'body', 'arms', 'legs', 'weapon', 'accessory')),
  
  base_health INT DEFAULT 0 CHECK (base_health >= 0),
  base_attack INT DEFAULT 0 CHECK (base_attack >= 0),
  base_defense INT DEFAULT 0 CHECK (base_defense >= 0),
  base_crit_rate INT DEFAULT 0 CHECK (base_crit_rate >= 0),
  base_crit_damage INT DEFAULT 0 CHECK (base_crit_damage >= 0),
  base_attack_speed INT DEFAULT 0 CHECK (base_attack_speed >= 0),
  
  -- Paper Doll SVG references
  svg_base_path VARCHAR(256),
  svg_socket_x INT DEFAULT 0,
  svg_socket_y INT DEFAULT 0,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_items_rarity ON items(rarity);
CREATE INDEX IF NOT EXISTS idx_items_slot ON items(slot_name);

-- ============= PLAYER INVENTORY =============

CREATE TABLE inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES items(id),
  quantity INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
  equipped BOOLEAN DEFAULT FALSE,
  acquired_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_inventory_player ON inventory(player_id);
CREATE INDEX IF NOT EXISTS idx_inventory_equipped ON inventory(player_id, equipped);

-- ============= SUMMONED HEROES =============

CREATE TABLE summoned_heroes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  
  class_name VARCHAR(64) NOT NULL,
  tier VARCHAR(32) NOT NULL CHECK (tier IN ('mortal', 'heroic', 'angelic', 'divine')),
  seed BIGINT NOT NULL,
  
  health INT NOT NULL CHECK (health > 0),
  attack INT NOT NULL CHECK (attack > 0),
  defense INT NOT NULL CHECK (defense >= 0),
  
  -- LLM-enhanced flavor (cached)
  personality_text TEXT,
  lore_snippet TEXT,
  unique_trait_name VARCHAR(256),
  
  -- SVG cache
  svg_cache VARCHAR(8192),
  
  rarity VARCHAR(32),
  obtained_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(player_id, seed)
);

CREATE INDEX IF NOT EXISTS idx_heroes_player ON summoned_heroes(player_id);
CREATE INDEX IF NOT EXISTS idx_heroes_tier ON summoned_heroes(tier);

-- ============= INVENTORY LOOT =============

CREATE TABLE inventory_loot (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  
  armor_type VARCHAR(64) NOT NULL,
  rarity VARCHAR(32) NOT NULL,
  seed BIGINT NOT NULL,
  
  health_bonus INT DEFAULT 0 CHECK (health_bonus >= 0),
  attack_bonus INT DEFAULT 0 CHECK (attack_bonus >= 0),
  defense_bonus INT DEFAULT 0 CHECK (defense_bonus >= 0),
  crit_rate_bonus INT DEFAULT 0 CHECK (crit_rate_bonus >= 0),
  crit_damage_bonus INT DEFAULT 0 CHECK (crit_damage_bonus >= 0),
  
  item_name VARCHAR(256),
  flavor_text TEXT,
  unique_property_description TEXT,
  
  svg_cache VARCHAR(8192),
  
  equipped BOOLEAN DEFAULT FALSE,
  obtained_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(player_id, seed)
);

CREATE INDEX IF NOT EXISTS idx_loot_player ON inventory_loot(player_id);
CREATE INDEX IF NOT EXISTS idx_loot_equipped ON inventory_loot(player_id, equipped);

-- ============= NARRATIVE CHAPTERS =============

CREATE TABLE narrative_chapters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  
  chapter_number BIGINT NOT NULL CHECK (chapter_number > 0),
  chapter_id VARCHAR(128) NOT NULL,
  narrative_text TEXT NOT NULL,
  
  decision_outcomes JSONB,
  
  player_alignment VARCHAR(64),
  player_stats_at_chapter JSONB,
  
  generated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(player_id, chapter_number)
);

CREATE INDEX IF NOT EXISTS idx_chapters_player ON narrative_chapters(player_id);

-- ============= NARRATIVE DECISIONS =============

CREATE TABLE narrative_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id UUID NOT NULL REFERENCES narrative_chapters(id) ON DELETE CASCADE,
  
  decision_id VARCHAR(128) NOT NULL,
  decision_text VARCHAR(512) NOT NULL,
  
  choices JSONB NOT NULL,
  consequences JSONB NOT NULL,
  
  player_choice VARCHAR(256),
  
  UNIQUE(chapter_id, decision_id)
);

CREATE INDEX IF NOT EXISTS idx_decisions_chapter ON narrative_decisions(chapter_id);

-- ============= LLM CACHE =============

CREATE TABLE llm_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  cache_type VARCHAR(64) NOT NULL,
  cache_key VARCHAR(512) NOT NULL UNIQUE,
  
  generated_text TEXT NOT NULL,
  tokens_used INT,
  api_used VARCHAR(32),
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP WITH TIME ZONE,
  hit_count INT DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_cache_type ON llm_cache(cache_type);
CREATE INDEX IF NOT EXISTS idx_cache_expires ON llm_cache(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cache_key ON llm_cache(cache_key);

-- ============= BOSS REGISTRY =============

CREATE TABLE boss_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  boss_seed BIGINT NOT NULL UNIQUE,
  boss_level BIGINT NOT NULL CHECK (boss_level > 0),
  
  health BIGINT NOT NULL CHECK (health > 0),
  attack INT NOT NULL CHECK (attack > 0),
  defense INT NOT NULL CHECK (defense >= 0),
  crit_chance INT NOT NULL CHECK (crit_chance >= 0),
  
  boss_name VARCHAR(256) NOT NULL,
  boss_lore TEXT,
  
  abilities JSONB NOT NULL,
  
  has_reality_shatter BOOLEAN DEFAULT FALSE,
  has_void_evasion BOOLEAN DEFAULT FALSE,
  
  svg_cache VARCHAR(8192),
  
  generated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(boss_seed, boss_level)
);

CREATE INDEX IF NOT EXISTS idx_boss_level ON boss_registry(boss_level);

-- ============= EVENT REGISTRY =============

CREATE TABLE event_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  event_id VARCHAR(128) NOT NULL UNIQUE,
  event_type VARCHAR(64) NOT NULL,
  
  event_name VARCHAR(256) NOT NULL,
  event_story TEXT NOT NULL,
  
  boss_id UUID REFERENCES boss_registry(id),
  boss_name VARCHAR(256),
  boss_lore TEXT,
  
  reward_loot_ids BIGINT[],
  
  duration_seconds BIGINT NOT NULL CHECK (duration_seconds > 0),
  start_time BIGINT NOT NULL CHECK (start_time >= 0),
  end_time BIGINT NOT NULL CHECK (end_time > start_time),
  
  generated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_event_active ON event_registry(start_time, end_time);

-- ============= LIMITED ITEMS =============

CREATE TABLE limited_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  seed BIGINT NOT NULL UNIQUE,
  rarity VARCHAR(32) NOT NULL,
  
  attack_bonus INT DEFAULT 0 CHECK (attack_bonus >= 0),
  defense_bonus INT DEFAULT 0 CHECK (defense_bonus >= 0),
  health_bonus INT DEFAULT 0 CHECK (health_bonus >= 0),
  
  item_name VARCHAR(256) NOT NULL,
  flavor_text TEXT,
  unique_property VARCHAR(512),
  
  svg_cache VARCHAR(8192),
  
  available_until BIGINT NOT NULL CHECK (available_until > 0),
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_limited_items_active ON limited_items(available_until);

-- ============= BATTLE LOG =============

CREATE TABLE battle_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  
  enemy_name VARCHAR(256),
  enemy_level BIGINT CHECK (enemy_level > 0),
  player_health_before INT CHECK (player_health_before >= 0),
  player_health_after INT CHECK (player_health_after >= 0),
  damage_dealt BIGINT CHECK (damage_dealt >= 0),
  victory BOOLEAN,
  
  gold_earned BIGINT DEFAULT 0 CHECK (gold_earned >= 0),
  exp_earned BIGINT DEFAULT 0 CHECK (exp_earned >= 0),
  loot_dropped UUID,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_battle_player ON battle_log(player_id);
CREATE INDEX IF NOT EXISTS idx_battle_date ON battle_log(created_at DESC);

-- ============= ASCENSIONS =============

CREATE TABLE ascensions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE UNIQUE,
  
  ascension_level INT NOT NULL DEFAULT 0 CHECK (ascension_level >= 0),
  star_level INT NOT NULL DEFAULT 0 CHECK (star_level >= 0 AND star_level <= 10),
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============= IDLE STATE =============

CREATE TABLE idle_state (
  player_id UUID PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  is_battling BOOLEAN DEFAULT FALSE,
  battles_won_idle BIGINT DEFAULT 0 CHECK (battles_won_idle >= 0),
  gold_earned_idle BIGINT DEFAULT 0 CHECK (gold_earned_idle >= 0),
  exp_earned_idle BIGINT DEFAULT 0 CHECK (exp_earned_idle >= 0),
  last_idle_sync TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============= SYNC QUEUE (for offline support) =============

CREATE TABLE sync_queue (
  id SERIAL PRIMARY KEY,
  table_name VARCHAR(64) NOT NULL,
  record_id TEXT NOT NULL,
  action VARCHAR(32) NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  data JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  synced_at TIMESTAMP WITH TIME ZONE,
  retry_count INT DEFAULT 0 CHECK (retry_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_sync_pending ON sync_queue(synced_at) WHERE synced_at IS NULL;

-- ============= API USAGE TRACKING =============

CREATE TABLE api_usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_name VARCHAR(32),
  tokens_used INT CHECK (tokens_used > 0),
  cache_hit BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_usage_date ON api_usage_log(created_at DESC);

-- ============= HELPER FUNCTIONS =============

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER players_update_trigger BEFORE UPDATE ON players
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER character_stats_update_trigger BEFORE UPDATE ON character_stats
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER ascensions_update_trigger BEFORE UPDATE ON ascensions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============= VIEW: Player Snapshot =============

CREATE VIEW player_snapshot AS
SELECT 
  p.id,
  p.username,
  p.level,
  p.health,
  p.attack,
  p.defense,
  COUNT(DISTINCT h.id) as hero_count,
  COUNT(DISTINCT i.id) as loot_count,
  p.current_chapter,
  p.alignment,
  p.updated_at
FROM players p
LEFT JOIN summoned_heroes h ON p.id = h.player_id
LEFT JOIN inventory_loot i ON p.id = i.player_id
GROUP BY p.id;

-- ============= GRANTS (for app user) =============
-- IMPORTANT: Create app user and grant permissions

-- Create app user (run as superuser)
-- CREATE ROLE app_user WITH PASSWORD 'secure_password' LOGIN;
-- GRANT CONNECT ON DATABASE your_db TO app_user;
-- GRANT USAGE ON SCHEMA public TO app_user;
-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO app_user;
-- GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO app_user;
-- ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO app_user;
-- ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO app_user;

CREATE TABLE IF NOT EXISTS battle_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  enemy_name VARCHAR(256),
  enemy_level BIGINT CHECK (enemy_level > 0),
  player_health_before INT CHECK (player_health_before >= 0),
  player_health_after INT CHECK (player_health_after >= 0),
  damage_dealt BIGINT CHECK (damage_dealt >= 0),
  victory BOOLEAN,
  gold_earned BIGINT DEFAULT 0 CHECK (gold_earned >= 0),
  exp_earned BIGINT DEFAULT 0 CHECK (exp_earned >= 0),
  loot_dropped UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_battle_player ON battle_log(player_id);
CREATE INDEX IF NOT EXISTS idx_battle_date ON battle_log(created_at DESC);

CREATE TABLE IF NOT EXISTS ascensions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE UNIQUE,
  ascension_level INT NOT NULL DEFAULT 0 CHECK (ascension_level >= 0),
  star_level INT NOT NULL DEFAULT 0 CHECK (star_level >= 0 AND star_level <= 10),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS idle_state (
  player_id UUID PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  is_battling BOOLEAN DEFAULT FALSE,
  battles_won_idle BIGINT DEFAULT 0 CHECK (battles_won_idle >= 0),
  gold_earned_idle BIGINT DEFAULT 0 CHECK (gold_earned_idle >= 0),
  exp_earned_idle BIGINT DEFAULT 0 CHECK (exp_earned_idle >= 0),
  last_idle_sync TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sync_queue (
  id SERIAL PRIMARY KEY,
  table_name VARCHAR(64) NOT NULL,
  record_id TEXT NOT NULL,
  action VARCHAR(32) NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  data JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  synced_at TIMESTAMP WITH TIME ZONE,
  retry_count INT DEFAULT 0 CHECK (retry_count >= 0)
);
CREATE INDEX IF NOT EXISTS idx_sync_pending ON sync_queue(synced_at) WHERE synced_at IS NULL;

CREATE TABLE IF NOT EXISTS limited_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seed BIGINT NOT NULL UNIQUE,
  rarity VARCHAR(32) NOT NULL,
  attack_bonus INT DEFAULT 0 CHECK (attack_bonus >= 0),
  defense_bonus INT DEFAULT 0 CHECK (defense_bonus >= 0),
  health_bonus INT DEFAULT 0 CHECK (health_bonus >= 0),
  item_name VARCHAR(256) NOT NULL,
  flavor_text TEXT,
  unique_property VARCHAR(512),
  svg_cache VARCHAR(8192),
  available_until BIGINT NOT NULL CHECK (available_until > 0),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS api_usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_name VARCHAR(32),
  tokens_used INT CHECK (tokens_used > 0),
  cache_hit BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_usage_date ON api_usage_log(created_at DESC);