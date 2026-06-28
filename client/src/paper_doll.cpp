// paper_doll.cpp
// Layered paper-doll character renderer for Cultivation AFK Realm.
//
// DEPENDENCIES (header-only, in Raylib 5 source tree):
//   raylib/src/external/nanosvg.h       — SVG parser
//   raylib/src/external/nanosvgrast.h   — SVG rasteriser
//
// Copy those two headers into client/include/ (one-time setup, see README).
//
// HOW IT WORKS
// ─────────────────────────────────────────────────────────────────────
// 1. Each equipped slot (head/body/arms/legs/weapon/accessory) becomes a
//    256×256 RGBA layer texture, uploaded to the GPU once then cached.
//
// 2. Texture source:
//    a. If PaperDollSlot.svgPath is non-empty → load the file.
//    b. Otherwise → build SVG from seed + rarity (fully procedural).
//
// 3. Draw order back→front:  legs → body → arms_L → head → arms_R → weapon → accessory
//
// 4. Socket offsets (pixels, before scale, relative to doll centre):
//    head (0,-110)  body (0,0)  arms_L (-88,-18)  arms_R (+88,-18)
//    legs (0,+82)   weapon (+88,+22)  accessory (-88,+22)
//
// 5. Rarity drives colour:
//    Common #9E9E9E  Uncommon #4CAF50  Rare #2196F3
//    Epic   #9C27B0  Legendary #FFC107

// Windows header exclusions — must precede ALL includes including nanosvg
#ifdef _WIN32
  #define NOGDI
  #define NOUSER
  #define NOMINMAX
  #define WIN32_LEAN_AND_MEAN
  #define VC_EXTRA_LEAN
#endif

#define NANOSVG_IMPLEMENTATION
#define NANOSVGRAST_IMPLEMENTATION
#include "nanosvg.h"
#include "nanosvgrast.h"

#include "paper_doll.hpp"
#include <raylib.h>

#include <cstring>
#include <cstdlib>
#include <cstdio>
#include <cstdint>
#include <cmath>
#include <cstdarg>
#include <string>
#include <map>
#include <vector>
#include <sstream>
#include <algorithm>

// ═══════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════

static constexpr int   TEX_SIZE = 256;
static constexpr float SVG_DPI  = 96.0f;

struct SocketOffset { int dx, dy; };
static const std::map<std::string, SocketOffset> SOCKETS = {
    { "head",       {   0, -110 } },
    { "body",       {   0,    0 } },
    { "arms_L",     { -88,  -18 } },
    { "arms_R",     {  88,  -18 } },
    { "legs",       {   0,   82 } },
    { "weapon",     {  88,   22 } },
    { "accessory",  { -88,   22 } },
};

static const std::vector<std::string> DRAW_ORDER = {
    "legs", "body", "arms_L", "head", "arms_R", "weapon", "accessory"
};

// ═══════════════════════════════════════════════════════════════════════
// Rarity palette
// ═══════════════════════════════════════════════════════════════════════

struct Palette { const char* fill; const char* stroke; };

static Palette rarityPalette(Rarity r) {
    switch (r) {
        case Rarity::Common:    return { "#9E9E9E", "#757575" };
        case Rarity::Uncommon:  return { "#4CAF50", "#2E7D32" };
        case Rarity::Rare:      return { "#2196F3", "#0D47A1" };
        case Rarity::Epic:      return { "#9C27B0", "#4A148C" };
        case Rarity::Legendary: return { "#FFC107", "#F57F17" };
    }
    return { "#9E9E9E", "#757575" };
}

// ═══════════════════════════════════════════════════════════════════════
// Seeded PRNG (mulberry32 — identical to loot_core.ts)
// ═══════════════════════════════════════════════════════════════════════

struct Prng {
    uint32_t a;
    // Wang hash pre-mix: spreads adjacent seeds apart before first use.
    // Real game seeds come from FNV(player_id+battle_count) so are already
    // well-distributed, but this makes the PRNG safe for any uint32 input.
    explicit Prng(uint32_t seed) {
        uint32_t s = seed;
        s = (s ^ 61u) ^ (s >> 16);
        s *= 9u;
        s ^= s >> 4;
        s *= 0x27d4eb2du;
        s ^= s >> 15;
        a = s ? s : 0x12345678u;
    }
    float next() {
        a += 0x6D2B79F5u;
        uint32_t t = (a ^ (a >> 15)) * (1u | a);
        t ^= t + (t ^ (t >> 7)) * (61u | t);
        return static_cast<float>(t >> 8) / 16777216.0f;
    }
    int nextInt(int lo, int hi) {
        return lo + static_cast<int>(next() * static_cast<float>(hi - lo + 1));
    }
};

// ═══════════════════════════════════════════════════════════════════════
// SVG generation helpers
// ═══════════════════════════════════════════════════════════════════════

static void svgFmt(std::ostringstream& o, const char* fmt, ...) {
    char buf[512];
    va_list args;
    va_start(args, fmt);
    vsnprintf(buf, sizeof(buf), fmt, args);
    va_end(args);
    o << buf;
}

static std::string svgOpen()  {
    return "<svg width=\"256\" height=\"256\" viewBox=\"0 0 256 256\" "
           "xmlns=\"http://www.w3.org/2000/svg\">\n";
}
static std::string svgClose() { return "</svg>\n"; }

// ── WEAPON ──────────────────────────────────────────────────────────
static std::string genWeapon(uint32_t seed, Rarity rarity) {
    Prng p(seed);
    Palette c = rarityPalette(rarity);
    int bladeVar = p.nextInt(0,2);
    int hiltVar  = p.nextInt(0,1);
    bool rune    = (rarity >= Rarity::Rare);

    std::ostringstream o;
    o << svgOpen();

    if      (bladeVar==0)
        svgFmt(o,"<path d=\"M128,20 L142,155 L128,230 L114,155 Z\" fill=\"%s\" stroke=\"%s\" stroke-width=\"5\"/>\n",c.fill,c.stroke);
    else if (bladeVar==1)
        svgFmt(o,"<path d=\"M128,22 Q155,90 148,160 L128,228 Q108,160 108,90 Z\" fill=\"%s\" stroke=\"%s\" stroke-width=\"5\"/>\n",c.fill,c.stroke);
    else
        svgFmt(o,"<path d=\"M110,25 L155,30 L160,160 L128,230 L96,160 Z\" fill=\"%s\" stroke=\"%s\" stroke-width=\"5\"/>\n",c.fill,c.stroke);

    if (hiltVar==0)
        svgFmt(o,"<rect x=\"100\" y=\"155\" width=\"56\" height=\"14\" rx=\"4\" fill=\"#5D4037\" stroke=\"#263238\" stroke-width=\"3\"/>\n");
    else
        svgFmt(o,"<path d=\"M96,162 Q128,148 160,162 Q128,176 96,162 Z\" fill=\"#5D4037\" stroke=\"#263238\" stroke-width=\"3\"/>\n");

    svgFmt(o,"<rect x=\"121\" y=\"169\" width=\"14\" height=\"32\" rx=\"3\" fill=\"#795548\" stroke=\"#263238\" stroke-width=\"2\"/>\n");
    svgFmt(o,"<circle cx=\"128\" cy=\"208\" r=\"8\" fill=\"%s\" stroke=\"%s\" stroke-width=\"2\"/>\n",c.stroke,c.fill);

    if (rune) {
        svgFmt(o,"<circle cx=\"128\" cy=\"90\" r=\"14\" fill=\"none\" stroke=\"%s\" stroke-width=\"2\" stroke-dasharray=\"4 3\" opacity=\"0.85\"/>\n",c.fill);
        svgFmt(o,"<text x=\"128\" y=\"95\" font-size=\"12\" text-anchor=\"middle\" fill=\"%s\" opacity=\"0.9\">+</text>\n",c.fill);
    }
    if (rarity==Rarity::Legendary)
        svgFmt(o,"<ellipse cx=\"128\" cy=\"90\" rx=\"30\" ry=\"120\" fill=\"%s\" opacity=\"0.18\"/>\n",c.fill);

    o << svgClose();
    return o.str();
}

// ── HEAD ─────────────────────────────────────────────────────────────
static std::string genHead(uint32_t seed, Rarity rarity) {
    Prng p(seed);
    Palette c = rarityPalette(rarity);
    int var    = p.nextInt(0,2);
    bool crest = p.next()>0.4f || rarity>=Rarity::Rare;

    std::ostringstream o;
    o << svgOpen();

    if (var==0) {
        svgFmt(o,"<path d=\"M80,148 Q80,60 128,40 Q176,60 176,148 Z\" fill=\"%s\" stroke=\"%s\" stroke-width=\"6\"/>\n",c.fill,c.stroke);
        svgFmt(o,"<rect x=\"88\" y=\"140\" width=\"80\" height=\"30\" rx=\"4\" fill=\"%s\" stroke=\"%s\" stroke-width=\"4\"/>\n",c.fill,c.stroke);
    } else if (var==1) {
        svgFmt(o,"<polygon points=\"128,38 172,80 172,148 128,162 84,148 84,80\" fill=\"%s\" stroke=\"%s\" stroke-width=\"6\"/>\n",c.fill,c.stroke);
    } else {
        svgFmt(o,"<path d=\"M92,148 L92,88 Q92,44 128,40 Q164,44 164,88 L164,148 L148,148 L148,104 L108,104 L108,148 Z\" fill=\"%s\" stroke=\"%s\" stroke-width=\"5\"/>\n",c.fill,c.stroke);
    }

    svgFmt(o,"<rect x=\"108\" y=\"112\" width=\"40\" height=\"8\" rx=\"3\" fill=\"%s\" opacity=\"0.7\"/>\n",c.stroke);

    if (crest)
        svgFmt(o,"<path d=\"M128,38 L120,10 L128,20 L136,10 Z\" fill=\"%s\" stroke=\"%s\" stroke-width=\"2\"/>\n",c.fill,c.stroke);

    if (rarity==Rarity::Legendary) {
        svgFmt(o,"<path d=\"M80,80 Q60,50 70,30 Q90,55 100,70 Z\" fill=\"%s\" stroke=\"%s\" stroke-width=\"2\" opacity=\"0.9\"/>\n",c.fill,c.stroke);
        svgFmt(o,"<path d=\"M176,80 Q196,50 186,30 Q166,55 156,70 Z\" fill=\"%s\" stroke=\"%s\" stroke-width=\"2\" opacity=\"0.9\"/>\n",c.fill,c.stroke);
    }

    o << svgClose();
    return o.str();
}

// ── BODY ─────────────────────────────────────────────────────────────
static std::string genBody(uint32_t seed, Rarity rarity) {
    Prng p(seed);
    Palette c = rarityPalette(rarity);
    int var    = p.nextInt(0,1);

    std::ostringstream o;
    o << svgOpen();

    if (var==0) {
        svgFmt(o,"<path d=\"M72,80 L72,200 L184,200 L184,80 Q184,48 128,40 Q72,48 72,80 Z\" fill=\"%s\" stroke=\"%s\" stroke-width=\"7\"/>\n",c.fill,c.stroke);
        svgFmt(o,"<line x1=\"128\" y1=\"48\" x2=\"128\" y2=\"196\" stroke=\"%s\" stroke-width=\"3\" opacity=\"0.6\"/>\n",c.stroke);
    } else {
        svgFmt(o,"<path d=\"M80,80 L80,196 L176,196 L176,80 Q176,50 128,44 Q80,50 80,80 Z\" fill=\"%s\" stroke=\"%s\" stroke-width=\"6\"/>\n",c.fill,c.stroke);
        for (int y=110; y<=180; y+=35)
            svgFmt(o,"<line x1=\"80\" y1=\"%d\" x2=\"176\" y2=\"%d\" stroke=\"%s\" stroke-width=\"3\" opacity=\"0.5\"/>\n",y,y,c.stroke);
    }

    svgFmt(o,"<ellipse cx=\"72\"  cy=\"90\" rx=\"16\" ry=\"12\" fill=\"%s\" stroke=\"%s\" stroke-width=\"4\"/>\n",c.fill,c.stroke);
    svgFmt(o,"<ellipse cx=\"184\" cy=\"90\" rx=\"16\" ry=\"12\" fill=\"%s\" stroke=\"%s\" stroke-width=\"4\"/>\n",c.fill,c.stroke);

    if (rarity==Rarity::Legendary)
        svgFmt(o,"<polygon points=\"128,90 138,105 128,120 118,105\" fill=\"#ffffff\" stroke=\"%s\" stroke-width=\"2\" opacity=\"0.9\"/>\n",c.stroke);

    o << svgClose();
    return o.str();
}

// ── ARMS ─────────────────────────────────────────────────────────────
static std::string genArms(uint32_t seed, Rarity rarity) {
    Palette c = rarityPalette(rarity);
    std::ostringstream o;
    o << svgOpen();

    svgFmt(o,"<rect x=\"104\" y=\"120\" width=\"48\" height=\"80\" rx=\"8\" fill=\"%s\" stroke=\"%s\" stroke-width=\"5\"/>\n",c.fill,c.stroke);
    svgFmt(o,"<ellipse cx=\"128\" cy=\"118\" rx=\"26\" ry=\"14\" fill=\"%s\" stroke=\"%s\" stroke-width=\"4\"/>\n",c.fill,c.stroke);
    svgFmt(o,"<rect x=\"104\" y=\"148\" width=\"48\" height=\"8\" fill=\"%s\" opacity=\"0.5\"/>\n",c.stroke);
    svgFmt(o,"<rect x=\"100\" y=\"196\" width=\"56\" height=\"14\" rx=\"5\" fill=\"%s\" stroke=\"%s\" stroke-width=\"4\"/>\n",c.fill,c.stroke);

    if (rarity>=Rarity::Epic)
        svgFmt(o,"<circle cx=\"128\" cy=\"148\" r=\"6\" fill=\"#ffffff\" opacity=\"0.8\"/>\n");

    o << svgClose();
    return o.str();
}

// ── LEGS ─────────────────────────────────────────────────────────────
static std::string genLegs(uint32_t seed, Rarity rarity) {
    Palette c = rarityPalette(rarity);
    std::ostringstream o;
    o << svgOpen();

    svgFmt(o,"<path d=\"M86,40 L86,200 Q86,220 100,226 L114,226 Q120,220 120,200 L120,40 Z\" fill=\"%s\" stroke=\"%s\" stroke-width=\"5\"/>\n",c.fill,c.stroke);
    svgFmt(o,"<path d=\"M136,40 L136,200 Q136,220 150,226 L164,226 Q170,220 170,200 L170,40 Z\" fill=\"%s\" stroke=\"%s\" stroke-width=\"5\"/>\n",c.fill,c.stroke);
    svgFmt(o,"<ellipse cx=\"103\" cy=\"128\" rx=\"18\" ry=\"14\" fill=\"%s\" stroke=\"%s\" stroke-width=\"4\"/>\n",c.fill,c.stroke);
    svgFmt(o,"<ellipse cx=\"153\" cy=\"128\" rx=\"18\" ry=\"14\" fill=\"%s\" stroke=\"%s\" stroke-width=\"4\"/>\n",c.fill,c.stroke);
    svgFmt(o,"<rect x=\"82\"  y=\"210\" width=\"42\" height=\"14\" rx=\"4\" fill=\"%s\" stroke=\"%s\" stroke-width=\"3\"/>\n",c.fill,c.stroke);
    svgFmt(o,"<rect x=\"132\" y=\"210\" width=\"42\" height=\"14\" rx=\"4\" fill=\"%s\" stroke=\"%s\" stroke-width=\"3\"/>\n",c.fill,c.stroke);

    o << svgClose();
    return o.str();
}

// ── ACCESSORY ─────────────────────────────────────────────────────────
static std::string genAccessory(uint32_t seed, Rarity rarity) {
    Prng p(seed);
    Palette c = rarityPalette(rarity);
    int var    = p.nextInt(0,2);

    std::ostringstream o;
    o << svgOpen();

    if (var==0) {
        svgFmt(o,"<path d=\"M80,50 Q50,150 60,230 L128,210 L196,230 Q206,150 176,50 Z\" fill=\"%s\" stroke=\"%s\" stroke-width=\"5\" opacity=\"0.85\"/>\n",c.fill,c.stroke);
        svgFmt(o,"<line x1=\"80\" y1=\"50\" x2=\"176\" y2=\"50\" stroke=\"%s\" stroke-width=\"6\"/>\n",c.stroke);
    } else if (var==1) {
        svgFmt(o,"<circle cx=\"128\" cy=\"110\" r=\"38\" fill=\"none\" stroke=\"%s\" stroke-width=\"5\"/>\n",c.fill);
        svgFmt(o,"<polygon points=\"128,72 142,106 178,106 150,127 160,161 128,140 96,161 106,127 78,106 114,106\" fill=\"%s\" stroke=\"%s\" stroke-width=\"2\"/>\n",c.fill,c.stroke);
        svgFmt(o,"<line x1=\"128\" y1=\"72\" x2=\"128\" y2=\"30\" stroke=\"%s\" stroke-width=\"4\"/>\n",c.stroke);
    } else {
        svgFmt(o,"<path d=\"M88,60 Q88,40 128,36 Q168,40 168,60 L168,160 Q168,210 128,228 Q88,210 88,160 Z\" fill=\"%s\" stroke=\"%s\" stroke-width=\"7\"/>\n",c.fill,c.stroke);
        svgFmt(o,"<circle cx=\"128\" cy=\"130\" r=\"24\" fill=\"none\" stroke=\"%s\" stroke-width=\"4\"/>\n",c.stroke);
    }

    o << svgClose();
    return o.str();
}

// ── Dispatcher ────────────────────────────────────────────────────────
static std::string generateSVG(const std::string& type, uint32_t seed, Rarity rarity) {
    if (type=="weapon")                                     return genWeapon(seed,rarity);
    if (type=="head")                                       return genHead(seed,rarity);
    if (type=="body")                                       return genBody(seed,rarity);
    if (type=="arms"||type=="arms_L"||type=="arms_R")       return genArms(seed,rarity);
    if (type=="legs")                                       return genLegs(seed,rarity);
    if (type=="accessory")                                  return genAccessory(seed,rarity);
    // Fallback
    Palette c = rarityPalette(rarity);
    std::ostringstream o;
    o << svgOpen();
    svgFmt(o,"<rect x=\"64\" y=\"64\" width=\"128\" height=\"128\" fill=\"%s\" stroke=\"%s\" stroke-width=\"8\"/>\n",c.fill,c.stroke);
    o << svgClose();
    return o.str();
}

// ═══════════════════════════════════════════════════════════════════════
// Rasterise helpers
// ═══════════════════════════════════════════════════════════════════════

static Texture2D sentinelTexture() {
    Image img = GenImageColor(1, 1, MAGENTA);
    Texture2D t = LoadTextureFromImage(img);
    UnloadImage(img);
    return t;
}

static Texture2D rasterizeString(const std::string& src) {
    std::string buf = src;                          // nsvgParse mutates the string
    NSVGimage* nimg = nsvgParse(buf.data(), "px", SVG_DPI);
    if (!nimg || nimg->width <= 0 || nimg->height <= 0) {
        if (nimg) nsvgDelete(nimg);
        return sentinelTexture();
    }

    NSVGrasterizer* rast = nsvgCreateRasterizer();
    const int W = TEX_SIZE, H = TEX_SIZE;
    std::vector<unsigned char> px(static_cast<size_t>(W * H * 4), 0);
    float scale = std::min(W / nimg->width, H / nimg->height);
    nsvgRasterize(rast, nimg, 0.f, 0.f, scale, px.data(), W, H, W * 4);
    nsvgDeleteRasterizer(rast);
    nsvgDelete(nimg);

    Image ri;
    ri.data    = px.data();
    ri.width   = W;
    ri.height  = H;
    ri.mipmaps = 1;
    ri.format  = PIXELFORMAT_UNCOMPRESSED_R8G8B8A8;
    return LoadTextureFromImage(ri);        // GPU upload; px freed on return
}

static Texture2D rasterizeFile(const std::string& path) {
    NSVGimage* nimg = nsvgParseFromFile(path.c_str(), "px", SVG_DPI);
    if (!nimg || nimg->width <= 0 || nimg->height <= 0) {
        if (nimg) nsvgDelete(nimg);
        return sentinelTexture();
    }

    NSVGrasterizer* rast = nsvgCreateRasterizer();
    const int W = TEX_SIZE, H = TEX_SIZE;
    std::vector<unsigned char> px(static_cast<size_t>(W * H * 4), 0);
    float scale = std::min(W / nimg->width, H / nimg->height);
    nsvgRasterize(rast, nimg, 0.f, 0.f, scale, px.data(), W, H, W * 4);
    nsvgDeleteRasterizer(rast);
    nsvgDelete(nimg);

    Image ri;
    ri.data    = px.data();
    ri.width   = W;
    ri.height  = H;
    ri.mipmaps = 1;
    ri.format  = PIXELFORMAT_UNCOMPRESSED_R8G8B8A8;
    return LoadTextureFromImage(ri);
}

// ═══════════════════════════════════════════════════════════════════════
// PaperDoll private state
// ═══════════════════════════════════════════════════════════════════════

struct PaperDoll::SlotState {
    std::string armorType;
    Rarity      rarity   = Rarity::Common;
    Texture2D   tex      = {};
    bool        loaded   = false;
    bool        mirrorX  = false;
};

struct PaperDoll::Impl {
    std::map<std::string, SlotState> layers;
};

// ═══════════════════════════════════════════════════════════════════════
// PaperDoll public API
// ═══════════════════════════════════════════════════════════════════════

PaperDoll::PaperDoll() : m(new Impl()) {}
PaperDoll::~PaperDoll() { unload(); delete m; }

void PaperDoll::equip(const PaperDollSlot& slot) {
    auto build = [&](const std::string& key, bool mirror) {
        auto it = m->layers.find(key);
        if (it != m->layers.end() && it->second.loaded)
            UnloadTexture(it->second.tex);

        SlotState ss;
        ss.armorType = slot.armorType;
        ss.rarity    = slot.rarity;
        ss.mirrorX   = mirror;

        if (!slot.svgPath.empty())
            ss.tex = rasterizeFile(slot.svgPath);
        else
            ss.tex = rasterizeString(generateSVG(slot.armorType, slot.seed, slot.rarity));

        ss.loaded = true;
        m->layers[key] = ss;
    };

    if (slot.armorType == "arms") {
        build("arms_L", false);
        build("arms_R", true);
    } else {
        build(slot.armorType, false);
    }
}

void PaperDoll::unequip(const std::string& armorType) {
    auto rm = [&](const std::string& key) {
        auto it = m->layers.find(key);
        if (it != m->layers.end()) {
            if (it->second.loaded) UnloadTexture(it->second.tex);
            m->layers.erase(it);
        }
    };
    if (armorType == "arms") { rm("arms_L"); rm("arms_R"); }
    else                     { rm(armorType); }
}

void PaperDoll::draw(int cx, int cy, float scale) {
    const int size = static_cast<int>(TEX_SIZE * scale);

    for (const auto& key : DRAW_ORDER) {
        auto lit = m->layers.find(key);
        if (lit == m->layers.end() || !lit->second.loaded) continue;

        const SlotState& ss = lit->second;
        auto sit = SOCKETS.find(key);
        if (sit == SOCKETS.end()) continue;

        const SocketOffset& off = sit->second;
        float drawX = static_cast<float>(cx + static_cast<int>(off.dx * scale) - size / 2);
        float drawY = static_cast<float>(cy + static_cast<int>(off.dy * scale) - size / 2);

        if (ss.mirrorX) {
            // Negative source width = horizontal flip
            Rectangle src  = { 0.f, 0.f,
                                -static_cast<float>(ss.tex.width),
                                 static_cast<float>(ss.tex.height) };
            Rectangle dest = { drawX, drawY,
                                static_cast<float>(size),
                                static_cast<float>(size) };
            DrawTexturePro(ss.tex, src, dest, {0.f, 0.f}, 0.f, WHITE);
        } else {
            DrawTextureEx(ss.tex, {drawX, drawY}, 0.f, scale, WHITE);
        }
    }
}

void PaperDoll::unload() {
    for (auto& [key, ss] : m->layers)
        if (ss.loaded) { UnloadTexture(ss.tex); ss.loaded = false; }
    m->layers.clear();
}