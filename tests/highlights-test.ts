/**
 * Unit checks for highlighting and the "unhighlighted" tools.
 *
 * The load-bearing rule is that nothing is destructive until something is
 * actually marked: "remove the bits I didn't mark" must not mean "delete the
 * whole transcript" when nothing is marked yet.
 *
 * Run: npx tsx tests/highlights-test.ts
 */

import {
  hasHighlights,
  highlightedIds,
  setHighlighted,
  unhighlightedIds,
  unhighlightedKeptIds,
  visibleWords,
} from "../lib/highlights";
import type { Word } from "../lib/types";

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function word(id: number, text: string, deleted = false, highlighted?: boolean): Word {
  const w: Word = { id, text, start: id, end: id + 0.5, speaker: 0, deleted };
  if (highlighted !== undefined) w.highlighted = highlighted;
  return w;
}

// --- Nothing marked: every tool is inert ---
{
  const words = [word(1, "a"), word(2, "b"), word(3, "c")];
  assert(!hasHighlights(words), "no highlights");
  assert(highlightedIds(words).length === 0, "no highlighted ids");
  assert(
    unhighlightedKeptIds(words).length === 0,
    "with nothing marked, Remove unhighlighted must touch nothing"
  );
  assert(
    unhighlightedIds(words).length === 0,
    "with nothing marked, nothing is hidden"
  );
  assert(
    visibleWords(words, false) === words,
    "hiding with nothing marked shows everything"
  );
}

// --- Marking, then unmarking ---
{
  const words = [word(1, "a"), word(2, "b"), word(3, "c")];
  const marked = setHighlighted(words, [2], true);
  assert(marked !== words, "marking returns a new list");
  assert(highlightedIds(marked).join() === "2", `marked: ${highlightedIds(marked)}`);
  assert(words[1].highlighted === undefined, "the original list is untouched");

  const cleared = setHighlighted(marked, [2], false);
  assert(!hasHighlights(cleared), "unmarking clears it");
  assert(
    cleared[1].highlighted === undefined,
    "cleared marks are undefined, so untouched transcripts serialize unchanged"
  );
}

// --- A no-op change returns the same array (no needless history entry) ---
{
  const words = [word(1, "a", false, true), word(2, "b")];
  assert(setHighlighted(words, [1], true) === words, "re-marking is a no-op");
  assert(setHighlighted(words, [2], false) === words, "clearing an unmarked word is a no-op");
  assert(setHighlighted(words, [], true) === words, "empty selection is a no-op");
}

// --- Remove unhighlighted skips words already deleted ---
{
  const words = [
    word(1, "keep", false, true),
    word(2, "drop"),
    word(3, "gone", true),
    word(4, "drop too"),
  ];
  assert(
    unhighlightedKeptIds(words).join() === "2,4",
    `should skip the already-deleted word: ${unhighlightedKeptIds(words)}`
  );
  // Hiding is about display, so it does include the deleted one.
  assert(
    unhighlightedIds(words).join() === "2,3,4",
    `hiding covers deleted words too: ${unhighlightedIds(words)}`
  );
}

// --- Hiding leaves only the marked words ---
{
  const words = [
    word(1, "a", false, true),
    word(2, "b"),
    word(3, "c", false, true),
  ];
  assert(visibleWords(words, true) === words, "showing is a pass-through");
  const shown = visibleWords(words, false);
  assert(
    shown.map((w) => w.text).join(" ") === "a c",
    `hidden view: ${shown.map((w) => w.text).join(" ")}`
  );
}

// --- A highlighted word can also be deleted; the two are independent ---
{
  const words = [word(1, "a", true, true), word(2, "b")];
  assert(hasHighlights(words), "a deleted word can still be marked");
  assert(
    unhighlightedKeptIds(words).join() === "2",
    "the marked-but-deleted word is not re-deleted"
  );
}

console.log("highlights: all checks passed");
