// src/main.cpp
// Infinite AFK RPG: C++ Client with Raylib + Paper Doll SVG renderer

#include <raylib.h>
#include <cpr/cpr.h>
#include <nlohmann/json.hpp>
#include <string>
#include <map>
#include <vector>
#include <cmath>

using json = nlohmann::json;

// Config
const char* API_BASE = "https://your-vercel-project.vercel.app/api";
const int SCREEN_WIDTH = 1280;
const int SCREEN_HEIGHT = 720;
const float SYNC_INTERVAL = 2.0f; // seconds

// Game State Structure
struct CharacterStats {
  int health;
  int maxHealth;
  int attack;
  int defense;
  int criticalRate;
  int criticalDamage;
  int attackSpeed;
};

struct Equipment {
  std::map<std::string, std::string> slots; // slot -> itemId
};

struct PlayerState {
  std::string id;
  std::string username;
  int level;
  int exp;
  int gold;
  int gems;
  CharacterStats stats;
  Equipment equipment;
};

struct BattleState {
  bool inBattle = false;
  float battleTimer = 0.0f;
  std::string enemyName;
  int enemyLevel = 1;
  int enemyHealth = 500;
  int playerHealthBefore = 1000;
  int playerHealthAfter = 1000;
  int damageDealt = 0;
  bool victory = false;
};

// Global game state
PlayerState playerState;
BattleState battleState;
float syncTimer = 0.0f;

// ============= NETWORK LAYER =============

json makeRequest(const std::string& endpoint, const json& payload) {
  std::string url = std::string(API_BASE) + "/" + endpoint;
  auto r = cpr::Post(cpr::Url{url},
                     cpr::Body{payload.dump()},
                     cpr::Header{{"Content-Type", "application/json"}});

  if (r.status_code == 200 || r.status_code == 201) {
    return json::parse(r.text);
  }
  return json::object();
}

void initPlayer(const std::string& username) {
  json req = {{"action", "init"}, {"username", username}};
  json res = makeRequest("_player", req);
  playerState.id = res["playerId"];
  playerState.username = res["username"];
}

void syncPlayerState() {
  json req = {{"action", "getState"}, {"playerId", playerState.id}};
  json res = makeRequest("_player", req);

  playerState.level = res["level"];
  playerState.exp = res["exp"];
  playerState.gold = res["gold"];
  playerState.gems = res["gems"];

  playerState.stats.health = res["stats"]["health"];
  playerState.stats.maxHealth = res["stats"]["maxHealth"];
  playerState.stats.attack = res["stats"]["attack"];
  playerState.stats.defense = res["stats"]["defense"];
  playerState.stats.criticalRate = res["stats"]["criticalRate"];
  playerState.stats.criticalDamage = res["stats"]["criticalDamage"];
  playerState.stats.attackSpeed = res["stats"]["attackSpeed"];
}

void startBattle(int enemyLevel, int difficulty) {
  json req = {{"playerId", playerState.id},
              {"enemyLevel", enemyLevel},
              {"difficulty", difficulty}};
  json res = makeRequest("_battle", req);

  battleState.inBattle = true;
  battleState.battleTimer = 0.0f;
  battleState.enemyLevel = enemyLevel;
  battleState.victory = res["victory"];
  battleState.playerHealthAfter = res["playerHealthAfter"];
  battleState.damageDealt = res["damageDealt"];

  // Update local state
  playerState.stats.health = battleState.playerHealthAfter;
  playerState.gold += res["goldEarned"];
  playerState.exp += res["expEarned"];
}

// ============= RENDERING =============

void drawCharacterPaperDoll(int x, int y, float scale) {
  // Simplified Paper Doll: render base rig + equipped items
  // For now, draw placeholder circles + text for assembly points

  // Base torso (placeholder rect)
  DrawRectangle(x - 20, y - 40, 40, 60, DARKBLUE);
  DrawText("TORSO", x - 20, y - 10, 10, WHITE);

  // Head socket (top)
  DrawCircle(x, y - 50, 15, GRAY);
  DrawText("HEAD", x - 15, y - 55, 8, WHITE);

  // Arms sockets (left/right)
  DrawCircle(x - 30, y - 20, 12, GRAY);
  DrawCircle(x + 30, y - 20, 12, GRAY);
  DrawText("ARMS", x - 15, y - 15, 8, WHITE);

  // Legs socket (bottom)
  DrawCircle(x, y + 40, 15, GRAY);
  DrawText("LEGS", x - 10, y + 45, 8, WHITE);

  // Weapon slot (right hand)
  DrawRectangle(x + 20, y, 20, 40, DARKGRAY);
  DrawText("WPN", x + 22, y + 10, 8, WHITE);
}

void drawUI() {
  // Top info bar
  DrawRectangle(0, 0, SCREEN_WIDTH, 60, Color{20, 20, 30, 255});
  DrawText(playerState.username.c_str(), 20, 10, 16, WHITE);
  DrawText(("Lvl " + std::to_string(playerState.level)).c_str(), 300, 10, 16,
           WHITE);

  // Stats panel (left side)
  DrawRectangle(0, 60, 250, 400, Color{30, 30, 40, 255});
  int yOffset = 80;
  DrawText("STATS", 20, yOffset, 14, YELLOW);
  yOffset += 30;

  std::string healthStr =
      "HP: " + std::to_string(playerState.stats.health) + "/" +
      std::to_string(playerState.stats.maxHealth);
  DrawText(healthStr.c_str(), 20, yOffset, 12, WHITE);
  yOffset += 20;

  DrawText(("ATK: " + std::to_string(playerState.stats.attack)).c_str(), 20,
           yOffset, 12, WHITE);
  yOffset += 20;

  DrawText(("DEF: " + std::to_string(playerState.stats.defense)).c_str(), 20,
           yOffset, 12, WHITE);
  yOffset += 20;

  DrawText(("CRIT: " + std::to_string(playerState.stats.criticalRate) + "%")
               .c_str(),
           20, yOffset, 12, WHITE);
  yOffset += 20;

  DrawText(("Gold: " + std::to_string(playerState.gold)).c_str(), 20, yOffset,
           12, YELLOW);
  yOffset += 20;

  DrawText(("Exp: " + std::to_string(playerState.exp)).c_str(), 20, yOffset,
           12, GREEN);

  // Battle panel (center)
  if (battleState.inBattle) {
    DrawRectangle(300, 100, 600, 400, Color{50, 20, 20, 255});
    DrawText("BATTLE IN PROGRESS", 320, 120, 20, RED);
    DrawText(battleState.enemyName.c_str(), 320, 160, 16, WHITE);
    DrawText(("Lvl " + std::to_string(battleState.enemyLevel)).c_str(), 320,
             190, 14, WHITE);

    if (battleState.victory) {
      DrawText("VICTORY!", 350, 260, 24, GREEN);
    } else {
      DrawText("DEFEAT", 350, 260, 24, RED);
    }

    DrawText(("Damage: " + std::to_string(battleState.damageDealt)).c_str(),
             320, 310, 12, YELLOW);
  } else {
    // Character preview
    DrawRectangle(300, 100, 600, 400, Color{30, 40, 50, 255});
    drawCharacterPaperDoll(600, 250, 2.0f);
  }

  // Action buttons (bottom right)
  if (!battleState.inBattle) {
    DrawRectangle(800, 600, 200, 50, Color{80, 80, 120, 255});
    DrawText("FIGHT (SPACE)", 810, 615, 12, WHITE);
  } else {
    DrawRectangle(800, 600, 200, 50, Color{120, 80, 80, 255});
    DrawText("BATTLING...", 810, 615, 12, WHITE);
  }
}

// ============= MAIN LOOP =============

int main(void) {
  // Initialize Raylib
  InitWindow(SCREEN_WIDTH, SCREEN_HEIGHT, "Infinite AFK RPG");
  SetTargetFPS(60);

  // Initialize player
  initPlayer("TestPlayer");
  syncPlayerState();

  bool shouldClose = false;

  while (!WindowShouldClose() && !shouldClose) {
    // Update
    syncTimer += GetFrameTime();
    if (syncTimer >= SYNC_INTERVAL) {
      syncPlayerState();
      syncTimer = 0.0f;
    }

    // Input
    if (IsKeyPressed(KEY_SPACE) && !battleState.inBattle) {
      startBattle(playerState.level, 1); // normal difficulty
    }

    if (battleState.inBattle) {
      battleState.battleTimer += GetFrameTime();
      if (battleState.battleTimer > 2.0f) {
        battleState.inBattle = false;
      }
    }

    // Draw
    BeginDrawing();
    ClearBackground(Color{15, 15, 25, 255});

    drawUI();

    // Debug info
    DrawText("Press SPACE to battle", 10, SCREEN_HEIGHT - 30, 10, GRAY);
    DrawFPS(SCREEN_WIDTH - 100, 10);

    EndDrawing();
  }

  CloseWindow();
  return 0;
}