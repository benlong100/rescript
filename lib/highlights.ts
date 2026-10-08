/**
 * Highlighting: marking words as keepers, and acting on everything else.
 *
 * A highlight is an annotation, not an edit to the media — it changes nothing
 * about what renders until one of the "unhighlighted" tools is used. That split
 * is why these are plain functions over the word list rather than anything
 * touching cut ranges.
 */

import type { Word } from "./types";

/**
 * The marker colours, in the order they appear in the toolbar.
 *
 * Red and amber are deliberately absent: red is how deleted words are drawn,
 * and amber marks hesitation placeholders and lifted material. A marker that
 * looked like either would be read as a state rather than a choice.
 */
export const HIGHLIGHT_COLORS = [
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
] as const;

export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

export function isHighlightColor(value: unknown): value is HighlightColor {
  return (
    typeof value === "string" &&
    (HIGHLIGHT_COLORS as readonly string[]).includes(value)
  );
}

/** The default colour, used for marks made before colours existed. */
export const DEFAULT_HIGHLIGHT: HighlightColor = "yellow";

/**
 * A word's marker colour, or null.
 *
 * The single place that understands the pre-colour `highlighted: true` field,
 * so every caller gets migration for free and old project files keep their
 * marks. Writing through `setHighlight` replaces the old field as words are
 * touched.
 */
export function highlightOf(word: Word): HighlightColor | null {
  if (isHighlightColor(word.highlight)) return word.highlight;
  if (word.highlighted === true) return DEFAULT_HIGHLIGHT;
  return null;
}

export function isHighlighted(word: Word): boolean {
  return highlightOf(word) !== null;
}

/** Words the user has marked, in any colour. */
export function highlightedIds(words: Word[]): number[] {
  return words.filter(isHighlighted).map((w) => w.id);
}

/** Whether anything is marked at all. */
export function hasHighlights(words: Word[]): boolean {
  return words.some(isHighlighted);
}

/**
 * Words that would be cut by "Remove unhighlighted": everything unmarked that
 * is still in the edit. Colour is irrelevant — any marker counts as a keeper.
 *
 * Already-deleted words are excluded so the menu's count reflects what would
 * actually change. Returns nothing when no word is highlighted — otherwise the
 * tool would offer to delete the entire transcript, which is never what
 * "remove the bits I didn't mark" means.
 */
export function unhighlightedKeptIds(words: Word[]): number[] {
  if (!hasHighlights(words)) return [];
  return words.filter((w) => !isHighlighted(w) && !w.deleted).map((w) => w.id);
}

/** Words hidden by "Hide unhighlighted" — unmarked, whatever their state. */
export function unhighlightedIds(words: Word[]): number[] {
  if (!hasHighlights(words)) return [];
  return words.filter((w) => !isHighlighted(w)).map((w) => w.id);
}

/**
 * Set or clear the marker on `ids`, returning a new list (or the same one when
 * nothing changed, so a no-op spends no undo entry).
 */
export function setHighlight(
  words: Word[],
  ids: Iterable<number>,
  color: HighlightColor | null
): Word[] {
  const target = new Set(ids);
  if (target.size === 0) return words;
  let changed = false;
  const next = words.map((w) => {
    if (!target.has(w.id)) return w;
    // Compare against the migrated value, so re-marking a legacy word in the
    // default colour is correctly a no-op in colour terms but still worth
    // rewriting if it carries the old field.
    const current = highlightOf(w);
    const legacy = w.highlighted !== undefined;
    if (current === color && !legacy) return w;
    changed = true;
    const next: Word = { ...w };
    // Clear BOTH fields: the deprecated boolean and the current colour. Only
    // removing the boolean left a cleared word still carrying its old colour.
    // Copy-and-delete rather than a rest spread, so any field added to Word
    // later survives untouched.
    delete next.highlighted;
    delete next.highlight;
    // Absent rather than null when cleared, so a transcript that has never
    // been highlighted serializes exactly as it did before the feature.
    if (color !== null) next.highlight = color;
    return next;
  });
  return changed ? next : words;
}

/** The words to render when unhighlighted ones are hidden. */
export function visibleWords(words: Word[], showUnhighlighted: boolean): Word[] {
  if (showUnhighlighted || !hasHighlights(words)) return words;
  return words.filter(isHighlighted);
}
