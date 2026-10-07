/**
 * Reordering layer: turns the sorted keep ranges into an ordered *playback*
 * sequence so material can be moved (cut here, paste there), not just removed.
 *
 * Why a move list and not a segment list
 * --------------------------------------
 * The natural model for this is a full EDL — an ordered list of segments as the
 * single source of truth. That means rewriting deletion, restore, split, trim
 * and undo/redo on top of it, because today all of those regenerate the keep
 * ranges from `Word.deleted` + `manualCuts` on every edit (see lib/edits.ts).
 *
 * Instead, moves are recorded *on top* of that pipeline and re-applied after it.
 * A move is addressed by **source time**, not by segment id or index, precisely
 * because keep ranges are rebuilt from scratch on every word edit: a source
 * range survives that rebuild, an index does not. Deleting a word inside
 * already-moved material therefore degrades sanely — the move simply carries
 * less material — rather than corrupting the order.
 *
 * With no moves recorded, `applyMoves` returns the keep ranges unchanged, so
 * the whole existing editor behaves exactly as before.
 */

import type { EditMove, TimeRange, Word } from "./types";

/** Source-time comparisons are fuzzy at this scale (matches lib/edits.ts). */
const EPS = 1e-4;

/** Split any range that straddles `t` so an insertion point lands on a seam. */
function splitAtSrc(ranges: TimeRange[], t: number): TimeRange[] {
  const out: TimeRange[] = [];
  for (const r of ranges) {
    if (t > r.start + EPS && t < r.end - EPS) {
      out.push({ start: r.start, end: t }, { start: t, end: r.end });
    } else {
      out.push({ ...r });
    }
  }
  return out;
}

/**
 * Partition `ranges` into the parts overlapping [srcStart, srcEnd) and the
 * parts outside it. Both sides keep their existing sequence order.
 */
export type { EditMove };

export function sliceOut(
  ranges: TimeRange[],
  srcStart: number,
  srcEnd: number
): { removed: TimeRange[]; kept: TimeRange[] } {
  const removed: TimeRange[] = [];
  const kept: TimeRange[] = [];
  for (const r of ranges) {
    const lo = Math.max(r.start, srcStart);
    const hi = Math.min(r.end, srcEnd);
    if (hi - lo > EPS) {
      removed.push({ start: lo, end: hi });
      if (lo - r.start > EPS) kept.push({ start: r.start, end: lo });
      if (r.end - hi > EPS) kept.push({ start: hi, end: r.end });
    } else {
      kept.push({ ...r });
    }
  }
  return { removed, kept };
}

/** Apply one move to an ordered sequence. */
export function applyMove(ordered: TimeRange[], move: EditMove): TimeRange[] {
  const { removed, kept } = sliceOut(ordered, move.srcStart, move.srcEnd);
  // The moved material was deleted out from under us — nothing left to place.
  if (removed.length === 0) return ordered.map((r) => ({ ...r }));

  const target = move.insertBeforeSrc;
  if (target === null) return [...removed, ...kept];

  const seamed = splitAtSrc(kept, target);
  return insertAt(seamed, removed, target);
}

/**
 * Splice `material` in at the seam beginning at source time `target`.
 *
 * Addressed by an exact match on the seam `splitAtSrc` just created, *not* by
 * the first entry whose start is at or after the target. Once anything has been
 * moved, the sequence is no longer sorted by source time, so "first start >=
 * target" picks an arbitrary earlier position: moving a word into a sentence
 * that had already been relocated put it at the very front of the edit instead.
 * A seam is unique, because no source moment appears twice in the sequence.
 */
function insertAt(
  seamed: TimeRange[],
  material: TimeRange[],
  target: number
): TimeRange[] {
  let at = seamed.findIndex((r) => Math.abs(r.start - target) < EPS);

  if (at < 0) {
    // No seam: the target sits inside cut material (a deleted word can still
    // be selected when deleted words are shown). Aim for the nearest kept
    // moment after it, wherever that now sits in the sequence.
    let best = -1;
    for (let i = 0; i < seamed.length; i++) {
      if (
        seamed[i].start >= target - EPS &&
        (best < 0 || seamed[i].start < seamed[best].start)
      ) {
        best = i;
      }
    }
    at = best < 0 ? seamed.length : best;
  }

  return [...seamed.slice(0, at), ...material, ...seamed.slice(at)];
}

/**
 * The edit in playback order. `keepRanges` comes straight from
 * `getKeepRanges()`; moves are applied in the order they were recorded.
 */
export function applyMoves(keepRanges: TimeRange[], moves: EditMove[]): TimeRange[] {
  if (moves.length === 0) return keepRanges.map((r) => ({ ...r }));
  return moves.reduce(applyMove, keepRanges);
}

/** Total length of the edit. Reordering never changes this. */
export function orderedDuration(ordered: TimeRange[]): number {
  return ordered.reduce((acc, r) => acc + (r.end - r.start), 0);
}

/**
 * Map a time on the edited timeline to its source time, plus which sequence
 * entry it falls in. Returns null past the end of the edit.
 */
export function editedToSource(
  ordered: TimeRange[],
  t: number
): { index: number; srcTime: number } | null {
  let acc = 0;
  for (let i = 0; i < ordered.length; i++) {
    const len = ordered[i].end - ordered[i].start;
    if (t < acc + len - EPS) {
      return { index: i, srcTime: ordered[i].start + Math.max(0, t - acc) };
    }
    acc += len;
  }
  return null;
}

/** Edited-timeline time at which sequence entry `index` begins. */
export function editedStartOf(ordered: TimeRange[], index: number): number {
  let acc = 0;
  for (let i = 0; i < index && i < ordered.length; i++) {
    acc += ordered[i].end - ordered[i].start;
  }
  return acc;
}

/**
 * Every edited time a source moment plays at. Once material can be duplicated
 * this is genuinely one-to-many, which is why it does not mirror
 * `originalToEdited()` in lib/edits.ts.
 */
export function sourceToEdited(ordered: TimeRange[], srcTime: number): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const r of ordered) {
    const len = r.end - r.start;
    if (srcTime >= r.start - EPS && srcTime < r.end - EPS) {
      out.push(acc + (srcTime - r.start));
    }
    acc += len;
  }
  return out;
}

/**
 * The transcript in playback order: words grouped by the sequence entry whose
 * source range contains their midpoint. Midpoint matching mirrors how the
 * timeline already decides whether a word belongs to a cut.
 */
export function orderWords(words: Word[], ordered: TimeRange[]): Word[] {
  const out: Word[] = [];
  for (const r of ordered) {
    const inRange = words.filter((w) => {
      const mid = w.start + (w.end - w.start) / 2;
      return mid >= r.start - EPS && mid < r.end - EPS;
    });
    inRange.sort((a, b) => a.start - b.start);
    out.push(...inRange);
  }
  return out;
}

/**
 * The transcript as it should be *displayed* once material has been moved.
 *
 * `orderWords()` only knows about kept material, but the panel also renders
 * deleted words (struck through, behind the Show deleted toggle). Each deleted
 * word is re-attached to the kept word that precedes it in source time, so a
 * deletion stays visually where the speaker said it instead of collapsing to
 * the end of the transcript.
 *
 * In source order this returns `words` untouched, so the normal editor path
 * does no extra work.
 */
export function orderWordsForDisplay(words: Word[], ordered: TimeRange[]): Word[] {
  if (isInSourceOrder(ordered)) return words;

  const kept = orderWords(words, ordered);
  const keptIds = new Set(kept.map((w) => w.id));

  // Walk source order, hanging each deleted word off the last kept word seen.
  const trailing = new Map<number, Word[]>();
  const leading: Word[] = [];
  let lastKept: Word | null = null;
  for (const w of [...words].sort((a, b) => a.start - b.start)) {
    if (keptIds.has(w.id)) {
      lastKept = w;
    } else if (lastKept === null) {
      leading.push(w);
    } else {
      const bucket = trailing.get(lastKept.id);
      if (bucket) bucket.push(w);
      else trailing.set(lastKept.id, [w]);
    }
  }

  const out: Word[] = [...leading];
  for (const w of kept) {
    out.push(w);
    const tail = trailing.get(w.id);
    if (tail) out.push(...tail);
  }
  return out;
}

/**
 * The source span to lift for a selection of words.
 *
 * Not simply `[min(start), max(end)]`. ASR word-end timestamps land slightly
 * *before* the audio actually stops, so a span that ends at the last selected
 * word's `end` leaves a sliver of that word behind — which, once the material
 * is moved away, plays as a stutter at the seam ("…sentence two. sentence one.
 * two. sentence three."). The trailing edge is therefore snapped forward to the
 * onset of the next word, so every sample belonging to the selection travels
 * with it.
 *
 * The leading edge is deliberately *not* snapped back to the previous word's
 * `end`: that would steal the preceding word's own trailing audio and clip it
 * instead — the same bug, moved one seam to the left. Starting at the first
 * selected word's `start` matches how every cut in the app already behaves.
 *
 * Deleted words count as neighbours: their audio is cut out either way, so the
 * gap up to a deleted word is still the right boundary.
 */
export function moveSpanForWords(
  words: Word[],
  selectedIds: Iterable<number>,
  duration: number
): { srcStart: number; srcEnd: number } | null {
  const ids = new Set(selectedIds);
  const picked = words.filter((w) => ids.has(w.id));
  if (picked.length === 0) return null;

  const srcStart = Math.min(...picked.map((w) => w.start));
  const maxEnd = Math.max(...picked.map((w) => w.end));

  // Onset of the earliest word that starts at or after the selection ends.
  let nextStart = duration;
  for (const w of words) {
    if (ids.has(w.id)) continue;
    if (w.start >= maxEnd - EPS && w.start < nextStart) nextStart = w.start;
  }

  return { srcStart, srcEnd: Math.max(maxEnd, nextStart) };
}

/** True when the sequence is still in plain source order (no reordering). */
export function isInSourceOrder(ordered: TimeRange[]): boolean {
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i].start < ordered[i - 1].start - EPS) return false;
  }
  return true;
}
