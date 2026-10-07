/**
 * Unit checks for the reordering layer (cut here, paste there).
 * Run: npx tsx tests/segments-test.ts
 */

import {
  applyMoves,
  editedStartOf,
  editedToSource,
  isInSourceOrder,
  orderedDuration,
  orderWords,
  orderWordsForDisplay,
  moveSpanForWords,
  sliceOut,
  sourceToEdited,
  type EditMove,
} from "../lib/segments";
import type { TimeRange, Word } from "../lib/types";

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function nearly(a: number, b: number, eps = 1e-3) {
  return Math.abs(a - b) < eps;
}

function word(id: number, text: string, start: number, end: number): Word {
  return { id, text, start, end, speaker: 0, deleted: false };
}

function move(
  id: number,
  srcStart: number,
  srcEnd: number,
  insertBeforeSrc: number | null
): EditMove {
  return { id, srcStart, srcEnd, insertBeforeSrc };
}

function shape(ranges: TimeRange[]): string {
  return ranges.map((r) => `${r.start.toFixed(2)}-${r.end.toFixed(2)}`).join(" ");
}

// --- No moves is a pass-through (the whole existing editor must not change) ---
{
  const keeps: TimeRange[] = [
    { start: 0, end: 2 },
    { start: 5, end: 7 },
  ];
  const out = applyMoves(keeps, []);
  assert(shape(out) === "0.00-2.00 5.00-7.00", `pass-through changed: ${shape(out)}`);
  assert(out !== keeps, "pass-through must copy, not alias");
}

// --- sliceOut partitions a range it straddles ---
{
  const { removed, kept } = sliceOut([{ start: 0, end: 10 }], 3, 6);
  assert(shape(removed) === "3.00-6.00", `removed: ${shape(removed)}`);
  assert(shape(kept) === "0.00-3.00 6.00-10.00", `kept: ${shape(kept)}`);
}

// --- sliceOut leaves untouched ranges alone ---
{
  const { removed, kept } = sliceOut(
    [
      { start: 0, end: 2 },
      { start: 4, end: 6 },
    ],
    4,
    6
  );
  assert(shape(removed) === "4.00-6.00", `removed: ${shape(removed)}`);
  assert(shape(kept) === "0.00-2.00", `kept: ${shape(kept)}`);
}

// --- Move a later chunk to the very front ---
{
  const keeps: TimeRange[] = [
    { start: 0, end: 2 },
    { start: 2, end: 4 },
    { start: 4, end: 6 },
  ];
  const out = applyMoves(keeps, [move(1, 4, 6, null)]);
  assert(shape(out) === "4.00-6.00 0.00-2.00 2.00-4.00", `front move: ${shape(out)}`);
  assert(!isInSourceOrder(out), "sequence should no longer be in source order");
}

// --- Move a chunk to an insertion point inside a contiguous range (seam split) ---
{
  const keeps: TimeRange[] = [{ start: 0, end: 10 }];
  const out = applyMoves(keeps, [move(1, 8, 10, 3)]);
  assert(
    shape(out) === "0.00-3.00 8.00-10.00 3.00-8.00",
    `mid-range insert: ${shape(out)}`
  );
}

// --- Reordering never changes the total length ---
{
  const keeps: TimeRange[] = [
    { start: 0, end: 2 },
    { start: 5, end: 9 },
  ];
  const before = orderedDuration(keeps);
  const after = orderedDuration(applyMoves(keeps, [move(1, 5, 9, 0)]));
  assert(nearly(before, 6) && nearly(after, 6), `duration drifted: ${before} -> ${after}`);
}

// --- Edited time maps into the reordered sequence, not source order ---
{
  const keeps: TimeRange[] = [
    { start: 0, end: 2 },
    { start: 4, end: 6 },
  ];
  // Put 4-6 first, so edited 0s is source 4s.
  const out = applyMoves(keeps, [move(1, 4, 6, null)]);
  const a = editedToSource(out, 0);
  const b = editedToSource(out, 2.5);
  assert(a !== null && a.index === 0 && nearly(a.srcTime, 4), `edited 0s -> ${JSON.stringify(a)}`);
  assert(b !== null && b.index === 1 && nearly(b.srcTime, 0.5), `edited 2.5s -> ${JSON.stringify(b)}`);
  assert(editedToSource(out, 99) === null, "past the end should be null");
  assert(nearly(editedStartOf(out, 1), 2), `second entry starts at ${editedStartOf(out, 1)}`);
}

// --- A source moment reports where it now plays ---
{
  const out = applyMoves(
    [
      { start: 0, end: 2 },
      { start: 4, end: 6 },
    ],
    [move(1, 4, 6, null)]
  );
  const at = sourceToEdited(out, 5);
  assert(at.length === 1 && nearly(at[0], 1), `source 5s plays at ${JSON.stringify(at)}`);
}

// --- The transcript follows the new order ---
{
  const words = [
    word(1, "first", 0, 0.9),
    word(2, "second", 1.0, 1.9),
    word(3, "third", 4.0, 4.9),
    word(4, "fourth", 5.0, 5.9),
  ];
  const out = applyMoves(
    [
      { start: 0, end: 2 },
      { start: 4, end: 6 },
    ],
    [move(1, 4, 6, null)]
  );
  const ordered = orderWords(words, out);
  assert(
    ordered.map((w) => w.text).join(" ") === "third fourth first second",
    `transcript order: ${ordered.map((w) => w.text).join(" ")}`
  );
  assert(ordered.length === words.length, "no word may be dropped or duplicated");
}

// --- Deleting the moved material out from under a move degrades sanely ---
{
  // The move wants 4-6, but that range is no longer kept at all.
  const keeps: TimeRange[] = [{ start: 0, end: 2 }];
  const out = applyMoves(keeps, [move(1, 4, 6, null)]);
  assert(shape(out) === "0.00-2.00", `stale move should be inert: ${shape(out)}`);
}

// --- A move that only partially survives carries what is left ---
{
  const keeps: TimeRange[] = [
    { start: 0, end: 2 },
    { start: 5, end: 6 },
  ];
  const out = applyMoves(keeps, [move(1, 4, 6, null)]);
  assert(shape(out) === "5.00-6.00 0.00-2.00", `partial move: ${shape(out)}`);
}

// --- Two moves compose in recorded order ---
{
  const keeps: TimeRange[] = [
    { start: 0, end: 2 },
    { start: 2, end: 4 },
    { start: 4, end: 6 },
  ];
  const out = applyMoves(keeps, [move(1, 4, 6, null), move(2, 0, 2, null)]);
  assert(shape(out) === "0.00-2.00 4.00-6.00 2.00-4.00", `composed: ${shape(out)}`);
}

// --- Source order is still recognised as unreordered ---
{
  assert(
    isInSourceOrder([
      { start: 0, end: 2 },
      { start: 5, end: 7 },
    ]),
    "plain keep ranges are in source order"
  );
}

// --- Display order keeps deleted words next to their neighbours ---
{
  const words = [
    word(1, "first", 0, 0.9),
    { ...word(2, "um", 1.0, 1.4), deleted: true },
    word(3, "second", 1.5, 1.9),
    word(4, "third", 4.0, 4.9),
  ];
  // 4.0-6.0 moved to the front; 1.0-1.4 is cut out by the deletion.
  const ordered = applyMoves(
    [
      { start: 0, end: 1.0 },
      { start: 1.4, end: 2.0 },
      { start: 4, end: 6 },
    ],
    [move(1, 4, 6, null)]
  );
  const shown = orderWordsForDisplay(words, ordered);
  assert(
    shown.map((w) => w.text).join(" ") === "third first um second",
    `display order: ${shown.map((w) => w.text).join(" ")}`
  );
  assert(shown.length === words.length, "display order must not drop a word");
}

// --- In source order, display order is the untouched word list ---
{
  const words = [word(1, "a", 0, 0.5), word(2, "b", 1, 1.5)];
  const ordered: TimeRange[] = [{ start: 0, end: 2 }];
  assert(
    orderWordsForDisplay(words, ordered) === words,
    "source order should pass the array straight through"
  );
}

// --- Regression: a moved selection must not leave a sliver of its last word ---
//
// "Here is sentence one. Here is sentence two. Here is sentence three." with
// sentence two moved in front of sentence one. Whisper ends "two." at 5.8
// while the audio runs to ~6.0, and the next sentence starts at 6.2.
{
  const mk = (id: number, text: string, start: number, end: number) =>
    word(id, text, start, end);
  const sentence = (base: number, n: number, label: string) => [
    mk(base + 0, "Here", n, n + 0.4),
    mk(base + 1, "is", n + 0.45, n + 0.6),
    mk(base + 2, "sentence", n + 0.65, n + 1.2),
    mk(base + 3, label, n + 1.25, n + 1.8),
  ];
  const s1 = sentence(10, 0.2, "one"); // 0.20 - 2.00
  const s2 = sentence(20, 4.0, "two"); // 4.00 - 5.80
  const s3 = sentence(30, 6.2, "three"); // 6.20 - 8.00
  const words = [...s1, ...s2, ...s3];
  const DUR = 8.4;

  const span = moveSpanForWords(words, s2.map((w) => w.id), DUR);
  assert(span !== null, "span should be computed");
  assert(
    nearly(span.srcStart, 4.0),
    `leading edge should stay at the first word's start, got ${span.srcStart}`
  );
  // The fix: 6.2 (next onset), not 5.8 (last word's end).
  assert(
    nearly(span.srcEnd, 6.2),
    `trailing edge should snap to the next word's onset, got ${span.srcEnd}`
  );

  const keeps = [{ start: 0, end: DUR }];
  const ordered = applyMoves(keeps, [
    { id: 1, srcStart: span.srcStart, srcEnd: span.srcEnd, insertBeforeSrc: 0.2 },
  ]);

  // Nothing may start inside the moved sentence's audio — that is the stutter.
  const stray = ordered.find(
    (r) => r.start > 5.79 && r.start < 6.19
  );
  assert(
    !stray,
    `a range starts inside the moved audio: ${JSON.stringify(stray)}`
  );
  assert(
    shape(ordered) === "0.00-0.20 4.00-6.20 0.20-4.00 6.20-8.40",
    `unexpected sequence: ${shape(ordered)}`
  );

  // Sentence one keeps its own trailing audio rather than having it stolen.
  const one = ordered.find((r) => nearly(r.start, 0.2));
  assert(one !== undefined && one.end > 2.0, "sentence one lost its tail");
}

// --- Moving the final words takes the span to the end of the media ---
{
  const words = [word(1, "first", 0, 0.5), word(2, "last", 1.0, 1.5)];
  const span = moveSpanForWords(words, [2], 2.5);
  assert(
    span !== null && nearly(span.srcEnd, 2.5),
    `no next word should extend to duration, got ${span?.srcEnd}`
  );
}

// --- A deleted word still counts as the next boundary ---
{
  const words = [
    word(1, "keep", 0, 0.5),
    { ...word(2, "um", 0.9, 1.2), deleted: true },
    word(3, "tail", 1.4, 1.9),
  ];
  const span = moveSpanForWords(words, [1], 2.0);
  assert(
    span !== null && nearly(span.srcEnd, 0.9),
    `should snap to the deleted word's onset, got ${span?.srcEnd}`
  );
}

// --- An empty selection lifts nothing ---
{
  assert(moveSpanForWords([word(1, "a", 0, 1)], [], 2) === null, "empty selection");
}

console.log("segments: all checks passed");
