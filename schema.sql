-- Corrected PostgreSQL Schema
CREATE TABLE players (
    player_id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(64),
    prestige_level INT DEFAULT 0,
    cultivation_sequence INT DEFAULT 1
);

CREATE TABLE player_team (
    player_id VARCHAR(64),
    slot_index INT,
    class_name VARCHAR(32), 
    stat_health_u32 BIGINT, -- PostgreSQL BIGINT is perfect for 32-bit unsigned
    stat_damage_u32 BIGINT,
    weapon_json TEXT,       -- Use TEXT instead of NVARCHAR(MAX)
    PRIMARY KEY (player_id, slot_index),
    FOREIGN KEY (player_id) REFERENCES players(player_id)
);

CREATE TABLE boss_state (
    instance_id VARCHAR(64) PRIMARY KEY,
    current_health_u32 BIGINT,
    sequence_tier INT,
    is_active BOOLEAN DEFAULT TRUE -- Use BOOLEAN, not BIT
);