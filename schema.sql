-- Optional: enable UUID generation helpers
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) Players
CREATE TABLE IF NOT EXISTS players (
    player_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(64) NOT NULL,
    prestige_level INT NOT NULL DEFAULT 0 CHECK (prestige_level >= 0),
    cultivation_sequence INT NOT NULL DEFAULT 1 CHECK (cultivation_sequence >= 1)
);

-- 2) Player team (20 classes/slots with 32-bit unsigned stats)
CREATE TABLE IF NOT EXISTS player_team (
    player_id UUID NOT NULL,
    slot_index INT NOT NULL CHECK (slot_index >= 0 AND slot_index < 20),
    class_name VARCHAR(32) NOT NULL,

    -- Emulate uint32 in Postgres
    stat_health_u32 BIGINT NOT NULL CHECK (stat_health_u32 >= 0 AND stat_health_u32 <= 4294967295),
    stat_damage_u32 BIGINT NOT NULL CHECK (stat_damage_u32 >= 0 AND stat_damage_u32 <= 4294967295),

    -- Better than TEXT for structured payloads
    weapon_json JSONB,

    PRIMARY KEY (player_id, slot_index),
    CONSTRAINT fk_player_team_player
      FOREIGN KEY (player_id) REFERENCES players(player_id) ON DELETE CASCADE
);

-- 3) World boss state
CREATE TABLE IF NOT EXISTS boss_state (
    instance_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    current_health_u32 BIGINT NOT NULL CHECK (current_health_u32 >= 0 AND current_health_u32 <= 4294967295),
    sequence_tier INT NOT NULL CHECK (sequence_tier >= 1),
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

-- 4) Component Library (The Visual Parts)
CREATE TABLE IF NOT EXISTS game_components (
    component_id VARCHAR(64) PRIMARY KEY,
    category VARCHAR(32) NOT NULL, -- 'blade', 'hilt', 'rune'
    path_data TEXT NOT NULL,       -- The SVG path string
    gradient_data TEXT,            -- CSS/SVG gradient string
    metadata JSONB                 -- Optional extra info
);

-- Index for fast lookup when assembling weapons
CREATE INDEX IF NOT EXISTS idx_components_category ON game_components (category);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_player_team_player_id ON player_team (player_id);
CREATE INDEX IF NOT EXISTS idx_boss_state_active ON boss_state (is_active);

INSERT INTO game_components (component_id, category, path_data, gradient_data) VALUES
('b_celestial', 'blade', 'M 256 50 L 280 450 L 256 480 L 232 450 Z', 'linear-gradient(to bottom, #E0E0E0, #A0A0A0)'),
('h_gilded', 'hilt', 'M 240 480 H 272 V 512 H 240 Z', 'radial-gradient(circle, #FFD700, #B8860B)'),
('r_void', 'rune', 'M 256 150 L 270 200 L 256 180 L 242 200 Z', 'radial-gradient(circle, #8A2BE2, transparent)');