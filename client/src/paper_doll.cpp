#pragma once
// paper_doll.hpp — public interface. Include this in main.cpp.
// Implementation: paper_doll.cpp

#include <raylib.h>
#include <string>
#include <cstdint>

// Rarity — must stay in sync with loot_core.ts RarityName ordering
enum class Rarity { Common = 1, Uncommon, Rare, Epic, Legendary };

// One equipped slot.
// armorType : "weapon" | "head" | "body" | "arms" | "legs" | "accessory"
// rarity    : drives colour palette
// seed      : uint32 — same seed → same shape
// svgPath   : optional path to a real .svg file; empty = use procedural gen
struct PaperDollSlot {
    std::string armorType;
    Rarity      rarity  = Rarity::Common;
    uint32_t    seed    = 0;
    std::string svgPath;
};

// ── PaperDoll ──────────────────────────────────────────────────────────
//
// Typical usage inside main.cpp:
//
//   PaperDoll doll;
//
//   // Equip from loot drop (procedural):
//   doll.equip({ "weapon", Rarity::Legendary, lootRow.seed });
//   doll.equip({ "arms",   Rarity::Rare,      lootRow.seed });
//
//   // Equip from a real SVG file:
//   doll.equip({ "body", Rarity::Epic, 0, "assets/body_epic.svg" });
//
//   // Unequip:
//   doll.unequip("weapon");
//
//   // Inside BeginDrawing() / EndDrawing():
//   doll.draw(640, 360, 1.0f);   // centred at (640, 360), native size
//
//   // Before CloseWindow():
//   doll.unload();
//
class PaperDoll {
public:
    PaperDoll();
    ~PaperDoll();

    // Equip a slot (replaces existing without leaking GPU memory).
    // "arms" automatically populates arms_L and arms_R (mirrored).
    void equip(const PaperDollSlot& slot);

    // Remove a slot. Safe to call on an already-empty slot.
    void unequip(const std::string& armorType);

    // Render all layers, back→front. Call inside BeginDrawing()/EndDrawing().
    // cx, cy = screen centre of the doll.
    // scale  = 1.0 → each layer is 256 px square.
    void draw(int cx, int cy, float scale = 1.0f);

    // Free all GPU textures. Call before CloseWindow().
    void unload();

private:
    struct SlotState;
    struct Impl;
    Impl* m;
};