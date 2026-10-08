/**
 * Highlighting: marking words as keepers, and acting on everything else.
 *
 * A highlight is an annotation, not an edit to the media — it changes nothing
 * about what renders until one of the "unhighlighted" tools is used. That split
 * is why these are plain functions over the word list rather than anything
 * touching cut ranges.
 */

import type { Word } from "./types";

/** Words the user has marked. */
export function highlightedIds(words: Word[]): number[] {
  return words.filter((w) => w.highlighted === true).map((w) => w.id);
}

/** Whether anything is marked at all. */
export function hasHighlights(words: Word[]): boolean {
  return words.some((w) => w.highlighted === true);
}

/**
 * Words that would be cut by "Remove unhighlighted": everything unmarked that
 * is still in the edit.
 *
 * Already-deleted words are excluded so the menu's count reflects what would
 * actually change. Returns nothing when no word is highlighted — otherwise the
 * tool would offer to delete the entire transcript, which is never what
 * "remove the bits I didn't mark" means.
 */
export function unhighlightedKeptIds(words: Word[]): number[] {
  if (!hasHighlights(words)) return [];
  return words
    .filter((w) => w.highlighted !== true && !w.deleted)
    .map((w) => w.id);
}

/** Words hidden by "Hide unhighlighted" — unmarked, whatever their state. */
export function unhighlightedIds(words: Word[]): number[] {
  if (!hasHighlights(words)) return [];
  return words.filter((w) => w.highlighted !== true).map((w) => w.id);
}

/** Apply or clear the mark on `ids`, returning a new list (or the same one). */
export function setHighlighted(
  words: Word[],
  ids: Iterable<number>,
  on: boolean
): Word[] {
  const target = new Set(ids);
  if (target.size === 0) return words;
  let changed = false;
  const next = words.map((w) => {
    if (!target.has(w.id)) return w;
    const current = w.highlighted === true;
    if (current === on) return w;
    changed = true;
    // Written as undefined rather than false so a transcript that has never
    // been highlighted serializes exactly as it did before.
    return { ...w, highlighted: on ? true : undefined };
  });
  return changed ? next : words;
}

/** The words to render when unhighlighted ones are hidden. */
export function visibleWords(words: Word[], showUnhighlighted: boolean): Word[] {
  if (showUnhighlighted || !hasHighlights(words)) return words;
  return words.filter((w) => w.highlighted === true);
}
