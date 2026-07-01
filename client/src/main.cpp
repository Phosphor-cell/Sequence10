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
    HOME, CHAPTER_SELECT, BATTLE, SHOP, INVENTORY, SUMMON, INDEX, STORY, HEROES, TEAM
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

// ─── Hero roster + teams ───────────────────────────────────────────────
struct Hero {
    std::string id, className, tier, theme, rarity, alignment, element;
    int health = 0, attack = 0, defense = 0;
    int level = 1;
    int starLevel = 1;                      // 1..6; raised via shard star-up
    bool inParty = false;
    int  partySlot = -1;                    // 0..4 when in party, -1 when benched
};
static std::vector<Hero> g_heroes;          // owned roster
static int  g_heroTab = 0;                  // 0=All 1=Medieval 2=XianxiaN 3=XianxiaH 4=VictorianN 5=VictorianH
static std::string g_teamSlots[5];          // hero ids in the active team (mirrors server in_party/party_slot)
static int  g_teamPickPos = -1;             // which team slot we're assigning, -1 = none
static bool g_heroesFetched = false;
static int  g_invTab = 0;                   // INVENTORY tabs: 0 = Gear, 1 = Party
static std::map<std::string, int> g_heroShards; // class_name -> shard balance (for star-up UI)

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

// Transient on-screen status/error message. Renders on top of every screen
// (see drawToast in the main loop) so silent failures -- a guard clause that
// returned early, an API call that failed or timed out -- are never invisible
// to the player the way "SET AS CURRENT" and "FIGHT NOW" silently were.
static std::string g_toastMsg;
static float       g_toastTimer = 0.0f;
static Color       g_toastColor = Col::C_REDDY;
static void showToast(const std::string& msg, Color color = Col::C_REDDY) {
    g_toastMsg = msg;
    g_toastColor = color;
    g_toastTimer = 3.0f;
}
static void drawToast() {
    if (g_toastTimer <= 0.0f || g_toastMsg.empty()) return;
    int fs = 16;
    int tw = MeasureText(g_toastMsg.c_str(), fs);
    int pw = tw + 40, ph = 44;
    int px = (SCREEN_WIDTH - pw) / 2, py = 92;
    // fade out over the last second
    unsigned char a = (unsigned char)(g_toastTimer < 1.0f ? 255 * g_toastTimer : 255);
    Color bg = { 22, 22, 35, (unsigned char)(a * 0.92f) };
    Color border = g_toastColor; border.a = a;
    Color txt = Col::C_TXT; txt.a = a;
    DrawRectangleRounded({ (float)px, (float)py, (float)pw, (float)ph }, 0.25f, 8, bg);
    DrawRectangleRoundedLines({ (float)px, (float)py, (float)pw, (float)ph }, 0.25f, 8, 1.5f, border);
    DrawText(g_toastMsg.c_str(), px + 20, py + ph / 2 - fs / 2, fs, txt);
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

// ─── Hero sprite cache (graceful: art appears when the file exists) ─────
// Looks for assets/heroes/<classname>.png (lowercased, spaces/hyphens kept as
// a slug). If found, caches and returns the texture; otherwise returns a
// 0-id texture and the UI falls back to the colored card. This lets you drop
// in Leonardo art one class at a time — present classes show their sprite,
// missing ones (e.g. tiers 4-5 not generated yet) keep the placeholder card.
static std::map<std::string, Texture2D> g_heroSprites;   // className -> texture
static std::map<std::string, bool>      g_heroSpriteTried;

static std::string classSlug(const std::string& className) {
    std::string s;
    for (char c : className) {
        if (c == ' ') s += '_';
        else s += (char)tolower((unsigned char)c);
    }
    return s; // "Shadow-Dancer" -> "shadow-dancer", "Beast-Master" -> "beast-master"
}

// Returns a sprite texture for the class, or {0} if none exists yet.
static Texture2D heroSprite(const std::string& className) {
    auto it = g_heroSprites.find(className);
    if (it != g_heroSprites.end()) return it->second;
    if (g_heroSpriteTried[className]) return Texture2D{ 0 };
    g_heroSpriteTried[className] = true;

    std::string slug = classSlug(className);
    const std::string candidates[] = {
        "assets/heroes/" + slug + ".png",
        "assets/heroes/" + slug + ".jpg",
    };
    for (const auto& path : candidates) {
        if (FileExists(path.c_str())) {
            Texture2D t = LoadTexture(path.c_str());
            if (t.id != 0) {
                SetTextureFilter(t, TEXTURE_FILTER_BILINEAR);
                g_heroSprites[className] = t;
                return t;
            }
        }
    }
    return Texture2D{ 0 };
}

// draw a hero sprite fitted into a box, or return false if no art exists.
static bool drawHeroSprite(const std::string& className, Rectangle box) {
    Texture2D t = heroSprite(className);
    if (t.id == 0) return false;
    float scale = std::min(box.width / t.width, box.height / t.height);
    float w = t.width * scale, h = t.height * scale;
    float ox = box.x + (box.width - w) / 2, oy = box.y + (box.height - h) / 2;
    DrawTextureEx(t, { ox, oy }, 0.0f, scale, WHITE);
    return true;
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
                TraceLog(LOG_INFO, "Backdrop loaded: %s", path.c_str());
                return c.backdrop;
            }
        }
    }
    // Nothing matched — log what we tried so this isn't a silent failure.
    TraceLog(LOG_WARNING, "Backdrop NOT found for chapter %d (cwd=%s). Tried: %s",
             c.id, GetWorkingDirectory(), candidates[0].c_str());
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

// ─── Hero / party networking ───────────────────────────────────────────
// The roster (each hero's in_party / party_slot) is the single source of truth.
// g_teamSlots is just a local mirror, rebuilt from the roster after every fetch
// so the UI and the server can never drift apart.
static void rebuildTeamSlotsFromRoster() {
    for (int i = 0; i < 5; i++) g_teamSlots[i].clear();
    for (auto& h : g_heroes)
        if (h.inParty && h.partySlot >= 0 && h.partySlot < 5)
            g_teamSlots[h.partySlot] = h.id;
}

// Forward declaration: fetchHeroes() calls this, but it's defined further down.
static void fetchHeroShards();

static void fetchHeroes() {
    if (g_player.id.empty()) return;
    auto res = apiPost("heroes", { { "playerId", g_player.id }, { "action", "list" } });
    g_heroes.clear();
    if (res.contains("heroes") && res["heroes"].is_array()) {
        for (auto& h : res["heroes"]) {
            Hero hero;
            hero.id        = h.value("id", std::string(""));
            hero.className = h.value("class_name", std::string("Unknown"));
            hero.tier      = h.value("tier", std::string("mortal"));
            hero.theme     = h.value("theme", std::string("medieval"));
            hero.rarity    = h.value("rarity", std::string("Common"));
            hero.alignment = h.value("alignment", std::string("neutral"));
            hero.element   = h.value("element", std::string("neutral"));
            hero.level     = h.value("level", 1);
            hero.starLevel = h.value("star_level", 1);
            hero.health    = h.value("health", 0);
            hero.attack    = h.value("attack", 0);
            hero.defense   = h.value("defense", 0);
            hero.inParty   = h.value("in_party", false);
            // party_slot is null when benched — value() only defaults on a MISSING
            // key, not a null one, so read it explicitly to avoid a type throw.
            hero.partySlot = -1;
            if (h.contains("party_slot") && h["party_slot"].is_number_integer())
                hero.partySlot = h["party_slot"].get<int>();
            g_heroes.push_back(hero);
        }
    }
    rebuildTeamSlotsFromRoster();
    g_heroesFetched = true;
    fetchHeroShards();
}

static void summonHeroes(int count) {
    if (g_player.id.empty()) return;
    auto res = apiPost("heroes", { { "playerId", g_player.id }, { "action", "summon" }, { "count", count } });
    if (res.contains("summoned")) {
        int n = (int)res["summoned"].size();
        appendStory("Summoned " + std::to_string(n) + " hero(es).");
        fetchHeroes();   // refresh roster
    } else if (res.contains("error")) {
        appendStory("Summon failed: " + res.value("error", std::string("unknown")));
    }
}

// Place one hero into a party slot (server kicks out whoever was there).
static void equipHeroToSlot(const std::string& heroId, int slot) {
    if (g_player.id.empty() || heroId.empty() || slot < 0 || slot >= 5) return;
    apiPost("heroes", { { "playerId", g_player.id }, { "action", "equip" },
                        { "heroId", heroId }, { "slot", slot } });
    fetchHeroes();   // re-pull truth (also rebuilds g_teamSlots)
}

// Bench a hero by slot or by id.
static void unequipSlot(int slot) {
    if (g_player.id.empty() || slot < 0 || slot >= 5) return;
    apiPost("heroes", { { "playerId", g_player.id }, { "action", "unequip" }, { "slot", slot } });
    fetchHeroes();
}
static void unequipHero(const std::string& heroId) {
    if (g_player.id.empty() || heroId.empty()) return;
    apiPost("heroes", { { "playerId", g_player.id }, { "action", "unequip" }, { "heroId", heroId } });
    fetchHeroes();
}

// Pull the player's hero-shard balances (class_name -> count), used by the
// star-up button to show "have X / need Y" and grey out when unaffordable.
static void fetchHeroShards() {
    if (g_player.id.empty()) return;
    auto res = apiPost("heroes", { { "playerId", g_player.id }, { "action", "shards" } });
    g_heroShards.clear();
    if (res.contains("shards") && res["shards"].is_array()) {
        for (auto& s : res["shards"]) {
            g_heroShards[s.value("class_name", std::string(""))] = s.value("shards", 0);
        }
    }
}

// Spend shards to raise one hero's star level by 1 (server validates cost
// and ownership; this just calls it and refreshes truth from the response).
static void starUpHero(const std::string& heroId) {
    if (g_player.id.empty() || heroId.empty()) return;
    auto res = apiPost("heroes", { { "playerId", g_player.id }, { "action", "starUp" }, { "heroId", heroId } });
    if (res.value("ok", false)) {
        appendStory("Star-up! " + res["hero"].value("class_name", std::string("Hero")) +
                    " is now " + std::to_string(res["hero"].value("star_level", 1)) + "-star.");
        fetchHeroes();
        fetchHeroShards();
    } else if (res.contains("error")) {
        std::string err = res.value("error", std::string("unknown"));
        if (err == "insufficient shards") {
            appendStory("Not enough shards: need " + std::to_string(res.value("need", 0)) +
                        ", have " + std::to_string(res.value("have", 0)) + ".");
        } else if (err == "hero already at max star level") {
            appendStory("Already at max star level.");
        } else {
            appendStory("Star-up failed: " + err);
        }
    }
}

// Back-compat shims for the existing HEROES/TEAM screens: both now route through
// the real `heroes` endpoint instead of the (never-implemented) `team` one.
static void saveActiveTeam() {
    if (g_player.id.empty()) return;
    json slots = json::array();
    for (int i = 0; i < 5; i++)
        slots.push_back(g_teamSlots[i].empty() ? json(nullptr) : json(g_teamSlots[i]));
    apiPost("heroes", { { "playerId", g_player.id }, { "action", "setParty" }, { "slots", slots } });
    fetchHeroes();
}
static void loadActiveTeam() {
    if (!g_heroesFetched) fetchHeroes();
    else rebuildTeamSlotsFromRoster();
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
    if (g_player.id.empty()) {
        showToast("Not connected yet -- please wait a moment and try again.");
        return;
    }
    if (g_battle.active) {
        showToast("A battle is already in progress.");
        return;
    }
    auto res = apiPost("battle", {
        { "playerId",    g_player.id },
        { "chapterId",   g_currentChapter },
        { "playerLevel", g_player.level }
    });
    if (!res.contains("victory")) {
        showToast("Couldn't reach the server -- check your connection and try again.");
        return;
    }

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
static Button g_navHeroes  { { 0,0,0,0 }, "HEROES" };
static Button g_navInv     { { 0,0,0,0 }, "INVENTORY" };
static Button g_navIndex   { { 0,0,0,0 }, "INDEX" };
static Button g_navChapters{ { 0,0,0,0 }, "QUEST" };

static void layoutNav() {
    float bw = 150, bh = 44, gap = 8;
    float x = SCREEN_WIDTH - bw - 18;
    float y = 60;
    g_navChapters.rect = { x, y, bw, bh }; y += bh + gap;
    g_navStory.rect    = { x, y, bw, bh }; y += bh + gap;
    g_navShop.rect     = { x, y, bw, bh }; y += bh + gap;
    g_navSummon.rect   = { x, y, bw, bh }; y += bh + gap;
    g_navHeroes.rect   = { x, y, bw, bh }; y += bh + gap;
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
    if (drawButton(g_navHeroes,   mouse, clicked, Col::C_PANEL_HI, Col::C_ACCENT_2)) { g_heroesFetched = false; g_screen = Screen::HEROES; }
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
        bool isCurrent = (ch.id == g_currentChapter);
        if (sel)       DrawRectangleRounded(row, 0.3f, 6, Col::C_PANEL_HI);
        else if (hov)  DrawRectangleRounded(row, 0.3f, 6, { 30, 30, 48, 255 });
        // Gold outline marks the ACTIVE chapter, independent of what you're
        // currently browsing/previewing (sel) -- these can differ.
        if (isCurrent) DrawRectangleRoundedLines(row, 0.3f, 6, 2.0f, Col::C_GOLD);
        Color tc = sel ? Col::C_ACCENT : (hov ? Col::C_TXT : Col::C_TXT_DIM);
        DrawText(TextFormat("Ch %d  -  Lv %d", ch.id, ch.levelCap),
                 (int)row.x + 10, (int)row.y + 8, 12, tc);
        if (isCurrent) DrawText("CURRENT", (int)(row.x + row.width - 60), (int)row.y + 9, 10, Col::C_GOLD);
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

        bool alreadyCurrent = (c.id == g_currentChapter);
        if (alreadyCurrent) {
            // Static badge instead of a button -- unmistakable confirmation
            // that this chapter IS the active one (no click needed/possible).
            Rectangle badge = { (float)px, (float)py, 200, 44 };
            DrawRectangleRounded(badge, 0.25f, 8, Col::C_PANEL);
            DrawRectangleRoundedLines(badge, 0.25f, 8, 1.5f, Col::C_GOLD);
            DrawText("CURRENT CHAPTER", (int)px + 16, (int)py + 15, 13, Col::C_GOLD);
        } else {
            Button setBtn{ { (float)px, (float)py, 200, 44 }, "SET AS CURRENT" };
            if (drawButton(setBtn, mouse, clicked, Col::C_PANEL_HI, Col::C_ACCENT_2)) {
                g_currentChapter = c.id;
                appendStory("[" + c.name + "] " + c.storyText);
            }
        }
        Button fightBtn{ { (float)px + 216, (float)py, 200, 44 }, "FIGHT NOW" };
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

// ─── INVENTORY (tabbed: Gear | Party) ──────────────────────────────────
static void drawInventoryParty(Vector2 mouse, bool clicked);   // defined after the hero helpers below

static void drawInventoryGear(Vector2 mouse, bool clicked, float contentY) {
    if (g_inventory.empty()) {
        DrawText("No items yet. Win battles to collect loot.",
                 SCREEN_WIDTH / 2 - 180, SCREEN_HEIGHT / 2, 16, Col::C_TXT_DIM);
        return;
    }
    float cardW = 220, cardH = 96, gap = 16;
    float startX = 100, startY = contentY;
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

static void drawInventory(Vector2 mouse, bool clicked) {
    drawBackdropCover({ 0 });
    DrawRectangle(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, Col::C_OVERLAY);
    drawTopBar();
    if (drawBack(mouse, clicked)) { g_teamPickPos = -1; g_screen = Screen::HOME; }

    DrawText("INVENTORY", SCREEN_WIDTH / 2 - 80, 56, 28, Col::C_ACCENT);

    // Tabs: Gear | Party
    const char* tabs[2] = { "Gear", "Party" };
    int tx = 100, ty = 96;
    for (int i = 0; i < 2; i++) {
        int tw = MeasureText(tabs[i], 16) + 36;
        Rectangle tab = { (float)tx, (float)ty, (float)tw, 32 };
        bool hov = CheckCollisionPointRec(mouse, tab);
        bool sel = (g_invTab == i);
        DrawRectangleRec(tab, sel ? Col::C_ACCENT : (hov ? Col::C_PANEL_HI : Col::C_PANEL));
        DrawRectangleLinesEx(tab, 1, sel ? Col::C_ACCENT : Col::C_BORDER);
        DrawText(tabs[i], tx + 18, ty + 8, 16, sel ? Col::C_BG_DEEP : Col::C_TXT);
        if (clicked && hov) { g_invTab = i; g_teamPickPos = -1; }
        tx += tw + 8;
    }

    if (g_invTab == 0) drawInventoryGear(mouse, clicked, 150.f);
    else               drawInventoryParty(mouse, clicked);
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

// ─── HEROES (tabbed roster) ────────────────────────────────────────────
static const char* HERO_TABS[]   = { "All", "Medieval", "Xianxia", "Corrupted", "Victorian", "Eldritch" };
// maps each tab to the DB theme string it filters (tab 0 = All). Theme is the
// setting/aesthetic axis, separate from the mortal/heroic/angelic/divine power tier.
static const char* TAB_THEME[]   = { "", "medieval", "xianxia_normal", "xianxia_horror", "victorian_normal", "victorian_horror" };
static bool heroPassesTab(const Hero& h) {
    if (g_heroTab == 0) return true;
    return h.theme == TAB_THEME[g_heroTab];
}

static void drawHeroes(Vector2 mouse, bool clicked) {
    drawBackdropCover({ 0 });
    DrawRectangleGradientV(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, { 14, 14, 26, 220 }, { 6, 6, 14, 230 });
    drawTopBar();
    if (drawBack(mouse, clicked)) g_screen = Screen::HOME;

    if (!g_heroesFetched) fetchHeroes();

    DrawText("HEROES", SCREEN_WIDTH / 2 - 55, 64, 28, Col::C_ACCENT_2);

    // Summon buttons (top right of content)
    Rectangle s1 = { SCREEN_WIDTH - 230.f, 60, 100, 30 };
    Rectangle s10 = { SCREEN_WIDTH - 120.f, 60, 100, 30 };
    bool h1 = CheckCollisionPointRec(mouse, s1), h10 = CheckCollisionPointRec(mouse, s10);
    DrawRectangleRec(s1, h1 ? Col::C_PANEL_HI : Col::C_PANEL); DrawRectangleLinesEx(s1, 1, Col::C_ACCENT_2);
    DrawText("Summon x1", (int)s1.x + 10, (int)s1.y + 8, 13, Col::C_TXT);
    DrawRectangleRec(s10, h10 ? Col::C_PANEL_HI : Col::C_PANEL); DrawRectangleLinesEx(s10, 1, Col::C_GOLD);
    DrawText("Summon x10", (int)s10.x + 8, (int)s10.y + 8, 13, Col::C_GOLD);
    if (clicked && h1)  summonHeroes(1);
    if (clicked && h10) summonHeroes(10);

    // Tabs
    int tx = 40, ty = 104;
    for (int i = 0; i < 6; i++) {
        int tw = MeasureText(HERO_TABS[i], 14) + 24;
        Rectangle tab = { (float)tx, (float)ty, (float)tw, 28 };
        bool hov = CheckCollisionPointRec(mouse, tab);
        bool sel = (g_heroTab == i);
        DrawRectangleRec(tab, sel ? Col::C_ACCENT : (hov ? Col::C_PANEL_HI : Col::C_PANEL));
        DrawText(HERO_TABS[i], tx + 12, ty + 7, 14, sel ? Col::C_BG_DEEP : Col::C_TXT);
        if (clicked && hov) g_heroTab = i;
        tx += tw + 6;
    }

    // Grid of hero cards (wider to fit a sprite thumbnail on the left)
    int gx = 40, gy = 144, cw = 250, ch = 92, col = 0;
    int perRow = (SCREEN_WIDTH - 80) / (cw + 12);
    int shown = 0;
    for (auto& h : g_heroes) {
        if (!heroPassesTab(h)) continue;
        int px = gx + col * (cw + 12);
        int py = gy + (shown / perRow) * (ch + 12);
        Rectangle card = { (float)px, (float)py, (float)cw, (float)ch };
        if (py > SCREEN_HEIGHT - 60) break;
        Color rc = rarityColor(h.rarity);
        drawPanel(px, py, cw, ch);
        DrawRectangleLinesEx(card, 2, rc);
        // sprite thumbnail (left), or a rarity-tinted placeholder box if no art
        Rectangle thumb = { (float)(px + 6), (float)(py + 6), 80, 80 };
        if (!drawHeroSprite(h.className, thumb)) {
            DrawRectangleRec(thumb, { rc.r, rc.g, rc.b, 40 });
            DrawRectangleLinesEx(thumb, 1, rc);
            // initial letter as a stand-in
            std::string init(1, h.className.empty() ? '?' : h.className[0]);
            DrawText(init.c_str(), (int)thumb.x + 30, (int)thumb.y + 26, 30, rc);
        }
        int textX = px + 96;
        DrawText(h.className.c_str(), textX, py + 10, 16, Col::C_TXT);
        DrawText(h.rarity.c_str(), textX, py + 30, 12, rc);
        DrawText(TextFormat("ATK %d  DEF %d", h.attack, h.defense),
                 textX, py + 50, 11, Col::C_TXT_DIM);
        DrawText(TextFormat("%s / %s", h.alignment.c_str(), h.element.c_str()),
                 textX, py + 68, 11, Col::C_ACCENT_2);
        // click a card while assigning a team slot -> assign it
        if (clicked && CheckCollisionPointRec(mouse, card) && g_teamPickPos >= 0) {
            g_teamSlots[g_teamPickPos] = h.id;
            g_teamPickPos = -1;
            saveActiveTeam();
            g_screen = Screen::TEAM;
        }
        shown++; col = shown % perRow;
    }
    if (shown == 0)
        DrawText("No heroes yet. Summon to build your roster.", 40, gy, 15, Col::C_TXT_DIM);

    // footer hint + go-to-team button
    Rectangle teamBtn = { 40, (float)(SCREEN_HEIGHT - 46), 160, 32 };
    bool tHov = CheckCollisionPointRec(mouse, teamBtn);
    DrawRectangleRec(teamBtn, tHov ? Col::C_PANEL_HI : Col::C_PANEL);
    DrawRectangleLinesEx(teamBtn, 1, Col::C_ACCENT);
    DrawText("Manage Team", (int)teamBtn.x + 18, (int)teamBtn.y + 8, 15, Col::C_TXT);
    if (clicked && tHov) { loadActiveTeam(); g_screen = Screen::TEAM; }
}

// ─── TEAM builder (5 slots) ────────────────────────────────────────────
static const Hero* heroById(const std::string& id) {
    for (auto& h : g_heroes) if (h.id == id) return &h;
    return nullptr;
}

static void drawTeam(Vector2 mouse, bool clicked) {
    drawBackdropCover({ 0 });
    DrawRectangleGradientV(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, { 12, 16, 28, 220 }, { 6, 6, 14, 230 });
    drawTopBar();
    if (drawBack(mouse, clicked)) { g_teamPickPos = -1; g_screen = Screen::HEROES; }

    DrawText("ACTIVE TEAM", SCREEN_WIDTH / 2 - 90, 64, 28, Col::C_ACCENT_2);
    DrawText("Tap a slot, then pick a hero. Up to 5.", SCREEN_WIDTH / 2 - 150, 104, 13, Col::C_TXT_DIM);

    // 5 slots in a row
    int slotW = 180, slotH = 230, gap = 18;
    int totalW = slotW * 5 + gap * 4;
    int sx = (SCREEN_WIDTH - totalW) / 2, sy = 150;
    for (int i = 0; i < 5; i++) {
        int px = sx + i * (slotW + gap);
        Rectangle slot = { (float)px, (float)sy, (float)slotW, (float)slotH };
        bool hov = CheckCollisionPointRec(mouse, slot);
        bool picking = (g_teamPickPos == i);
        drawPanel(px, sy, slotW, slotH, picking ? Col::C_PANEL_HI : Col::C_PANEL);
        DrawRectangleLinesEx(slot, picking ? 3 : 1, picking ? Col::C_GOLD : Col::C_BORDER);

        const Hero* h = g_teamSlots[i].empty() ? nullptr : heroById(g_teamSlots[i]);
        if (h) {
            Color rc = rarityColor(h->rarity);
            DrawText(TextFormat("Slot %d", i + 1), px + 12, sy + 8, 12, Col::C_TXT_DIM);
            // sprite portrait at top of the slot (or tinted placeholder)
            Rectangle port = { (float)(px + 12), (float)(sy + 26), (float)(slotW - 24), 96 };
            if (!drawHeroSprite(h->className, port)) {
                DrawRectangleRec(port, { rc.r, rc.g, rc.b, 35 });
                DrawRectangleLinesEx(port, 1, rc);
                std::string init(1, h->className.empty() ? '?' : h->className[0]);
                DrawText(init.c_str(), (int)(port.x + port.width/2 - 12), (int)(port.y + 32), 40, rc);
            }
            DrawText(h->className.c_str(), px + 12, sy + 128, 16, Col::C_TXT);
            DrawText(h->rarity.c_str(), px + 12, sy + 148, 12, rc);
            DrawText(TextFormat("ATK %d  DEF %d", h->attack, h->defense), px + 12, sy + 168, 11, Col::C_TXT_DIM);
            DrawText(TextFormat("%s / %s", h->alignment.c_str(), h->element.c_str()), px + 12, sy + 186, 11, Col::C_ACCENT_2);
            // remove button
            Rectangle rm = { (float)(px + slotW - 30), (float)(sy + 8), 22, 22 };
            DrawRectangleRec(rm, Col::C_PANEL_HI); DrawText("x", (int)rm.x + 7, (int)rm.y + 4, 14, Col::C_TXT);
            if (clicked && CheckCollisionPointRec(mouse, rm)) { g_teamSlots[i].clear(); saveActiveTeam(); }
        } else {
            DrawText(TextFormat("Slot %d", i + 1), px + 12, sy + 10, 12, Col::C_TXT_DIM);
            DrawText("+ empty", px + slotW/2 - 30, sy + slotH/2 - 8, 16, Col::C_TXT_DIM);
            if (clicked && hov) { g_teamPickPos = i; g_screen = Screen::HEROES; }
        }
        // clicking a filled slot re-assigns it
        if (clicked && hov && h && !CheckCollisionPointRec(mouse, { (float)(px + slotW - 30), (float)(sy + 8), 22, 22 }))
            { g_teamPickPos = i; g_screen = Screen::HEROES; }
    }

    // team summary (total power)
    long long totalAtk = 0, totalHp = 0; int members = 0;
    for (int i = 0; i < 5; i++) { const Hero* h = g_teamSlots[i].empty() ? nullptr : heroById(g_teamSlots[i]); if (h) { totalAtk += h->attack; totalHp += h->health; members++; } }
    DrawText(TextFormat("Team Power:  %lld ATK   %lld HP   (%d/5 heroes)", totalAtk, totalHp, members),
             sx, sy + slotH + 30, 16, Col::C_GOLD);
}

// ─── INVENTORY > PARTY tab ─────────────────────────────────────────────
// Equip/unequip heroes into a 5-slot active party, persisted server-side.
// NOTE: equip/unequip call fetchHeroes() which rebuilds g_heroes, so every
// handler RETURNS immediately after to avoid iterating a mutated container.
static void drawInventoryParty(Vector2 mouse, bool clicked) {
    if (!g_heroesFetched) fetchHeroes();

    // ── Active party: 5 slots across the top ──
    int slotW = 150, slotH = 150, gap = 14;
    int totalW = slotW * 5 + gap * 4;
    int sx = (SCREEN_WIDTH - totalW) / 2, sy = 156;

    DrawText("ACTIVE PARTY", sx, sy - 26, 16, Col::C_ACCENT_2);
    long long tAtk = 0, tHp = 0; int members = 0;
    for (int i = 0; i < 5; i++) {
        const Hero* h = g_teamSlots[i].empty() ? nullptr : heroById(g_teamSlots[i]);
        if (h) { tAtk += h->attack; tHp += h->health; members++; }
    }
    DrawText(TextFormat("Power: %lld ATK  %lld HP  (%d/5)", tAtk, tHp, members),
             sx + totalW - 300, sy - 24, 14, Col::C_GOLD);

    for (int i = 0; i < 5; i++) {
        int px = sx + i * (slotW + gap);
        Rectangle slot = { (float)px, (float)sy, (float)slotW, (float)slotH };
        bool hov = CheckCollisionPointRec(mouse, slot);
        bool picking = (g_teamPickPos == i);
        const Hero* h = g_teamSlots[i].empty() ? nullptr : heroById(g_teamSlots[i]);

        drawPanel(px, sy, slotW, slotH, picking ? Col::C_PANEL_HI : Col::C_PANEL);
        DrawRectangleLinesEx(slot, picking ? 3 : 1, picking ? Col::C_GOLD : Col::C_BORDER);
        DrawText(TextFormat("Slot %d", i + 1), px + 10, sy + 8, 11, Col::C_TXT_DIM);

        if (h) {
            Color rc = rarityColor(h->rarity);
            Rectangle port = { (float)(px + 10), (float)(sy + 26), (float)(slotW - 20), 66 };
            if (!drawHeroSprite(h->className, port)) {
                DrawRectangleRec(port, { rc.r, rc.g, rc.b, 35 });
                DrawRectangleLinesEx(port, 1, rc);
                std::string init(1, h->className.empty() ? '?' : h->className[0]);
                DrawText(init.c_str(), (int)(port.x + port.width / 2 - 10), (int)(port.y + 18), 32, rc);
            }
            std::string nm = h->className.size() > 16 ? h->className.substr(0, 14) + ".." : h->className;
            DrawText(nm.c_str(), px + 10, sy + 98, 12, Col::C_TXT);
            DrawText(TextFormat("Lv%d  %s  %d*", h->level, h->rarity.c_str(), h->starLevel), px + 10, sy + 114, 10, rc);
            DrawText(TextFormat("ATK %d  DEF %d", h->attack, h->defense), px + 10, sy + 130, 10, Col::C_TXT_DIM);

            Rectangle rm = { (float)(px + slotW - 26), (float)(sy + 6), 20, 20 };
            bool rmHov = CheckCollisionPointRec(mouse, rm);
            DrawRectangleRec(rm, rmHov ? Col::C_REDDY : Col::C_PANEL_HI);
            DrawText("x", (int)rm.x + 6, (int)rm.y + 3, 14, Col::C_TXT);
            if (clicked && rmHov) { unequipSlot(i); return; }
            if (clicked && hov && !rmHov) g_teamPickPos = (g_teamPickPos == i ? -1 : i);
        } else {
            DrawText("+ empty", px + slotW / 2 - 30, sy + slotH / 2 - 8, 14, Col::C_TXT_DIM);
            if (clicked && hov) g_teamPickPos = (g_teamPickPos == i ? -1 : i);
        }
    }

    const char* hint = (g_teamPickPos >= 0)
        ? "Slot selected — tap a hero below to place it here."
        : "Tap a slot to select it, or tap any hero below to fill the first empty slot.";
    DrawText(hint, sx, sy + slotH + 10, 12, Col::C_TXT_DIM);

    // ── Roster: theme tabs + summon shortcut ──
    int rty = sy + slotH + 34, rtx = sx;
    for (int i = 0; i < 6; i++) {
        int tw = MeasureText(HERO_TABS[i], 13) + 20;
        Rectangle tab = { (float)rtx, (float)rty, (float)tw, 26 };
        bool hov = CheckCollisionPointRec(mouse, tab);
        bool sel = (g_heroTab == i);
        DrawRectangleRec(tab, sel ? Col::C_ACCENT : (hov ? Col::C_PANEL_HI : Col::C_PANEL));
        DrawText(HERO_TABS[i], rtx + 10, rty + 6, 13, sel ? Col::C_BG_DEEP : Col::C_TXT);
        if (clicked && hov) g_heroTab = i;
        rtx += tw + 6;
    }
    Rectangle sm = { (float)(sx + totalW - 130), (float)rty, 130, 26 };
    bool smHov = CheckCollisionPointRec(mouse, sm);
    DrawRectangleRec(sm, smHov ? Col::C_PANEL_HI : Col::C_PANEL);
    DrawRectangleLinesEx(sm, 1, Col::C_ACCENT_2);
    DrawText("Go to Summon", (int)sm.x + 12, (int)sm.y + 6, 13, Col::C_ACCENT_2);
    if (clicked && smHov) { g_teamPickPos = -1; g_screen = Screen::SUMMON; return; }

    // ── Roster grid ──
    int gy = rty + 36, gx = sx, cw = 188, ch = 70, col = 0;
    int perRow = totalW / (cw + 10); if (perRow < 1) perRow = 1;
    int shown = 0;
    for (auto& hh : g_heroes) {
        if (!heroPassesTab(hh)) continue;
        int px = gx + col * (cw + 10);
        int py = gy + (shown / perRow) * (ch + 10);
        if (py > SCREEN_HEIGHT - 70) break;
        Rectangle card = { (float)px, (float)py, (float)cw, (float)ch };
        Color rc = rarityColor(hh.rarity);
        bool inParty = hh.inParty;
        drawPanel(px, py, cw, ch);
        DrawRectangleLinesEx(card, inParty ? 2 : 1, inParty ? Col::C_GREENY : rc);

        Rectangle thumb = { (float)(px + 6), (float)(py + 6), 58, 58 };
        if (!drawHeroSprite(hh.className, thumb)) {
            DrawRectangleRec(thumb, { rc.r, rc.g, rc.b, 40 });
            DrawRectangleLinesEx(thumb, 1, rc);
            std::string init(1, hh.className.empty() ? '?' : hh.className[0]);
            DrawText(init.c_str(), (int)thumb.x + 20, (int)thumb.y + 16, 26, rc);
        }
        int textX = px + 72;
        std::string nm = hh.className.size() > 14 ? hh.className.substr(0, 12) + ".." : hh.className;
        DrawText(nm.c_str(), textX, py + 8, 13, Col::C_TXT);
        DrawText(TextFormat("Lv%d %s %d*", hh.level, hh.rarity.c_str(), hh.starLevel), textX, py + 26, 10, rc);
        DrawText(TextFormat("ATK %d DEF %d", hh.attack, hh.defense), textX, py + 42, 10, Col::C_TXT_DIM);
        if (inParty) DrawText("IN PARTY", textX, py + 55, 9, Col::C_GREENY);

        // Star-up button: only worth showing if the hero isn't maxed. Cost
        // mirrors the server's STAR_UP_COST ramp (5/10/20/40/80 for 1->6).
        if (hh.starLevel < 6) {
            static const int STAR_COST[6] = { 0, 5, 10, 20, 40, 80 }; // index by current star
            int cost = STAR_COST[hh.starLevel];
            int have = g_heroShards.count(hh.className) ? g_heroShards[hh.className] : 0;
            bool afford = have >= cost;
            Rectangle su = { (float)(px + cw - 54), (float)(py + ch - 20), 50, 16 };
            bool suHov = CheckCollisionPointRec(mouse, su);
            DrawRectangleRec(su, afford ? (suHov ? Col::C_GOLD : Col::C_PANEL_HI) : Col::C_PANEL);
            DrawRectangleLinesEx(su, 1, afford ? Col::C_GOLD : Col::C_BORDER);
            DrawText(TextFormat("%d/%d", have, cost), (int)su.x + 4, (int)su.y + 3, 9,
                      afford ? Col::C_BG_DEEP : Col::C_TXT_DIM);
            if (clicked && suHov) { if (afford) starUpHero(hh.id); return; }
        } else {
            DrawText("MAX", px + cw - 40, py + ch - 18, 11, Col::C_GOLD);
        }

        if (clicked && CheckCollisionPointRec(mouse, card)) {
            if (inParty) { unequipHero(hh.id); return; }              // toggle out
            if (g_teamPickPos >= 0) { equipHeroToSlot(hh.id, g_teamPickPos); g_teamPickPos = -1; return; }
            int target = -1;
            for (int s = 0; s < 5; s++) if (g_teamSlots[s].empty()) { target = s; break; }
            if (target >= 0) { equipHeroToSlot(hh.id, target); return; }
        }
        shown++; col = shown % perRow;
    }
    if (shown == 0)
        DrawText("No heroes yet. Summon to build your roster.", sx, gy, 14, Col::C_TXT_DIM);
}

// ─── SUMMON ────────────────────────────────────────────────────────────
static void drawSummon(Vector2 mouse, bool clicked) {
    drawBackdropCover({ 0 });
    DrawRectangleGradientV(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT,
                           { 20, 10, 36, 220 }, { 6, 6, 14, 230 });
    drawTopBar();
    if (drawBack(mouse, clicked)) g_screen = Screen::HOME;

    DrawText("SUMMON", SCREEN_WIDTH / 2 - 60, 70, 30, Col::C_ACCENT_2);
    DrawText("Channel resonance to call an ally.", SCREEN_WIDTH / 2 - 160, 110, 13, Col::C_TXT_DIM);

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
    if (drawButton(s1,  mouse, clicked, Col::C_PANEL_HI, Col::C_ACCENT))   { summonHeroes(1);  g_summonFlash = 1.0f; }
    if (drawButton(s10, mouse, clicked, Col::C_PANEL_HI, Col::C_ACCENT_2)) { summonHeroes(10); g_summonFlash = 1.0f; }
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

    // Resolve assets relative to the executable, NOT the working directory.
    // Without this, launching the game from Explorer / a shortcut / another
    // folder makes "assets/..." paths fail and backdrops fall back to a
    // blank gradient. ChangeDirectory fixes it for every launch method.
    ChangeDirectory(GetApplicationDirectory());

    initPlayer("TestPlayer");
    fetchChapters();
    syncPlayer();
    claimIdle();   // offline rewards "while you were away"

    if (!g_chapters.empty())
        appendStory("[" + g_chapters[0].name + "] " + g_chapters[0].storyText);

    while (!WindowShouldClose()) {
        float dt = GetFrameTime();
        if (g_toastTimer > 0.0f) g_toastTimer -= dt;
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
            case Screen::HEROES:         drawHeroes(mouse, clicked);        break;
            case Screen::TEAM:           drawTeam(mouse, clicked);          break;
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

        drawToast();
        EndDrawing();
    }

    // Make sure no background sync is still touching memory we're freeing.
    if (g_syncInFlight && g_syncFuture.valid()) g_syncFuture.wait();

    for (auto& c : g_chapters)
        if (c.backdrop.id != 0) UnloadTexture(c.backdrop);
    for (auto& kv : g_heroSprites)
        if (kv.second.id != 0) UnloadTexture(kv.second);
    g_doll.unload();
    CloseWindow();
    return 0;
}