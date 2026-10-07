"use client";

import { useMemo } from "react";
import { getKeepRanges } from "@/lib/edits";
import { applyMoves } from "@/lib/segments";
import { useEditorStore } from "@/lib/store";
import { useCutRanges } from "@/hooks/useCutRanges";

/**
 * The edit in playback order: keep ranges with any reordering applied.
 *
 * This is what export and playback should consume. `useCutRanges()` remains the
 * right hook for anything asking "is this moment cut?", which is independent of
 * sequence order.
 */
export function useOrderedRanges() {
  const cuts = useCutRanges();
  const duration = useEditorStore((s) => s.duration);
  const moves = useEditorStore((s) => s.moves);
  return useMemo(
    () => applyMoves(getKeepRanges(cuts, duration), moves),
    [cuts, duration, moves]
  );
}
