// api/affinity.ts
// Affinity engine: computes damage/healing multipliers when an armor's element
// interacts with a character/ally alignment.
//
// Concept (from design):
//   Demonic armor + Angelic ally  -> ally does 3x damage but heals you much less
//   Angelic armor  + Angelic ally  -> ally heals 2x, damage 1.5x
// Everything is percentile-based and data-driven via the AFFINITY_MATRIX below,
// so new elements/alignments are a one-line table edit.
//
// POST { armorElement: string, allyAlignment: string }
//   -> { damageMult, healMult, label, description }
//
// POST { action: "matrix" }
//   -> full matrix (for the in-game Index screen)

import { VercelRequest, VercelResponse } from "@vercel/node";

type Element =
  | "neutral" | "demonic" | "angelic" | "void"
  | "celestial" | "abyssal" | "resonant";

interface AffinityResult {
  damageMult: number;   // multiplier applied to ally damage
  healMult: number;     // multiplier applied to ally healing toward the wearer
  label: string;        // short tag for UI
  description: string;  // human-readable explanation
}

// armorElement -> allyAlignment -> result
// Values are multipliers (1.0 = neutral). Tunable.
const AFFINITY_MATRIX: Record<Element, Record<Element, AffinityResult>> = {
  neutral: {
    neutral:   { damageMult: 1.0, healMult: 1.0, label: "Balanced",   description: "No special interaction." },
    demonic:   { damageMult: 1.1, healMult: 1.0, label: "Tempted",    description: "Slight aggression boost." },
    angelic:   { damageMult: 1.0, healMult: 1.1, label: "Blessed",    description: "Slight healing boost." },
    void:      { damageMult: 1.0, healMult: 1.0, label: "Untouched",  description: "The void ignores neutrality." },
    celestial: { damageMult: 1.05, healMult: 1.05, label: "Favored",  description: "Mild all-round uplift." },
    abyssal:   { damageMult: 1.1, healMult: 0.95, label: "Stained",   description: "More damage, less mercy." },
    resonant:  { damageMult: 1.1, healMult: 1.1, label: "Attuned",    description: "Resonance amplifies both." },
  },
  demonic: {
    // Wearing demonic armor near an angel: angel fights harder, heals far less.
    neutral:   { damageMult: 1.2, healMult: 0.9, label: "Corrupting", description: "Demonic influence sharpens attacks." },
    demonic:   { damageMult: 1.5, healMult: 0.8, label: "Infernal Pact", description: "Demon-on-demon: massive damage, poor sustain." },
    angelic:   { damageMult: 3.0, healMult: 0.3, label: "Holy Conflict", description: "Angel rebukes the demon — 3x damage but barely heals." },
    void:      { damageMult: 1.4, healMult: 0.7, label: "Hollowing",  description: "Void feeds on demonic taint." },
    celestial: { damageMult: 2.2, healMult: 0.5, label: "Crusade",    description: "Celestial fury against corruption." },
    abyssal:   { damageMult: 1.8, healMult: 0.6, label: "Deep Hunger", description: "Abyss and demon amplify aggression." },
    resonant:  { damageMult: 1.6, healMult: 0.7, label: "Discordant", description: "Resonance destabilizes into raw power." },
  },
  angelic: {
    neutral:   { damageMult: 1.1, healMult: 1.3, label: "Sanctified", description: "Holy armor steadies allies." },
    demonic:   { damageMult: 1.5, healMult: 0.6, label: "Smiting",    description: "Demon ally turns the light into a weapon." },
    angelic:   { damageMult: 1.5, healMult: 2.0, label: "Divine Choir", description: "Angel-on-angel: 1.5x damage, 2x healing." },
    void:      { damageMult: 0.9, healMult: 1.2, label: "Shielding",  description: "Light wards the void, softening its edge." },
    celestial: { damageMult: 1.6, healMult: 1.8, label: "Ascendant",  description: "Celestial harmony, strong on both fronts." },
    abyssal:   { damageMult: 1.3, healMult: 0.8, label: "Purging",    description: "Light fights the abyss but strains healing." },
    resonant:  { damageMult: 1.4, healMult: 1.6, label: "Harmonic",   description: "Resonance carries the blessing further." },
  },
  void: {
    neutral:   { damageMult: 1.1, healMult: 0.9, label: "Eroding",    description: "Void quietly drains." },
    demonic:   { damageMult: 1.4, healMult: 0.7, label: "Consuming",  description: "Void and demon devour together." },
    angelic:   { damageMult: 0.9, healMult: 1.1, label: "Resisted",   description: "Light pushes back the void." },
    void:      { damageMult: 1.7, healMult: 0.5, label: "Null Field", description: "Pure void: high damage, almost no healing." },
    celestial: { damageMult: 1.0, healMult: 1.0, label: "Stalemate",  description: "Cosmic forces cancel out." },
    abyssal:   { damageMult: 1.9, healMult: 0.4, label: "Oblivion",   description: "Void + abyss: devastating, self-destructive." },
    resonant:  { damageMult: 1.5, healMult: 0.6, label: "Unraveling", description: "Resonance frays against the void." },
  },
  celestial: {
    neutral:   { damageMult: 1.15, healMult: 1.15, label: "Graced",   description: "Gentle uplift across the board." },
    demonic:   { damageMult: 2.2, healMult: 0.5, label: "Judgment",   description: "Celestial wrath turned by a demon ally." },
    angelic:   { damageMult: 1.6, healMult: 1.8, label: "Ascendant",  description: "Celestial + angelic: radiant power." },
    void:      { damageMult: 1.0, healMult: 1.0, label: "Stalemate",  description: "Order meets nothingness." },
    celestial: { damageMult: 1.8, healMult: 1.8, label: "Apotheosis", description: "Peak harmony: strong damage and healing." },
    abyssal:   { damageMult: 1.5, healMult: 0.7, label: "Reckoning",  description: "Heaven against the deep." },
    resonant:  { damageMult: 1.7, healMult: 1.5, label: "Crescendo",  description: "Resonance peaks under celestial light." },
  },
  abyssal: {
    neutral:   { damageMult: 1.2, healMult: 0.85, label: "Sinking",   description: "The deep pulls aggression upward." },
    demonic:   { damageMult: 1.8, healMult: 0.6, label: "Deep Hunger", description: "Abyss and demon feed each other." },
    angelic:   { damageMult: 1.3, healMult: 0.8, label: "Drowning Light", description: "Light strains against the abyss." },
    void:      { damageMult: 1.9, healMult: 0.4, label: "Oblivion",   description: "Abyss + void: ruinous output." },
    celestial: { damageMult: 1.5, healMult: 0.7, label: "Reckoning",  description: "The deep resists the heavens." },
    abyssal:   { damageMult: 2.0, healMult: 0.5, label: "Leviathan",  description: "Pure abyss: enormous damage, little mercy." },
    resonant:  { damageMult: 1.6, healMult: 0.6, label: "Pressure",   description: "Resonance buckles under abyssal weight." },
  },
  resonant: {
    neutral:   { damageMult: 1.15, healMult: 1.15, label: "Tuned",    description: "Resonance lifts everything slightly." },
    demonic:   { damageMult: 1.6, healMult: 0.7, label: "Discordant", description: "Resonance warps into aggression." },
    angelic:   { damageMult: 1.4, healMult: 1.6, label: "Harmonic",   description: "Resonance carries the blessing." },
    void:      { damageMult: 1.5, healMult: 0.6, label: "Unraveling", description: "The void frays the resonance." },
    celestial: { damageMult: 1.7, healMult: 1.5, label: "Crescendo",  description: "Light and resonance build together." },
    abyssal:   { damageMult: 1.6, healMult: 0.6, label: "Pressure",   description: "Resonance strains against the deep." },
    resonant:  { damageMult: 1.9, healMult: 1.4, label: "Standing Wave", description: "Resonance-on-resonance: amplified." },
  },
};

const ELEMENTS = Object.keys(AFFINITY_MATRIX) as Element[];

function normalize(s: string): Element {
  const e = (s || "neutral").toLowerCase() as Element;
  return ELEMENTS.includes(e) ? e : "neutral";
}

export default async (req: VercelRequest, res: VercelResponse) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = req.body || {};

  if (body.action === "matrix") {
    return res.status(200).json({ elements: ELEMENTS, matrix: AFFINITY_MATRIX });
  }

  const armorElement = normalize(body.armorElement);
  const allyAlignment = normalize(body.allyAlignment);
  const result = AFFINITY_MATRIX[armorElement][allyAlignment];

  return res.status(200).json({
    armorElement,
    allyAlignment,
    ...result,
  });
};
