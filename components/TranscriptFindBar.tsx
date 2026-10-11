"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import {
  findMatches,
  stepMatch,
  type TranscriptMatch,
} from "@/lib/transcriptFind";
import type { TextSegment } from "@/lib/transcriptText";
import { useI18n } from "./I18nProvider";

/**
 * Find bar for the transcript.
 *
 * Landing on a match *selects* its words rather than drawing its own
 * highlight, so everything already bound to a selection — cut, the colour
 * swatches, Move, Correct, speaker reassignment — applies to a search result,
 * and the existing selection machinery handles scrolling it into view.
 *
 * Rendered only while open, so closing discards the query with no state to
 * clear and no effect to synchronise.
 */
export default function TranscriptFindBar({
  text,
  segments,
  onGoTo,
  onClose,
}: {
  text: string;
  segments: TextSegment[];
  /** Select the words a match covers. */
  onGoTo: (wordIds: number[]) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  // Recomputed rather than stored, so matches stay correct when the transcript
  // is edited while the bar is open.
  const matches = useMemo(
    () => findMatches(text, segments, query),
    [text, segments, query]
  );

  /**
   * Jump to a match, taking the list explicitly: a keystroke needs to act on
   * the matches for the text just typed, not the ones from the previous
   * render. Doing it here rather than in an effect also keeps the jump out of
   * the render cycle.
   */
  const jump = useCallback(
    (list: TranscriptMatch[], to: number) => {
      setIndex(to);
      const match = list[to];
      if (match) onGoTo(match.wordIds);
    },
    [onGoTo]
  );

  const retype = useCallback(
    (value: string) => {
      setQuery(value);
      const next = findMatches(text, segments, value);
      jump(next, next.length > 0 ? 0 : -1);
    },
    [text, segments, jump]
  );

  const step = useCallback(
    (delta: number) => jump(matches, stepMatch(matches.length, index, delta)),
    [jump, matches, index]
  );

  const total = matches.length;
  const position =
    total === 0
      ? t("find.none")
      : t("find.position", { current: index + 1, total });

  return (
    <div className="flex items-center gap-1 rounded-xl border border-zinc-200 bg-white px-1.5 py-1 shadow-sm dark:border-zinc-700 dark:bg-zinc-800">
      <Search size={13} className="shrink-0 text-zinc-400" />
      <input
        ref={inputRef}
        autoFocus
        value={query}
        onChange={(e) => retype(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            step(e.shiftKey ? -1 : 1);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
        placeholder={t("find.placeholder")}
        aria-label={t("find.placeholder")}
        className="w-40 bg-transparent text-[13px] text-zinc-800 outline-none placeholder:text-zinc-400 sm:w-52 dark:text-zinc-100"
      />
      <span
        aria-live="polite"
        className="shrink-0 px-1 text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500"
      >
        {query.trim() ? position : ""}
      </span>
      <button
        onClick={() => step(-1)}
        disabled={total === 0}
        title={t("find.previous")}
        aria-label={t("find.previous")}
        className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded text-zinc-500 transition hover:bg-zinc-100 disabled:opacity-30 dark:text-zinc-400 dark:hover:bg-zinc-700"
      >
        <ChevronUp size={14} />
      </button>
      <button
        onClick={() => step(1)}
        disabled={total === 0}
        title={t("find.next")}
        aria-label={t("find.next")}
        className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded text-zinc-500 transition hover:bg-zinc-100 disabled:opacity-30 dark:text-zinc-400 dark:hover:bg-zinc-700"
      >
        <ChevronDown size={14} />
      </button>
      <button
        onClick={onClose}
        title={t("find.close")}
        aria-label={t("find.close")}
        className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
      >
        <X size={13} />
      </button>
    </div>
  );
}
