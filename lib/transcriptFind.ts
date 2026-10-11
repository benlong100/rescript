/**
 * Finding text in the transcript.
 *
 * Searches the plain-text projection from lib/transcriptText.ts rather than the
 * word list, which is what makes a phrase spanning several words match: the
 * projection puts a space between words, so "sentence two" is contiguous there
 * while being two separate spans on screen. Each match is then mapped back to
 * the words it touches, so the caller can select them and every existing tool —
 * cut, highlight, move — applies to a search result.
 */

import { wordIdsInRange, type TextSegment } from "./transcriptText";

export interface TranscriptMatch {
  /** Char offsets into the projected text, half-open. */
  start: number;
  end: number;
  /** Words the match touches, in text order. */
  wordIds: number[];
}

/**
 * Guard against a pathological query ("e" across an hour of speech) building an
 * array nobody can use. Far more matches than anyone navigates by hand.
 */
export const MAX_MATCHES = 2000;

/**
 * Collapse whitespace so a query typed with a double space, or copied with a
 * line break in it, still matches the single-spaced projection.
 */
export function normalizeQuery(query: string): string {
  return query.replace(/\s+/g, " ").trim();
}

/**
 * Matches of `query` in `text`, case-insensitively, in text order.
 *
 * Matches landing entirely inside a speaker prefix ("Name: ") are dropped:
 * they touch no word, so there would be nothing to select or act on.
 */
export function findMatches(
  text: string,
  segments: TextSegment[],
  query: string
): TranscriptMatch[] {
  const needle = normalizeQuery(query).toLowerCase();
  if (needle.length === 0) return [];

  const haystack = text.toLowerCase();
  const matches: TranscriptMatch[] = [];

  let from = 0;
  while (matches.length < MAX_MATCHES) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) break;
    const end = at + needle.length;
    const wordIds = wordIdsInRange(segments, at, end);
    if (wordIds.length > 0) matches.push({ start: at, end, wordIds });
    // Step past this occurrence. The guard keeps a zero-width needle from
    // looping, though normalizeQuery already rules that out.
    from = at + Math.max(1, needle.length);
  }

  return matches;
}

/**
 * Index of the match to show after moving `delta` from `current`, wrapping at
 * both ends. Returns -1 when there is nothing to step through.
 */
export function stepMatch(
  count: number,
  current: number,
  delta: number
): number {
  if (count <= 0) return -1;
  if (current < 0) return delta >= 0 ? 0 : count - 1;
  return (((current + delta) % count) + count) % count;
}
