// Pure-logic tests for the narrative chapter response parser (_narrative_parse.ts).
// No DB, no network. Run: node tests/narrative_parse.test.cjs
const { execSync } = require('child_process');
const assert = require('assert');

execSync(
  'npx tsc --target ES2020 --module commonjs --esModuleInterop --outDir /tmp/_t_narr api/_narrative_parse.ts',
  { stdio: 'inherit' }
);
const P = require('/tmp/_t_narr/_narrative_parse.js');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}: ${e.message}`); fail++; }
}

console.log("narrative_parse.test:");

check("well-formed response parses exactly as written", () => {
  const raw =
    "STORY: The gates creak open before you. A cold wind carries whispers of the past.\n" +
    "CHOICE_A: Step through the gate\n" +
    "CHOICE_B: Search the perimeter first\n" +
    "CHOICE_C: Turn back and regroup";
  const r = P.parseChapterResponse(raw);
  assert.strictEqual(r.story, "The gates creak open before you. A cold wind carries whispers of the past.");
  assert.strictEqual(r.choices.length, 3);
  assert.strictEqual(r.choices[0].key, "A");
  assert.strictEqual(r.choices[0].text, "Step through the gate");
  assert.strictEqual(r.choices[1].text, "Search the perimeter first");
  assert.strictEqual(r.choices[2].text, "Turn back and regroup");
});

check("always returns exactly 3 choices, in A/B/C order, regardless of input", () => {
  const r = P.parseChapterResponse("STORY: text\nCHOICE_A: only one given");
  assert.strictEqual(r.choices.length, 3);
  assert.deepStrictEqual(r.choices.map(c => c.key), ["A", "B", "C"]);
});

check("missing STORY marker falls back to non-empty default text", () => {
  const r = P.parseChapterResponse("CHOICE_A: a\nCHOICE_B: b\nCHOICE_C: c");
  assert(typeof r.story === "string" && r.story.length > 0, "story must never be empty");
});

check("missing CHOICE markers synthesize sane, non-empty fallback text", () => {
  const r = P.parseChapterResponse("STORY: just a story, no choices at all");
  for (const c of r.choices) {
    assert(c.text.length > 0, `choice ${c.key} must not be empty`);
  }
});

check("completely empty or garbage input never crashes and still returns 3 choices", () => {
  for (const bad of ["", "   ", "this is not formatted at all", "\n\n\n"]) {
    const r = P.parseChapterResponse(bad);
    assert.strictEqual(r.choices.length, 3, `input ${JSON.stringify(bad)} should still yield 3 choices`);
    assert(r.story.length > 0);
  }
});

check("null/undefined input is handled without throwing", () => {
  const r1 = P.parseChapterResponse(null);
  const r2 = P.parseChapterResponse(undefined);
  assert.strictEqual(r1.choices.length, 3);
  assert.strictEqual(r2.choices.length, 3);
});

check("multi-line STORY text (LLM ignored the 'single line' instruction) is fully captured", () => {
  const raw =
    "STORY: The first sentence sets the scene.\n" +
    "The second sentence continues without a marker.\n" +
    "A third line adds more atmosphere.\n" +
    "CHOICE_A: Move on\n" +
    "CHOICE_B: Wait\n" +
    "CHOICE_C: Retreat";
  const r = P.parseChapterResponse(raw);
  assert(r.story.includes("first sentence"), "should capture the marker line's text");
  assert(r.story.includes("second sentence"), "should capture continuation lines before the next marker");
  assert(r.story.includes("third line"), "should capture all continuation lines, not just the first");
  assert(!r.story.includes("CHOICE"), "story block must stop before the next marker");
});

check("case-insensitive markers and extra whitespace are tolerated", () => {
  const raw = "  story:   lowercase marker with leading spaces  \n" +
              "choice_a:   also lowercase  \n" +
              "CHOICE_B: normal\n" +
              "Choice_C: mixed case";
  const r = P.parseChapterResponse(raw);
  assert(r.story.includes("lowercase marker"));
  assert.strictEqual(r.choices[0].text, "also lowercase");
  assert.strictEqual(r.choices[2].text, "mixed case");
});

check("overly long choice text is truncated so client UI never overflows", () => {
  const longText = "X".repeat(300);
  const raw = `STORY: s\nCHOICE_A: ${longText}\nCHOICE_B: b\nCHOICE_C: c`;
  const r = P.parseChapterResponse(raw);
  assert(r.choices[0].text.length <= 80, `expected <=80 chars, got ${r.choices[0].text.length}`);
  assert(r.choices[0].text.endsWith("..."), "truncated text should end with an ellipsis");
});

check("markers appearing out of order (A/B/C not sequential in text) still resolve correctly", () => {
  // Defensive: even if a future prompt tweak reorders output, each choice
  // should still map to the RIGHT key regardless of its position in the text.
  const raw = "CHOICE_C: third\nSTORY: the tale\nCHOICE_A: first\nCHOICE_B: second";
  const r = P.parseChapterResponse(raw);
  const byKey = Object.fromEntries(r.choices.map(c => [c.key, c.text]));
  assert.strictEqual(byKey.A, "first");
  assert.strictEqual(byKey.B, "second");
  assert.strictEqual(byKey.C, "third");
});

console.log(`\nnarrative_parse.test: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
