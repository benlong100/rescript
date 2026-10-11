/**
 * Checks for transcript search.
 *
 * The interesting cases are the ones a naive substring search gets wrong: a
 * phrase spanning two word spans, a hit inside a speaker prefix that no word
 * owns, and overlapping occurrences.
 *
 * Run: npx tsx tests/transcript-find-test.ts
 */

import { buildTranscriptText } from "../lib/transcriptText";
import {
  MAX_MATCHES,
  findMatches,
  normalizeQuery,
  stepMatch,
} from "../lib/transcriptFind";
import type { SpeakerTurn, Word } from "../lib/types";

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

let nextId = 1;
function words(...texts: string[]): Word[] {
  return texts.map((text) => {
    const id = nextId++;
    return { id, text, start: id, end: id + 0.5, speaker: 0, deleted: false };
  });
}

function turn(speaker: number, list: Word[]): SpeakerTurn {
  return { speaker, words: list.map((w) => ({ ...w, speaker })) };
}

// "Alice: This is sentence one" / "Bob: Here is sentence two"
const first = words("This", "is", "sentence", "one");
const second = words("Here", "is", "sentence", "two");
const turns: SpeakerTurn[] = [turn(0, first), turn(1, second)];
const names = (id: number) => (id === 0 ? "Alice" : "Bob");
const { text, segments } = buildTranscriptText(turns, names);

// --- Query normalisation ---
{
  assert(normalizeQuery("  one  ") === "one", "trimmed");
  assert(normalizeQuery("sentence   two") === "sentence two", "inner runs collapse");
  assert(normalizeQuery("a\nb") === "a b", "newlines collapse");
  assert(normalizeQuery("   ") === "", "whitespace only is empty");
}

// --- A single word ---
{
  const m = findMatches(text, segments, "one");
  assert(m.length === 1, `expected 1 match, got ${m.length}`);
  assert(m[0].wordIds.length === 1, `one word: ${JSON.stringify(m[0].wordIds)}`);
  assert(m[0].wordIds[0] === first[3].id, "matched the right word");
}

// --- Case-insensitive ---
{
  assert(findMatches(text, segments, "THIS").length === 1, "upper-case query");
  assert(findMatches(text, segments, "tHiS").length === 1, "mixed-case query");
}

// --- A phrase spanning two words, which is the whole point ---
{
  const m = findMatches(text, segments, "sentence two");
  assert(m.length === 1, `phrase match: ${m.length}`);
  assert(
    m[0].wordIds.length === 2 &&
      m[0].wordIds[0] === second[2].id &&
      m[0].wordIds[1] === second[3].id,
    `phrase should touch both words: ${JSON.stringify(m[0].wordIds)}`
  );
}

// --- A phrase must not match across a speaker boundary ---
{
  // "one" ends turn one and "Here" starts turn two, separated by "\nBob: ".
  assert(
    findMatches(text, segments, "one Here").length === 0,
    "adjacent turns are not contiguous text"
  );
}

// --- Repeated words are all found, in order ---
{
  const m = findMatches(text, segments, "is");
  // "This" contains "is", then the standalone "is" in each turn.
  assert(m.length >= 3, `expected several hits, got ${m.length}`);
  for (let i = 1; i < m.length; i++) {
    assert(m[i].start > m[i - 1].start, "matches are in text order");
  }
  assert(
    m.every((x) => x.wordIds.length > 0),
    "every match owns at least one word"
  );
}

// --- A hit inside a speaker prefix is dropped, having no word to act on ---
{
  assert(findMatches(text, segments, "Alice").length === 0, "speaker name only");
  assert(findMatches(text, segments, "Bob").length === 0, "other speaker name");
  // Sanity: that name really is in the projected text.
  assert(text.includes("Alice:"), "the prefix is in the text");
}

// --- No match, and empty queries ---
{
  assert(findMatches(text, segments, "zebra").length === 0, "absent word");
  assert(findMatches(text, segments, "").length === 0, "empty query");
  assert(findMatches(text, segments, "   ").length === 0, "whitespace query");
}

// --- Overlapping occurrences advance rather than looping ---
{
  const repeated = words("aaaa");
  const built = buildTranscriptText([turn(0, repeated)], names);
  const m = findMatches(built.text, built.segments, "aa");
  assert(m.length === 2, `non-overlapping scan over "aaaa": ${m.length}`);
  assert(m[0].start < m[1].start, "second match is later");
}

// --- The cap is honoured ---
{
  const many = words(...Array.from({ length: 50 }, () => "aa"));
  const built = buildTranscriptText([turn(0, many)], names);
  const m = findMatches(built.text, built.segments, "a");
  assert(m.length <= MAX_MATCHES, `cap respected: ${m.length}`);
  assert(m.length === 100, `every "a" found: ${m.length}`);
}

// --- Stepping wraps in both directions ---
{
  assert(stepMatch(3, -1, 1) === 0, "first step forward from nothing");
  assert(stepMatch(3, -1, -1) === 2, "first step backward from nothing");
  assert(stepMatch(3, 0, 1) === 1, "forward");
  assert(stepMatch(3, 2, 1) === 0, "forward wraps");
  assert(stepMatch(3, 0, -1) === 2, "backward wraps");
  assert(stepMatch(0, -1, 1) === -1, "nothing to step through");
  assert(stepMatch(1, 0, 1) === 0, "a single match stays put");
}

console.log("transcript find: all checks passed");
