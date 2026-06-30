// api/_namegen.ts  (HELPER — underscore = not an HTTP endpoint)
//
// Deterministic procedural name generation. Replaces the idea of a tiny LLM:
// seed-stable, instant, zero dependencies, fully controllable, and themed to
// the game's xianxia + Lovecraftian + Wuthering-Waves aesthetic.
//
// Same seed -> same name, always. This matters: an item with seed 12345 has the
// SAME name on the client, the server, and after a reload. Pure function.

// Mulberry32 — tiny deterministic PRNG (matches the client's RNG family).
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(r: () => number, arr: T[]): T => arr[Math.floor(r() * arr.length)];

// ── Word banks (the "model", but legible and tunable) ──
const PREFIX_BY_RARITY: Record<string, string[]> = {
  Common:    ["Worn", "Plain", "Iron", "Chipped", "Dull", "Rough"],
  Uncommon:  ["Honed", "Jade", "Tempered", "Swift", "Keen", "Bronze"],
  Rare:      ["Resonant", "Gilded", "Stormforged", "Ardent", "Lunar", "Sworn"],
  Epic:      ["Voidtouched", "Empyrean", "Eclipsed", "Wraithbound", "Astral", "Sovereign"],
  Legendary: ["Worldsplitting", "Eldritch", "Ascendant", "Catastrophe-", "Star-Devouring", "Unspeakable"],
};
const WEAPON_NOUN = ["Blade", "Saber", "Glaive", "Edge", "Fang", "Talon", "Cleaver", "Spike"];
const ARMOR_NOUN: Record<string, string[]> = {
  head:      ["Crown", "Visage", "Helm", "Diadem", "Mask"],
  body:      ["Mantle", "Carapace", "Aegis", "Vestment", "Plate"],
  arms:      ["Gauntlets", "Bracers", "Grips", "Vambraces"],
  legs:      ["Greaves", "Striders", "Treads", "Sabatons"],
  accessory: ["Sigil", "Charm", "Pendant", "Talisman", "Eye"],
  weapon:    WEAPON_NOUN,
};
const SUFFIX = [
  "of the Hollow Star", "of Nine Whispers", "of the Drowned Sect",
  "of Severed Heaven", "of the Coiling Abyss", "of Quiet Ruin",
  "of the Last Cultivator", "of Resonant Decay", "of the Unblinking Deep",
];

export function generateItemName(seed: number, slot: string, rarity: string): string {
  const r = rng(seed);
  const prefixes = PREFIX_BY_RARITY[rarity] ?? PREFIX_BY_RARITY.Common;
  const nouns = ARMOR_NOUN[slot] ?? WEAPON_NOUN;
  const prefix = pick(r, prefixes);
  const noun = pick(r, nouns);
  // Higher rarity gets a cosmic suffix more often.
  const suffixChance = rarity === "Legendary" ? 0.95
                     : rarity === "Epic" ? 0.6
                     : rarity === "Rare" ? 0.3 : 0.08;
  const sep = prefix.endsWith("-") ? "" : " ";
  const base = `${prefix}${sep}${noun}`;
  return r() < suffixChance ? `${base} ${pick(r, SUFFIX)}` : base;
}

// Enemy names by tier (0 = grunt … 4 = boss).
const ENEMY_PREFIX = ["Lesser", "Twisted", "Corrupted", "Ascendant", "Maddened"];
const ENEMY_ROOT = ["Zealot", "Chimera", "Echo", "Acolyte", "Revenant", "Aberration", "Cultivator"];
export function generateEnemyName(seed: number, tier: number): string {
  const r = rng(seed);
  const p = ENEMY_PREFIX[Math.max(0, Math.min(4, tier))];
  return `${p} ${pick(r, ENEMY_ROOT)}`;
}
