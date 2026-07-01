// api/narrative.ts
// Per-player, AI-generated main story. Replaces nothing existing -- chapters.ts
// still serves the static level-cap/multiplier/backdrop config (that's global,
// shared across all players). This endpoint is the PERSONALIZED layer on top:
// each player gets their own generated narrative for whatever chapter_number
// they're currently on, informed by their alignment and their own prior choice.
//
// Generation is LAZY and happens at most once per (player, chapter_number) --
// narrative_chapters has a UNIQUE(player_id, chapter_number) constraint, so a
// chapter is generated on first view and simply re-served from the DB after
// that. The underlying LLM call is ALSO cache-deduplicated in _ai.ts across
// every player sharing the same (chapter_number, alignment, previous_choice)
// path, so the same "story beat" is never paid for twice even across players.
//
// A choice, once made, is PERMANENT (matches narrative-game convention: your
// past decisions are part of your story, not a setting you can flip back).
//
// POST { playerId, action:"current" }
//   -> { chapterNumber, story, choices:[{key,text}], decisionId, playerChoice }
//      playerChoice is null until the player has chosen.
// POST { playerId, action:"choose", decisionId, choiceKey: "A"|"B"|"C" }
//   -> { ok, playerChoice }

import { VercelRequest, VercelResponse } from "@vercel/node";
import { getPool } from "./_db";
import { aiGenerate } from "./_ai";
import { parseChapterResponse, ParsedChoice } from "./_narrative_parse";

const pool = getPool();

function cors(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

const VALID_CHOICE_KEYS = new Set(["A", "B", "C"]);

export default async (req: VercelRequest, res: VercelResponse) => {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = req.body || {};
  const playerId = body.playerId;
  const action = body.action;
  if (!playerId) return res.status(400).json({ error: "playerId required" });

  try {
    // ---- CURRENT (get-or-generate the player's current chapter) -----------
    if (action === "current") {
      const p = await pool.query(
        `SELECT current_chapter, alignment, level, gold, gems FROM players WHERE id = $1`,
        [playerId]
      );
      if (p.rowCount === 0) return res.status(404).json({ error: "player not found" });

      const chapterNumber = Number(p.rows[0].current_chapter) || 1;
      const alignment = p.rows[0].alignment || "Neutral";

      // Already generated for this player+chapter? Serve it as-is -- a
      // chapter's text and choices never change after first generation.
      const existing = await pool.query(
        `SELECT nc.narrative_text, nd.id AS decision_id, nd.choices, nd.player_choice
           FROM narrative_chapters nc
           JOIN narrative_decisions nd ON nd.chapter_id = nc.id
          WHERE nc.player_id = $1 AND nc.chapter_number = $2
          LIMIT 1`,
        [playerId, chapterNumber]
      );
      if (existing.rowCount && existing.rowCount > 0) {
        const row = existing.rows[0];
        return res.status(200).json({
          chapterNumber,
          story: row.narrative_text,
          choices: row.choices,
          decisionId: row.decision_id,
          playerChoice: row.player_choice,
        });
      }

      // Not generated yet. Find this player's choice from the immediately
      // prior chapter (if any) to inform this chapter's generation.
      const prev = await pool.query(
        `SELECT nd.player_choice
           FROM narrative_chapters nc
           JOIN narrative_decisions nd ON nd.chapter_id = nc.id
          WHERE nc.player_id = $1 AND nc.chapter_number = $2 AND nd.player_choice IS NOT NULL
          LIMIT 1`,
        [playerId, chapterNumber - 1]
      );
      const previousChoice: string | undefined = prev.rows[0]?.player_choice || undefined;

      const { text: rawText } = await aiGenerate("chapter", {
        chapter_number: chapterNumber,
        alignment,
        previous_choice: previousChoice,
      });
      const parsed = parseChapterResponse(rawText);

      const statsSnapshot = {
        level: Number(p.rows[0].level),
        gold: String(p.rows[0].gold),
        gems: String(p.rows[0].gems),
      };

      // Insert both rows in one transaction. ON CONFLICT DO NOTHING handles the
      // race where two concurrent "current" calls for the same never-yet-seen
      // chapter both reach here -- whichever commits first wins, the loser's
      // insert becomes a no-op and we just re-select below.
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const chapIns = await client.query(
          `INSERT INTO narrative_chapters
             (player_id, chapter_number, chapter_id, narrative_text, player_alignment, player_stats_at_chapter)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (player_id, chapter_number) DO NOTHING
           RETURNING id`,
          [playerId, chapterNumber, `chapter_${chapterNumber}`, parsed.story, alignment, JSON.stringify(statsSnapshot)]
        );

        let chapterRowId: string;
        let finalStory = parsed.story;
        let finalChoices: ParsedChoice[] = parsed.choices;

        if (chapIns.rowCount && chapIns.rowCount > 0) {
          chapterRowId = chapIns.rows[0].id;
          await client.query(
            `INSERT INTO narrative_decisions (chapter_id, decision_id, decision_text, choices, consequences)
             VALUES ($1,'main','What do you do?',$2,'{}'::jsonb)
             ON CONFLICT (chapter_id, decision_id) DO NOTHING`,
            [chapterRowId, JSON.stringify(parsed.choices)]
          );
        } else {
          // Lost the race -- another request already generated this chapter.
          // Discard our generation and read back the winner's version instead.
          const winner = await client.query(
            `SELECT nc.narrative_text, nd.choices
               FROM narrative_chapters nc
               JOIN narrative_decisions nd ON nd.chapter_id = nc.id
              WHERE nc.player_id = $1 AND nc.chapter_number = $2
              LIMIT 1`,
            [playerId, chapterNumber]
          );
          finalStory = winner.rows[0].narrative_text;
          finalChoices = winner.rows[0].choices;
        }
        await client.query("COMMIT");

        const decisionRow = await pool.query(
          `SELECT nd.id AS decision_id, nd.player_choice
             FROM narrative_chapters nc
             JOIN narrative_decisions nd ON nd.chapter_id = nc.id
            WHERE nc.player_id = $1 AND nc.chapter_number = $2 LIMIT 1`,
          [playerId, chapterNumber]
        );

        return res.status(200).json({
          chapterNumber,
          story: finalStory,
          choices: finalChoices,
          decisionId: decisionRow.rows[0].decision_id,
          playerChoice: decisionRow.rows[0].player_choice,
        });
      } catch (e: any) {
        try { await client.query("ROLLBACK"); } catch {}
        throw e;
      } finally {
        client.release();
      }
    }

    // ---- CHOOSE (record the player's pick; permanent once set) ------------
    if (action === "choose") {
      const decisionId = body.decisionId;
      const choiceKey = String(body.choiceKey || "").toUpperCase();
      if (!decisionId) return res.status(400).json({ error: "decisionId required" });
      if (!VALID_CHOICE_KEYS.has(choiceKey)) {
        return res.status(400).json({ error: "choiceKey must be A, B, or C" });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // Ownership check: the decision's chapter must belong to this player.
        const row = await client.query(
          `SELECT nd.id, nd.choices, nd.player_choice
             FROM narrative_decisions nd
             JOIN narrative_chapters nc ON nc.id = nd.chapter_id
            WHERE nd.id = $1 AND nc.player_id = $2
            FOR UPDATE`,
          [decisionId, playerId]
        );
        if (row.rowCount === 0) {
          await client.query("ROLLBACK");
          return res.status(404).json({ error: "decision not found for this player" });
        }
        if (row.rows[0].player_choice) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            error: "choice already made",
            playerChoice: row.rows[0].player_choice,
          });
        }
        const choices: ParsedChoice[] = row.rows[0].choices;
        const picked = choices.find((c) => c.key === choiceKey);
        if (!picked) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "unknown choiceKey for this decision" });
        }

        await client.query(
          `UPDATE narrative_decisions SET player_choice = $1 WHERE id = $2`,
          [picked.text, decisionId]
        );
        await client.query("COMMIT");
        return res.status(200).json({ ok: true, playerChoice: picked.text });
      } catch (e: any) {
        try { await client.query("ROLLBACK"); } catch {}
        return res.status(500).json({ error: "choose failed", detail: String(e?.message || e) });
      } finally {
        client.release();
      }
    }

    return res.status(400).json({ error: "unknown action", action });
  } catch (e: any) {
    return res.status(500).json({ error: "narrative endpoint failed", detail: String(e?.message || e) });
  }
};