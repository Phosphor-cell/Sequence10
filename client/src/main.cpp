// src/main.cpp
// Cultivation AFK Realm: Divine Descent — C++ Client

#include <raylib.h>
#include <cpr/cpr.h>
#include <nlohmann/json.hpp>
#include <string>
#include <map>
#include <vector>
#include <cmath>

#include "paper_doll.hpp"

using json = nlohmann::json;

// ─── Config ────────────────────────────────────────────────────────────
const char*  API_BASE      = "https://your-vercel-project.vercel.app/api";
const int    SCREEN_WIDTH  = 1280;
const int    SCREEN_HEIGHT = 720;
const float  SYNC_INTERVAL = 5.0f;   // seconds between background syncs

// ─── Data structures ───────────────────────────────────────────────────

struct CharacterStats {
    int health        = 1000;
    int maxHealth     = 1000;
    int attack        = 100;
    int defense       = 50;
    int criticalRate  = 15;
    int criticalDamage= 150;
    int attackSpeed   = 100;
};

struct LootDrop {
    bool      dropped        = false;
    std::string armorType;
    std::string rarity;
    uint32_t  seed           = 0;
    int       attackBonus    = 0;
    int       defenseBonus   = 0;
    int       healthBonus    = 0;
    int       critRateBonus  = 0;
    int       critDmgBonus   = 0;
    std::string itemName;
};

struct PlayerState {
    std::string   id;
    std::string   username;
    int           level  = 1;
    int           exp    = 0;
    int           gold   = 1000;
    int           gems   = 0;
    CharacterStats stats;
    // slot → item name displayed in equip panel
    std::map<std::string, std::string> equippedNames;
};

struct BattleState {
    bool        active         = false;
    float       timer          = 0.0f;
    float       displayTimer   = 0.0f;  // how long to show result
    int         enemyLevel     = 1;
    std::string enemyName;
    bool        victory        = false;
    int         damageDealt    = 0;
    int         goldEarned     = 0;
    int         expEarned      = 0;
    LootDrop    lastLoot;
    bool        leveledUp      = false;
    int         newLevel       = 1;
};

// ─── Global state ──────────────────────────────────────────────────────

static PlayerState  g_player;
static BattleState  g_battle;
static PaperDoll    g_doll;
static float        g_syncTimer = 0.0f;

// ─── Helpers ───────────────────────────────────────────────────────────

static Rarity rarityFromString(const std::string& s) {
    if (s == "Uncommon")  return Rarity::Uncommon;
    if (s == "Rare")      return Rarity::Rare;
    if (s == "Epic")      return Rarity::Epic;
    if (s == "Legendary") return Rarity::Legendary;
    return Rarity::Common;
}

static Color rarityColor(const std::string& r) {
    if (r == "Uncommon")  return { 76,  175,  80, 255 };
    if (r == "Rare")      return { 33,  150, 243, 255 };
    if (r == "Epic")      return { 156,  39, 176, 255 };
    if (r == "Legendary") return { 255, 193,   7, 255 };
    return { 158, 158, 158, 255 };
}

// ─── Network ───────────────────────────────────────────────────────────

static json apiPost(const std::string& endpoint, const json& body) {
    std::string url = std::string(API_BASE) + "/" + endpoint;
    auto r = cpr::Post(
        cpr::Url{url},
        cpr::Body{body.dump()},
        cpr::Header{{"Content-Type", "application/json"}},
        cpr::Timeout{8000}
    );
    if (r.status_code == 200 || r.status_code == 201) {
        return json::parse(r.text, nullptr, false);
    }
    return json::object();
}

static void initPlayer(const std::string& username) {
    auto res = apiPost("_player", {{"action","init"},{"username",username}});
    if (res.contains("playerId")) {
        g_player.id       = res.value("playerId", std::string(""));
        g_player.username = res.value("username", username);
    }
}

static void syncPlayer() {
    if (g_player.id.empty()) return;
    auto res = apiPost("_player", {{"action","getState"},{"playerId",g_player.id}});
    if (!res.contains("level")) return;

    g_player.level = res["level"];
    g_player.exp   = res["exp"];
    g_player.gold  = res["gold"];
    g_player.gems  = res["gems"];

    if (res.contains("stats")) {
        auto  s = res["stats"];
        g_player.stats.health         = s.value("health",         g_player.stats.health);
        g_player.stats.maxHealth      = s.value("maxHealth",      g_player.stats.maxHealth);
        g_player.stats.attack         = s.value("attack",         g_player.stats.attack);
        g_player.stats.defense        = s.value("defense",        g_player.stats.defense);
        g_player.stats.criticalRate   = s.value("criticalRate",   g_player.stats.criticalRate);
        g_player.stats.criticalDamage = s.value("criticalDamage", g_player.stats.criticalDamage);
        g_player.stats.attackSpeed    = s.value("attackSpeed",    g_player.stats.attackSpeed);
    }
}

static void requestLoot() {
    if (g_player.id.empty()) return;
    auto res = apiPost("_loot", {{"player_id", g_player.id}});

    g_battle.lastLoot = LootDrop{};
    g_battle.lastLoot.dropped = res.value("dropped", false);
    if (!g_battle.lastLoot.dropped) return;

    if (res.contains("loot")) {
        auto  l = res["loot"];
        g_battle.lastLoot.armorType   = l.value("armor_type",      "weapon");
        g_battle.lastLoot.rarity      = l.value("rarity",          "Common");
        g_battle.lastLoot.seed        = l.value("seed",            (uint32_t)0);
        g_battle.lastLoot.attackBonus = l.value("attack_bonus",    0);
        g_battle.lastLoot.defenseBonus= l.value("defense_bonus",   0);
        g_battle.lastLoot.healthBonus = l.value("health_bonus",    0);
        g_battle.lastLoot.critRateBonus = l.value("crit_rate_bonus", 0);
        g_battle.lastLoot.critDmgBonus  = l.value("crit_damage_bonus", 0);
        g_battle.lastLoot.itemName    = l.value("item_name",       "Unknown Item");
    }

    // Auto-equip the drop onto the paper doll
    g_doll.equip({
        g_battle.lastLoot.armorType,
        rarityFromString(g_battle.lastLoot.rarity),
        g_battle.lastLoot.seed
    });
    g_player.equippedNames[g_battle.lastLoot.armorType] = g_battle.lastLoot.itemName;
}

static void startBattle() {
    if (g_player.id.empty() || g_battle.active) return;
    auto res = apiPost("_battle", {
        {"playerId",   g_player.id},
        {"enemyLevel", g_player.level},
        {"difficulty", 1}
    });
    if (!res.contains("victory")) return;

    g_battle.active      = true;
    g_battle.timer       = 0.0f;
    g_battle.displayTimer= 0.0f;
    g_battle.enemyLevel  = g_player.level;
    g_battle.enemyName   = res.value("enemyName", "Enemy Lv" + std::to_string(g_player.level));
    g_battle.victory     = res["victory"];
    g_battle.damageDealt = res.value("damageDealt",  0);
    g_battle.goldEarned  = res.value("goldEarned",   0);
    g_battle.expEarned   = res.value("expEarned",    0);
    g_battle.leveledUp   = res.value("levelUp",      false);
    g_battle.newLevel    = res.value("newLevel",      g_player.level);
    g_battle.lastLoot    = {};

    // Apply rewards locally (server is authoritative, sync will correct any drift)
    g_player.stats.health = res.value("playerHealthAfter", g_player.stats.health);
    g_player.gold  += g_battle.goldEarned;
    g_player.exp   += g_battle.expEarned;
    if (g_battle.leveledUp) g_player.level = g_battle.newLevel;

    // Request loot roll if we won
    if (g_battle.victory) requestLoot();
}

// ─── UI helpers ────────────────────────────────────────────────────────

static void drawPanel(int x, int y, int w, int h, Color bg) {
    DrawRectangle(x, y, w, h, bg);
    DrawRectangleLinesEx({(float)x,(float)y,(float)w,(float)h}, 1, {60,60,80,255});
}

static void drawLabel(const char* text, int x, int y, int size, Color c) {
    DrawText(text, x, y, size, c);
}

static int drawStat(const char* label, int value, int x, int y,
                    Color labelCol, Color valCol) {
    DrawText(label, x, y, 11, labelCol);
    DrawText(std::to_string(value).c_str(), x + 90, y, 11, valCol);
    return y + 18;
}

// ─── Panels ────────────────────────────────────────────────────────────

static void drawTopBar() {
    DrawRectangle(0, 0, SCREEN_WIDTH, 50, {15, 15, 25, 255});
    DrawRectangle(0, 48, SCREEN_WIDTH, 2, {50, 50, 80, 255});

    // Username + level
    std::string title = g_player.username.empty()
                      ? "Connecting..."
                      : g_player.username + "  |  Lv " + std::to_string(g_player.level);
    DrawText(title.c_str(), 20, 14, 18, WHITE);

    // Gold / Gems on the right
    std::string resources = "Gold: " + std::to_string(g_player.gold)
                          + "   Gems: " + std::to_string(g_player.gems);
    int tw = MeasureText(resources.c_str(), 14);
    DrawText(resources.c_str(), SCREEN_WIDTH - tw - 20, 17, 14, {255,193,7,255});

    DrawFPS(SCREEN_WIDTH / 2 - 20, 14);
}

static void drawStatsPanel() {
    drawPanel(0, 50, 220, 420, {22, 22, 35, 255});
    int y = 62;
    drawLabel("STATS", 10, y, 13, {180,180,255,255}); y += 24;

    // EXP bar
    float expPct = (g_player.level > 0)
                 ? std::min(1.0f, (float)g_player.exp / (float)(g_player.level * 10000))
                 : 0.f;
    DrawRectangle(10, y, 200, 8, {40,40,60,255});
    DrawRectangle(10, y, (int)(200 * expPct), 8, {100,220,100,255});
    DrawText("EXP", 10, y - 14, 10, {120,200,120,255});
    y += 22;

    // HP bar
    float hpPct = g_player.stats.maxHealth > 0
                ? (float)g_player.stats.health / (float)g_player.stats.maxHealth
                : 0.f;
    DrawRectangle(10, y, 200, 8, {40,40,60,255});
    DrawRectangle(10, y, (int)(200 * hpPct), 8, {220,80,80,255});
    std::string hpStr = std::to_string(g_player.stats.health) + "/"
                      + std::to_string(g_player.stats.maxHealth);
    DrawText(hpStr.c_str(), 10, y - 14, 10, {220,150,150,255});
    y += 24;

    y = drawStat("ATK",   g_player.stats.attack,         10, y, GRAY, WHITE);
    y = drawStat("DEF",   g_player.stats.defense,         10, y, GRAY, WHITE);
    y = drawStat("CR%",   g_player.stats.criticalRate,    10, y, GRAY, {255,200,80,255});
    y = drawStat("CD%",   g_player.stats.criticalDamage,  10, y, GRAY, {255,200,80,255});
    y = drawStat("SPD",   g_player.stats.attackSpeed,     10, y, GRAY, WHITE);
    y += 10;

    drawLabel("EQUIPPED", 10, y, 11, {180,180,255,255}); y += 16;
    const std::vector<std::string> slots = {"weapon","head","body","arms","legs","accessory"};
    for (const auto& slot : slots) {
        auto it = g_player.equippedNames.find(slot);
        std::string name = (it != g_player.equippedNames.end()) ? it->second : "--";
        // Truncate long names
        if ((int)name.size() > 18) name = name.substr(0, 15) + "...";
        Color dimGray = {70,70,90,255};
        Color col = (it != g_player.equippedNames.end()) ? WHITE : dimGray;
        DrawText((slot + ":").c_str(), 10, y, 10, {120,120,160,255});
        DrawText(name.c_str(),         64, y, 10, col);
        y += 15;
    }
}

static void drawDollPanel() {
    drawPanel(220, 50, 620, 560, {18, 25, 35, 255});
    // Paper doll centred in this panel
    g_doll.draw(220 + 310, 50 + 280, 0.9f);
}

static void drawBattlePanel() {
    int px = 840, py = 50, pw = 440, ph = 420;
    drawPanel(px, py, pw, ph, {22, 22, 35, 255});
    int y = py + 12;

    if (!g_battle.active) {
        drawLabel("BATTLE",         px+10, y, 13, {180,180,255,255}); y += 28;
        drawLabel("[SPACE] Fight",  px+10, y, 12, {100,100,140,255}); y += 20;
        drawLabel("[R] Force sync", px+10, y, 11, {80, 80, 110,255});
        return;
    }

    // In-battle display
    Color titleCol = g_battle.victory ? GREEN : RED;
    std::string header = g_battle.victory ? "VICTORY!" : "DEFEAT";
    DrawText(header.c_str(), px + pw/2 - MeasureText(header.c_str(),22)/2,
             y, 22, titleCol);
    y += 34;

    DrawText(g_battle.enemyName.c_str(), px+10, y, 13, WHITE); y += 20;
    DrawText(("Lv " + std::to_string(g_battle.enemyLevel)).c_str(),
             px+10, y, 11, GRAY); y += 22;

    y = drawStat("Damage",   g_battle.damageDealt, px+10, y, GRAY, {255,220,80,255});
    y = drawStat("+Gold",    g_battle.goldEarned,  px+10, y, GRAY, {255,193,7,255});
    y = drawStat("+EXP",     g_battle.expEarned,   px+10, y, GRAY, {100,220,100,255});
    if (g_battle.leveledUp) {
        y += 6;
        std::string lvl = "LEVEL UP!  Now Lv " + std::to_string(g_battle.newLevel);
        DrawText(lvl.c_str(), px+10, y, 13, {180,255,180,255});
        y += 22;
    }

    // Loot section
    y += 10;
    DrawRectangle(px+8, y, pw-16, 1, {50,50,70,255});
    y += 10;
    drawLabel("LOOT", px+10, y, 12, {180,180,255,255}); y += 18;

    if (!g_battle.lastLoot.dropped) {
        drawLabel("No drop", px+10, y, 11, {70,70,90,255});
    } else {
        Color rc = rarityColor(g_battle.lastLoot.rarity);
        DrawText(g_battle.lastLoot.itemName.c_str(), px+10, y, 12, rc);
        y += 16;
        std::string rarStr = "[" + g_battle.lastLoot.rarity + "] " + g_battle.lastLoot.armorType;
        DrawText(rarStr.c_str(), px+10, y, 11, rc);
        y += 16;
        if (g_battle.lastLoot.attackBonus > 0)
            { DrawText(("+ATK " + std::to_string(g_battle.lastLoot.attackBonus)).c_str(),  px+10, y, 11, WHITE); y+=14; }
        if (g_battle.lastLoot.defenseBonus > 0)
            { DrawText(("+DEF " + std::to_string(g_battle.lastLoot.defenseBonus)).c_str(), px+10, y, 11, WHITE); y+=14; }
        if (g_battle.lastLoot.healthBonus > 0)
            { DrawText(("+HP " + std::to_string(g_battle.lastLoot.healthBonus)).c_str(), px+10, y, 11, WHITE); y+=14; }
        if (g_battle.lastLoot.critRateBonus > 0)
            { DrawText(("+CR " + std::to_string(g_battle.lastLoot.critRateBonus)+"%").c_str(),  px+10, y, 11, {255,220,80,255}); y+=14; }
        if (g_battle.lastLoot.critDmgBonus > 0)
            { DrawText(("+CD " + std::to_string(g_battle.lastLoot.critDmgBonus)+"%").c_str(),   px+10, y, 11, {255,220,80,255}); y+=14; }
        y += 4;
        DrawText("Auto-equipped!", px+10, y, 10, {120,200,120,200});
    }
}

static void drawActionBar() {
    drawPanel(0, SCREEN_HEIGHT-50, SCREEN_WIDTH, 50, {15,15,25,255});
    DrawRectangle(0, SCREEN_HEIGHT-50, SCREEN_WIDTH, 1, {50,50,80,255});

    bool canFight = !g_battle.active && !g_player.id.empty();
    Color btnCol  = canFight ? Color{60,90,160,255} : Color{40,40,60,255};
    DrawRectangle(10, SCREEN_HEIGHT-42, 180, 34, btnCol);
    DrawText("FIGHT  [SPACE]", 22, SCREEN_HEIGHT-32, 12, canFight ? WHITE : GRAY);

    DrawText("[R] Sync  |  [ESC] Quit", SCREEN_WIDTH-240, SCREEN_HEIGHT-32, 11, {80,80,110,255});
}

// ─── Main ──────────────────────────────────────────────────────────────

int main(void) {
    InitWindow(SCREEN_WIDTH, SCREEN_HEIGHT, "Cultivation AFK Realm: Divine Descent");
    SetTargetFPS(60);

    initPlayer("TestPlayer");
    syncPlayer();

    while (!WindowShouldClose()) {
        float dt = GetFrameTime();

        // ── Input ────────────────────────────────────────────────────
        if (IsKeyPressed(KEY_SPACE)) startBattle();
        if (IsKeyPressed(KEY_R))     { syncPlayer(); g_syncTimer = 0.f; }

        // ── Auto sync ────────────────────────────────────────────────
        g_syncTimer += dt;
        if (g_syncTimer >= SYNC_INTERVAL) {
            syncPlayer();
            g_syncTimer = 0.f;
        }

        // ── Battle display timeout ────────────────────────────────────
        if (g_battle.active) {
            g_battle.displayTimer += dt;
            if (g_battle.displayTimer >= 4.0f) {
                g_battle.active = false;
            }
        }

        // ── Draw ─────────────────────────────────────────────────────
        BeginDrawing();
        ClearBackground({12, 12, 20, 255});

        drawTopBar();
        drawStatsPanel();
        drawDollPanel();
        drawBattlePanel();
        drawActionBar();

        EndDrawing();
    }

    g_doll.unload();
    CloseWindow();
    return 0;
}