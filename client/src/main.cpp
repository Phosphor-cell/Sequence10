// src/main.cpp
// Cultivation AFK Realm: Divine Descent — C++ Client
// Full UI overhaul: menu navigation, chapter backdrops, shop/inventory/summon/index/story.

#include <raylib.h>
#include <cpr/cpr.h>
#include <nlohmann/json.hpp>
#include <string>
#include <map>
#include <vector>
#include <cmath>
#include <algorithm>
#include <future>
#include <atomic>

#include "paper_doll.hpp"
#include "device_id.hpp"
#include "format.hpp"

using json = nlohmann::json;

// Server sends big numbers (gold/exp/damage) as STRINGS since they exceed JS
// Number precision. Small values may arrive as numbers. Parse either safely.
static uint64_t jsonU64(const json& obj, const char* key, uint64_t fallback) {
    if (!obj.contains(key)) return fallback;
    const auto& v = obj[key];
    try {
        if (v.is_string())          return std::stoull(v.get<std::string>());
        if (v.is_number_unsigned()) return v.get<uint64_t>();
        if (v.is_number_integer())  { auto i = v.get<long long>(); return i < 0 ? 0 : (uint64_t)i; }
        if (v.is_number_float())    { double d = v.get<double>(); return d < 0 ? 0 : (uint64_t)d; }
    } catch (...) {}
    return fallback;
}

// ─── Config ────────────────────────────────────────────────────────────
const char*  API_BASE      = "https://sequence10.vercel.app/api";
const int    SCREEN_WIDTH  = 1280;
const int    SCREEN_HEIGHT = 720;
const float  SYNC_INTERVAL = 5.0f;

// ─── Screens ───────────────────────────────────────────────────────────
enum class Screen {
    HOME, CHAPTER_SELECT, BATTLE, SHOP, INVENTORY, SUMMON, INDEX, STORY
};

// ─── Data structures ───────────────────────────────────────────────────
struct CharacterStats {
    int health = 1000, maxHealth = 1000, attack = 100, defense = 50;
    int criticalRate = 15, criticalDamage = 150, attackSpeed = 100;
};

struct LootDrop {
    bool dropped = false;
    std::string armorType, rarity, itemName;
    uint32_t seed = 0;
    int attackBonus = 0, defenseBonus = 0, healthBonus = 0;
    int critRateBonus = 0, critDmgBonus = 0;
};

struct PlayerState {
    std::string id, username;
    int level = 1;
    uint64_t exp = 0, gold = 1000, gems = 0;
    uint64_t expToNext = 10000;
    CharacterStats stats;
    std::map<std::string, std::string> equippedNames;
};

struct BattleState {
    bool active = false;
    float displayTimer = 0.0f;
    int enemyLevel = 1;
    std::string enemyName;
    bool victory = false;
    uint64_t damageDealt = 0, goldEarned = 0, expEarned = 0;
    LootDrop lastLoot;
    bool leveledUp = false;
    int newLevel = 1;
};

struct Chapter {
    int id = 0;
    std::string name;
    int levelCap = 1;
    float expMult = 1.0f, goldMult = 1.0f;
    std::string storyText, backdropFile;
    Texture2D backdrop = { 0 };
    bool triedLoad = false;
};

struct InventoryItem {
    std::string itemName, armorType, rarity;
    int attackBonus = 0, defenseBonus = 0, healthBonus = 0;
    uint32_t seed = 0;
};

// ─── Global state ──────────────────────────────────────────────────────
static PlayerState           g_player;
static BattleState           g_battle;
static PaperDoll             g_doll;
static float                 g_syncTimer = 0.0f;
static Screen                g_screen = Screen::HOME;
static std::vector<Chapter>  g_chapters;
static int                   g_currentChapter = 1;
static int                   g_selectedChapter = 1;
static std::vector<InventoryItem> g_inventory;
static std::vector<std::string>   g_storyLog;

// Idle "while you were away" popup state.
static bool      g_idlePopup = false;
static uint64_t  g_idleGold = 0, g_idleExp = 0;
static long long g_idleSeconds = 0;

// ─── Colour palette ────────────────────────────────────────────────────
namespace Col {
    const Color C_BG_DEEP  = { 10, 10, 18, 255 };
    const Color C_PANEL    = { 22, 22, 35, 230 };
    const Color C_PANEL_HI = { 40, 40, 62, 255 };
    const Color C_BORDER   = { 60, 60, 90, 255 };
    const Color C_ACCENT   = { 0, 217, 255, 255 };
    const Color C_ACCENT_2 = { 156, 136, 255, 255 };
    const Color C_GOLD     = { 255, 193, 7, 255 };
    const Color C_TXT      = { 220, 220, 235, 255 };
    const Color C_TXT_DIM = { 120, 120, 160, 255 };
    const Color C_GREENY   = { 100, 220, 120, 255 };
    const Color C_REDDY    = { 230, 80, 80, 255 };
    const Color C_OVERLAY  = { 0, 0, 0, 150 };
}

// ─── Helpers ───────────────────────────────────────────────────────────
static Rarity rarityFromString(const std::string& s) {
    if (s == "Uncommon")  return Rarity::Uncommon;
    if (s == "Rare")      return Rarity::Rare;
    if (s == "Epic")      return Rarity::Epic;
    if (s == "Legendary") return Rarity::Legendary;
    return Rarity::Common;
}

static Color rarityColor(const std::string& r) {
    if (r == "Uncommon")  return {  76, 175,  80, 255 };
    if (r == "Rare")      return {  33, 150, 243, 255 };
    if (r == "Epic")      return { 156,  39, 176, 255 };
    if (r == "Legendary") return { 255, 193,   7, 255 };
    return { 158, 158, 158, 255 };
}

// ─── UI primitives ─────────────────────────────────────────────────────
struct Button {
    Rectangle rect;
    std::string label;
    bool hovered = false;
};

static bool pointInRect(Vector2 p, Rectangle r) {
    return p.x >= r.x && p.x <= r.x + r.width &&
           p.y >= r.y && p.y <= r.y + r.height;
}

static void drawPanel(float x, float y, float w, float h, Color bg = Col::C_PANEL) {
    DrawRectangleRounded({ x, y, w, h }, 0.06f, 8, bg);
    DrawRectangleRoundedLines({ x, y, w, h }, 0.06f, 8, 1.5f, Col::C_BORDER);
}

static bool drawButton(Button& b, Vector2 mouse, bool clicked,
                       Color base = Col::C_PANEL_HI, Color accent = Col::C_ACCENT) {
    b.hovered = pointInRect(mouse, b.rect);
    Color fill = b.hovered ? accent : base;
    Color txt  = b.hovered ? Col::C_BG_DEEP : Col::C_TXT;
    DrawRectangleRounded(b.rect, 0.25f, 8, fill);
    DrawRectangleRoundedLines(b.rect, 0.25f, 8, 1.5f, Col::C_BORDER);
    int fs = 16;
    int tw = MeasureText(b.label.c_str(), fs);
    DrawText(b.label.c_str(),
             (int)(b.rect.x + b.rect.width / 2 - tw / 2),
             (int)(b.rect.y + b.rect.height / 2 - fs / 2),
             fs, txt);
    return b.hovered && clicked;
}

static int drawWrapped(const std::string& text, int x, int y, int maxWidth,
                       int fontSize, Color color, int lineGap = 6) {
    std::string word, line;
    int cursorY = y;
    auto flush = [&](const std::string& l) {
        DrawText(l.c_str(), x, cursorY, fontSize, color);
        cursorY += fontSize + lineGap;
    };
    for (size_t i = 0; i <= text.size(); ++i) {
        char c = (i < text.size()) ? text[i] : ' ';
        if (c == ' ' || c == '\n') {
            std::string test = line.empty() ? word : line + " " + word;
            if (MeasureText(test.c_str(), fontSize) > maxWidth && !line.empty()) {
                flush(line);
                line = word;
            } else {
                line = test;
            }
            word.clear();
            if (c == '\n') { flush(line); line.clear(); }
        } else {
            word += c;
        }
    }
    if (!line.empty()) flush(line);
    return cursorY;
}

// ─── Network ───────────────────────────────────────────────────────────
static json apiPost(const std::string& endpoint, const json& body) {
    std::string url = std::string(API_BASE) + "/" + endpoint;
    auto r = cpr::Post(
        cpr::Url{ url },
        cpr::Body{ body.dump() },
        cpr::Header{ { "Content-Type", "application/json" } },
        cpr::Timeout{ 4000 }
    );
    if (r.status_code == 200 || r.status_code == 201) {
        return json::parse(r.text, nullptr, false);
    }
    return json::object();
}

static void initPlayer(const std::string& username) {
    // Stable per-install identity so the player returns as themselves.
    std::string deviceId = device::getOrCreate();
    auto res = apiPost("player", {
        { "action", "init" },
        { "username", username },
        { "deviceId", deviceId }
    });
    if (res.contains("playerId")) {
        g_player.id       = res.value("playerId", std::string(""));
        g_player.username = res.value("username", username);
    }
}

static void fetchChapters() {
    auto res = apiPost("chapters", json::object());
    if (!res.contains("chapters")) return;
    g_chapters.clear();
    for (auto& ch : res["chapters"]) {
        Chapter c;
        c.id           = ch.value("id", 0);
        c.name         = ch.value("name", std::string("Chapter"));
        c.levelCap     = ch.value("levelCap", 1);
        c.expMult      = ch.value("expMult", 1.0f);
        c.goldMult     = ch.value("goldMult", 1.0f);
        c.storyText    = ch.value("storyText", std::string(""));
        c.backdropFile = ch.value("backdrop", std::string(""));
        g_chapters.push_back(c);
    }
}

static Texture2D getChapterBackdrop(Chapter& c) {
    if (c.backdrop.id != 0) return c.backdrop;
    if (c.triedLoad)        return c.backdrop;
    c.triedLoad = true;

    const std::string candidates[] = {
        "assets/backdrops/" + c.backdropFile,
        "assets/" + c.backdropFile,
        "assets/backdrops/chapter" + std::to_string(c.id) + ".jpg",
        "assets/backdrops/chapter" + std::to_string(c.id) + ".png",
    };
    for (const auto& path : candidates) {
        if (FileExists(path.c_str())) {
            Texture2D t = LoadTexture(path.c_str());
            if (t.id != 0) {
                SetTextureFilter(t, TEXTURE_FILTER_BILINEAR);
                c.backdrop = t;
                return c.backdrop;
            }
        }
    }
    return c.backdrop;
}

static void drawBackdropCover(Texture2D tex) {
    if (tex.id == 0) {
        DrawRectangleGradientV(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT,
                               { 18, 16, 32, 255 }, { 8, 8, 16, 255 });
        return;
    }
    float sx = (float)SCREEN_WIDTH  / tex.width;
    float sy = (float)SCREEN_HEIGHT / tex.height;
    float scale = std::max(sx, sy);
    float w = tex.width  * scale;
    float h = tex.height * scale;
    float ox = (SCREEN_WIDTH  - w) / 2.0f;
    float oy = (SCREEN_HEIGHT - h) / 2.0f;
    DrawTextureEx(tex, { ox, oy }, 0.0f, scale, WHITE);
}

static void appendStory(const std::string& beat) {
    if (g_storyLog.empty() || g_storyLog.back() != beat) {
        g_storyLog.push_back(beat);
        if (g_storyLog.size() > 40) g_storyLog.erase(g_storyLog.begin());
    }
}

static void applyPlayerJson(const json& res) {
    if (!res.contains("level")) return;
    g_player.level     = res.value("level", g_player.level);
    g_player.exp       = jsonU64(res, "exp",       g_player.exp);
    g_player.gold      = jsonU64(res, "gold",      g_player.gold);
    g_player.gems      = jsonU64(res, "gems",      g_player.gems);
    g_player.expToNext = jsonU64(res, "expToNext", g_player.expToNext);

    if (res.contains("stats")) {
        auto s = res["stats"];
        g_player.stats.health         = s.value("health",         g_player.stats.health);
        g_player.stats.maxHealth      = s.value("maxHealth",      g_player.stats.maxHealth);
        g_player.stats.attack         = s.value("attack",         g_player.stats.attack);
        g_player.stats.defense        = s.value("defense",        g_player.stats.defense);
        g_player.stats.criticalRate   = s.value("criticalRate",   g_player.stats.criticalRate);
        g_player.stats.criticalDamage = s.value("criticalDamage", g_player.stats.criticalDamage);
        g_player.stats.attackSpeed    = s.value("attackSpeed",    g_player.stats.attackSpeed);
    }
}

static void syncPlayer() {
    if (g_player.id.empty()) return;
    auto res = apiPost("player", { { "action", "getState" }, { "playerId", g_player.id } });
    applyPlayerJson(res);
}

// Claim offline/AFK rewards on launch. Server computes elapsed from its own
// clock (clock-cheat proof); we just show the result. Triggers the popup when
// there's a non-trivial reward.
static void claimIdle() {
    if (g_player.id.empty()) return;
    auto res = apiPost("idle", { { "playerId", g_player.id }, { "action", "claim" } });
    if (!res.value("claimed", false)) return;
    g_idleGold    = jsonU64(res, "goldGained", 0);
    g_idleExp     = jsonU64(res, "expGained", 0);
    g_idleSeconds = (long long)res.value("elapsedSeconds", 0);
    if (g_idleGold > 0 || g_idleExp > 0) {
        g_player.gold += g_idleGold;
        g_player.exp  += g_idleExp;
        g_idlePopup = true;
    }
}

// Background sync: HTTP runs off-thread; result is applied on the main
// thread only when ready, so g_player is never written concurrently.
static std::future<json> g_syncFuture;
static bool              g_syncInFlight = false;

static void syncPlayerAsync() {
    if (g_player.id.empty() || g_syncInFlight) return;
    std::string id = g_player.id;
    g_syncInFlight = true;
    g_syncFuture = std::async(std::launch::async, [id]() {
        return apiPost("player", { { "action", "getState" }, { "playerId", id } });
    });
}

static void pollSync() {
    if (!g_syncInFlight) return;
    if (g_syncFuture.wait_for(std::chrono::seconds(0)) == std::future_status::ready) {
        json res = g_syncFuture.get();
        applyPlayerJson(res);
        g_syncInFlight = false;
    }
}

static void requestLoot() {
    if (g_player.id.empty()) return;
    auto res = apiPost("loot", { { "player_id", g_player.id } });

    g_battle.lastLoot = LootDrop{};
    g_battle.lastLoot.dropped = res.value("dropped", false);
    if (!g_battle.lastLoot.dropped) return;

    if (res.contains("loot")) {
        auto l = res["loot"];
        g_battle.lastLoot.armorType     = l.value("armor_type",        std::string("weapon"));
        g_battle.lastLoot.rarity        = l.value("rarity",            std::string("Common"));
        g_battle.lastLoot.seed          = l.value("seed",              (uint32_t)0);
        g_battle.lastLoot.attackBonus   = l.value("attack_bonus",      0);
        g_battle.lastLoot.defenseBonus  = l.value("defense_bonus",     0);
        g_battle.lastLoot.healthBonus   = l.value("health_bonus",      0);
        g_battle.lastLoot.critRateBonus = l.value("crit_rate_bonus",   0);
        g_battle.lastLoot.critDmgBonus  = l.value("crit_damage_bonus", 0);
        g_battle.lastLoot.itemName      = l.value("item_name",         std::string("Unknown Item"));
    }

    InventoryItem item;
    item.itemName     = g_battle.lastLoot.itemName;
    item.armorType    = g_battle.lastLoot.armorType;
    item.rarity       = g_battle.lastLoot.rarity;
    item.attackBonus  = g_battle.lastLoot.attackBonus;
    item.defenseBonus = g_battle.lastLoot.defenseBonus;
    item.healthBonus  = g_battle.lastLoot.healthBonus;
    item.seed         = g_battle.lastLoot.seed;
    g_inventory.push_back(item);

    g_doll.equip({
        g_battle.lastLoot.armorType,
        rarityFromString(g_battle.lastLoot.rarity),
        g_battle.lastLoot.seed
    });
    g_player.equippedNames[g_battle.lastLoot.armorType] = g_battle.lastLoot.itemName;
}

static void startBattle() {
    if (g_player.id.empty() || g_battle.active) return;
    auto res = apiPost("battle", {
        { "playerId",    g_player.id },
        { "chapterId",   g_currentChapter },
        { "playerLevel", g_player.level }
    });
    if (!res.contains("victory")) return;

    g_battle.active       = true;
    g_battle.displayTimer = 0.0f;
    g_battle.enemyLevel   = res.value("enemyLevel", g_player.level);
    g_battle.enemyName    = res.value("enemyName", std::string("Enemy"));
    g_battle.victory      = res.value("victory", false);
    g_battle.damageDealt  = jsonU64(res, "damageDealt", 0);
    g_battle.goldEarned   = jsonU64(res, "goldEarned", 0);
    g_battle.expEarned    = jsonU64(res, "expEarned", 0);
    g_battle.leveledUp    = res.value("levelUp", false);
    g_battle.newLevel     = res.value("newLevel", g_player.level);

    g_player.gold += g_battle.goldEarned;
    g_player.exp  += g_battle.expEarned;
    if (g_battle.leveledUp) g_player.level = g_battle.newLevel;

    if (g_battle.victory) requestLoot();

    g_screen = Screen::BATTLE;
}

// ─── Top bar ───────────────────────────────────────────────────────────
static void drawTopBar() {
    DrawRectangle(0, 0, SCREEN_WIDTH, 44, { 14, 14, 24, 235 });
    DrawRectangle(0, 43, SCREEN_WIDTH, 2, Col::C_BORDER);

    std::string title = g_player.username.empty()
        ? "Connecting..."
        : g_player.username + "   Lv " + std::to_string(g_player.level);
    DrawText(title.c_str(), 18, 13, 18, Col::C_TXT);

    std::string res = "Gold " + fmtnum::formatBigCompact(g_player.gold) +
                      "    Gems " + fmtnum::formatBigCompact(g_player.gems);
    int tw = MeasureText(res.c_str(), 15);
    DrawText(res.c_str(), SCREEN_WIDTH - tw - 18, 14, 15, Col::C_GOLD);
}

// ─── HOME ──────────────────────────────────────────────────────────────
static Button g_navStory   { { 0,0,0,0 }, "STORY" };
static Button g_navShop    { { 0,0,0,0 }, "SHOP" };
static Button g_navSummon  { { 0,0,0,0 }, "SUMMON" };
static Button g_navInv     { { 0,0,0,0 }, "INVENTORY" };
static Button g_navIndex   { { 0,0,0,0 }, "INDEX" };
static Button g_navChapters{ { 0,0,0,0 }, "QUEST" };

static void layoutNav() {
    float bw = 150, bh = 46, gap = 10;
    float x = SCREEN_WIDTH - bw - 18;
    float y = 60;
    g_navChapters.rect = { x, y, bw, bh }; y += bh + gap;
    g_navStory.rect    = { x, y, bw, bh }; y += bh + gap;
    g_navShop.rect     = { x, y, bw, bh }; y += bh + gap;
    g_navSummon.rect   = { x, y, bw, bh }; y += bh + gap;
    g_navInv.rect      = { x, y, bw, bh }; y += bh + gap;
    g_navIndex.rect    = { x, y, bw, bh };
}

static void drawStatChip(const char* label, int value, float x, float y, Color valCol) {
    DrawText(label, (int)x, (int)y, 12, Col::C_TXT_DIM);
    DrawText(TextFormat("%d", value), (int)x + 70, (int)y, 12, valCol);
}

static void drawHome(Vector2 mouse, bool clicked) {
    if (g_currentChapter >= 1 && g_currentChapter <= (int)g_chapters.size())
        drawBackdropCover(getChapterBackdrop(g_chapters[g_currentChapter - 1]));
    else
        drawBackdropCover({ 0 });
    DrawRectangle(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, Col::C_OVERLAY);
    drawTopBar();

    drawPanel(14, 56, 240, 420);
    int sx = 30, sy = 72;
    DrawText("CHARACTER", sx, sy, 14, Col::C_ACCENT_2); sy += 26;

    float hpPct = g_player.stats.maxHealth > 0
        ? (float)g_player.stats.health / g_player.stats.maxHealth : 0.f;
    DrawRectangle(sx, sy, 200, 9, { 40, 40, 60, 255 });
    DrawRectangle(sx, sy, (int)(200 * hpPct), 9, { 220, 80, 80, 255 });
    DrawText(TextFormat("HP %d/%d", g_player.stats.health, g_player.stats.maxHealth),
             sx, sy - 13, 10, { 220, 150, 150, 255 });
    sy += 22;

    uint64_t expNeed = g_player.expToNext > 0 ? g_player.expToNext : 1;
    float expPct = std::min(1.0f, (float)((double)g_player.exp / (double)expNeed));
    DrawRectangle(sx, sy, 200, 9, { 40, 40, 60, 255 });
    DrawRectangle(sx, sy, (int)(200 * expPct), 9, Col::C_GREENY);
    DrawText(TextFormat("EXP  %s / %s",
             fmtnum::formatBigCompact(g_player.exp).c_str(),
             fmtnum::formatBigCompact(expNeed).c_str()),
             sx, sy - 13, 10, Col::C_GREENY);
    sy += 24;

    drawStatChip("ATK", g_player.stats.attack,         sx, sy, Col::C_TXT);  sy += 18;
    drawStatChip("DEF", g_player.stats.defense,        sx, sy, Col::C_TXT);  sy += 18;
    drawStatChip("CR%", g_player.stats.criticalRate,   sx, sy, Col::C_GOLD);  sy += 18;
    drawStatChip("CD%", g_player.stats.criticalDamage, sx, sy, Col::C_GOLD);  sy += 18;
    drawStatChip("SPD", g_player.stats.attackSpeed,    sx, sy, Col::C_TXT);  sy += 26;

    DrawText("EQUIPPED", sx, sy, 12, Col::C_ACCENT_2); sy += 18;
    const char* slots[] = { "weapon", "head", "body", "arms", "legs", "accessory" };
    for (const char* slot : slots) {
        auto it = g_player.equippedNames.find(slot);
        std::string name = (it != g_player.equippedNames.end()) ? it->second : "--";
        if ((int)name.size() > 16) name = name.substr(0, 13) + "...";
        DrawText(TextFormat("%s:", slot), sx, sy, 10, Col::C_TXT_DIM);
        DrawText(name.c_str(), sx + 64, sy, 10,
                 (it != g_player.equippedNames.end()) ? Col::C_TXT : Col::C_TXT_DIM);
        sy += 15;
    }

    drawPanel(280, 90, 600, 520, { 18, 22, 34, 180 });
    g_doll.draw(280 + 300, 90 + 250, 0.95f);

    if (g_currentChapter >= 1 && g_currentChapter <= (int)g_chapters.size()) {
        Chapter& c = g_chapters[g_currentChapter - 1];
        std::string lbl = c.name + "  (Lv cap " + std::to_string(c.levelCap) + ")";
        int tw = MeasureText(lbl.c_str(), 16);
        DrawText(lbl.c_str(), 280 + 300 - tw / 2, 560, 16, Col::C_ACCENT);
    }

    layoutNav();
    if (drawButton(g_navChapters, mouse, clicked, Col::C_PANEL_HI, Col::C_ACCENT))   g_screen = Screen::CHAPTER_SELECT;
    if (drawButton(g_navStory,    mouse, clicked, Col::C_PANEL_HI, Col::C_ACCENT_2)) g_screen = Screen::STORY;
    if (drawButton(g_navShop,     mouse, clicked, Col::C_PANEL_HI, Col::C_GOLD))     g_screen = Screen::SHOP;
    if (drawButton(g_navSummon,   mouse, clicked, Col::C_PANEL_HI, Col::C_ACCENT_2)) g_screen = Screen::SUMMON;
    if (drawButton(g_navInv,      mouse, clicked, Col::C_PANEL_HI, Col::C_ACCENT))   g_screen = Screen::INVENTORY;
    if (drawButton(g_navIndex,    mouse, clicked, Col::C_PANEL_HI, Col::C_ACCENT_2)) g_screen = Screen::INDEX;

    DrawText("Click QUEST to choose a chapter, then fight. ESC quits.",
             18, SCREEN_HEIGHT - 26, 12, Col::C_TXT_DIM);
}

// ─── Back button ───────────────────────────────────────────────────────
static Button g_back { { 18, 56, 120, 40 }, "< BACK" };
static bool drawBack(Vector2 mouse, bool clicked) {
    return drawButton(g_back, mouse, clicked, Col::C_PANEL_HI, Col::C_ACCENT);
}

// ─── CHAPTER SELECT ────────────────────────────────────────────────────
static void drawChapterSelect(Vector2 mouse, bool clicked) {
    if (g_selectedChapter >= 1 && g_selectedChapter <= (int)g_chapters.size())
        drawBackdropCover(getChapterBackdrop(g_chapters[g_selectedChapter - 1]));
    DrawRectangle(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, Col::C_OVERLAY);
    drawTopBar();
    if (drawBack(mouse, clicked)) g_screen = Screen::HOME;

    float lx = 18, ly = 110, lw = 250;
    drawPanel(lx, ly, lw, SCREEN_HEIGHT - ly - 70);
    DrawText("CHAPTERS", (int)lx + 16, (int)ly + 14, 14, Col::C_ACCENT_2);

    float ry = ly + 44;
    for (auto& ch : g_chapters) {
        Rectangle row = { lx + 10, ry, lw - 20, 30 };
        bool hov = pointInRect(mouse, row);
        bool sel = (ch.id == g_selectedChapter);
        if (sel)       DrawRectangleRounded(row, 0.3f, 6, Col::C_PANEL_HI);
        else if (hov)  DrawRectangleRounded(row, 0.3f, 6, { 30, 30, 48, 255 });
        Color tc = sel ? Col::C_ACCENT : (hov ? Col::C_TXT : Col::C_TXT_DIM);
        DrawText(TextFormat("Ch %d  -  Lv %d", ch.id, ch.levelCap),
                 (int)row.x + 10, (int)row.y + 8, 12, tc);
        if (hov && clicked) g_selectedChapter = ch.id;
        ry += 36;
    }

    float dx = lx + lw + 16, dy = 110, dw = SCREEN_WIDTH - dx - 18;
    drawPanel(dx, dy, dw, SCREEN_HEIGHT - dy - 70);
    if (g_selectedChapter >= 1 && g_selectedChapter <= (int)g_chapters.size()) {
        Chapter& c = g_chapters[g_selectedChapter - 1];
        int px = (int)dx + 24, py = (int)dy + 22;
        DrawText(c.name.c_str(), px, py, 24, Col::C_ACCENT); py += 38;
        DrawText(TextFormat("Level Cap: %d", c.levelCap), px, py, 14, Col::C_GREENY); py += 22;
        DrawText(TextFormat("EXP x%.2f   Gold x%.2f", c.expMult, c.goldMult),
                 px, py, 14, Col::C_GOLD); py += 30;
        py = drawWrapped(c.storyText, px, py, (int)dw - 48, 14, Col::C_TXT);
        py += 20;

        Button setBtn  { { (float)px,       (float)py, 200, 44 }, "SET AS CURRENT" };
        Button fightBtn{ { (float)px + 216, (float)py, 200, 44 }, "FIGHT NOW" };
        if (drawButton(setBtn, mouse, clicked, Col::C_PANEL_HI, Col::C_ACCENT_2)) {
            g_currentChapter = c.id;
            appendStory("[" + c.name + "] " + c.storyText);
        }
        if (drawButton(fightBtn, mouse, clicked, Col::C_PANEL_HI, Col::C_GREENY)) {
            g_currentChapter = c.id;
            appendStory("[" + c.name + "] " + c.storyText);
            startBattle();
        }
    }
}

// ─── BATTLE ────────────────────────────────────────────────────────────
static void drawBattle(Vector2 mouse, bool clicked) {
    if (g_currentChapter >= 1 && g_currentChapter <= (int)g_chapters.size())
        drawBackdropCover(getChapterBackdrop(g_chapters[g_currentChapter - 1]));
    DrawRectangle(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, { 0, 0, 0, 170 });
    drawTopBar();

    int cx = SCREEN_WIDTH / 2;
    Color titleCol = g_battle.victory ? Col::C_GREENY : Col::C_REDDY;
    const char* header = g_battle.victory ? "VICTORY" : "DEFEAT";
    int hw = MeasureText(header, 40);
    DrawText(header, cx - hw / 2, 90, 40, titleCol);

    drawPanel(cx - 220, 160, 440, 300);
    int px = cx - 190, py = 185;
    DrawText(g_battle.enemyName.c_str(), px, py, 18, Col::C_TXT); py += 30;
    DrawText(TextFormat("Enemy Level %d", g_battle.enemyLevel), px, py, 13, Col::C_TXT_DIM); py += 30;
    DrawText(TextFormat("Damage Dealt : %s", fmtnum::formatBigCompact(g_battle.damageDealt).c_str()), px, py, 15, { 255, 220, 100, 255 }); py += 24;
    DrawText(TextFormat("Gold Earned  : +%s", fmtnum::formatBigCompact(g_battle.goldEarned).c_str()), px, py, 15, Col::C_GOLD); py += 24;
    DrawText(TextFormat("EXP Earned   : +%s", fmtnum::formatBigCompact(g_battle.expEarned).c_str()), px, py, 15, Col::C_GREENY); py += 24;

    if (g_battle.leveledUp) {
        DrawText(TextFormat("LEVEL UP!  Now Lv %d", g_battle.newLevel),
                 px, py, 15, Col::C_ACCENT); py += 28;
    }
    py += 4;
    if (g_battle.lastLoot.dropped) {
        Color rc = rarityColor(g_battle.lastLoot.rarity);
        DrawText("Loot:", px, py, 13, Col::C_ACCENT_2); py += 18;
        DrawText(TextFormat("%s [%s]", g_battle.lastLoot.itemName.c_str(),
                            g_battle.lastLoot.rarity.c_str()), px, py, 12, rc);
    } else {
        DrawText("No loot dropped.", px, py, 12, Col::C_TXT_DIM);
    }

    Button again { { (float)cx - 220, 480, 210, 46 }, "FIGHT AGAIN" };
    Button home  { { (float)cx + 10,  480, 210, 46 }, "RETURN HOME" };
    if (drawButton(again, mouse, clicked, Col::C_PANEL_HI, Col::C_GREENY)) {
        g_battle.active = false;
        startBattle();
    }
    if (drawButton(home, mouse, clicked, Col::C_PANEL_HI, Col::C_ACCENT)) {
        g_battle.active = false;
        g_screen = Screen::HOME;
    }
}

// ─── SHOP ──────────────────────────────────────────────────────────────
struct ShopItem { std::string name; int cost; std::string desc; };
static const std::vector<ShopItem> g_shopItems = {
    { "Health Tonic",      150, "Restore HP between battles." },
    { "Forged Blade",      600, "+25 ATK weapon." },
    { "Warding Plate",     800, "+30 DEF body armor." },
    { "Summon Ticket x1", 1200, "One guaranteed summon." },
    { "EXP Elixir",        500, "Small EXP boost." },
};

static void drawShop(Vector2 mouse, bool clicked) {
    drawBackdropCover({ 0 });
    DrawRectangle(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, Col::C_OVERLAY);
    drawTopBar();
    if (drawBack(mouse, clicked)) g_screen = Screen::HOME;

    DrawText("SHOP", SCREEN_WIDTH / 2 - 40, 60, 28, Col::C_GOLD);
    DrawText("Spend gold on consumables and gear. (Purchasing is a placeholder for now.)",
             160, 100, 13, Col::C_TXT_DIM);

    float cardW = 340, cardH = 110, gap = 20;
    float startX = 160, startY = 140;
    int perRow = 3;
    for (size_t i = 0; i < g_shopItems.size(); ++i) {
        int row = (int)i / perRow;
        int col = (int)i % perRow;
        float x = startX + col * (cardW + gap);
        float y = startY + row * (cardH + gap);
        drawPanel(x, y, cardW, cardH);
        const ShopItem& it = g_shopItems[i];
        DrawText(it.name.c_str(), (int)x + 16, (int)y + 14, 18, Col::C_TXT);
        drawWrapped(it.desc, (int)x + 16, (int)y + 42, (int)cardW - 32, 12, Col::C_TXT_DIM);

        Button buy { { x + cardW - 110, y + cardH - 42, 94, 30 },
                     "BUY " + std::to_string(it.cost) };
        bool canAfford = g_player.gold >= it.cost;
        Color base = canAfford ? Col::C_PANEL_HI : Color{ 30, 30, 40, 255 };
        Color acc  = canAfford ? Col::C_GOLD : Col::C_TXT_DIM;
        if (drawButton(buy, mouse, clicked, base, acc) && canAfford) {
            g_player.gold -= it.cost;
        }
    }
}

// ─── INVENTORY ─────────────────────────────────────────────────────────
static void drawInventory(Vector2 mouse, bool clicked) {
    drawBackdropCover({ 0 });
    DrawRectangle(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, Col::C_OVERLAY);
    drawTopBar();
    if (drawBack(mouse, clicked)) g_screen = Screen::HOME;

    DrawText("INVENTORY", SCREEN_WIDTH / 2 - 80, 60, 28, Col::C_ACCENT);

    if (g_inventory.empty()) {
        DrawText("No items yet. Win battles to collect loot.",
                 SCREEN_WIDTH / 2 - 180, SCREEN_HEIGHT / 2, 16, Col::C_TXT_DIM);
        return;
    }

    float cardW = 220, cardH = 96, gap = 16;
    float startX = 100, startY = 120;
    int perRow = 5;
    for (size_t i = 0; i < g_inventory.size(); ++i) {
        int row = (int)i / perRow;
        int col = (int)i % perRow;
        float x = startX + col * (cardW + gap);
        float y = startY + row * (cardH + gap);
        if (y > SCREEN_HEIGHT - 120) break;
        const InventoryItem& it = g_inventory[i];
        Color rc = rarityColor(it.rarity);
        drawPanel(x, y, cardW, cardH);
        DrawRectangle((int)x, (int)y, 4, (int)cardH, rc);
        std::string nm = it.itemName.size() > 22 ? it.itemName.substr(0, 19) + "..." : it.itemName;
        DrawText(nm.c_str(), (int)x + 14, (int)y + 10, 13, Col::C_TXT);
        DrawText(TextFormat("[%s] %s", it.rarity.c_str(), it.armorType.c_str()),
                 (int)x + 14, (int)y + 30, 11, rc);
        DrawText(TextFormat("ATK +%d  DEF +%d", it.attackBonus, it.defenseBonus),
                 (int)x + 14, (int)y + 48, 11, Col::C_TXT_DIM);

        Button eq { { x + 14, y + cardH - 28, 90, 22 }, "EQUIP" };
        if (drawButton(eq, mouse, clicked, Col::C_PANEL_HI, Col::C_ACCENT)) {
            g_doll.equip({ it.armorType, rarityFromString(it.rarity), it.seed });
            g_player.equippedNames[it.armorType] = it.itemName;
        }
    }
}

// ─── SUMMON ────────────────────────────────────────────────────────────
static std::string g_lastSummon;
static float        g_summonFlash = 0.f;

static void doSummon() {
    static const char* pool[] = {
        "Resonance Swordsman (SR)", "Twisted Zealot (R)", "Aberrant Chimera (SSR)",
        "Echo Lord (SSR)", "Wandering Cultivator (R)", "Voidtouched Acolyte (SR)"
    };
    int idx = GetRandomValue(0, 5);
    g_lastSummon = pool[idx];
    g_summonFlash = 1.0f;
    appendStory("Summoned: " + g_lastSummon);
}

static void drawSummon(Vector2 mouse, bool clicked) {
    drawBackdropCover({ 0 });
    DrawRectangleGradientV(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT,
                           { 20, 10, 36, 220 }, { 6, 6, 14, 230 });
    drawTopBar();
    if (drawBack(mouse, clicked)) g_screen = Screen::HOME;

    DrawText("SUMMON", SCREEN_WIDTH / 2 - 60, 70, 30, Col::C_ACCENT_2);
    DrawText("Channel resonance to call an ally. (Rates are placeholder.)",
             SCREEN_WIDTH / 2 - 220, 110, 13, Col::C_TXT_DIM);

    int ccx = SCREEN_WIDTH / 2, ccy = 330;
    DrawCircleLines(ccx, ccy, 120, Col::C_ACCENT_2);
    DrawCircleLines(ccx, ccy, 90,  Col::C_ACCENT);
    DrawCircleLines(ccx, ccy, 60,  { 156, 136, 255, 120 });
    DrawText("?", ccx - 12, ccy - 24, 48, Col::C_ACCENT);

    if (g_summonFlash > 0.f && !g_lastSummon.empty()) {
        int tw = MeasureText(g_lastSummon.c_str(), 22);
        unsigned char a = (unsigned char)(255 * std::min(1.0f, g_summonFlash));
        DrawText(g_lastSummon.c_str(), ccx - tw / 2, ccy + 150, 22, { 0, 217, 255, a });
    }

    Button s1 { { (float)ccx - 220, 520, 200, 50 }, "SUMMON x1  (100 Gems)" };
    Button s10{ { (float)ccx + 20,  520, 200, 50 }, "SUMMON x10 (900 Gems)" };
    if (drawButton(s1,  mouse, clicked, Col::C_PANEL_HI, Col::C_ACCENT))   doSummon();
    if (drawButton(s10, mouse, clicked, Col::C_PANEL_HI, Col::C_ACCENT_2)) doSummon();
}

// ─── INDEX ─────────────────────────────────────────────────────────────
static void drawIndex(Vector2 mouse, bool clicked) {
    drawBackdropCover({ 0 });
    DrawRectangle(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, Col::C_OVERLAY);
    drawTopBar();
    if (drawBack(mouse, clicked)) g_screen = Screen::HOME;

    DrawText("INDEX", SCREEN_WIDTH / 2 - 46, 60, 28, Col::C_ACCENT_2);
    DrawText("Codex of chapters, enemies, and lore discovered so far.",
             160, 100, 13, Col::C_TXT_DIM);

    float x = 160, y = 140, w = SCREEN_WIDTH - 320;
    drawPanel(x, y, w, SCREEN_HEIGHT - y - 70);
    int px = (int)x + 20, py = (int)y + 18;
    DrawText("CHAPTERS UNLOCKED", px, py, 14, Col::C_ACCENT); py += 24;
    for (auto& c : g_chapters) {
        bool reached = c.id <= g_currentChapter;
        DrawText(TextFormat("%2d. %s  %s", c.id, c.name.c_str(),
                            reached ? "" : "(locked)"),
                 px, py, 13, reached ? Col::C_TXT : Col::C_TXT_DIM);
        py += 20;
        if (py > SCREEN_HEIGHT - 100) break;
    }
}

// ─── STORY ─────────────────────────────────────────────────────────────
static void drawStory(Vector2 mouse, bool clicked) {
    drawBackdropCover({ 0 });
    DrawRectangle(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, Col::C_OVERLAY);
    drawTopBar();
    if (drawBack(mouse, clicked)) g_screen = Screen::HOME;

    DrawText("STORY  /  MAIN QUEST", SCREEN_WIDTH / 2 - 140, 60, 28, Col::C_ACCENT_2);

    float x = 140, y = 110, w = SCREEN_WIDTH - 280;
    drawPanel(x, y, w, SCREEN_HEIGHT - y - 70);
    int px = (int)x + 24, py = (int)y + 20;

    if (g_storyLog.empty()) {
        DrawText("Your tale has not yet begun. Enter a chapter to start the story.",
                 px, py, 14, Col::C_TXT_DIM);
        return;
    }
    DrawText("STORY SUMMARY", px, py, 14, Col::C_ACCENT); py += 26;
    for (auto& beat : g_storyLog) {
        py = drawWrapped("- " + beat, px, py, (int)w - 48, 13, Col::C_TXT, 5);
        py += 6;
        if (py > SCREEN_HEIGHT - 90) break;
    }
}

// ─── Main ──────────────────────────────────────────────────────────────
int main(void) {
    SetConfigFlags(FLAG_MSAA_4X_HINT);
    InitWindow(SCREEN_WIDTH, SCREEN_HEIGHT, "Cultivation AFK Realm: Divine Descent");
    SetTargetFPS(60);
    SetExitKey(0);

    initPlayer("TestPlayer");
    fetchChapters();
    syncPlayer();
    claimIdle();   // offline rewards "while you were away"

    if (!g_chapters.empty())
        appendStory("[" + g_chapters[0].name + "] " + g_chapters[0].storyText);

    while (!WindowShouldClose()) {
        float dt = GetFrameTime();
        Vector2 mouse = GetMousePosition();
        bool clicked = IsMouseButtonPressed(MOUSE_BUTTON_LEFT);

        if (IsKeyPressed(KEY_ESCAPE)) {
            if (g_idlePopup) { g_idlePopup = false; }
            else if (g_screen == Screen::HOME) break;
            else { g_screen = Screen::HOME; g_battle.active = false; }
        }

        if (!g_idlePopup && g_screen == Screen::HOME) {
            if (IsKeyPressed(KEY_Q)) g_screen = Screen::CHAPTER_SELECT;
            if (IsKeyPressed(KEY_I)) g_screen = Screen::INVENTORY;
            if (IsKeyPressed(KEY_SPACE)) startBattle();
        }
        if (g_screen == Screen::CHAPTER_SELECT) {
            if (IsKeyPressed(KEY_UP))   g_selectedChapter = std::max(1, g_selectedChapter - 1);
            if (IsKeyPressed(KEY_DOWN)) g_selectedChapter =
                std::min((int)g_chapters.size(), g_selectedChapter + 1);
        }

        g_syncTimer += dt;
        if (g_syncTimer >= SYNC_INTERVAL) { syncPlayerAsync(); g_syncTimer = 0.f; }
        pollSync();
        if (g_summonFlash > 0.f) g_summonFlash -= dt * 0.4f;

        BeginDrawing();
        ClearBackground(Col::C_BG_DEEP);

        switch (g_screen) {
            case Screen::HOME:           drawHome(mouse, clicked);          break;
            case Screen::CHAPTER_SELECT: drawChapterSelect(mouse, clicked); break;
            case Screen::BATTLE:         drawBattle(mouse, clicked);        break;
            case Screen::SHOP:           drawShop(mouse, clicked);          break;
            case Screen::INVENTORY:      drawInventory(mouse, clicked);     break;
            case Screen::SUMMON:         drawSummon(mouse, clicked);        break;
            case Screen::INDEX:          drawIndex(mouse, clicked);         break;
            case Screen::STORY:          drawStory(mouse, clicked);         break;
        }

        // "While you were away" popup overlays everything; click/key dismisses.
        if (g_idlePopup) {
            DrawRectangle(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, { 0, 0, 0, 170 });
            int pw = 460, ph = 230;
            int px = (SCREEN_WIDTH - pw) / 2, py = (SCREEN_HEIGHT - ph) / 2;
            drawPanel(px, py, pw, ph);
            int cx = SCREEN_WIDTH / 2;
            const char* title = "While You Were Away";
            DrawText(title, cx - MeasureText(title, 26) / 2, py + 26, 26, Col::C_ACCENT);

            long long hrs = g_idleSeconds / 3600, mins = (g_idleSeconds % 3600) / 60;
            std::string away = "Away for " + std::to_string(hrs) + "h " + std::to_string(mins) + "m";
            DrawText(away.c_str(), cx - MeasureText(away.c_str(), 15) / 2, py + 70, 15, Col::C_TXT_DIM);

            std::string g = "Gold  +" + fmtnum::formatBigCompact(g_idleGold);
            std::string e = "EXP   +" + fmtnum::formatBigCompact(g_idleExp);
            DrawText(g.c_str(), cx - 90, py + 110, 20, Col::C_GOLD);
            DrawText(e.c_str(), cx - 90, py + 140, 20, Col::C_GREENY);

            int bw = 160, bh = 38, bx = cx - bw / 2, by = py + ph - 56;
            bool hov = mouse.x >= bx && mouse.x <= bx + bw && mouse.y >= by && mouse.y <= by + bh;
            DrawRectangle(bx, by, bw, bh, hov ? Col::C_PANEL_HI : Col::C_PANEL);
            DrawRectangleLines(bx, by, bw, bh, Col::C_ACCENT);
            const char* ct = "Collect";
            DrawText(ct, cx - MeasureText(ct, 18) / 2, by + 10, 18, Col::C_TXT);
            if ((clicked && hov) || IsKeyPressed(KEY_ENTER) || IsKeyPressed(KEY_SPACE))
                g_idlePopup = false;
        }

        EndDrawing();
    }

    // Make sure no background sync is still touching memory we're freeing.
    if (g_syncInFlight && g_syncFuture.valid()) g_syncFuture.wait();

    for (auto& c : g_chapters)
        if (c.backdrop.id != 0) UnloadTexture(c.backdrop);
    g_doll.unload();
    CloseWindow();
    return 0;
}
