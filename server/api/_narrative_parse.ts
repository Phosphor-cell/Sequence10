// api/_narrative_parse.ts  (HELPER — underscore = not an HTTP endpoint)
//
// _ai.ts's 'chapter' prompt asks the LLM for a specific text format:
//   STORY: <3-4 sentences>
//   CHOICE_A: <choice>
//   CHOICE_B: <choice>
//   CHOICE_C: <choice>
// LLMs don't always follow formatting instructions perfectly -- markers can be
// missing, story text can spill across multiple lines, whitespace varies. This
// parser is defensive: it ALWAYS returns a non-empty story and EXACTLY 3
// choices, synthesizing sane fallback text for anything it can't find, so a
// malformed LLM response degrades gracefully instead of breaking the client
// (which always expects exactly 3 choice buttons).
//
// Pure, no I/O -- fully unit-testable.

export interface ParsedChoice { key: string; text: string; }
export interface ParsedChapter { story: string; choices: ParsedChoice[]; }

const CHOICE_KEYS = ["A", "B", "C"] as const;

const FALLBACK_STORY =
  "The path ahead is uncertain, but you press onward, senses sharpened for what comes next.";
const FALLBACK_CHOICE_TEXT: Record<string, string> = {
  A: "Press forward",
  B: "Proceed with caution",
  C: "Seek another way",
};

const MAX_CHOICE_LEN = 80;

// Matches a marker line like "STORY: text" or "CHOICE_A:text", case-insensitive,
// tolerant of leading whitespace.
const MARKER_RE = /^\s*(STORY|CHOICE_A|CHOICE_B|CHOICE_C)\s*:\s*(.*)$/i;

interface MarkerHit { key: string; lineIndex: number; firstLineText: string; }

function findMarkers(lines: string[]): MarkerHit[] {
  const hits: MarkerHit[] = [];
  lines.forEach((line, i) => {
    const m = line.match(MARKER_RE);
    if (m) hits.push({ key: m[1].toUpperCase(), lineIndex: i, firstLineText: m[2] });
  });
  return hits;
}

// Extract everything belonging to `key`'s block: its own line's trailing text,
// plus any subsequent lines up to (not including) the next marker or EOF --
// handles LLMs that wrap STORY across multiple lines despite instructions.
function extractBlock(key: string, lines: string[], markers: MarkerHit[]): string | null {
  const idx = markers.findIndex((m) => m.key === key);
  if (idx === -1) return null;
  const start = markers[idx];
  const end = markers[idx + 1]?.lineIndex ?? lines.length;
  const continuation = lines.slice(start.lineIndex + 1, end).join(" ").trim();
  const combined = (start.firstLineText + (continuation ? " " + continuation : "")).trim();
  return combined.length > 0 ? combined : null;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 3).trim() + "..." : s;
}

export function parseChapterResponse(raw: string): ParsedChapter {
  const text = (raw ?? "").replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const markers = findMarkers(lines);

  const story = extractBlock("STORY", lines, markers) ?? FALLBACK_STORY;

  const choices: ParsedChoice[] = CHOICE_KEYS.map((k) => {
    const block = extractBlock(`CHOICE_${k}`, lines, markers);
    const chosenText = block ?? FALLBACK_CHOICE_TEXT[k];
    return { key: k, text: truncate(chosenText, MAX_CHOICE_LEN) };
  });

  return { story, choices };
}