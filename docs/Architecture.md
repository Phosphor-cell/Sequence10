# Hybrid Architecture: SQLite Local Cache + Neon Cloud Sync
## Best of Both Worlds: Free + Great UX

---

## The Magic: Offline Play + Cloud Progress

```
ONLINE:
  Player action
    ↓
  [C++ Client] Process locally (instant)
    ↓
  [SQLite] Save locally
    ↓
  [POST to Neon] Async sync (fire and forget)
    ↓
  Done (100ms total)

OFFLINE:
  Player action
    ↓
  [C++ Client] Process locally (instant)
    ↓
  [SQLite] Save locally
    ↓
  [Neon] ❌ Network down, skip
    ↓
  Done (10ms, no network lag)

BACK ONLINE:
  [Sync daemon] Background thread
    ↓
  Compare: SQLite vs Neon
    ↓
  [POST to Neon] All unsynced actions
    ↓
  [Neon] Server validates + merges
    ↓
  [SQLite] Update with server response
    ↓
  Progress is now cloud-synced
```

---

## Architecture (Updated)

```
┌────────────────────────────────────────────┐
│          Native C++ Client (Raylib)        │
│                                            │
│  ┌──────────────────────────────────────┐ │
│  │  Game Loop                           │ │
│  │  - Render                            │ │
│  │  - Input                             │ │
│  │  - Update                            │ │
│  └──────┬───────────────────────────────┘ │
│         │                                  │
│  ┌──────▼───────────────────────────────┐ │
│  │  Game Systems                        │ │
│  │  - Combat (Int64 math)               │ │
│  │  - Loot generation (procedural)      │ │
│  │  - Summon pulling (procedural)       │ │
│  │  - Narrative engine                  │ │
│  └──────┬───────────────────────────────┘ │
│         │                                  │
│  ┌──────▼───────────────────────────────┐ │
│  │  Storage Layer (Dual-Write)          │ │
│  │                                      │ │
│  │  1. Save to SQLite (always)          │ │
│  │     ├─ players                       │ │
│  │     ├─ summoned_heroes               │ │
│  │     ├─ inventory_loot                │ │
│  │     ├─ narrative_chapters            │ │
│  │     └─ sync_queue (for offline)      │ │
│  │                                      │ │
│  │  2. POST to Neon (async, if online)  │ │
│  │     └─ NetworkManager handles retry  │ │
│  │                                      │ │
│  └──────┬───────────────────────────────┘ │
│         │                                  │
│         ├─ [Online] HTTP POST async       │
│         │                                  │
│         └─ [Offline] Queue for later      │
│                                            │
└────────────────────────────────────────────┘
         │
         │ SYNC DAEMON (Background Thread)
         │ Runs every 5-10 seconds
         │ ├─ Check network status
         │ ├─ Flush sync_queue to Neon
         │ ├─ Fetch server state
         │ └─ Merge conflicts (server wins)
         │
┌────────▼────────────────────────────────────┐
│       Neon PostgreSQL (Cloud)                │
│  ├─ Primary storage (authoritative)         │
│  ├─ Battle validation                       │
│  ├─ LLM generation & caching                │
│  └─ Cross-device sync                       │
└────────────────────────────────────────────┘
```

---

## SQLite Schema (Local Cache)

```sql
-- Same as Neon, but WITH sync tracking

CREATE TABLE players (
  id TEXT PRIMARY KEY,
  username TEXT,
  level BIGINT,
  exp BIGINT,
  gold BIGINT,
  -- ... all fields
  _synced_at TIMESTAMP,  -- NEW: When last synced to Neon
  _needs_sync BOOLEAN DEFAULT TRUE  -- NEW: Dirty flag
);

CREATE TABLE sync_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,  -- "players", "summoned_heroes", etc
  record_id TEXT NOT NULL,   -- UUID
  action TEXT NOT NULL,      -- "INSERT", "UPDATE", "DELETE"
  data JSONB NOT NULL,       -- Full record data
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  synced_at TIMESTAMP,       -- When successfully synced
  retry_count INT DEFAULT 0
);

CREATE INDEX idx_sync_pending ON sync_queue(synced_at) 
  WHERE synced_at IS NULL;

-- All other tables: Same as Neon schema
CREATE TABLE summoned_heroes { ... };
CREATE TABLE inventory_loot { ... };
CREATE TABLE narrative_chapters { ... };
-- etc.
```

---

## C++ Storage Layer (Key Component)

```cpp
// storage.hpp - Handles dual-write + sync

#pragma once

#include <sqlite3.h>
#include <nlohmann/json.hpp>
#include <queue>
#include <thread>
#include <mutex>

using json = nlohmann::json;

class StorageManager {
 public:
  StorageManager(const std::string& db_path);
  ~StorageManager();

  // ========== PRIMARY API: Always works (online or offline) ==========
  
  void SavePlayerState(const json& player_state);
  json LoadPlayerState(const std::string& player_id);
  
  void SaveChapter(uint32_t chapter_num, const json& chapter);
  json LoadChapter(uint32_t chapter_num);
  
  void SaveSummon(const json& summon);
  std::vector<json> LoadAllSummons(const std::string& player_id);
  
  void SaveLoot(const json& loot);
  std::vector<json> LoadAllLoot(const std::string& player_id);
  
  // ========== SYNC API: Handles cloud sync ==========
  
  // Called by sync daemon (background thread)
  std::vector<json> GetPendingSyncQueue();
  void MarkAsSynced(const std::string& record_id);
  void RequeueOnSyncFailure(const std::string& record_id);
  
  // Merge server response into local
  void ApplyServerUpdate(const json& server_state);
  
  // ========== NETWORK STATUS ==========
  
  void SetOnlineStatus(bool is_online);
  bool IsOnline() const;
  
 private:
  sqlite3* db_;
  bool is_online_;
  std::mutex db_mutex_;
  
  // Internal helpers
  void ExecuteSQL(const std::string& sql);
  json QueryOneRow(const std::string& sql);
  std::vector<json> QueryAllRows(const std::string& sql);
  
  // Queue management
  void EnqueueSync(
    const std::string& table_name,
    const std::string& record_id,
    const std::string& action,
    const json& data
  );
};

// ========== SYNC DAEMON (Background Thread) ==========

class SyncDaemon {
 public:
  SyncDaemon(StorageManager* storage, NetworkManager* network);
  ~SyncDaemon();
  
  void Start();
  void Stop();
  
 private:
  StorageManager* storage_;
  NetworkManager* network_;
  std::thread sync_thread_;
  std::atomic<bool> running_{false};
  
  void SyncLoop();
  void FlushSyncQueue();
  void FetchServerState();
  void ResolveConflicts(const json& server_state);
};
```

---

## Network Manager (Retry Logic)

```cpp
// network_manager.hpp - Updated for offline resilience

class NetworkManager {
 public:
  NetworkManager(const std::string& api_base);
  
  // Returns: success, cached result on failure
  Result PostPlayerState(const json& player_state);
  Result PostSummon(const json& summon);
  Result PostLoot(const json& loot);
  Result PostChapter(uint32_t chapter_num, const json& chapter);
  
  // Returns: server's latest state (for sync merge)
  json GetServerState(const std::string& player_id);
  
  // Manual network check
  bool IsNetworkAvailable();
  
 private:
  std::string api_base_;
  static const int RETRY_COUNT = 3;
  static const int TIMEOUT_MS = 5000;
  
  json MakeRequest(
    const std::string& endpoint,
    const json& payload,
    int retry_count = RETRY_COUNT
  );
  
  bool IsNetworkError(const cpr::Response& resp);
};
```

---

## Sync Flow (Detailed)

### Step 1: User Action (Always Online or Offline)

```cpp
// In game_manager.cpp
void GameManager::OnBattleWon() {
  // 1. Update local state
  player_state.exp += 100;
  player_state.gold += 500;
  
  // 2. Save to SQLite (ALWAYS succeeds)
  storage_manager_.SavePlayerState(player_state);
  
  // 3. Queue for sync (async, doesn't block)
  storage_manager_.EnqueueSync(
    "players",
    player_state.id,
    "UPDATE",
    player_state
  );
  
  // 4. Try to POST to Neon (if online)
  network_manager_.PostPlayerState(player_state);
  
  // UI updates immediately
  RenderUI();
  
  // Network request happens in background
  // If fails, sync daemon retries later
}
```

### Step 2: Background Sync Daemon (Every 5s)

```cpp
// In sync_daemon.cpp
void SyncDaemon::SyncLoop() {
  while (running_) {
    // Sleep 5 seconds
    std::this_thread::sleep_for(std::chrono::seconds(5));
    
    // Check network
    if (!network_->IsNetworkAvailable()) {
      continue;  // Still offline, try again in 5s
    }
    
    // Online: flush pending queue
    auto pending = storage_->GetPendingSyncQueue();
    
    for (const auto& sync_item : pending) {
      bool success = network_->PostSyncItem(sync_item);
      
      if (success) {
        storage_->MarkAsSynced(sync_item["record_id"]);
      } else {
        storage_->RequeueOnSyncFailure(sync_item["record_id"]);
      }
    }
    
    // Fetch latest from server (for merge)
    auto server_state = network_->GetServerState(current_player_id_);
    storage_->ApplyServerUpdate(server_state);
  }
}
```

### Step 3: Conflict Resolution (Server Wins)

```cpp
void StorageManager::ApplyServerUpdate(const json& server_state) {
  // Server is authoritative
  // Strategy: Server data overwrites local if newer
  
  auto local = LoadPlayerState(server_state["id"]);
  
  if (server_state["updated_at"] > local["updated_at"]) {
    // Server is newer, use server data
    ExecuteSQL(
      "UPDATE players SET ... WHERE id = ?",
      server_state
    );
  }
  // Otherwise: Keep local (we're ahead)
}
```

---

## When to Use Which Storage

### Load Data (Read)

```cpp
// Always try local first (fast)
auto player = storage_manager_.LoadPlayerState(player_id);

if (player.is_null()) {
  // Not in local cache, sync from server
  auto server_player = network_manager_.GetServerState(player_id);
  storage_manager_.ApplyServerUpdate(server_player);
  player = storage_manager_.LoadPlayerState(player_id);
}

// Use player data
```

### Save Data (Write)

```cpp
// Always save to local first
storage_manager_.SavePlayerState(player);

// Then queue + send to server (async)
network_manager_.PostPlayerState(player);  // Fire and forget

// Game continues immediately
// Sync daemon retries if network fails
```

---

## Offline Scenarios

### Scenario A: User Plays Offline for 1 Hour

```
[Offline] User plays, battles, levels up
  ↓ SQLite saves everything
[Goes Online]
  ↓ Sync daemon wakes up
  ↓ Detects network
  ↓ Posts all queued actions to Neon
  ↓ Neon validates, merges, updates
  ↓ Client gets confirmation
  ↓ sync_queue is cleared
  ↓ Progress now backed up in cloud
```

### Scenario B: User on 2 Devices (Sync Conflict)

```
Device A (Phone):
  Offline for 2 hours
  Levels up to level 50, earns 10,000 gold
  Saves to SQLite, sync_queue fills
  
Device B (PC):
  Online whole time
  Also levels up to level 50, earns 5,000 gold
  Syncs immediately to Neon
  
Device A comes online:
  Sync daemon posts: level 50, 10,000 gold
  Neon has: level 50, 5,000 gold (from Device B)
  
Conflict resolution (Server Wins):
  Check updated_at timestamp
  Device B synced more recently?
  → Keep Device B's data (5,000 gold)
  → Device A's progress is lost? NO!
  
Actually: Neon validates the full history
  Both devices contributed to level 50
  Neon takes: max(level), sum(gold from all sources)
  Result: level 50, 15,000 gold (merged!)
```

---

## Key Benefits

✅ **Offline play** — Play anywhere, sync when online  
✅ **No data loss** — Local SQLite is backup if network fails  
✅ **Cloud progress** — Neon is always source of truth  
✅ **Cross-device** — Same account on phone & PC auto-syncs  
✅ **Cheating protection** — Server validates all actions  
✅ **Free** — SQLite $0, Neon $0 free tier  
✅ **Resilient** — Works great on bad WiFi or mobile  

---

## Implementation Checklist

- [ ] SQLite schema (with sync_queue table)
- [ ] StorageManager class (dual-write logic)
- [ ] NetworkManager class (retry + offline handling)
- [ ] SyncDaemon class (background thread)
- [ ] Conflict resolution logic (server wins)
- [ ] Online/offline detection
- [ ] Test offline scenario (disconnect WiFi, play, reconnect)
- [ ] Test sync conflict (edit on 2 devices simultaneously)
- [ ] Monitor sync_queue (size, pending items)

---

## Database Design Notes

### Local SQLite
- ✅ Fast (no network)
- ✅ Works offline
- ✅ Easy to query
- ❌ Single device only
- ❌ Not backed up

### Cloud Neon
- ✅ Backed up (daily)
- ✅ Cross-device sync
- ✅ Server validation
- ❌ Requires network
- ❌ ~100ms latency

### Hybrid (Both)
- ✅ All benefits of both
- ✅ Instant local + cloud safety
- ✅ Offline + online seamless
- ✅ Conflict resolution
- ❌ Slight complexity (but worth it)

---

**This is the gold standard for modern games: instant local + cloud backup.**