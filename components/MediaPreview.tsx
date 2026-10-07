"use client";

import { useCallback, useEffect, useRef } from "react";
import { useEditorStore } from "@/lib/store";
import { cutRangeAt, PLAYHEAD_EPSILON_S } from "@/lib/edits";
import { isInSourceOrder } from "@/lib/segments";
import { useCutRanges } from "@/hooks/useCutRanges";
import { useOrderedRanges } from "@/hooks/useOrderedRanges";

/**
 * Owns the <video>/<audio> element and the cut-skipping playback loop.
 * In video mode this is the visual preview; in audio mode it mounts a hidden
 * <audio> so playback still works when the preview panel is omitted.
 *
 * Two playback strategies:
 *
 * - **Source order** (nothing has been reordered) keeps the original
 *   cut-skipping loop untouched. It is the hot path for every edit that is
 *   only deletions, and it is well-tested, so moves must not regress it.
 * - **Reordered** follows the sequence from `useOrderedRanges()`, seeking to
 *   the next entry when the current one runs out. That seek can go backwards,
 *   which plain cut-skipping never had to do.
 */
export default function MediaPreview() {
  const mediaUrl = useEditorStore((s) => s.mediaUrl);
  const mediaKind = useEditorStore((s) => s.mediaKind);
  const setVideoEl = useEditorStore((s) => s.setVideoEl);
  const setDuration = useEditorStore((s) => s.setDuration);
  const setPlaying = useEditorStore((s) => s.setPlaying);
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);
  const cuts = useCutRanges();
  const ordered = useOrderedRanges();

  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const isAudio = mediaKind === "audio";
  const cutsRef = useRef(cuts);
  useEffect(() => {
    cutsRef.current = cuts;
  }, [cuts]);

  const orderedRef = useRef(ordered);
  /** Which sequence entry is playing; -1 until the playhead is located. */
  const seqIndexRef = useRef(-1);
  useEffect(() => {
    orderedRef.current = ordered;
    // The sequence changed under us — relocate on the next tick.
    seqIndexRef.current = -1;
  }, [ordered]);

  const refCb = useCallback(
    (el: HTMLMediaElement | null) => {
      mediaRef.current = el;
      setVideoEl(el);
    },
    [setVideoEl]
  );

  // Playback loop: mirror time into the store, skipping cuts and following
  // the sequence order when material has been moved.
  useEffect(() => {
    let raf = 0;

    /** Index of the sequence entry containing source time `t`, or -1. */
    const entryAt = (t: number): number =>
      orderedRef.current.findIndex(
        (r) => t >= r.start - PLAYHEAD_EPSILON_S && t < r.end - PLAYHEAD_EPSILON_S
      );

    const tick = () => {
      const media = mediaRef.current;
      if (media) {
        let t = media.currentTime;
        const seq = orderedRef.current;
        const reordered = seq.length > 0 && !isInSourceOrder(seq);

        if (!media.paused && reordered) {
          // Relocate after a seek, a sequence change, or the first frame.
          if (seqIndexRef.current < 0) seqIndexRef.current = entryAt(t);

          const idx = seqIndexRef.current;
          const cur = idx >= 0 ? seq[idx] : undefined;

          if (!cur) {
            // Playhead is in cut material: resume at the current entry's start.
            const fallback = Math.max(0, idx);
            if (fallback < seq.length) {
              seqIndexRef.current = fallback;
              t = seq[fallback].start;
              media.currentTime = t;
            }
          } else if (t >= cur.end - PLAYHEAD_EPSILON_S) {
            const nextIdx = idx + 1;
            if (nextIdx >= seq.length) {
              media.pause();
              seqIndexRef.current = 0;
              t = seq[0].start;
              media.currentTime = t;
            } else {
              seqIndexRef.current = nextIdx;
              t = seq[nextIdx].start;
              media.currentTime = t;
            }
          } else if (t < cur.start - PLAYHEAD_EPSILON_S) {
            // Seeked out from under us (click on the transcript / timeline).
            seqIndexRef.current = entryAt(t);
          }
        } else if (!media.paused) {
          const cut = cutRangeAt(t, cutsRef.current);
          if (cut) {
            const target = cut.end + PLAYHEAD_EPSILON_S;
            if (target >= media.duration - 0.05) {
              media.pause();
              media.currentTime = cut.start;
              t = cut.start;
            } else {
              media.currentTime = target;
              t = target;
            }
          }
        } else if (reordered) {
          // Paused: keep the index tracking wherever the user put the playhead.
          seqIndexRef.current = entryAt(t);
        }

        const prev = useEditorStore.getState().currentTime;
        if (Math.abs(prev - t) > 0.005) setCurrentTime(t);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [setCurrentTime]);

  const togglePlay = useCallback(() => {
    useEditorStore.getState().togglePlayback();
  }, []);

  if (!mediaUrl) return null;

  if (isAudio) {
    return (
      <audio
        ref={refCb}
        src={mediaUrl}
        preload="metadata"
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        className="hidden"
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-zinc-50/70 p-3 sm:p-4 dark:bg-zinc-950/70">
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <video
          ref={refCb}
          src={mediaUrl}
          playsInline
          onClick={togglePlay}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          className="max-h-full max-w-full cursor-pointer rounded-sm bg-black shadow-lg shadow-zinc-900/10 dark:shadow-black/40"
        />
      </div>
    </div>
  );
}
