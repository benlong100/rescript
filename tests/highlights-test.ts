/**
 * Unit checks for highlighting and the "unhighlighted" tools.
 *
 * Two load-bearing rules:
 *  - nothing is destructive until something is marked ("remove the bits I
 *    didn't mark" must not mean "delete everything" when nothing is marked);
 *  - marks made before colours existed still count, in the default colour.
 *
 * Run: npx tsx tests/highlights-test.ts
 */

import {
  DEFAULT_HIGHLIGHT,
  HIGHLIGHT_COLORS,
  hasHighlights,
  highlightOf,
  highlightedIds,
  isHighlightColor,
  isHighlighted,
  setHighlight,
  sharedHighlight,
  unhighlightedIds,
  unhighlightedKeptIds,
  visibleWords,
  type HighlightColor,
} from "../lib/highlights";
import type { Word } from "../lib/types";

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function word(
  id: number,
  text: string,
  deleted = false,
  highlight?: HighlightColor
): Word {
  const w: Word = { id, text, start: id, end: id + 0.5, speaker: 0, deleted };
  if (highlight) w.highlight = highlight;
  return w;
}

/** A word as written before colours existed. */
function legacyMarked(id: number, text: string): Word {
  return { id, text, start: id, end: id + 0.5, speaker: 0, deleted: false, highlighted: true };
}

// --- The palette ---
{
  assert(HIGHLIGHT_COLORS.length === 5, `expected 5 colours, got ${HIGHLIGHT_COLORS.length}`);
  assert(new Set(HIGHLIGHT_COLORS).size === 5, "colours are distinct");
  assert(
    (HIGHLIGHT_COLORS as readonly string[]).includes(DEFAULT_HIGHLIGHT),
    "the default is one of the five"
  );
  // Red and amber are reserved for deleted words and hesitation placeholders.
  assert(
    !(HIGHLIGHT_COLORS as readonly string[]).some((c) => c === "red" || c === "amber"),
    "red and amber must stay reserved"
  );
  for (const c of HIGHLIGHT_COLORS) assert(isHighlightColor(c), `${c} validates`);
  for (const bad of ["crimson", "", "Yellow", null, 3, undefined]) {
    assert(!isHighlightColor(bad), `${String(bad)} must not validate`);
  }
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
  assert(unhighlightedIds(words).length === 0, "nothing is hidden");
  assert(visibleWords(words, false) === words, "hiding with nothing marked shows everything");
}

// --- Marking in each colour, then clearing ---
{
  for (const color of HIGHLIGHT_COLORS) {
    const words = [word(1, "a"), word(2, "b")];
    const marked = setHighlight(words, [2], color);
    assert(marked !== words, `${color}: returns a new list`);
    assert(highlightOf(marked[1]) === color, `${color}: read back`);
    assert(isHighlighted(marked[1]), `${color}: counts as highlighted`);
    assert(highlightOf(marked[0]) === null, `${color}: others untouched`);
    assert(words[1].highlight === undefined, `${color}: original list untouched`);

    const cleared = setHighlight(marked, [2], null);
    assert(!hasHighlights(cleared), `${color}: cleared`);
    assert(
      cleared[1].highlight === undefined && !("highlight" in cleared[1]),
      `${color}: cleared marks leave no key behind`
    );
  }
}

// --- Recolouring replaces rather than accumulating ---
{
  const words = setHighlight([word(1, "a")], [1], "yellow");
  const recoloured = setHighlight(words, [1], "blue");
  assert(highlightOf(recoloured[0]) === "blue", `recoloured: ${highlightOf(recoloured[0])}`);
  assert(highlightedIds(recoloured).length === 1, "still one marked word");
}

// --- Different words can hold different colours at once ---
{
  let words = [word(1, "a"), word(2, "b"), word(3, "c")];
  words = setHighlight(words, [1], "green");
  words = setHighlight(words, [3], "pink");
  assert(highlightOf(words[0]) === "green", "first stays green");
  assert(highlightOf(words[1]) === null, "middle unmarked");
  assert(highlightOf(words[2]) === "pink", "last is pink");
  assert(unhighlightedKeptIds(words).join() === "2", "only the unmarked one is at risk");
}

// --- A no-op change returns the same array (no needless history entry) ---
{
  const words = [word(1, "a", false, "yellow"), word(2, "b")];
  assert(setHighlight(words, [1], "yellow") === words, "re-marking the same colour is a no-op");
  assert(setHighlight(words, [2], null) === words, "clearing an unmarked word is a no-op");
  assert(setHighlight(words, [], "blue") === words, "empty selection is a no-op");
}

// --- Marks from before colours existed still count ---
{
  const words = [legacyMarked(1, "old"), word(2, "new")];
  assert(highlightOf(words[0]) === DEFAULT_HIGHLIGHT, "legacy mark reads as the default colour");
  assert(isHighlighted(words[0]), "legacy mark counts as highlighted");
  assert(hasHighlights(words), "a legacy mark enables the tools");
  assert(unhighlightedKeptIds(words).join() === "2", "the legacy-marked word is a keeper");
  assert(
    visibleWords(words, false).map((w) => w.text).join() === "old",
    "hiding keeps the legacy-marked word"
  );
}

// --- Writing over a legacy mark drops the old field ---
{
  const words = [legacyMarked(1, "old")];
  const recoloured = setHighlight(words, [1], "blue");
  assert(recoloured !== words, "a legacy word is rewritten even to the same effective colour");
  assert(recoloured[0].highlight === "blue", "new field set");
  assert(
    !("highlighted" in recoloured[0]),
    "the deprecated boolean must not survive a write"
  );

  // Clearing a legacy mark must clear it, not leave the old field asserting it.
  const cleared = setHighlight(words, [1], null);
  assert(!hasHighlights(cleared), "legacy mark can be cleared");
  assert(!("highlighted" in cleared[0]), "old field gone");
}

// --- Re-marking a legacy word in the default colour still rewrites it ---
{
  const words = [legacyMarked(1, "old")];
  const same = setHighlight(words, [1], DEFAULT_HIGHLIGHT);
  assert(same !== words, "the stale field is worth one write to remove");
  assert(same[0].highlight === DEFAULT_HIGHLIGHT && !("highlighted" in same[0]), "migrated");
}

// --- Remove unhighlighted skips words already deleted ---
{
  const words = [
    word(1, "keep", false, "yellow"),
    word(2, "drop"),
    word(3, "gone", true),
    word(4, "drop too"),
  ];
  assert(
    unhighlightedKeptIds(words).join() === "2,4",
    `should skip the already-deleted word: ${unhighlightedKeptIds(words)}`
  );
  assert(
    unhighlightedIds(words).join() === "2,3,4",
    `hiding covers deleted words too: ${unhighlightedIds(words)}`
  );
}

// --- Hiding leaves only the marked words, whatever their colour ---
{
  const words = [
    word(1, "a", false, "purple"),
    word(2, "b"),
    word(3, "c", false, "green"),
  ];
  assert(visibleWords(words, true) === words, "showing is a pass-through");
  assert(
    visibleWords(words, false).map((w) => w.text).join(" ") === "a c",
    "both colours survive hiding"
  );
}

// --- A highlighted word can also be deleted; the two are independent ---
{
  const words = [word(1, "a", true, "blue"), word(2, "b")];
  assert(hasHighlights(words), "a deleted word can still be marked");
  assert(unhighlightedKeptIds(words).join() === "2", "it is not re-deleted");
}

// --- The selection's current colour, for the toolbar ring ---
{
  const words = [
    word(1, "a", false, "blue"),
    word(2, "b", false, "blue"),
    word(3, "c", false, "pink"),
    word(4, "d"),
    legacyMarked(5, "old"),
  ];

  assert(sharedHighlight(words, [1, 2]) === "blue", "agreeing words share a colour");
  assert(sharedHighlight(words, [1]) === "blue", "a single word shares its own colour");
  assert(sharedHighlight(words, [1, 3]) === null, "disagreeing words share nothing");
  assert(sharedHighlight(words, [1, 4]) === null, "an unmarked word means no shared colour");
  assert(sharedHighlight(words, [4]) === null, "an unmarked word alone is null");
  assert(sharedHighlight(words, []) === null, "no selection is null");
  assert(sharedHighlight(words, [99]) === null, "ids matching no word vouch for nothing");
  assert(
    sharedHighlight(words, [5]) === DEFAULT_HIGHLIGHT,
    "a pre-colour mark reports the default colour"
  );
  assert(
    sharedHighlight(words, [1, 5]) === null,
    "blue and a legacy yellow mark disagree"
  );
}

console.log("highlights: all checks passed");
